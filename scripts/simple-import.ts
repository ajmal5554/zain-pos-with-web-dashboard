import { PrismaClient } from '../prisma/generated/client/index.js';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 Simple Product Import from MaxSell Excel');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const migrationDir = join(__dirname, '../migration');
    const itemFile = join(migrationDir, 'Report_Item_Detail_AllItem.xls');

    console.log('📖 Reading item details...');
    const workbook = XLSX.readFile(itemFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    console.log(`  ✓ Found ${rawData.length} rows\n`);

    // Find header row (usually contains "Item Name", "Barcode", etc.)
    let headerRow = -1;
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
        const row = rawData[i];
        if (row && row.some((cell: any) =>
            cell && typeof cell === 'string' &&
            (cell.includes('Item Name') || cell.includes('Barcode') || cell.includes('Item Code'))
        )) {
            headerRow = i;
            break;
        }
    }

    if (headerRow === -1) {
        console.error('❌ Could not find header row');
        console.log('\nFirst 10 rows:');
        rawData.slice(0, 10).forEach((row, i) => {
            console.log(`Row ${i}:`, row.slice(0, 5));
        });
        await prisma.$disconnect();
        return;
    }

    console.log(`✓ Found header row at line ${headerRow + 1}`);
    const headers = rawData[headerRow];
    console.log('Headers:', headers.slice(0, 10));

    // Get or create default category
    let category = await prisma.category.findFirst({ where: { name: 'General' } });
    if (!category) {
        category = await prisma.category.create({ data: { name: 'General' } });
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    console.log('\n📦 Importing products...\n');

    for (let i = headerRow + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length === 0) continue;

        try {
            // Create a map of column names to values
            const data: any = {};
            headers.forEach((header: string, index: number) => {
                if (header) {
                    data[header] = row[index];
                }
            });

            // Extract product information (match actual column names from Excel)
            const itemName = data['Item name'] || data['Item Name'] || data['Product Name'] || data['Name'];
            const itemCode = data['Item Code'] || data['Product Code'];
            const barcode = data['Barcode'] || data['Bar Code'] || itemCode || `BC${Date.now()}${i}`;
            const brandName = data['Brand Name'] || '';
            const groupName = data['Group Name'] || data['Category'] || '';

            // Try to find price columns (may vary)
            const mrp = parseFloat(data['MRP'] || data['Price'] || data['Selling Price'] || data['Rate'] || '0');
            const sellingPrice = parseFloat(data['Selling Price'] || data['Sale Price'] || data['MRP'] || data['Rate'] || '0');
            const stock = parseInt(data['Stock'] || data['Quantity'] || data['Qty'] || data['Stock Qty'] || '0');

            if (!itemName || itemName === '') {
                skipped++;
                continue;
            }

            // Use group name as category if available
            let productCategory = category;
            if (groupName && groupName !== '') {
                let groupCategory = await prisma.category.findFirst({
                    where: { name: groupName }
                });
                if (!groupCategory) {
                    groupCategory = await prisma.category.create({
                        data: { name: groupName }
                    });
                }
                productCategory = groupCategory;
            }

            // Check if product exists
            let product = await prisma.product.findFirst({
                where: { name: itemName }
            });

            if (!product) {
                product = await prisma.product.create({
                    data: {
                        name: itemName,
                        description: brandName ? `Brand: ${brandName}` : 'Imported from MaxSell',
                        categoryId: productCategory.id,
                        taxRate: 5.0
                    }
                });
            }

            // Generate unique SKU
            const sku = itemCode || `SKU-${product.id.substring(0, 8)}-${i}`;

            // Check if variant with this barcode exists
            const existingVariant = await prisma.productVariant.findFirst({
                where: { barcode: barcode }
            });

            if (!existingVariant) {
                await prisma.productVariant.create({
                    data: {
                        productId: product.id,
                        sku: sku,
                        barcode: barcode,
                        size: 'Standard',
                        mrp: mrp || 100,
                        sellingPrice: sellingPrice || mrp || 100,
                        costPrice: 0,
                        stock: stock || 0
                    }
                });
                imported++;

                if (imported % 50 === 0) {
                    console.log(`  ✓ Imported ${imported} products...`);
                }
            } else {
                skipped++;
            }

        } catch (error: any) {
            errors.push(`Row ${i + 1}: ${error.message}`);
            skipped++;
        }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Import Complete!\n');
    console.log(`📊 Summary:`);
    console.log(`  ✓ Imported: ${imported} products`);
    console.log(`  ⏭️  Skipped: ${skipped} products`);

    if (errors.length > 0) {
        console.log(`\n❌ Errors (first 10):`);
        errors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
    }

    console.log('\n💡 Login credentials:');
    console.log('  Username: admin');
    console.log('  Password: admin123');

    await prisma.$disconnect();
}

main().catch(async (error) => {
    console.error('❌ Import failed:', error.message);
    await prisma.$disconnect();
    process.exit(1);
});
