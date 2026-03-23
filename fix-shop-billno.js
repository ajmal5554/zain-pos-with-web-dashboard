/**
 * fix-shop-billno.js
 * Converts Sale.billNo from INTEGER to TEXT for v2 compatibility.
 */

const { PrismaClient } = require('./prisma/generated/client');

const prisma = new PrismaClient({
  datasources: { db: { url: 'file:C:/Users/admin/Downloads/zain-POS-with-web-main/zain-POS-with-web-main/prisma/pos.db' } },
});

async function fixBillNo() {
  console.log('=== Fixing billNo INTEGER → TEXT ===\n');

  try {
    // Check current billNo type
    const saleInfo = await prisma.$queryRawUnsafe(`PRAGMA table_info("Sale")`);
    const billNoCol = saleInfo.find(c => c.name === 'billNo');
    console.log('Current billNo type:', billNoCol?.type);

    if (billNoCol?.type === 'INTEGER') {
      console.log('\nConverting billNo from INTEGER to TEXT...');

      await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = OFF`);

      // Create new table with TEXT billNo
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "Sale_new" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "billNo" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "customerName" TEXT,
          "customerPhone" TEXT,
          "subtotal" REAL NOT NULL,
          "discount" REAL NOT NULL DEFAULT 0,
          "discountPercent" REAL NOT NULL DEFAULT 0,
          "taxAmount" REAL NOT NULL,
          "cgst" REAL NOT NULL,
          "sgst" REAL NOT NULL,
          "grandTotal" REAL NOT NULL,
          "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
          "paidAmount" REAL NOT NULL,
          "changeAmount" REAL NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'COMPLETED',
          "remarks" TEXT,
          "isHistorical" BOOLEAN NOT NULL DEFAULT 0,
          "importedFrom" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL
        )
      `);

      // Copy data, converting billNo to text
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Sale_new"
        SELECT id, CAST(billNo AS TEXT), userId, customerName, customerPhone,
               subtotal, discount, discountPercent, taxAmount, cgst, sgst, grandTotal,
               paymentMethod, paidAmount, changeAmount,
               COALESCE(status, 'COMPLETED'), remarks,
               COALESCE(isHistorical, 0), importedFrom,
               createdAt, updatedAt
        FROM "Sale"
      `);

      // Drop old, rename new
      await prisma.$executeRawUnsafe(`DROP TABLE "Sale"`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Sale_new" RENAME TO "Sale"`);

      // Recreate index
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "Sale_billNo_key" ON "Sale"("billNo")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX "Sale_createdAt_idx" ON "Sale"("createdAt")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX "Sale_status_idx" ON "Sale"("status")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX "Sale_userId_idx" ON "Sale"("userId")`);

      await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = ON`);

      console.log('billNo converted to TEXT successfully!');
    } else {
      console.log('billNo is already TEXT, no conversion needed.');
    }

    // Verify
    console.log('\nVerifying...');
    const sales = await prisma.sale.findMany({ take: 3, orderBy: { createdAt: 'desc' } });
    console.log('Recent sales:', sales.map(s => `Bill #${s.billNo}`).join(', '));

    console.log('\n=== FIX COMPLETE ===');

  } catch (error) {
    console.error('ERROR:', error.message);
  }

  await prisma.$disconnect();
}

fixBillNo();
