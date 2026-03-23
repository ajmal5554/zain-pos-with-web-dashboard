import { PrismaClient } from '../prisma/generated/client/index.js';

const prisma = new PrismaClient();

const categoryRules = [
    { name: 'Shirts', keywords: ['shirt', 'formal shirt'] },
    { name: 'Pants', keywords: ['pant', 'trouser'] },
    { name: 'Jeans', keywords: ['jeans', 'denim'] },
    { name: 'Capri', keywords: ['capri'] },
    { name: 'T-Shirts', keywords: ['t-shirt', 'tshirt', 'tee'] },
    { name: 'Kurta', keywords: ['kurta', 'kurti'] },
    { name: 'Jackets', keywords: ['jacket', 'blazer', 'coat'] },
    { name: 'Accessories', keywords: ['belt', 'tie', 'socks', 'cap', 'hat'] },
];

async function main() {
    console.log('🏷️  Auto-Categorizing Products\n');

    // Create categories if they don't exist
    console.log('📁 Creating categories...');
    const categoryMap = new Map<string, string>();

    for (const rule of categoryRules) {
        let category = await prisma.category.findFirst({
            where: { name: rule.name }
        });

        if (!category) {
            category = await prisma.category.create({
                data: { name: rule.name }
            });
            console.log(`  ✓ Created: ${rule.name}`);
        } else {
            console.log(`  ✓ Found: ${rule.name}`);
        }

        categoryMap.set(rule.name, category.id);
    }

    // Get or create General category
    let generalCategory = await prisma.category.findFirst({
        where: { name: 'General' }
    });

    if (!generalCategory) {
        generalCategory = await prisma.category.create({
            data: { name: 'General' }
        });
    }

    console.log('\n📦 Categorizing products...\n');

    // Get all products
    const products = await prisma.product.findMany({
        include: { category: true }
    });

    let updated = 0;
    let skipped = 0;

    for (const product of products) {
        const productName = product.name.toLowerCase();
        let newCategoryId: string | null = null;

        // Find matching category
        for (const rule of categoryRules) {
            if (rule.keywords.some(keyword => productName.includes(keyword))) {
                newCategoryId = categoryMap.get(rule.name) || null;
                break;
            }
        }

        // If no match, use General
        if (!newCategoryId) {
            newCategoryId = generalCategory.id;
        }

        // Update if different from current category
        if (newCategoryId !== product.categoryId) {
            await prisma.product.update({
                where: { id: product.id },
                data: { categoryId: newCategoryId }
            });

            const newCategoryName = categoryRules.find(r => categoryMap.get(r.name) === newCategoryId)?.name || 'General';
            console.log(`  ✓ ${product.name} → ${newCategoryName}`);
            updated++;
        } else {
            skipped++;
        }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Categorization Complete!\n');
    console.log(`📊 Summary:`);
    console.log(`  ✓ Updated: ${updated} products`);
    console.log(`  ⏭️  Skipped: ${skipped} products (already correct)`);

    await prisma.$disconnect();
}

main().catch(async (error) => {
    console.error('❌ Categorization failed:', error.message);
    await prisma.$disconnect();
    process.exit(1);
});
