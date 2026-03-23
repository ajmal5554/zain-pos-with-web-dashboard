import { PrismaClient } from '../prisma/generated/client/index.js';
import XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 MaxSell Product Import');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const migrationDir = path.join(process.cwd(), 'migration');
    const pricelistFile = path.join(migrationDir, 'Report_Item_Detail_Pricelist_All_GroupwiseBrandwise_with_Option.xls');

    if (!fs.existsSync(pricelistFile)) {
        console.error('❌ Pricelist file not found!');
        process.exit(1);
    }

    console.log('📖 Reading pricelist...');
    const workbook = XLSX.readFile(pricelistFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    console.log(`  ✓ Found ${rawData.length} rows\n`);

    // Row 0: Print Date
    // Row 1: Headers (Item Code, Item Name, W. Sale Rate, Retail Rate, MRP)
    // Row 2+: Data

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Create default category
    let defaultCategory = await prisma.category.findFirst({
        where: { name: 'General' }
    });

    if (!defaultCategory) {
        defaultCategory = await prisma.category.create({
            data: { name: 'General' }
        });
    }

    console.log('📦 Importing products...\n');

    for (let i = 2; i < rawData.length; i++) {
        const row = rawData[i];

        // Skip empty rows
        if (!row || row.length === 0 || !row[1]) {
            continue;
        }

        const itemCode = row[0]?.toString().trim() || '';
        const itemName = row[1]?.toString().trim();
        const wholesaleRate = parseFloat(row[2]?.toString() || '0');
        const retailRate = parseFloat(row[3]?.toString() || '0');
        const mrp = parseFloat(row[4]?.toString() || '0');

        if (!itemName) {
            skipped++;
            continue;
        }

        try {
            // Check if product already exists
            const existing = await prisma.product.findFirst({
                where: { name: itemName }
            });

            if (existing) {
                console.log(`  ⏭️  Skipped: ${itemName} (already exists)`);
                skipped++;
                continue;
            }

            // Create product
            const product = await prisma.product.create({
                data: {
                    name: itemName,
                    categoryId: defaultCategory.id,
                    taxRate: 0,
                }
            });

            // Create variant
            await prisma.productVariant.create({
                data: {
                    productId: product.id,
                    size: 'Standard',
                    barcode: itemCode || `TEMP-${Date.now()}-${imported}`,
                    sku: itemCode || `SKU-${imported}`,
                    mrp: mrp || retailRate,
                    sellingPrice: retailRate || mrp,
                    costPrice: wholesaleRate || retailRate * 0.7,
                    stock: 0,
                }
            });

            imported++;
            if (imported % 50 === 0) {
                console.log(`  ✓ Imported ${imported} products...`);
            }

        } catch (error: any) {
            errors.push(`Row ${i}: ${itemName} - ${error.message}`);
            skipped++;
        }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Import Complete!\n');
    console.log(`📊 Summary:`);
    console.log(`  ✓ Imported: ${imported} products`);
    console.log(`  ⏭️  Skipped: ${skipped} products`);

    if (errors.length > 0) {
        console.log(`\n❌ Errors (${errors.length}):`);
        errors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
        if (errors.length > 10) {
            console.log(`  ... and ${errors.length - 10} more`);
        }
    }

    console.log('\n💡 Next Steps:');
    console.log('  1. Open the POS app');
    console.log('  2. Go to Products page');
    console.log('  3. Edit each product and scan its barcode');
    console.log('  4. Update stock quantities as needed');

    await prisma.$disconnect();
}

main().catch(async (error) => {
    console.error('❌ Import failed:', error.message);
    await prisma.$disconnect();
    process.exit(1);
});
