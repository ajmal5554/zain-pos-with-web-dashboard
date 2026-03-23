import { PrismaClient } from '../prisma/generated/client/index.js';

const prisma = new PrismaClient();

async function main() {
    console.log('🗑️  Deleting Test Product: "Formal Shirt"\n');

    // Find the product
    const product = await prisma.product.findFirst({
        where: { name: 'Formal Shirt' },
        include: { variants: true }
    });

    if (!product) {
        console.log('❌ Product "Formal Shirt" not found.');
        await prisma.$disconnect();
        return;
    }

    console.log(`Found: ${product.name}`);
    console.log(`  - Variants: ${product.variants.length}`);
    console.log(`  - Category: ${product.categoryId}\n`);

    try {
        // Delete variants first
        console.log('Deleting variants...');
        await prisma.productVariant.deleteMany({
            where: { productId: product.id }
        });
        console.log(`  ✓ Deleted ${product.variants.length} variant(s)`);

        // Delete product
        console.log('Deleting product...');
        await prisma.product.delete({
            where: { id: product.id }
        });
        console.log('  ✓ Deleted product\n');

        console.log('✅ Successfully deleted "Formal Shirt"!');
    } catch (error) {
        console.error('❌ Failed to delete:', error);
    }

    await prisma.$disconnect();
}

main();
