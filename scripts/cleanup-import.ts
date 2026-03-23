import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanup() {
    console.log('🧹 Cleaning up imported data...\n');

    try {
        // Delete all product variants (will cascade delete sale items)
        const deletedVariants = await prisma.productVariant.deleteMany({});
        console.log(`✓ Deleted ${deletedVariants.count} product variants`);

        // Delete all products
        const deletedProducts = await prisma.product.deleteMany({});
        console.log(`✓ Deleted ${deletedProducts.count} products`);

        // Delete Uncategorized category
        const deletedCategories = await prisma.category.deleteMany({
            where: { name: 'Uncategorized' },
        });
        console.log(`✓ Deleted ${deletedCategories.count} categories`);

        console.log('\n✅ Cleanup complete! Ready for fresh import.');

        await prisma.$disconnect();
    } catch (error: any) {
        console.error('❌ Cleanup failed:', error.message);
        await prisma.$disconnect();
        process.exit(1);
    }
}

cleanup();
