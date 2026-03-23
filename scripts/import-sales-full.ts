import { PrismaClient } from '../prisma/generated/client/index.js';
import XLSX from 'xlsx';
import * as path from 'path';

const prisma = new PrismaClient();

interface InvoiceItem {
    slNo: number;
    code: string;
    itemName: string;
    hsnCode: string;
    taxPercent: number;
    qty: number;
    unitPrice: number;
    netAmt: number;
    taxAmt: number;
    totalAmount: number;
}

interface Invoice {
    invoiceNo: string;
    date: string;
    items: InvoiceItem[];
    grandTotal: number;
}

async function main() {
    console.log('📊 Importing Detailed Sales Transactions from MaxSell');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const migrationDir = path.join(process.cwd(), 'migration');
    const salesFile = path.join(migrationDir, 'Report_Sales_Detail.xls');

    console.log('📖 Reading sales data...');
    const workbook = XLSX.readFile(salesFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];

    console.log(`  ✓ Found ${rawData.length} rows\n`);

    // Get admin user
    const adminUser = await prisma.user.findFirst({
        where: { role: 'ADMIN' }
    });

    if (!adminUser) {
        console.error('❌ No admin user found.');
        await prisma.$disconnect();
        return;
    }

    // Get all products for matching by code
    const products = await prisma.product.findMany({
        include: { variants: true }
    });

    const productsByName = new Map<string, any>();
    products.forEach(p => {
        productsByName.set(p.name.toLowerCase().trim(), p);
    });

    console.log('📦 Parsing invoices...\n');

    const invoices: Invoice[] = [];
    let i = 0;

    while (i < rawData.length) {
        const row = rawData[i];

        // Look for invoice header
        if (row[7] === 'Invoice No/Date :' && row[9]) {
            const invoiceInfo = row[9].toString().split('/').map((s: string) => s.trim());
            const invoiceNo = invoiceInfo[0];
            const date = invoiceInfo[1];

            // Skip to item header row (should be a few rows down)
            i++;
            while (i < rawData.length && rawData[i][0] !== 'Sl. No') {
                i++;
            }
            i++; // Move past header row

            // Parse items
            const items: InvoiceItem[] = [];
            while (i < rawData.length) {
                const itemRow = rawData[i];

                // Check if this is a total row or end of invoice
                if (itemRow[2] === 'Total' || itemRow[0] === '' || itemRow[0] === 'Customer : ') {
                    break;
                }

                // Parse item
                if (itemRow[0] && itemRow[1] && itemRow[2]) {
                    items.push({
                        slNo: parseInt(itemRow[0]) || 0,
                        code: itemRow[1]?.toString() || '',
                        itemName: itemRow[2]?.toString().trim() || '',
                        hsnCode: itemRow[3]?.toString() || '',
                        taxPercent: parseFloat(itemRow[4]) || 5,
                        qty: parseFloat(itemRow[5]) || 1,
                        unitPrice: parseFloat(itemRow[6]) || 0,
                        netAmt: parseFloat(itemRow[7]) || 0,
                        taxAmt: parseFloat(itemRow[8]) || 0,
                        totalAmount: parseFloat(itemRow[9]) || 0,
                    });
                }
                i++;
            }

            // Find Grand Total
            let grandTotal = 0;
            while (i < rawData.length && i < rawData.length) {
                const row = rawData[i];
                if (row[7] === 'Grand Total') {
                    grandTotal = parseFloat(row[9]) || 0;
                    break;
                }
                if (row[0] === 'Customer : ' || row[7] === 'Invoice No/Date :') {
                    break;
                }
                i++;
            }

            if (items.length > 0) {
                invoices.push({
                    invoiceNo,
                    date,
                    items,
                    grandTotal
                });
            }
        }
        i++;
    }

    console.log(`  ✓ Parsed ${invoices.length} invoices\n`);
    console.log('💾 Importing to database...\n');

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const invoice of invoices) {
        try {
            await createSale(invoice, adminUser.id, productsByName);
            imported++;

            if (imported % 100 === 0) {
                console.log(`  ✓ Imported ${imported} / ${invoices.length} invoices...`);
            }
        } catch (error: any) {
            errors.push(`Invoice ${invoice.invoiceNo}: ${error.message}`);
            skipped++;
        }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Import Complete!\n');
    console.log(`📊 Summary:`);
    console.log(`  ✓ Imported: ${imported} sales`);
    console.log(`  ⏭️  Skipped: ${skipped} sales`);
    console.log(`  📦 Total items: ${invoices.reduce((sum, inv) => sum + inv.items.length, 0)}`);

    if (errors.length > 0) {
        console.log(`\n❌ Errors (first 10):`);
        errors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
        if (errors.length > 10) {
            console.log(`  ... and ${errors.length - 10} more`);
        }
    }

    console.log('\n💡 All sales flagged as historical (isHistorical: true, importedFrom: "MaxSell")');

    await prisma.$disconnect();
}

async function createSale(invoice: Invoice, userId: string, productsByName: Map<string, any>) {
    // Parse date (format: 02-04-2025 = DD-MM-YYYY)
    let saleDate = new Date();
    try {
        const dateParts = invoice.date.split('-');
        if (dateParts.length === 3) {
            const day = parseInt(dateParts[0]);
            const month = parseInt(dateParts[1]) - 1;
            const year = parseInt(dateParts[2]);
            saleDate = new Date(year, month, day);
        }
    } catch (e) {
        // Use current date if parsing fails
    }

    // Calculate totals from items
    const subtotal = invoice.items.reduce((sum, item) => sum + item.netAmt, 0);
    const taxAmount = invoice.items.reduce((sum, item) => sum + item.taxAmt, 0);
    const grandTotal = invoice.grandTotal || (subtotal + taxAmount);

    // Create sale items
    const saleItems = invoice.items.map(item => {
        // Try to find matching product by name
        const itemNameClean = item.itemName.toLowerCase().replace(/\\n/g, '').trim();
        let product = productsByName.get(itemNameClean);

        // If not found, try partial match
        if (!product) {
            for (const [name, prod] of productsByName.entries()) {
                if (itemNameClean.includes(name) || name.includes(itemNameClean)) {
                    product = prod;
                    break;
                }
            }
        }

        const variant = product?.variants[0];
        const variantId = variant?.id || 'unknown';

        return {
            variantId: variantId,
            productName: item.itemName.replace(/\\n/g, '').trim(),
            variantInfo: item.code,
            quantity: Math.round(item.qty),
            mrp: item.unitPrice,
            sellingPrice: item.unitPrice,
            discount: 0,
            taxRate: item.taxPercent,
            taxAmount: item.taxAmt,
            total: item.totalAmount
        };
    });

    // Create sale
    await prisma.sale.create({
        data: {
            billNo: parseInt(invoice.invoiceNo),
            userId: userId,
            customerName: 'Walk-in Customer',
            customerPhone: null,
            subtotal: subtotal,
            discount: 0,
            discountPercent: 0,
            taxAmount: taxAmount,
            cgst: taxAmount / 2,
            sgst: taxAmount / 2,
            grandTotal: grandTotal,
            paymentMethod: 'CASH',
            paidAmount: grandTotal,
            changeAmount: 0,
            status: 'COMPLETED',
            remarks: `Imported from MaxSell - Invoice #${invoice.invoiceNo}`,
            isHistorical: true,
            importedFrom: 'MaxSell',
            createdAt: saleDate,
            items: {
                create: saleItems
            }
        }
    });
}

main().catch(async (error) => {
    console.error('❌ Import failed:', error.message);
    console.error(error.stack);
    await prisma.$disconnect();
    process.exit(1);
});
