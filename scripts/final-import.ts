import { PrismaClient } from '../prisma/generated/client/index.js';
import XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const prisma = new PrismaClient();
const migrationDir = 'migration';

async function main() {
    console.log('🚀 Starting Final Data Import...');

    const productsFile = path.join(migrationDir, 'Report_Item_Detail_AllItem.xls');
    if (fs.existsSync(productsFile)) {
        await importProducts(productsFile);
    }

    await generateSales();

    console.log('\n✅ Data Import Finished!');
    await prisma.$disconnect();
}

async function importProducts(filePath: string) {
    console.log(`\n📦 Importing Products from ${path.basename(filePath)}...`);
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    let count = 0;
    for (let i = 4; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 3 || !row[2]) continue;

        const itemName = row[2].toString().trim();
        const categoryName = row[4]?.toString().trim() || 'General';

        const category = await prisma.category.upsert({
            where: { name: categoryName },
            update: {},
            create: { name: categoryName }
        });

        // Use a more stable way to ensure 1 product per name
        let product = await prisma.product.findFirst({ where: { name: itemName } });
        if (!product) {
            product = await prisma.product.create({
                data: {
                    name: itemName,
                    categoryId: category.id,
                    description: `Imported`
                }
            });
        }

        await prisma.productVariant.upsert({
            where: { sku: itemName },
            update: {},
            create: {
                productId: product.id,
                sku: itemName,
                barcode: itemName,
                mrp: 0,
                sellingPrice: 0,
                costPrice: 0,
                stock: 100
            }
        });
        count++;
    }
    console.log(`✓ Result: ${count} items processed.`);
}

async function generateSales() {
    const admin = await prisma.user.findFirst({ where: { username: 'admin' } });
    if (!admin) {
        console.error('❌ Admin user not found. Run seed script first.');
        return;
    }

    console.log('\n💰 Generating simulated sales records for the dashboard...');

    // Clear existing sales to avoid duplication if running multiple times
    await prisma.saleItem.deleteMany();
    await prisma.sale.deleteMany();

    const variants = await prisma.productVariant.findMany({ take: 50 });
    if (variants.length === 0) {
        console.warn('⚠️ No products found to create sales items.');
    }

    for (let i = 0; i < 30; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);

        const dailyOrders = Math.floor(Math.random() * 8) + 4;

        for (let j = 0; j < dailyOrders; j++) {
            const saleDate = new Date(date);
            saleDate.setHours(10 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60));

            const subtotal = Math.floor(Math.random() * 1500) + 300;
            const tax = subtotal * 0.12;
            const grandTotal = subtotal + tax;

            const sale = await prisma.sale.create({
                data: {
                    billNo: (i + 1) * 100 + j,
                    userId: admin.id,
                    customerName: 'Walking Customer',
                    subtotal: subtotal,
                    taxAmount: tax,
                    cgst: tax / 2,
                    sgst: tax / 2,
                    discount: 0,
                    grandTotal: grandTotal,
                    paidAmount: grandTotal,
                    changeAmount: 0,
                    paymentMethod: 'CASH',
                    status: 'COMPLETED',
                    isHistorical: true,
                    createdAt: saleDate
                }
            });

            // Add 1-3 items to each sale
            const itemCounts = Math.floor(Math.random() * 3) + 1;
            for (let k = 0; k < itemCounts && variants.length > 0; k++) {
                const variant = variants[Math.floor(Math.random() * variants.length)];
                await prisma.saleItem.create({
                    data: {
                        saleId: sale.id,
                        variantId: variant.id,
                        productName: variant.sku,
                        quantity: 1,
                        mrp: 500,
                        sellingPrice: 500,
                        taxRate: 12,
                        taxAmount: 60,
                        total: 560
                    }
                });
            }
        }
    }
    console.log('✓ Sales data generation complete.');
}

main().catch(console.error);
