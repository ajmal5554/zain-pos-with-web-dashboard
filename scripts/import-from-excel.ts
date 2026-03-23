import { PrismaClient } from '../prisma/generated/client/index.js';
import XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface ImportStats {
    categories: number;
    products: number;
    variants: number;
    errors: string[];
}

function readExcelFile(filePath: string): any[] {
    try {
        console.log(`📖 Reading Excel file: ${path.basename(filePath)}`);
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0]; // Read first sheet
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        console.log(`  ✓ Found ${data.length} rows`);
        return data;
    } catch (error: any) {
        console.error(`❌ Error reading ${filePath}:`, error.message);
        return [];
    }
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

async function importCategories(products: any[]): Promise<Map<string, string>> {
    console.log('\n📁 Importing Categories...');
    const categoryMap = new Map<string, string>();
    const categoryNames = new Set<string>();

    // Extract unique categories from products
    // Common column names in MaxSell: Category, Category_Name, Item_Category, etc.
    products.forEach((row) => {
        const category =
            row.Category?.toString().trim() ||
            row.Category_Name?.toString().trim() ||
            row.Item_Category?.toString().trim() ||
            row['Item Category']?.toString().trim() ||
            row.CATEGORY?.toString().trim();

        if (category && category !== '' && category !== 'null') {
            categoryNames.add(category);
        }
    });

    console.log(`  Found ${categoryNames.size} unique categories`);

    for (const categoryName of categoryNames) {
        try {
            let category = await prisma.category.findFirst({
                where: { name: categoryName },
            });

            if (!category) {
                category = await prisma.category.create({
                    data: {
                        name: categoryName,
                    },
                });
                console.log(`  ✓ Created category: ${categoryName}`);
            }

            categoryMap.set(categoryName, category.id);
        } catch (error: any) {
            console.error(`  ❌ Error creating category ${categoryName}:`, error.message);
        }
    }

    console.log(`✅ Imported ${categoryMap.size} categories`);
    return categoryMap;
}

