import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();

interface ProductRow {
    'Product Code'?: string;
    'Product Name'?: string;
    'Category'?: string;
    'MRP'?: string;
    'Selling Price'?: string;
    'Purchase Price'?: string;
    'Stock'?: string;
    'Barcode'?: string;
    'HSN Code'?: string;
    'GST %'?: string;
    'Size'?: string;
    'Color'?: string;
    [key: string]: string | undefined;
}

interface CustomerRow {
    'Customer Name'?: string;
    'Phone'?: string;
    'Mobile'?: string;
    'Address'?: string;
    'GSTIN'?: string;
    'Email'?: string;
    [key: string]: string | undefined;
}

interface ImportStats {
    categories: number;
    products: number;
    variants: number;
    customers: number;
    errors: string[];
}

function readCSV(filePath: string): any[] {
    try {
        // Use xlsx to read CSV files
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const records = XLSX.utils.sheet_to_json(worksheet);
        return records;
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

async function importCategories(products: ProductRow[]): Promise<Map<string, string>> {
    console.log('\n📁 Importing Categories...');
    const categoryMap = new Map<string, string>();
    const categoryNames = new Set<string>();

    // Extract unique categories from products
    products.forEach((row) => {
        const category = row.Category?.trim();
        if (category) categoryNames.add(category);
    });

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

async function importProducts(
    products: ProductRow[],
    categoryMap: Map<string, string>
): Promise<ImportStats> {
    console.log('\n📦 Importing Products...');
    const stats: ImportStats = {
        categories: categoryMap.size,
        products: 0,
        variants: 0,
        customers: 0,
        errors: [],
    };

    for (const row of products) {
        try {
            const productCode = row['Product Code']?.trim();
            const productName = row['Product Name']?.trim();

            if (!productCode || !productName) {
                stats.errors.push(`Skipped product with missing code or name`);
                continue;
            }

            // Get category ID
            const categoryId = categoryMap.get(row.Category?.trim() || '');

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
                        hsn: row['HSN Code']?.trim() || null,
                        taxRate: parseFloat(row['GST %'] || '0') || 0,
                    },
                });
                stats.products++;
                console.log(`  ✓ Created product: ${productName} (${productCode})`);
            }

            // Create variant
            const size = row.Size?.trim() || 'Standard';
            const color = row.Color?.trim() || null;
            const barcode = row.Barcode?.trim() || `${productCode}-${size}`;

            await prisma.productVariant.create({
                data: {
                    productId: product.id,
                    size: size,
                    color: color,
                    barcode: barcode,
                    sku: `${productCode}-${size}${color ? `-${color}` : ''}`,
                    mrp: parseFloat(row.MRP || '0') || 0,
                    sellingPrice: parseFloat(row['Selling Price'] || '0') || 0,
                    costPrice: parseFloat(row['Purchase Price'] || '0') || 0,
                    stock: parseInt(row.Stock || '0') || 0,
                },
            });
            stats.variants++;
        } catch (error: any) {
            stats.errors.push(`Error importing ${row['Product Name']}: ${error.message}`);
            console.error(`  ❌ Error importing ${row['Product Name']}:`, error.message);
        }
    }

    console.log(`✅ Imported ${stats.products} products with ${stats.variants} variants`);
    return stats;
}

async function importCustomers(customers: CustomerRow[], stats: ImportStats): Promise<void> {
    console.log('\n👥 Importing Customers...');

    for (const row of customers) {
        try {
            const customerName = row['Customer Name']?.trim();
            const phone = row.Mobile?.trim() || row.Phone?.trim();

            if (!customerName) continue;

            // Check if customer exists
            const existing = await prisma.customer.findFirst({
                where: {
                    OR: [{ name: customerName }, { phone: phone || '' }],
                },
            });

            if (!existing) {
                await prisma.customer.create({
                    data: {
                        name: customerName,
                        phone: phone || null,
                        email: row.Email?.trim() || null,
                        address: row.Address?.trim() || null,
                        gstin: row.GSTIN?.trim() || null,
                    },
                });
                stats.customers++;
                console.log(`  ✓ Created customer: ${customerName}`);
            }
        } catch (error: any) {
            stats.errors.push(`Error importing customer ${row['Customer Name']}: ${error.message}`);
            console.error(`  ❌ Error importing customer:`, error.message);
        }
    }

    console.log(`✅ Imported ${stats.customers} customers`);
}

async function generateReport(stats: ImportStats): Promise<void> {
    const reportPath = path.join(__dirname, '../migration/import-report.txt');
    const report = `
MaxSell to Zain POS - CSV Import Report
Generated: ${new Date().toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IMPORT SUMMARY:
  ✓ Categories: ${stats.categories}
  ✓ Products: ${stats.products}
  ✓ Variants: ${stats.variants}
  ✓ Customers: ${stats.customers}

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
1. Open the new POS application
2. Login with admin/admin123
3. Verify products in Products page
4. Check stock levels and prices
5. Test POS with imported products
6. Configure shop settings

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    fs.writeFileSync(reportPath, report);
    console.log(`\n📄 Report saved to: ${reportPath}`);
    console.log(report);
}

async function main() {
    console.log('🚀 MaxSell CSV Import - Data Migration');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const migrationDir = path.join(__dirname, '../migration');

    // Check for CSV files
    const productsFile = path.join(migrationDir, 'products.csv');
    const customersFile = path.join(migrationDir, 'customers.csv');

    if (!fs.existsSync(productsFile)) {
        console.error('❌ products.csv not found in migration folder');
        console.log('\n📋 Please export data from MaxSell:');
        console.log('1. Open MaxSell POS');
        console.log('2. Export Products to CSV');
        console.log('3. Save as: migration/products.csv');
        console.log('4. Export Customers to CSV (optional)');
        console.log('5. Save as: migration/customers.csv');
        console.log('6. Run this script again');
        process.exit(1);
    }

    try {
        // Read CSV files
        console.log('📖 Reading CSV files...');
        const products = readCSV(productsFile);
        const customers = fs.existsSync(customersFile) ? readCSV(customersFile) : [];

        console.log(`  ✓ Found ${products.length} products`);
        console.log(`  ✓ Found ${customers.length} customers`);

        if (products.length === 0) {
            console.error('❌ No products found in CSV file');
            process.exit(1);
        }

        // Import data
        const categoryMap = await importCategories(products);
        const stats = await importProducts(products, categoryMap);
        if (customers.length > 0) {
            await importCustomers(customers, stats);
        }

        // Generate report
        await generateReport(stats);

        console.log('\n✅ Migration completed successfully!');
        console.log('🎉 Your MaxSell data has been imported into Zain POS');

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
