/**
 * test-v2-migration.js
 * Simulates what v2 app does on startup with a v1 database.
 * Tests the auto-migration logic.
 */

const { PrismaClient } = require('./prisma/generated/client');

const prisma = new PrismaClient({
  datasources: { db: { url: 'file:C:/Users/admin/Downloads/zain-POS-with-web-main/zain-POS-with-web-main/prisma/pos.db' } },
});

async function testMigration() {
  console.log('=== Testing V2 Migration on Shop Backup ===\n');

  try {
    // Step 1: Check current state
    console.log('1. Checking current database state...');
    const tables = await prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type = 'table'`);
    console.log('   Tables found:', tables.map(t => t.name).join(', '));

    // Step 2: Test if we can read basic data
    console.log('\n2. Testing basic queries...');

    try {
      const productCount = await prisma.product.count();
      console.log('   Products:', productCount);
    } catch (e) {
      console.log('   ERROR reading products:', e.message);
    }

    try {
      const variantCount = await prisma.productVariant.count();
      console.log('   Variants:', variantCount);
    } catch (e) {
      console.log('   ERROR reading variants:', e.message);
    }

    try {
      const saleCount = await prisma.sale.count();
      console.log('   Sales:', saleCount);
    } catch (e) {
      console.log('   ERROR reading sales:', e.message);
    }

    try {
      const userCount = await prisma.user.count();
      console.log('   Users:', userCount);
    } catch (e) {
      console.log('   ERROR reading users:', e.message);
    }

    // Step 3: Run the actual migration logic (same as ensureSchemaUpdated)
    console.log('\n3. Running auto-migration...');

    const allTables = await prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type = 'table'`);
    const tableSet = new Set(allTables.map(t => t.name));
    const hasTable = (name) => tableSet.has(name);

    // Create missing tables
    const tablesToCreate = ['InvoicePayment', 'Exchange', 'ExchangeItem', 'ExchangePayment', 'Refund', 'RefundItem', 'RefundPayment'];
    for (const tbl of tablesToCreate) {
      if (!hasTable(tbl)) {
        console.log(`   Creating table: ${tbl}`);
      }
    }

    if (!hasTable('InvoicePayment')) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "InvoicePayment" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "saleId" TEXT NOT NULL,
          "paymentMode" TEXT NOT NULL,
          "amount" REAL NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }

    if (!hasTable('Exchange')) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "Exchange" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "originalInvoiceId" TEXT NOT NULL,
          "exchangeDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "differenceAmount" REAL NOT NULL,
          "notes" TEXT,
          "createdBy" TEXT NOT NULL
        )
      `);
    }

    if (!hasTable('ExchangeItem')) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ExchangeItem" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "exchangeId" TEXT NOT NULL,
          "returnedItemId" TEXT,
          "returnedQty" INTEGER NOT NULL DEFAULT 0,
          "newItemId" TEXT,
          "newQty" INTEGER NOT NULL DEFAULT 0,
          "priceDiff" REAL NOT NULL
        )
      `);
    }

    if (!hasTable('ExchangePayment')) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ExchangePayment" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "exchangeId" TEXT NOT NULL,
          "paymentMode" TEXT NOT NULL,
          "amount" REAL NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }

    if (!hasTable('Refund')) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "Refund" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "originalInvoiceId" TEXT NOT NULL,
          "refundDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "totalRefundAmount" REAL NOT NULL,
          "reason" TEXT NOT NULL,
          "createdBy" TEXT NOT NULL
        )
      `);
    }

    if (!hasTable('RefundItem')) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "RefundItem" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "refundId" TEXT NOT NULL,
          "variantId" TEXT NOT NULL,
          "quantity" INTEGER NOT NULL,
          "amount" REAL NOT NULL
        )
      `);
    }

    if (!hasTable('RefundPayment')) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "RefundPayment" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "refundId" TEXT NOT NULL,
          "paymentMode" TEXT NOT NULL,
          "amount" REAL NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }

    // Add missing Sale columns
    const saleTableInfo = await prisma.$queryRawUnsafe(`PRAGMA table_info("Sale")`);
    const saleHas = (name) => saleTableInfo.some(col => col.name === name);

    if (!saleHas('customerPhone')) {
      console.log('   Adding Sale.customerPhone');
      await prisma.$executeRawUnsafe(`ALTER TABLE "Sale" ADD COLUMN customerPhone TEXT`);
    }
    if (!saleHas('status')) {
      console.log('   Adding Sale.status');
      await prisma.$executeRawUnsafe(`ALTER TABLE "Sale" ADD COLUMN status TEXT DEFAULT 'COMPLETED'`);
    }
    if (!saleHas('isHistorical')) {
      console.log('   Adding Sale.isHistorical');
      await prisma.$executeRawUnsafe(`ALTER TABLE "Sale" ADD COLUMN isHistorical BOOLEAN DEFAULT 0`);
    }
    if (!saleHas('importedFrom')) {
      console.log('   Adding Sale.importedFrom');
      await prisma.$executeRawUnsafe(`ALTER TABLE "Sale" ADD COLUMN importedFrom TEXT`);
    }

    // Add missing User columns
    const userTableInfo = await prisma.$queryRawUnsafe(`PRAGMA table_info("User")`);
    const userHas = (name) => userTableInfo.some(col => col.name === name);

    const userColumns = [
      { name: 'permPrintSticker', type: 'BOOLEAN', defaultValue: 1 },
      { name: 'permAddItem', type: 'BOOLEAN', defaultValue: 1 },
      { name: 'permDeleteProduct', type: 'BOOLEAN', defaultValue: 1 },
      { name: 'permVoidSale', type: 'BOOLEAN', defaultValue: 1 },
      { name: 'permViewReports', type: 'BOOLEAN', defaultValue: 1 },
      { name: 'permEditSettings', type: 'BOOLEAN', defaultValue: 0 },
      { name: 'permManageProducts', type: 'BOOLEAN', defaultValue: 0 },
      { name: 'permViewSales', type: 'BOOLEAN', defaultValue: 0 },
      { name: 'permViewGstReports', type: 'BOOLEAN', defaultValue: 0 },
      { name: 'permEditSales', type: 'BOOLEAN', defaultValue: 0 },
      { name: 'permManageInventory', type: 'BOOLEAN', defaultValue: 0 },
      { name: 'permManageUsers', type: 'BOOLEAN', defaultValue: 0 },
      { name: 'permViewCostPrice', type: 'BOOLEAN', defaultValue: 0 },
      { name: 'permChangePayment', type: 'BOOLEAN', defaultValue: 0 },
      { name: 'permDeleteAudit', type: 'BOOLEAN', defaultValue: 0 },
      { name: 'permBulkUpdate', type: 'BOOLEAN', defaultValue: 0 },
      { name: 'permBackDateSale', type: 'BOOLEAN', defaultValue: 0 },
      { name: 'permViewInsights', type: 'BOOLEAN', defaultValue: 0 },
      { name: 'maxDiscount', type: 'REAL', defaultValue: 0 },
    ];

    let userColsAdded = 0;
    for (const col of userColumns) {
      if (!userHas(col.name)) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`);
        userColsAdded++;
      }
    }
    if (userColsAdded > 0) console.log(`   Added ${userColsAdded} User permission columns`);

    // Step 4: Verify after migration
    console.log('\n4. Verifying after migration...');

    const finalProducts = await prisma.product.count();
    const finalVariants = await prisma.productVariant.count();
    const finalSales = await prisma.sale.count();
    const finalUsers = await prisma.user.count();

    console.log('   Products:', finalProducts);
    console.log('   Variants:', finalVariants);
    console.log('   Sales:', finalSales);
    console.log('   Users:', finalUsers);

    // Step 5: Test a complex query (what the app would do)
    console.log('\n5. Testing complex queries (simulating app usage)...');

    try {
      const recentSales = await prisma.sale.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { items: true, user: true }
      });
      console.log('   Recent sales query: OK (' + recentSales.length + ' sales with items)');
    } catch (e) {
      console.log('   ERROR in sales query:', e.message);
    }

    try {
      const productsWithVariants = await prisma.product.findMany({
        take: 5,
        include: { variants: true, category: true }
      });
      console.log('   Products with variants query: OK (' + productsWithVariants.length + ' products)');
    } catch (e) {
      console.log('   ERROR in products query:', e.message);
    }

    console.log('\n=== MIGRATION TEST COMPLETE ===');
    console.log('If no errors above, v2 should work with shop database.');

  } catch (error) {
    console.error('\n!!! MIGRATION FAILED !!!');
    console.error('Error:', error.message);
    console.error('\nThis needs to be fixed before deploying v2 to shop.');
  }

  await prisma.$disconnect();
}

testMigration();