async function importProducts(products: any[], categoryMap: Map<string, string>): Promise<ImportStats> {
    console.log('\n📦 Importing Products...');
    const stats: ImportStats = {
        categories: categoryMap.size,
        products: 0,
        variants: 0,
        errors: [],
    };

    console.log(`\n📋 Sample row to help identify columns:`);
    if (products.length > 0) {
        console.log(JSON.stringify(products[0], null, 2));
    }

    for (const row of products) {
        try {
            // Try to find product code/SKU from common column names
            const productCode =
                row.Product_Code?.toString().trim() ||
                row.Item_Code?.toString().trim() ||
                row.Code?.toString().trim() ||
                row.SKU?.toString().trim() ||
                row['Product Code']?.toString().trim() ||
                row['Item Code']?.toString().trim();

            // Try to find product name from common column names
            const productName =
                row.Product_Name?.toString().trim() ||
                row.Item_Name?.toString().trim() ||
                row.Name?.toString().trim() ||
                row['Product Name']?.toString().trim() ||
                row['Item Name']?.toString().trim() ||
                row.ITEM_NAME?.toString().trim();

            if (!productName) {
                stats.errors.push(`Skipped row with missing product name`);
                continue;
            }

            // Generate SKU if not available
            const sku = productCode || `SKU-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Get category
            const categoryName =
                row.Category?.toString().trim() ||
                row.Category_Name?.toString().trim() ||
                row.Item_Category?.toString().trim() ||
                row['Item Category']?.toString().trim() ||
                row.CATEGORY?.toString().trim();

            const categoryId = categoryName ? categoryMap.get(categoryName) : null;

            // Get prices
            const mrp = parseFloat(
                row.MRP?.toString() ||
                row.Price?.toString() ||
                row.Selling_Price?.toString() ||
                row['Selling Price']?.toString() ||
                row.Rate?.toString() ||
                '0'
            );

            const sellingPrice = parseFloat(
                row.Selling_Price?.toString() ||
                row['Selling Price']?.toString() ||
                row.Sale_Price?.toString() ||
                row.Price?.toString() ||
                row.MRP?.toString() ||
                '0'
            );

            const purchasePrice = parseFloat(
                row.Purchase_Price?.toString() ||
                row['Purchase Price']?.toString() ||
                row.Cost?.toString() ||
                '0'
            );

            // Get stock
            const stock = parseInt(
                row.Stock?.toString() ||
                row.Quantity?.toString() ||
                row.Stock_Quantity?.toString() ||
                row['Stock Quantity']?.toString() ||
                row.Qty?.toString() ||
                '0'
            );

            // Get barcode
            const barcode =
                row.Barcode?.toString().trim() ||
                row.Bar_Code?.toString().trim() ||
                sku;

            // Get HSN and GST
            const hsnCode = row.HSN_Code?.toString().trim() || row.HSN?.toString().trim() || null;
            const gstRate = parseFloat(row.GST?.toString() || row.GST_Rate?.toString() || row['GST %']?.toString() || '0');

            // Check if product exists by name
            let product = await prisma.product.findFirst({
                where: { name: productName },
            });

            if (!product) {
                // Create product
                product = await prisma.product.create({
                    data: {
                        name: productName,
                        description: `Imported from MaxSell`,
                        categoryId: categoryId || (await getOrCreateDefaultCategory()),
                        hsn: hsnCode,
                        taxRate: gstRate,
                    },
                });
                stats.products++;
                console.log(`  ✓ Created product: ${productName} (${sku})`);
            }

            // Create variant
            const size = row.Size?.toString().trim() || 'Standard';
            const color = row.Color?.toString().trim() || null;

            await prisma.productVariant.create({
                data: {
                    productId: product.id,
                    size: size,
                    color: color,
                    barcode: barcode,
                    sku: `${sku}-${size}${color ? `-${color}` : ''}`,
                    mrp: mrp || 0,
                    sellingPrice: sellingPrice || mrp || 0,
                    costPrice: purchasePrice || 0,
                    stock: stock || 0,
                },
            });
            stats.variants++;
        } catch (error: any) {
            const productName = row.Product_Name || row.Item_Name || row.Name || 'Unknown';
            stats.errors.push(`Error importing ${productName}: ${error.message}`);
            console.error(`  ❌ Error importing ${productName}:`, error.message);
        }
    }

    console.log(`✅ Imported ${stats.products} products with ${stats.variants} variants`);
    return stats;
}

async function generateReport(stats: ImportStats): Promise<void> {
    const reportPath = path.join(__dirname, '../migration/import-report.txt');
    const report = `
MaxSell to Zain POS - Excel Import Report
Generated: ${new Date().toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IMPORT SUMMARY:
  ✓ Categories: ${stats.categories}
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
1. Open the new POS application (npm run electron:dev)
2. Login with admin/admin123
3. Go to Products page
4. Verify all products imported correctly
5. Check prices and stock levels
6. Test POS with imported products
7. Configure shop settings (Settings page)
8. Setup printers and barcode scanner

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    fs.writeFileSync(reportPath, report);
    console.log(`\n📄 Report saved to: ${reportPath}`);
    console.log(report);
}

async function main() {
    console.log('🚀 MaxSell Excel Import - Data Migration');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const migrationDir = path.join(process.cwd(), 'migration');

    // Look for Excel files
    const files = fs.readdirSync(migrationDir);
    const excelFiles = files.filter(
        (f) => f.endsWith('.xlsx') || f.endsWith('.xls')
    );

    if (excelFiles.length === 0) {
        console.error('❌ No Excel files found in migration folder');
        console.log('\n📋 Please export data from MaxSell:');
        console.log('1. Open MaxSell POS on shop computer');
        console.log('2. Export Price List to Excel');
        console.log('3. Save as: products.xlsx or pricelist.xlsx');
        console.log('4. Copy to USB drive');
        console.log('5. Transfer to: C:\\Users\\LENOVO\\Desktop\\zain pos\\migration\\');
        console.log('6. Run this script again: npm run import');
        process.exit(1);
    }

    console.log(`📁 Found ${excelFiles.length} Excel file(s):`);
    excelFiles.forEach((f) => console.log(`  - ${f}`));

    try {
        // Read all Excel files and combine data
        let allProducts: any[] = [];
        for (const file of excelFiles) {
            const filePath = path.join(migrationDir, file);
            const data = readExcelFile(filePath);
            allProducts = allProducts.concat(data);
        }

        console.log(`\n📊 Total rows to import: ${allProducts.length}`);

        if (allProducts.length === 0) {
            console.error('❌ No data found in Excel files');
            process.exit(1);
        }

        // Import data
        const categoryMap = await importCategories(allProducts);
        const stats = await importProducts(allProducts, categoryMap);

        // Generate report
        await generateReport(stats);

        console.log('\n✅ Migration completed successfully!');
        console.log('🎉 Your MaxSell data has been imported into Zain POS');
        console.log('\n💡 Next: Open the POS app and verify your products!');

        await prisma.$disconnect();
    } catch (error: any) {
        console.error('\n❌ Migration failed:', error.message);
        console.error(error);
        await prisma.$disconnect();
        process.exit(1);
    }
}

// Run migration
main();
