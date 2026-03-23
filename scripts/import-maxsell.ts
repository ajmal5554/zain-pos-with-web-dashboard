import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface ImportStats {
    categories: number;
    products: number;
    variants: number;
    errors: string[];
}

async function getOrCreateDefaultCategory(): Promise<string> {
    let category = await prisma.category.findFirst({
        where: { name: 'Uncategorized' },
    });

    if (!category) {
        category = await prisma.category.create({
            data: { name: 'Uncategorized' },
        });
    }

    return category.id;
}

async function importFromMaxSellPriceList(): Promise<ImportStats> {
    const stats: ImportStats = {
        categories: 0,
        products: 0,
        variants: 0,
        errors: [],
    };

    const file = 'migration/Report_Item_Detail_Pricelist_All_GroupwiseBrandwise_with_Option.xls';

    console.log(`📖 Reading: ${file}`);
    const workbook = XLSX.readFile(file);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Read as array to skip header rows
    const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    console.log(`  Total rows: ${rawData.length}`);

    // Find the header row (contains "Item Code")
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
        const row = rawData[i];
        if (row && row.some((cell: any) => cell && cell.toString().includes('Item Code'))) {
            headerRowIndex = i;
            break;
        }
    }

    if (headerRowIndex === -1) {
        console.error('❌ Could not find header row with "Item Code"');
        return stats;
    }

    console.log(`  Found headers at row ${headerRowIndex + 1}`);
    const headers = rawData[headerRowIndex];
    console.log(`  Headers:`, headers);

    // Get default category
    const defaultCategoryId = await getOrCreateDefaultCategory();

    // Process data rows (skip header and any rows before it)
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];

        if (!row || row.length === 0) continue;

        try {
            // Map columns based on header position
            const itemCode = row[0]?.toString().trim();
            let itemName = row[1]?.toString().trim();
            let mrp = parseFloat(row[2]?.toString() || '0') || 0;

            if (!itemName || itemName === '') {
                continue; // Skip empty rows
            }

            // Extract price from product name if MRP is 0
            // Pattern: "product name 123" where 123 is the price
            if (mrp === 0) {
                const priceMatch = itemName.match(/\s+(\d+)$/);
                if (priceMatch) {
                    mrp = parseFloat(priceMatch[1]);
                    // Remove price from product name
                    itemName = itemName.replace(/\s+\d+$/, '').trim();
                }
            }

            if (mrp === 0) {
                console.log(`  ⚠️ Skipping ${itemName} - no price found`);
                continue; // Skip products without price
            }

            console.log(`  Processing: ${itemName} - ₹${mrp}`);

            // Check if product exists
            let product = await prisma.product.findFirst({
                where: { name: itemName },
            });

            if (!product) {
                // Create product
                product = await prisma.product.create({
                    data: {
                        name: itemName,
                        description: `Imported from MaxSell`,
                        categoryId: defaultCategoryId,
                        hsn: null,
                        taxRate: 5.0, // Default 5% GST
                    },
                });
                stats.products++;
            }

            // Create variant
            const sku = itemCode || `SKU-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            const barcode = itemCode || sku;

            await prisma.productVariant.create({
                data: {
                    productId: product.id,
                    size: 'Standard',
                    color: null,
                    barcode: barcode,
                    sku: sku,
                    mrp: mrp,
                    sellingPrice: mrp, // Use MRP as selling price
                    costPrice: 0, // Not available in price list
                    stock: 0, // Not available in price list
                },
            });
            stats.variants++;

        } catch (error: any) {
            const itemName = row[1]?.toString() || 'Unknown';
            stats.errors.push(`Error importing ${itemName}: ${error.message}`);
            console.error(`  ❌ Error:`, error.message);
        }
    }

    return stats;
}

async function generateReport(stats: ImportStats): Promise<void> {
    const reportPath = path.join(__dirname, '../migration/maxsell-import-report.txt');
    const report = `
MaxSell to Zain POS - Import Report
Generated: ${new Date().toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IMPORT SUMMARY:
  ✓ Products: ${stats.products}
  ✓ Variants: ${stats.variants}

${stats.errors.length > 0
            ? `
ERRORS (${stats.errors.length}):
${stats.errors.slice(0, 20).map((e, i) => `  ${i + 1}. ${e}`).join('\n')}
${stats.errors.length > 20 ? `  ... and ${stats.errors.length - 20} more errors` : ''}
`
            : '✓ No errors encountered'
        }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NEXT STEPS:
1. Open the POS application
2. Login with admin/admin123
3. Go to Products page
4. Verify all products imported
5. Update stock levels as needed
6. Update cost prices if needed
7. Test POS with imported products

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    fs.writeFileSync(reportPath, report);
    console.log(`\n📄 Report saved to: ${reportPath}`);
    console.log(report);
}

async function main() {
    console.log('🚀 MaxSell Price List Import');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
        const stats = await importFromMaxSellPriceList();
        await generateReport(stats);

        console.log('\n✅ Import completed!');
        console.log('🎉 Your MaxSell products have been imported');

        await prisma.$disconnect();
    } catch (error: any) {
        console.error('\n❌ Import failed:', error.message);
        console.error(error);
        await prisma.$disconnect();
        process.exit(1);
    }
}

main();
