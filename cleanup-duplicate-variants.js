/**
 * cleanup-duplicate-variants.js
 * Removes duplicate BC* variants that have no sales linked.
 * Run once to clean up the database.
 */

const { PrismaClient } = require('./prisma/generated/client');

const prisma = new PrismaClient({
  datasources: { db: { url: 'file:C:/Users/admin/Downloads/zain-POS-with-web-main/zain-POS-with-web-main/prisma/pos.db' } },
});

async function main() {
  // Count before
  const before = await prisma.productVariant.count();
  console.log('Variants before:', before);

  // Show what will be deleted
  const toDelete = await prisma.productVariant.findMany({
    where: {
      barcode: { startsWith: 'BC' },
      saleItems: { none: {} }
    },
    select: { id: true, barcode: true, sku: true }
  });
  console.log('BC* variants with no sales:', toDelete.length);

  // Delete BC* variants with no sales
  const deleted = await prisma.productVariant.deleteMany({
    where: {
      barcode: { startsWith: 'BC' },
      saleItems: { none: {} }
    }
  });

  console.log('Deleted:', deleted.count, 'BC* variants');

  // Count after
  const after = await prisma.productVariant.count();
  console.log('Variants after:', after);

  // Verify all products still have at least 1 variant
  const productsWithoutVariants = await prisma.product.findMany({
    where: {
      variants: { none: {} }
    },
    select: { id: true, name: true }
  });

  if (productsWithoutVariants.length > 0) {
    console.log('\nWARNING: Products without variants:', productsWithoutVariants.length);
    for (const p of productsWithoutVariants) {
      console.log('  -', p.name);
    }
  } else {
    console.log('\nAll products still have at least 1 variant.');
  }

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
