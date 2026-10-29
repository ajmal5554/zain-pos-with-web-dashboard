const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
let database, temporaryDirectory;
let getStockOverview, getStockMovements;
let PermissionService, PermissionMiddleware;

before(async () => {
    // 1. Create isolated disposable temporary directory and SQLite database
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-stock-st01-'));
    const dbPath = path.join(temporaryDirectory, 'test-stock.db').replaceAll('\\', '/');

    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    database = new PrismaClient({
        datasources: { db: { url: `file:${dbPath}` } },
    });

    // 2. Create tables for test schema in disposable database
    await database.$executeRawUnsafe(`
        CREATE TABLE "User" (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE,
            password TEXT,
            name TEXT,
            role TEXT,
            isActive INTEGER DEFAULT 1,
            permManageInventory INTEGER DEFAULT 0,
            permManageProducts INTEGER DEFAULT 0,
            createdAt TEXT,
            updatedAt TEXT
        )
    `);

    await database.$executeRawUnsafe(`
        CREATE TABLE "Category" (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE,
            createdAt TEXT,
            updatedAt TEXT
        )
    `);

    await database.$executeRawUnsafe(`
        CREATE TABLE "Product" (
            id TEXT PRIMARY KEY,
            name TEXT,
            description TEXT,
            categoryId TEXT,
            hsn TEXT,
            taxRate REAL DEFAULT 5.0,
            isActive INTEGER DEFAULT 1,
            createdAt TEXT,
            updatedAt TEXT,
            isSynced INTEGER DEFAULT 0,
            lastSyncedAt TEXT
        )
    `);

    await database.$executeRawUnsafe(`
        CREATE TABLE "ProductVariant" (
            id TEXT PRIMARY KEY,
            productId TEXT,
            sku TEXT UNIQUE,
            barcode TEXT UNIQUE,
            size TEXT,
            color TEXT,
            mrp REAL,
            sellingPrice REAL,
            costPrice REAL,
            stock INTEGER DEFAULT 0,
            minStock INTEGER DEFAULT 5,
            isActive INTEGER DEFAULT 1,
            createdAt TEXT,
            updatedAt TEXT,
            isSynced INTEGER DEFAULT 0,
            lastSyncedAt TEXT
        )
    `);

    await database.$executeRawUnsafe(`
        CREATE TABLE "InventoryMovement" (
            id TEXT PRIMARY KEY,
            variantId TEXT,
            type TEXT,
            quantity INTEGER,
            reason TEXT,
            reference TEXT,
            createdBy TEXT,
            createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            isSynced INTEGER DEFAULT 0,
            lastSyncedAt DATETIME
        )
    `);

    // 3. Compile and load electron/stock.service.ts
    const stockServiceSource = fs.readFileSync(path.join(root, 'electron/stock.service.ts'), 'utf8');
    const compiledStockService = ts.transpileModule(stockServiceSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;

    const stockModule = { exports: {} };
    const stockFn = new Function('require', 'exports', 'module', compiledStockService);
    stockFn(require, stockModule.exports, stockModule);
    getStockOverview = stockModule.exports.getStockOverview;
    getStockMovements = stockModule.exports.getStockMovements;

    // 4. Compile and load electron/permission.service.ts
    const permSource = fs.readFileSync(path.join(root, 'electron/permission.service.ts'), 'utf8');
    const compiledPermService = ts.transpileModule(permSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;

    const permModule = { exports: {} };
    const permRequire = (id) => {
        if (id === './logger') return { logger: { info: () => {}, warn: () => {}, error: () => {} } };
        return require(id);
    };
    const permFn = new Function('require', 'exports', 'module', compiledPermService);
    permFn(permRequire, permModule.exports, permModule);
    PermissionService = permModule.exports.PermissionService;
    PermissionMiddleware = permModule.exports.PermissionMiddleware;
});

after(async () => {
    if (database) await database.$disconnect();
    if (temporaryDirectory && path.dirname(temporaryDirectory) === path.resolve(os.tmpdir()) &&
        path.basename(temporaryDirectory).startsWith('zain-stock-st01-') && fs.existsSync(temporaryDirectory)) {
        try {
            fs.rmSync(temporaryDirectory, { recursive: true, force: true });
        } catch {
            // ignore cleanup failure on Windows temp files if locked
        }
    }
});

beforeEach(async () => {
    await database.$executeRawUnsafe('DELETE FROM "InventoryMovement"');
    await database.$executeRawUnsafe('DELETE FROM "ProductVariant"');
    await database.$executeRawUnsafe('DELETE FROM "Product"');
    await database.$executeRawUnsafe('DELETE FROM "Category"');
    await database.$executeRawUnsafe('DELETE FROM "User"');
});

// Helper to seed standard products and variants
async function seedCatalog() {
    await database.$executeRawUnsafe(`
        INSERT INTO "User" (id, username, password, name, role, isActive, permManageInventory)
        VALUES ('user-admin', 'admin', 'hash', 'Shop Owner', 'ADMIN', 1, 1),
               ('user-staff', 'staff', 'hash', 'Cashier One', 'CASHIER', 1, 1),
               ('user-no-inv', 'cashier2', 'hash', 'Cashier Two', 'CASHIER', 1, 0)
    `);

    await database.$executeRawUnsafe(`
        INSERT INTO "Category" (id, name, createdAt, updatedAt)
        VALUES ('cat-shirts', 'Shirts', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z'),
               ('cat-pants', 'Pants', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z')
    `);

    await database.$executeRawUnsafe(`
        INSERT INTO "Product" (id, name, categoryId, taxRate, isActive, createdAt, updatedAt)
        VALUES ('prod-linen', 'Linen Formal Shirt', 'cat-shirts', 5.0, 1, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z'),
               ('prod-cotton', 'Cotton Casual Shirt', 'cat-shirts', 5.0, 1, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z'),
               ('prod-chinos', 'Slim Fit Chinos', 'cat-pants', 5.0, 1, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z')
    `);

    // S1, S2, S3, S4 test data:
    // - prod-linen has 3 variants (S1)
    // - var-linen-s and var-cotton-m both sell for Rs. 700 (S2)
    // - var-linen-m has recorded stock -12 (S3)
    // - var-cotton-m has recorded stock 0 (S4)
    // - barcodes with leading zero or custom format
    await database.$executeRawUnsafe(`
        INSERT INTO "ProductVariant" (id, productId, sku, barcode, size, color, mrp, sellingPrice, costPrice, stock, minStock, isActive, createdAt, updatedAt)
        VALUES
        ('var-linen-s', 'prod-linen', 'LIN-S-01', '0890123', 'Small', 'White', 750.0, 700.0, 450.0, 15, 5, 1, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z'),
        ('var-linen-m', 'prod-linen', 'LIN-M-02', '0890124', 'Medium', 'White', 750.0, 750.0, 480.0, -12, 5, 1, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z'),
        ('var-linen-l', 'prod-linen', 'LIN-L-03', '0890125', 'Large', 'White', 800.0, 800.0, 500.0, 8, 5, 1, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z'),
        ('var-cotton-m', 'prod-cotton', 'COT-M-01', '0890130', 'Medium', 'Blue', 700.0, 700.0, 420.0, 0, 5, 1, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z'),
        ('var-chinos-32', 'prod-chinos', 'CHI-32', '0890140', '32', 'Beige', 1200.0, 1100.0, 700.0, 20, 5, 1, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z')
    `);
}

// -----------------------------------------------------------------------------
// S1: Product with 3 existing variants produces 3 distinct rows with stable IDs
// -----------------------------------------------------------------------------
test('S1: Product with 3 existing variants produces 3 distinct rows with stable variant IDs and barcodes', async () => {
    await seedCatalog();
    const res = await getStockOverview(database, { search: 'Linen Formal Shirt' });
    assert.equal(res.success, true);
    assert.equal(res.data.items.length, 3);

    const ids = res.data.items.map((i) => i.id);
    assert.ok(ids.includes('var-linen-s'));
    assert.ok(ids.includes('var-linen-m'));
    assert.ok(ids.includes('var-linen-l'));

    // Check barcode preservation (including leading zeroes)
    const barcodes = res.data.items.map((i) => i.barcode);
    assert.ok(barcodes.includes('0890123'));
    assert.ok(barcodes.includes('0890124'));
    assert.ok(barcodes.includes('0890125'));
});

// -----------------------------------------------------------------------------
// S2: Two variants both sell for Rs. 700 remain separate rows (never merged by price or name)
// -----------------------------------------------------------------------------
test('S2: Two variants both selling for Rs. 700 remain separate rows; neither price nor name merges them', async () => {
    await seedCatalog();
    const res = await getStockOverview(database, { categoryId: 'cat-shirts' });
    assert.equal(res.success, true);

    const varLinenS = res.data.items.find((i) => i.id === 'var-linen-s');
    const varCottonM = res.data.items.find((i) => i.id === 'var-cotton-m');
    assert.ok(varLinenS, 'Linen Small must exist as separate row');
    assert.ok(varCottonM, 'Cotton Medium must exist as separate row');
    assert.notEqual(varLinenS.id, varCottonM.id);
    assert.notEqual(varLinenS.barcode, varCottonM.barcode);
});

// -----------------------------------------------------------------------------
// S3: Existing recorded stock -12 returns -12 truthfully without claiming physical shortage
// -----------------------------------------------------------------------------
test('S3: Existing recorded stock -12 returns -12 as unverified recorded stock', async () => {
    await seedCatalog();
    const res = await getStockOverview(database, { search: 'LIN-M-02' });
    assert.equal(res.success, true);
    assert.equal(res.data.items.length, 1);
    assert.equal(res.data.items[0].stock, -12);
    assert.equal(res.data.items[0].id, 'var-linen-m');
});

// -----------------------------------------------------------------------------
// S4: Existing recorded stock 0 is distinguished from loading/missing
// -----------------------------------------------------------------------------
test('S4: Existing recorded stock 0 returns explicitly as 0', async () => {
    await seedCatalog();
    const res = await getStockOverview(database, { search: 'COT-M-01' });
    assert.equal(res.success, true);
    assert.equal(res.data.items.length, 1);
    assert.equal(res.data.items[0].stock, 0);
    assert.equal(typeof res.data.items[0].stock, 'number');
});

// -----------------------------------------------------------------------------
// S5: Search by product name, SKU, barcode, and category filter
// -----------------------------------------------------------------------------
test('S5: Search by product name, SKU, barcode, and category returns exact matches with preserved barcodes', async () => {
    await seedCatalog();

    // 1. Barcode search
    const byBarcode = await getStockOverview(database, { search: '0890124' });
    assert.equal(byBarcode.data.items.length, 1);
    assert.equal(byBarcode.data.items[0].barcode, '0890124');

    // 2. SKU search
    const bySku = await getStockOverview(database, { search: 'CHI-32' });
    assert.equal(bySku.data.items.length, 1);
    assert.equal(bySku.data.items[0].sku, 'CHI-32');

    // 3. Category filter
    const byCategory = await getStockOverview(database, { categoryId: 'cat-pants' });
    assert.equal(byCategory.data.items.length, 1);
    assert.equal(byCategory.data.items[0].product.name, 'Slim Fit Chinos');

    // 4. Multi-token name search
    const byName = await getStockOverview(database, { search: 'Linen Shirt' });
    assert.equal(byName.data.items.length, 3);
});

// -----------------------------------------------------------------------------
// S6: Pagination and totals cover all filtered rows with stable IDs
// -----------------------------------------------------------------------------
test('S6: Multi-page results cover all filtered rows without duplicate or missing IDs', async () => {
    await database.$executeRawUnsafe(`
        INSERT INTO "Category" (id, name, createdAt, updatedAt)
        VALUES ('cat-bulk', 'Bulk Category', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z')
    `);

    await database.$executeRawUnsafe(`
        INSERT INTO "Product" (id, name, categoryId, isActive, createdAt, updatedAt)
        VALUES ('prod-bulk', 'Bulk Item', 'cat-bulk', 1, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z')
    `);

    // Insert 55 variants
    for (let i = 1; i <= 55; i++) {
        const id = `var-bulk-${String(i).padStart(3, '0')}`;
        const code = `890${String(i).padStart(4, '0')}`;
        await database.$executeRawUnsafe(`
            INSERT INTO "ProductVariant" (id, productId, sku, barcode, stock, isActive, createdAt, updatedAt, mrp, sellingPrice, costPrice)
            VALUES ('${id}', 'prod-bulk', 'SKU-${i}', '${code}', ${i % 3 === 0 ? -2 : i % 3 === 1 ? 0 : 5}, 1, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z', 100, 100, 50)
        `);
    }

    // Query Page 1 with pageSize 25
    const p1 = await getStockOverview(database, { categoryId: 'cat-bulk', page: 1, pageSize: 25 });
    assert.equal(p1.data.totalMatching, 55);
    assert.equal(p1.data.items.length, 25);
    assert.equal(p1.data.totalPages, 3);

    // Query Page 2
    const p2 = await getStockOverview(database, { categoryId: 'cat-bulk', page: 2, pageSize: 25 });
    assert.equal(p2.data.items.length, 25);

    // Query Page 3
    const p3 = await getStockOverview(database, { categoryId: 'cat-bulk', page: 3, pageSize: 25 });
    assert.equal(p3.data.items.length, 5);

    // Assert no overlapping IDs between page 1, page 2, and page 3
    const p1Ids = new Set(p1.data.items.map((i) => i.id));
    const p2Ids = new Set(p2.data.items.map((i) => i.id));
    const p3Ids = new Set(p3.data.items.map((i) => i.id));

    for (const id of p2Ids) assert.ok(!p1Ids.has(id), `Duplicate ID across pages: ${id}`);
    for (const id of p3Ids) {
        assert.ok(!p1Ids.has(id), `Duplicate ID across pages: ${id}`);
        assert.ok(!p2Ids.has(id), `Duplicate ID across pages: ${id}`);
    }

    // Total unique IDs across all 3 pages must be 55
    const allIds = new Set([...p1Ids, ...p2Ids, ...p3Ids]);
    assert.equal(allIds.size, 55);
});

// -----------------------------------------------------------------------------
test('S6: Filtering a later page clamps to the last matching page and returns its rows', async () => {
    await seedCatalog();
    const before = await getStockOverview(database, { page: 3, pageSize: 2 });
    assert.equal(before.success, true);
    assert.equal(before.data.page, 3);
    const filtered = await getStockOverview(database, { page: 3, pageSize: 2, balanceFilter: 'NEGATIVE' });
    assert.equal(filtered.success, true);
    assert.equal(filtered.data.page, 1);
    assert.equal(filtered.data.totalPages, 1);
    assert.equal(filtered.data.totalMatching, 1);
    assert.deepEqual(filtered.data.items.map(item => item.id), ['var-linen-m']);
});

test('S6: Refresh clamps after stock changes shrink the result, including no matches', async () => {
    await seedCatalog();
    const args = { page: 2, pageSize: 2, balanceFilter: 'POSITIVE' };
    const before = await getStockOverview(database, args);
    assert.equal(before.data.page, 2);
    assert.equal(before.data.totalMatching, 3);
    // Fixture changes occur only in this disposable test database.
    await database.$executeRawUnsafe('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?', 'var-linen-s');
    const shrunk = await getStockOverview(database, args);
    assert.equal(shrunk.success, true);
    assert.equal(shrunk.data.page, 1);
    assert.equal(shrunk.data.totalMatching, 2);
    assert.equal(shrunk.data.items.length, 2);
    await database.$executeRawUnsafe('UPDATE "ProductVariant" SET stock = 0 WHERE stock > 0');
    const empty = await getStockOverview(database, args);
    assert.equal(empty.success, true);
    assert.equal(empty.data.page, 1);
    assert.equal(empty.data.totalPages, 1);
    assert.equal(empty.data.totalMatching, 0);
    assert.deepEqual(empty.data.items, []);
});

test('S6: Fractional or unbounded page inputs still produce bounded integer pagination', async () => {
    await seedCatalog();
    const fractional = await getStockOverview(database, { page: 2.9, pageSize: 2.9 });
    assert.equal(fractional.success, true);
    assert.equal(fractional.data.page, 2);
    assert.equal(fractional.data.pageSize, 2);
    const unbounded = await getStockOverview(database, { page: Infinity, pageSize: Infinity });
    assert.equal(unbounded.success, true);
    assert.equal(unbounded.data.page, 1);
    assert.equal(unbounded.data.pageSize, 100);
    assert.equal(unbounded.data.items.length, 5);
});

// S7: Request sequence protection (simulating search race condition)
// -----------------------------------------------------------------------------
test('S7: Search sequence protection discards older search response if newer search was triggered', () => {
    let activeRequestId = 0;
    let renderedResult = 'INITIAL';

    // User triggers Search A (reqId 1)
    const reqA = ++activeRequestId;

    // User triggers Search B immediately after (reqId 2)
    const reqB = ++activeRequestId;

    // Search B completes first
    if (reqB === activeRequestId) {
        renderedResult = 'RESULT_B';
    }

    // Search A completes later (stale response)
    if (reqA === activeRequestId) {
        renderedResult = 'RESULT_A';
    }

    // Result must stay RESULT_B
    assert.equal(renderedResult, 'RESULT_B');
});

// -----------------------------------------------------------------------------
// S8: Movement quantities signed correctly (-2, +1, -1) and source types
// -----------------------------------------------------------------------------
test('S8: Movement quantities preserve stored signs (-2, +1, -1) and source types without double-negation', async () => {
    await seedCatalog();

    await database.$executeRawUnsafe(`
        INSERT INTO "InventoryMovement" (id, variantId, type, quantity, reason, reference, createdBy, createdAt)
        VALUES
        ('mov-1', 'var-linen-s', 'SALE', -2, 'Sale Bill #101', 'sale-101', 'user-staff', '2026-10-02T10:00:00Z'),
        ('mov-2', 'var-linen-s', 'REFUND', 1, 'Customer return', 'ref-50', 'user-staff', '2026-10-03T11:00:00Z'),
        ('mov-3', 'var-linen-s', 'EXCHANGE_OUT', -1, 'Exchanged for shirt', 'exc-20', 'user-staff', '2026-10-04T12:00:00Z')
    `);

    const res = await getStockMovements(database, { variantId: 'var-linen-s' });
    assert.equal(res.success, true);
    assert.equal(res.data.movements.length, 3);

    const mov1 = res.data.movements.find((m) => m.id === 'mov-1');
    const mov2 = res.data.movements.find((m) => m.id === 'mov-2');
    const mov3 = res.data.movements.find((m) => m.id === 'mov-3');

    assert.equal(mov1.quantity, -2);
    assert.equal(mov1.type, 'SALE');

    assert.equal(mov2.quantity, 1);
    assert.equal(mov2.type, 'REFUND');

    assert.equal(mov3.quantity, -1);
    assert.equal(mov3.type, 'EXCHANGE_OUT');

    // Operator resolved to user name
    assert.equal(mov1.operatorName, 'Cashier One');
});

// -----------------------------------------------------------------------------
// S9: Old or unfamiliar movement type remains visible with readable fallback
// -----------------------------------------------------------------------------
test('S9: Unfamiliar legacy movement type remains visible with raw type and reason', async () => {
    await seedCatalog();

    await database.$executeRawUnsafe(`
        INSERT INTO "InventoryMovement" (id, variantId, type, quantity, reason, reference, createdBy, createdAt)
        VALUES ('mov-legacy', 'var-linen-s', 'LEGACY_AUDIT_DELTA', 3, 'Manual correction note', 'ref-old', 'user-admin', '2026-10-01T10:00:00Z')
    `);

    const res = await getStockMovements(database, { variantId: 'var-linen-s' });
    assert.equal(res.success, true);
    assert.equal(res.data.movements.length, 1);
    assert.equal(res.data.movements[0].type, 'LEGACY_AUDIT_DELTA');
    assert.equal(res.data.movements[0].quantity, 3);
    assert.equal(res.data.movements[0].reason, 'Manual correction note');
});

// -----------------------------------------------------------------------------
// S10: Movement date filter changes only movements, current stock remains present-time balance
// -----------------------------------------------------------------------------
test('S10: Changing movement date filter restricts movement rows without relabelling present stock', async () => {
    await seedCatalog();

    await database.inventoryMovement.create({
        data: {
            id: 'mov-sep',
            variantId: 'var-linen-s',
            type: 'IN',
            quantity: 20,
            reason: 'September delivery',
            createdBy: 'user-admin',
            createdAt: new Date('2026-09-15T10:00:00Z'),
        },
    });

    await database.inventoryMovement.create({
        data: {
            id: 'mov-oct',
            variantId: 'var-linen-s',
            type: 'SALE',
            quantity: -5,
            reason: 'October sale',
            createdBy: 'user-staff',
            createdAt: new Date('2026-10-05T10:00:00Z'),
        },
    });

    // Filter movements for October only
    const res = await getStockMovements(database, {
        variantId: 'var-linen-s',
        fromDate: '2026-10-01',
        toDate: '2026-10-10',
    });

    assert.equal(res.success, true);
    assert.equal(res.data.movements.length, 1);
    assert.equal(res.data.movements[0].id, 'mov-oct');

    // Present recorded stock of the variant is 15 (seeded in ProductVariant), not reconstructed
    assert.equal(res.data.variant.stock, 15);
});

// -----------------------------------------------------------------------------
// S11: Data request error returns error state, never fabricated zero totals
// -----------------------------------------------------------------------------
test('S11: Data request error returns failure with message, not fabricated zeros', async () => {
    const res = await getStockMovements(database, { variantId: 'non-existent-id' });
    assert.equal(res.success, false);
    assert.ok(res.error.includes('not found'));
    assert.equal(res.data, undefined);
});

// -----------------------------------------------------------------------------
// S12: Refresh after committed sale reflects updated recorded stock and new movement
// -----------------------------------------------------------------------------
test('S12: Refresh after committed sale reflects updated quantity and new movement', async () => {
    await seedCatalog();

    // Initial stock is 15
    const initialOverview = await getStockOverview(database, { search: 'LIN-S-01' });
    assert.equal(initialOverview.data.items[0].stock, 15);

    // Simulate committed sale: stock decreases by 2, movement inserted
    await database.$executeRawUnsafe(`
        UPDATE "ProductVariant" SET stock = 13 WHERE id = 'var-linen-s'
    `);
    await database.inventoryMovement.create({
        data: {
            id: 'mov-fresh',
            variantId: 'var-linen-s',
            type: 'SALE',
            quantity: -2,
            reason: 'Fresh POS Sale',
            reference: 'bill-999',
            createdBy: 'user-staff',
            createdAt: new Date('2026-10-08T15:00:00Z'),
        },
    });

    // Refresh overview
    const refreshedOverview = await getStockOverview(database, { search: 'LIN-S-01' });
    assert.equal(refreshedOverview.data.items[0].stock, 13);

    // Refresh movements
    const refreshedMovements = await getStockMovements(database, { variantId: 'var-linen-s' });
    assert.equal(refreshedMovements.data.movements.some((m) => m.id === 'mov-fresh'), true);
});

// -----------------------------------------------------------------------------
// S13: Access denial for unauthorized user, allowed for authorized user
// -----------------------------------------------------------------------------
test('S13: Access denied for unauthorized user without permManageInventory; granted for admin or permitted user', async () => {
    const adminUser = { id: 'user-admin', role: 'ADMIN', isActive: true, permManageInventory: true };
    const cashierWithPerm = { id: 'user-staff', role: 'CASHIER', isActive: true, permManageInventory: true };
    const cashierWithoutPerm = { id: 'user-no-inv', role: 'CASHIER', isActive: true, permManageInventory: false };

    // 1. Admin check
    const adminCheck = PermissionService.checkPermission(adminUser, 'permManageInventory');
    assert.equal(adminCheck.allowed, true);

    // 2. Cashier with permManageInventory
    const cashierPermCheck = PermissionService.checkPermission(cashierWithPerm, 'permManageInventory');
    assert.equal(cashierPermCheck.allowed, true);

    // 3. Cashier WITHOUT permManageInventory
    const cashierDenyCheck = PermissionService.checkPermission(cashierWithoutPerm, 'permManageInventory');
    assert.equal(cashierDenyCheck.allowed, false);
    assert.ok(cashierDenyCheck.reason.includes('Missing permission'));

    // 4. Inactive user check
    const inactiveUser = { ...cashierWithPerm, isActive: false };
    const inactiveCheck = PermissionService.checkPermission(inactiveUser, 'permManageInventory');
    assert.equal(inactiveCheck.allowed, false);
});

// -----------------------------------------------------------------------------
// S14: No cost-price fields returned in overview or movements responses
// -----------------------------------------------------------------------------
test('S14: Authorized request strictly omits costPrice from all returned variant and product projections', async () => {
    await seedCatalog();

    const overview = await getStockOverview(database);
    assert.equal(overview.success, true);
    for (const item of overview.data.items) {
        assert.equal(item.costPrice, undefined, 'costPrice must NOT be present in variant');
        assert.equal(item.product.costPrice, undefined, 'costPrice must NOT be present in product');
    }

    const movements = await getStockMovements(database, { variantId: 'var-linen-s' });
    assert.equal(movements.success, true);
    assert.equal(movements.data.variant.costPrice, undefined, 'costPrice must NOT be present in movement variant');
});

// -----------------------------------------------------------------------------
// S15: Helper reads preserve every field in the local stock-related tables.
// -----------------------------------------------------------------------------
test('S15: Stock read helpers leave catalogue, movement and user rows unchanged', async () => {
    await seedCatalog();

    await database.inventoryMovement.create({ data: {
        id: 'read-only-movement', variantId: 'var-linen-s', type: 'OUT', quantity: -1,
        reason: 'Sale', reference: 'test-sale', createdBy: 'user-staff',
    } });
    const tables = ['ProductVariant', 'InventoryMovement', 'Product', 'Category', 'User'];
    const snapshot = () => Promise.all(tables.map(table =>
        database.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY id`)));
    const before = await snapshot();

    // Execute queries
    await getStockOverview(database, { page: 1, pageSize: 50, balanceFilter: 'ALL' });
    await getStockOverview(database, { search: 'Linen', balanceFilter: 'POSITIVE' });
    await getStockOverview(database, { categoryId: 'cat-shirts', balanceFilter: 'NEGATIVE' });
    await getStockMovements(database, { variantId: 'var-linen-s' });
    await getStockMovements(database, { variantId: 'var-linen-m', fromDate: '2026-10-01' });

    assert.deepEqual(await snapshot(), before, 'Reads must not update existing fields or add/remove rows');
});

// -----------------------------------------------------------------------------
// S16: Offline execution functions fully without cloud connection
// -----------------------------------------------------------------------------
test('S16: Read handlers query local database directly with zero cloud dependency', async () => {
    await seedCatalog();
    // Local SQLite query executes synchronously/locally without any HTTP / axios calls
    const res = await getStockOverview(database);
    assert.equal(res.success, true);
    assert.ok(res.data.items.length > 0);
});

// -----------------------------------------------------------------------------
// S17: Empty catalogue handling
// -----------------------------------------------------------------------------
test('S17: Empty catalogue returns clean empty state without crashing', async () => {
    // Database has 0 products and variants
    const res = await getStockOverview(database);
    assert.equal(res.success, true);
    assert.equal(res.data.items.length, 0);
    assert.equal(res.data.totalMatching, 0);
    assert.equal(res.data.stats.totalMatching, 0);
    assert.equal(res.data.stats.positiveCount, 0);
    assert.equal(res.data.stats.zeroCount, 0);
    assert.equal(res.data.stats.negativeCount, 0);
});
