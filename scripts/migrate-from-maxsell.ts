import { PrismaClient } from '../prisma/generated/client/index.js';
// @ts-ignore
import sql from 'mssql'; // Fixed import
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// SQL Server connection config
// Note: You'll need SQL Server Express installed to restore .bak files
const sqlConfig: any = { // Changed type to any to avoid namespace issues
    server: 'localhost\\SQLEXPRESS', // or just 'localhost'
    database: 'Maxsll22_zain', // Will be created when restoring
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
    },
    authentication: {
        type: 'default',
        options: {
            userName: 'sa', // Update with your SQL Server username
            password: 'your_password', // Update with your SQL Server password
        },
    },
};

interface ImportStats {
    categories: number;
    products: number;
    variants: number;
    customers: number;
    errors: string[];
}

async function connectToSqlServer(): Promise<any> { // Changed return type to any
    try {
        console.log('Connecting to SQL Server...');
        const pool = await sql.connect(sqlConfig);
        console.log('✅ Connected to SQL Server');
        return pool;
    } catch (error: any) {
        console.error('❌ Failed to connect to SQL Server:', error.message);
        console.log('\n📋 Prerequisites:');
        console.log('1. Install SQL Server Express (free): https://www.microsoft.com/en-us/sql-server/sql-server-downloads');
        console.log('2. Restore the .bak file using SQL Server Management Studio or command line');
        console.log('3. Update the connection config in this script');
        throw error;
    }
}

async function importCategories(pool: any): Promise<Map<string, string>> { // Changed pool type to any
    console.log('\n📁 Importing Categories...');
    const categoryMap = new Map<string, string>();

    try {
        // Query MaxSell categories table
        const result = await pool.request().query(`
      SELECT DISTINCT Category_Name 
      FROM Products 
      WHERE Category_Name IS NOT NULL AND Category_Name != ''
      ORDER BY Category_Name
    `);

        for (const row of result.recordset) {
            const categoryName = row.Category_Name?.trim();
            if (!categoryName) continue;

            // Check if category exists
            let category = await prisma.category.findFirst({
                where: { name: categoryName },
            });

            if (!category) {
                category = await prisma.category.create({
                    data: {
                        name: categoryName,
                        // description: `Imported from MaxSell`,
                    },
                });
                console.log(`  ✓ Created category: ${categoryName}`);
            }

            categoryMap.set(categoryName, category.id);
        }

        console.log(`✅ Imported ${categoryMap.size} categories`);
        return categoryMap;
    } catch (error: any) {
        console.error('❌ Error importing categories:', error.message);
        throw error;
    }
}

