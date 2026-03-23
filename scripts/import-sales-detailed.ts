import { PrismaClient } from '../prisma/generated/client/index.js';
import XLSX from 'xlsx';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    console.log('📊 Importing Detailed Sales Transactions from MaxSell');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const migrationDir = path.join(process.cwd(), 'migration');
    const salesFile = path.join(migrationDir, 'Report_Sales_Detail.xls');

    console.log('📖 Reading sales data...');
    const workbook = XLSX.readFile(salesFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

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

    // Get all products for matching
    const products = await prisma.product.findMany({
        include: { variants: true }
    });

    let billNoCounter = 1;
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    console.log('📦 Parsing sales transactions...\n');
    console.log('⚠️  Note: This is a complex Excel format. Importing what can be parsed.\n');

    // The Excel has a complex structure:
    // - Headers in rows 1-4
    // - Invoice headers like "Invoice No/Date : 1 / 02-04-2025"
    // - Then item rows
    // We'll parse what we can

    let currentInvoice: any = null;
    let invoiceItems: any[] = [];

    for (let i = 5; i < rawData.length; i++) {
        const row = rawData[i];

        if (!row || row.length === 0) continue;

        // Check if this is an invoice header row
        const invoiceHeader = row.find((cell: any) =>
            cell && typeof cell === 'string' && cell.includes('Invoice No/Date')
        );

        if (invoiceHeader) {
            // Save previous invoice if exists
            if (currentInvoice && invoiceItems.length > 0) {
                try {
                    await createSale(currentInvoice, invoiceItems, adminUser.id, products);
                    imported++;
                    if (imported % 100 === 0) {
                        console.log(`  ✓ Imported ${imported} invoices...`);
                    }
                } catch (error: any) {
                    errors.push(`Invoice ${currentInvoice.invoiceNo}: ${error.message}`);
                    skipped++;
                }
            }

            // Parse new invoice
            const parts = invoiceHeader.split(':')[1]?.trim().split('/');
            if (parts && parts.length >= 2) {
                currentInvoice = {
                    invoiceNo: parts[0]?.trim(),
                    date: parts[1]?.trim(),
                    billNo: billNoCounter++
                };
                invoiceItems = [];
            }
        } else if (currentInvoice) {
            // This might be an item row
            // Try to extract item data (this is approximate due to complex format)
            const itemName = row[1] || row[2];
            const qty = row[3] || row[4];
            const rate = row[5] || row[6];

            if (itemName && qty && rate) {
                invoiceItems.push({
                    name: itemName,
                    quantity: parseInt(qty) || 1,
                    rate: parseFloat(rate) || 0
                });
            }
        }
    }

    // Save last invoice
    if (currentInvoice && invoiceItems.length > 0) {
        try {
            await createSale(currentInvoice, invoiceItems, adminUser.id, products);
            imported++;
        } catch (error: any) {
            errors.push(`Invoice ${currentInvoice.invoiceNo}: ${error.message}`);
            skipped++;
        }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Import Complete!\n');
    console.log(`📊 Summary:`);
    console.log(`  ✓ Imported: ${imported} sales`);
    console.log(`  ⏭️  Skipped: ${skipped} sales`);

    if (errors.length > 0) {
        console.log(`\n❌ Errors (first 10):`);
        errors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
        if (errors.length > 10) {
            console.log(`  ... and ${errors.length - 10} more`);
        }
    }

    console.log('\n💡 All sales are flagged as historical data (isHistorical: true)');

    await prisma.$disconnect();
}

async function createSale(invoice: any, items: any[], userId: string, products: any[]) {
    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.rate), 0);
    const taxRate = 5; // 5% GST
    const taxAmount = subtotal * (taxRate / 100);
    const grandTotal = subtotal + taxAmount;

    // Parse date (format: 02-04-2025)
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

    // Create sale with items
    const saleItems = items.map(item => {
        // Try to find matching product
        const product = products.find(p =>
            p.name.toLowerCase().includes(item.name.toLowerCase()) ||
            item.name.toLowerCase().includes(p.name.toLowerCase())
        );

        const variant = product?.variants[0];

        return {
            variantId: variant?.id || products[0]?.variants[0]?.id || 'unknown',
            productName: item.name,
            variantInfo: 'Standard',
            quantity: item.quantity,
            mrp: item.rate,
            sellingPrice: item.rate,
            discount: 0,
            taxRate: taxRate,
            taxAmount: (item.quantity * item.rate) * (taxRate / 100),
            total: item.quantity * item.rate
        };
    });

    await prisma.sale.create({
        data: {
            billNo: invoice.billNo,
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
    await prisma.$disconnect();
    process.exit(1);
});
