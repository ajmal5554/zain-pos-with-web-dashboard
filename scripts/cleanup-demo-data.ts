import { PrismaClient } from '../prisma/generated/client/index.js';

const prisma = new PrismaClient();

async function main() {
    console.log('🗑️  Cleaning Demo Data\n');

    try {
        // Delete demo sales (Bills #1, #2, #3)
        console.log('Deleting demo sales...');
        const demoSales = await prisma.sale.findMany({
            where: {
                OR: [
                    { billNo: { in: [1, 2, 3] } },
                    { customerName: 'Historical Data Import' }
                ]
            },
            include: { items: true }
        });

        for (const sale of demoSales) {
            // Delete sale items first
            await prisma.saleItem.deleteMany({
                where: { saleId: sale.id }
            });

            // Delete sale
            await prisma.sale.delete({
                where: { id: sale.id }
            });

            console.log(`  ✓ Deleted Bill #${sale.billNo}`);
        }

        // Delete Formal Shirt product and its variants
        console.log('\nDeleting demo products...');
        const formalShirt = await prisma.product.findFirst({
            where: { name: 'Formal Shirt' },
            include: { variants: true }
        });

        if (formalShirt) {
            // Delete variants
            await prisma.productVariant.deleteMany({
                where: { productId: formalShirt.id }
            });

            // Delete product
            await prisma.product.delete({
                where: { id: formalShirt.id }
            });

            console.log('  ✓ Deleted "Formal Shirt" product');
        }

        console.log('\n✅ Demo data cleaned successfully!');

    } catch (error: any) {
        console.error('❌ Cleanup failed:', error.message);
    }

    await prisma.$disconnect();
}

main();
