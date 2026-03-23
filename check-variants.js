const { PrismaClient } = require('./prisma/generated/client');

const current = new PrismaClient({
  datasources: { db: { url: 'file:C:/Users/admin/Downloads/zain-POS-with-web-main/zain-POS-with-web-main/prisma/pos.db' } },
  log: [],
});

(async () => {
  // Count variants by barcode pattern
  const allVariants = await current.productVariant.findMany({
    include: { _count: { select: { saleItems: true } } }
  });

  let tempVariants = 0, tempWithSales = 0;
  let bcVariants = 0, bcWithSales = 0;
  let otherVariants = 0, otherWithSales = 0;

  for (const v of allVariants) {
    if (v.barcode.startsWith('TEMP-')) {
      tempVariants++;
      if (v._count.saleItems > 0) tempWithSales++;
    } else if (v.barcode.startsWith('BC')) {
      bcVariants++;
      if (v._count.saleItems > 0) bcWithSales++;
    } else {
      otherVariants++;
      if (v._count.saleItems > 0) otherWithSales++;
    }
  }

  console.log('Variant Analysis by Barcode Type:');
  console.log('==================================');
  console.log(`TEMP-* barcodes: ${tempVariants} variants (${tempWithSales} have sales)`);
  console.log(`BC* barcodes:    ${bcVariants} variants (${bcWithSales} have sales)`);
  console.log(`Other barcodes:  ${otherVariants} variants (${otherWithSales} have sales)`);
  console.log(`\nTotal: ${allVariants.length} variants`);

  // Show which should be deleted
  console.log('\n\nRecommendation:');
  if (tempWithSales === 0 && tempVariants > 0) {
    console.log(`  DELETE ${tempVariants} TEMP-* variants (no sales linked)`);
    console.log(`  KEEP ${bcVariants + otherVariants} BC*/other variants`);
  } else if (bcWithSales === 0 && bcVariants > 0) {
    console.log(`  DELETE ${bcVariants} BC* variants (no sales linked)`);
    console.log(`  KEEP ${tempVariants + otherVariants} TEMP-*/other variants`);
  } else {
    console.log('  Both types have sales - manual review needed');
  }

  await current.$disconnect();
})();