async function importProducts(
    pool: any, // Changed pool type to any
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

    try {
        // Query MaxSell products
        const result = await pool.request().query(`
      SELECT 
        Product_Code,
        Product_Name,
        Category_Name,
        MRP,
        Selling_Price,
        Purchase_Price,
        Stock_Quantity,
        Barcode,
        HSN_Code,
        GST_Percentage,
        Size,
        Color
      FROM Products
      ORDER BY Product_Code
    `);

        console.log(`Found ${result.recordset.length} products in MaxSell`);

        for (const row of result.recordset) {
            try {
                const productCode = row.Product_Code?.trim();
                const productName = row.Product_Name?.trim();

                if (!productCode || !productName) {
                    stats.errors.push(`Skipped product with missing code or name`);
                    continue;
                }

                // Get category ID
                const categoryId = categoryMap.get(row.Category_Name?.trim() || '') || '';

                // Check if product exists - Use Name as identifier since Product doesn't have SKU
                let product = await prisma.product.findFirst({
                    where: { name: productName },
                });

                if (!product) {
                    // Create product
                    product = await prisma.product.create({
                        data: {
                            name: productName,
                            // sku: productCode, // Removed: Not in schema
                            description: `Imported from MaxSell`,
                            categoryId: categoryId || 'MISSING_CATEGORY', // UUID will fail if invalid, logic needs handling
                            hsn: row.HSN_Code?.trim() || null, // hsnCode -> hsn
                            taxRate: row.GST_Percentage || 5.0, // gstRate -> taxRate
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
                        mrp: parseFloat(row.MRP) || 0,
                        sellingPrice: parseFloat(row.Selling_Price) || 0,
                        costPrice: parseFloat(row.Purchase_Price) || 0, // purchasePrice -> costPrice
                        stock: parseInt(row.Stock_Quantity) || 0,
                    },
                });
                stats.variants++;
            } catch (error: any) {
                // Ignore duplicate barcode/sku errors gracefully?
                if (error.code === 'P2002') {
                    stats.errors.push(`Skipped duplicate ${row.Product_Name} (${row.Product_Code})`);
                } else {
                    stats.errors.push(`Error importing ${row.Product_Name}: ${error.message}`);
                    console.error(`  ❌ Error importing ${row.Product_Name}:`, error.message);
                }
            }
        }

        console.log(`✅ Imported ${stats.products} products with ${stats.variants} variants`);
        return stats;
    } catch (error: any) {
        console.error('❌ Error importing products:', error.message);
        throw error;
    }
}

async function importCustomers(pool: any, stats: ImportStats): Promise<void> {
    console.log('\n👥 Importing Customers...');

    try {
        const result = await pool.request().query(`
      SELECT 
        Customer_Name,
        Phone,
        Mobile,
        Address,
        GSTIN,
        Email
      FROM Customers
      WHERE Customer_Name IS NOT NULL AND Customer_Name != ''
      ORDER BY Customer_Name
    `);

        console.log(`Found ${result.recordset.length} customers in MaxSell`);

        for (const row of result.recordset) {
            try {
                const customerName = row.Customer_Name?.trim();
                const phone = row.Mobile?.trim() || row.Phone?.trim();

                if (!customerName) continue;

                // Check if customer exists
                const existing = await prisma.customer.findFirst({
                    where: {
                        OR: [
                            { name: customerName },
                            { phone: phone || '' },
                        ],
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
                stats.errors.push(`Error importing customer ${row.Customer_Name}: ${error.message}`);
                console.error(`  ❌ Error importing customer:`, error.message);
            }
        }

        console.log(`✅ Imported ${stats.customers} customers`);
    } catch (error: any) {
        console.error('❌ Error importing customers:', error.message);
        throw error;
    }
}

async function generateReport(stats: ImportStats): Promise<void> {
    const reportPath = path.join(__dirname, '../migration/import-report.txt');
    // Ensure directory exists
    const dir = path.dirname(reportPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const report = `
MaxSell to Zain POS - Import Report
Generated: ${new Date().toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IMPORT SUMMARY:
  ✓ Categories: ${stats.categories}
  ✓ Products: ${stats.products}
  ✓ Variants: ${stats.variants}
  ✓ Customers: ${stats.customers}

${stats.errors.length > 0 ? `
ERRORS (${stats.errors.length}):
${stats.errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}
` : '✓ No errors encountered'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NEXT STEPS:
1. Verify data in the new POS application
2. Check product prices and stock levels
3. Test POS with imported products
4. Configure shop settings
5. Train staff on new system

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    fs.writeFileSync(reportPath, report);
    console.log(`\n📄 Report saved to: ${reportPath}`);
    console.log(report);
}

async function main() {
    console.log('🚀 MaxSell to Zain POS - Data Migration');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
        // Connect to SQL Server
        const pool = await connectToSqlServer();

        // Import data
        const categoryMap = await importCategories(pool);
        const stats = await importProducts(pool, categoryMap);
        await importCustomers(pool, stats);

        // Generate report
        await generateReport(stats);

        console.log('\n✅ Migration completed successfully!');
        console.log('🎉 Your MaxSell data has been imported into Zain POS');

        await pool.close();
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
