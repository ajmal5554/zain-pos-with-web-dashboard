
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const CATEGORY_RULES = [
    { name: 'Jeans', keywords: ['jeans', 'denim'] },
    { name: 'Shirts', keywords: ['shirt', 'formal', 'casual'] },
    { name: 'T-Shirts', keywords: ['t-shirt', 'polo', 'tee'] },
    { name: 'Pants', keywords: ['pant', 'trouser', 'chino', 'formal pant'] },
    { name: 'Shorts', keywords: ['short', 'boxer', 'bermuda', 'knicker', 'capri'] },
    { name: 'Traditional', keywords: ['mundu', 'dhoti', 'lungi'] },
    { name: 'Innerwear', keywords: ['vest', 'brief', 'trunk', 'baniyan', 'underwear'] },
    { name: 'Kids', keywords: ['kid', 'boy', 'girl', 'baby', 'babasuit', 'frock'] },
    { name: 'Accessories', keywords: ['belt', 'wallet', 'sock', 'perfume'] },
];

async function main() {
    console.log('Starting auto-categorization...');

    // 1. Create Categories
    const categoryMap = new Map<string, string>();

    for (const rule of CATEGORY_RULES) {
        let category = await db.category.findUnique({
            where: { name: rule.name },
        });

        if (!category) {
            console.log(`Creating category: ${rule.name}`);
            category = await db.category.create({
                data: { name: rule.name },
            });
        }
        categoryMap.set(rule.name, category.id);
    }

    // Get "Uncategorized" or Default category if needed as fallback
    let defaultCategory = await db.category.findFirst({
        where: { name: { contains: 'Uncategorized' } }
    });

    // 2. Fetch all products
    const products = await db.product.findMany({
        include: { category: true }
    });

    console.log(`Found ${products.length} products to check.`);

    let updatedCount = 0;

    for (const product of products) {
        const productName = product.name.toLowerCase();
        let matchedCategoryName = null;

        // Find matching category
        for (const rule of CATEGORY_RULES) {
            if (rule.keywords.some(k => productName.includes(k))) {
                matchedCategoryName = rule.name;
                break;
            }
        }

        if (matchedCategoryName) {
            const newCategoryId = categoryMap.get(matchedCategoryName);

            // Only update if category is different
            if (product.categoryId !== newCategoryId && newCategoryId) {
                await db.product.update({
                    where: { id: product.id },
                    data: { categoryId: newCategoryId }
                });
                console.log(`Moved "${product.name}" -> ${matchedCategoryName}`);
                updatedCount++;
            }
        }
    }

    console.log(`Auto-categorization complete! Updated ${updatedCount} products.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
