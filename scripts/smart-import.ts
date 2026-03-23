import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// List of common typos to fix
const TYPO_FIXES: { [key: string]: string } = {
    'doubil': 'Double',
    'dubil': 'Double',
    'niker': 'Knicker',
    'nicer': 'Knicker',
    'barmuda': 'Bermuda',
    'sadha': 'Sadha', // Keep as is, but capitalize
    'pnt': 'Pant',
    'pant': 'Pant',
    'shrt': 'Shirt',
    'tshirt': 'T-Shirt',
    't-shirt': 'T-Shirt',
    'cotton': 'Cotton',
    'cottn': 'Cotton',
    'jeans': 'Jeans',
    'jean': 'Jeans',
};

interface ImportStats {
    products: number;
    variants: number;
    cleaned: number;
    grouped: number;
}

function cleanName(name: string): string {
    if (!name) return '';

    // 1. Remove numbers from end (prices)
    let clean = name.replace(/\s+\d+\s*$/, '').trim();

    // 2. Remove multiple spaces
    clean = clean.replace(/\s+/g, ' ');

    // 3. To Title Case & Fix Typos
    const words = clean.toLowerCase().split(' ');
    const fixedWords = words.map(word => {
        // Check for typo fix
        if (TYPO_FIXES[word]) return TYPO_FIXES[word];
        // Capitalize first letter
        return word.charAt(0).toUpperCase() + word.slice(1);
    });

    return fixedWords.join(' ');
}

async function cleanupData() {
    console.log('🧹 Cleaning up existing data...');
    await prisma.saleItem.deleteMany({});
    await prisma.sale.deleteMany({});
    await prisma.productVariant.deleteMany({});
    await prisma.product.deleteMany({});
    console.log('  ✓ Database cleared');
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

async function smartImport(): Promise<ImportStats> {
    const stats: ImportStats = {
        products: 0,
        variants: 0,
        cleaned: 0,
        grouped: 0,
    };

    const file = 'migration/Report_Item_Detail_Pricelist_All_GroupwiseBrandwise_with_Option.xls';
    console.log(`📖 Reading: ${file}`);

    const workbook = XLSX.readFile(file);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    const defaultCategoryId = await getOrCreateDefaultCategory();

    // Group products by CLEAN name
    const productGroups = new Map<string, any[]>();

    // Find header row
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
        const row = rawData[i];
        if (row && row.some((cell: any) => cell && cell.toString().includes('Item Code'))) {
            headerRowIndex = i;
            break;
        }
    }

    if (headerRowIndex === -1) {
        console.error('❌ Could not find header row');
        return stats;
    }

    console.log('🧠 Analyzing and grouping products...');

    // First pass: Group items
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length === 0) continue;

        const rawName = row[1]?.toString().trim();
        if (!rawName) continue;

        let mrp = parseFloat(row[2]?.toString() || '0') || 0;

        // Extract price if missing
        if (mrp === 0) {
            const priceMatch = rawName.match(/\s+(\d+)$/);
            if (priceMatch) {
                mrp = parseFloat(priceMatch[1]);
            }
        }

        const itemCode = row[0]?.toString().trim();
        const finalName = cleanName(rawName);

        if (!productGroups.has(finalName)) {
            productGroups.set(finalName, []);
        }

        productGroups.get(finalName)?.push({
            itemCode,
            mrp,
            originalName: rawName
        });
    }

    console.log(`  ✓ Found ${productGroups.size} unique products (from ${rawData.length - headerRowIndex} raw items)`);
    console.log('💾 Importing structured data...');

    // Second pass: Create products and variants
    for (const [name, items] of productGroups) {
        try {
            // Create Product
            const product = await prisma.product.create({
                data: {
                    name: name,
                    description: 'Imported from MaxSell',
                    categoryId: defaultCategoryId,
                    hsn: null,
                    taxRate: 5.0,
                },
            });
            stats.products++;

            // Create Variants
            // Deduplicate variants by barcode/price to avoid exact duplicates
            const uniqueVariants = new Map<string, any>();

            for (const item of items) {
                const sku = item.itemCode || `SKU-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                // Use ItemCode as unique key, or SKU if missing
                const key = item.itemCode ? item.itemCode : `${sku}-${item.mrp}`; // Combine code + price for uniqueness if needed

                if (!uniqueVariants.has(key)) {
                    uniqueVariants.set(key, { ...item, sku });
                }
            }

            for (const variant of uniqueVariants.values()) {
                await prisma.productVariant.create({
                    data: {
                        productId: product.id,
                        size: 'Standard', // Default size
                        color: null,
                        barcode: variant.itemCode || variant.sku,
                        sku: variant.sku,
                        mrp: variant.mrp,
                        sellingPrice: variant.mrp, // Default to MRP
                        costPrice: 0,
                        stock: 0,
                    },
                });
                stats.variants++;
            }

            if (items.length > 1) {
                stats.grouped += items.length - 1;
            }

            if (name !== items[0].originalName) {
                stats.cleaned++;
            }

        } catch (error: any) {
            console.error(`❌ Error creating ${name}:`, error.message);
        }
    }

    return stats;
}

async function main() {
    console.log('🚀 Starting Smart Data Import');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
        await cleanupData();
        const stats = await smartImport();

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ Smart Import Complete!');
        console.log(`  Products Created: ${stats.products}`);
        console.log(`  Variants Created: ${stats.variants}`);
        console.log(`  Names Cleaned: ${stats.cleaned}`);
        console.log(`  Duplicates Merged: ${stats.grouped}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // Disclaimer
        console.log('\n⚠️ NOTE: Since we cleaned names, some mismatched sales might occur if you re-import sales history.');
        console.log('   You should re-run the sales import script after this.');

        await prisma.$disconnect();
    } catch (error: any) {
        console.error('\n❌ Import failed:', error.message);
        await prisma.$disconnect();
        process.exit(1);
    }
}

main();
