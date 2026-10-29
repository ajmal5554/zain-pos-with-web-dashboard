const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
} }).outputText;
const loaded = new Map();
function load(relative) {
    if (loaded.has(relative)) return loaded.get(relative);
    const exports = {};
    loaded.set(relative, exports);
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, relative + '.ts'), 'utf8')), {
        exports, module: { exports }, Buffer, Date,
        require: name => name.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), name))) : require(name),
    });
    return exports;
}
const guard = load('electron/tracked-stock.service');
const catalogue = load('electron/catalogue.service');
const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
let directory, database, databaseUrl, actor, checkout, update, exchange, billNumberRequests = 0;

before(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-tracked-stock-'));
    databaseUrl = `file:${path.join(directory, 'test.db').replaceAll('\\', '/')}`;
    database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const sql = execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff',
        '--from-empty', '--to-schema-datamodel', path.join(root, 'prisma/generated/client/schema.prisma'), '--script'], { encoding: 'utf8', cwd: root });
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await database.$executeRawUnsafe(statement);
    await catalogue.ensureCatalogueSchema(database);
    await database.$executeRawUnsafe('CREATE TABLE "StockVariantTracking" (variantId TEXT NOT NULL PRIMARY KEY, activatedAt TEXT NOT NULL, FOREIGN KEY (variantId) REFERENCES "ProductVariant" (id) ON DELETE CASCADE)');
    actor = await database.user.create({ data: { username: randomUUID(), password: 'test-only', name: 'Test Owner', role: 'ADMIN', isActive: true, permEditSales: true } });
    const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    const context = {
        ...guard, ...load('src/lib/refund'), ...load('src/lib/saleEdit'), ...load('src/lib/catalogueDescription'),
        ...load('electron/return-stock.service'), ...load('electron/stock-cost.service'),
        enrichCatalogueVariants: catalogue.enrichCatalogueVariants, prisma: database,
        ipcMain: { handle: (channel, handler) => { if (channel === 'sales:checkout') checkout = handler; if (channel === 'sales:updateSale') update = handler; } },
        createSecureIpcHandler: (channel, _permission, handler) => { if (channel === 'sales:exchange') exchange = handler; },
        PermissionMiddleware: { editSale: null },
        sanitizeString: value => value == null ? undefined : String(value).trim().slice(0, 500),
        roundCurrency: value => Math.round(Number(value || 0) * 100) / 100,
        getNextBillNoForDate: async () => { billNumberRequests++; return `test-${randomUUID()}`; },
        cloudSync: { queueSale: async () => {}, queueExchange: async () => {}, syncAuditLogs: async () => {} },
        saleCounterSinceLastBackup: 0, performAutoBackup() {}, console: { error() {}, log() {}, info() {}, warn() {} },
    };
    const validation = main.slice(main.indexOf('// --- Input Validation Helpers ---'), main.indexOf('function validateProductData('));
    const checkoutSource = main.slice(main.indexOf("ipcMain.handle('sales:checkout'"), main.indexOf("ipcMain.handle('sales:updatePayment'"));
    const updateSource = main.slice(main.indexOf("ipcMain.handle('sales:updateSale'"), main.indexOf('// Professional Exchange Handler'));
    const exchangeSource = main.slice(main.indexOf('// Professional Exchange Handler'), main.indexOf('// Retrieve structured Exchange/Refund details'));
    vm.runInNewContext(compile([validation, checkoutSource, updateSource, exchangeSource].join('\n')), context);
});

after(async () => {
    await database?.$disconnect();
    if (directory && path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('zain-tracked-stock-')) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

async function variant({ stock = 1, tracked = true, price = 700, prepared = false, categoryId = null } = {}) {
    const category = categoryId ? { id: categoryId } : await database.category.create({ data: { name: randomUUID() } });
    const product = await database.product.create({ data: { name: 'Test Shirt', categoryId: category.id } });
    const row = await database.productVariant.create({ data: { productId: product.id, sku: randomUUID(), barcode: randomUUID(), size: 'XL', mrp: price, sellingPrice: price, costPrice: 300, stock } });
    if (tracked) await database.$executeRawUnsafe('INSERT INTO "StockVariantTracking" (variantId,activatedAt) VALUES (?,?)', row.id, '2026-10-14T09:00:00.000Z');
    if (prepared) await database.$executeRawUnsafe('UPDATE "ProductVariant" SET isPrepared = 1 WHERE id = ?', row.id);
    return row;
}
function payload(items) {
    const subtotal = items.reduce((sum, item) => sum + item.variant.sellingPrice * item.quantity, 0);
    return { userId: actor.id, subtotal, discount: 0, discountPercent: 0, taxAmount: 0, cgst: 0, sgst: 0,
        grandTotal: subtotal, paidAmount: subtotal, changeAmount: 0, paymentMethod: 'CASH',
        items: items.map(({ variant: item, quantity }) => ({ variantId: item.id, productName: 'Test Shirt', variantInfo: 'XL', quantity, mrp: item.mrp,
            sellingPrice: item.sellingPrice, discount: 0, taxRate: 5, taxAmount: 0, total: item.sellingPrice * quantity })),
        payments: [{ paymentMode: 'CASH', amount: subtotal }],
    };
}
async function seedSale(item, quantity = 1) {
    const data = payload([{ variant: item, quantity }]);
    return database.sale.create({ data: { ...data, billNo: randomUUID(), items: { create: data.items }, payments: { create: data.payments } }, include: { items: true, payments: true } });
}
const stock = async id => (await database.productVariant.findUnique({ where: { id } })).stock;
const counts = async () => Promise.all([database.sale.count(), database.saleItem.count(), database.invoicePayment.count(), database.inventoryMovement.count(), database.exchange.count(), database.auditLog.count()]);

test('checkout aggregates duplicate tracked lines and rejects the sale before financial or stock changes', async () => {
    const item = await variant({ stock: 3 });
    const before = await counts(), bills = billNumberRequests;
    const result = await checkout(null, payload([{ variant: item, quantity: 2 }, { variant: item, quantity: 2 }]));
    assert.equal(result.success, false);
    assert.match(result.error, /Not enough tracked stock.*Available: 3; required: 4/);
    assert.deepEqual(await counts(), before);
    assert.equal(await stock(item.id), 3);
    assert.equal(billNumberRequests, bills);
});

test('checkout sells the exact tracked balance but permits negative legacy balances', async () => {
    const tracked = await variant({ stock: 2 });
    const accepted = await checkout(null, payload([{ variant: tracked, quantity: 2 }]));
    assert.equal(accepted.success, true, accepted.error);
    assert.equal(await stock(tracked.id), 0);
    const legacy = await variant({ stock: 0, tracked: false });
    const old = await checkout(null, payload([{ variant: legacy, quantity: 3 }]));
    assert.equal(old.success, true, old.error);
    assert.equal(await stock(legacy.id), -3);
});

test('prepared-state rejection remains in effect even when a tracking row exists', async () => {
    const item = await variant({ stock: 10, prepared: true });
    const before = await counts();
    const result = await checkout(null, payload([{ variant: item, quantity: 1 }]));
    assert.equal(result.success, false);
    assert.match(result.error, /Stock conversion pending/);
    assert.deepEqual(await counts(), before);
});

test('sale update checks only the aggregated extra quantity and preserves saved-sale edit behavior', async () => {
    const item = await variant({ stock: 1 });
    const sale = await seedSale(item);
    const before = await counts(), originalItems = sale.items.map(row => row.id);
    const rejected = await update(null, { saleId: sale.id, userId: actor.id,
        saleData: payload([{ variant: item, quantity: 1 }, { variant: item, quantity: 2 }]) });
    assert.equal(rejected.success, false);
    assert.match(rejected.error, /required: 2/);
    assert.equal(await stock(item.id), 1);
    assert.deepEqual(await counts(), before);
    assert.deepEqual((await database.saleItem.findMany({ where: { saleId: sale.id } })).map(row => row.id), originalItems);
    const accepted = await update(null, { saleId: sale.id, userId: actor.id, saleData: payload([{ variant: item, quantity: 2 }]) });
    assert.equal(accepted.success, true, accepted.error);
    assert.equal(await stock(item.id), 0);
    const unchanged = await update(null, { saleId: sale.id, userId: actor.id, saleData: payload([{ variant: item, quantity: 2 }]) });
    assert.equal(unchanged.success, true, unchanged.error);
    const reduced = await update(null, { saleId: sale.id, userId: actor.id, saleData: payload([{ variant: item, quantity: 1 }]) });
    assert.equal(reduced.success, true, reduced.error);
    assert.equal(await stock(item.id), 1);
});

test('same-variant tracked exchange credits validated returned pieces toward net stock demand', async () => {
    const item = await variant({ stock: 0 });
    const sale = await seedSale(item);
    const result = await exchange(null, { originalInvoiceId: sale.id, userId: actor.id, discount: 0,
        items: [{ returnedId: item.id, returnedQty: 1, newId: item.id, newQty: 1, priceDiff: 0 }], payments: [], replacementPaymentMethod: 'CASH' }, actor);
    assert.equal(result.success, true, result.error);
    assert.equal(await stock(item.id), 0);
    assert.equal((await database.sale.findUnique({ where: { id: sale.id } })).grandTotal, 700);
    assert.equal(result.data.replacementSale.paidAmount, 0);
});

test('exchange rejects duplicate replacement demand atomically and preserves legacy replacement behavior', async () => {
    const original = await variant({ stock: 0, tracked: false });
    const replacement = await variant({ stock: 1 });
    const sale = await seedSale(original);
    const before = await counts();
    const rejected = await exchange(null, { originalInvoiceId: sale.id, userId: actor.id, discount: 0,
        items: [{ returnedId: original.id, returnedQty: 1, newId: replacement.id, newQty: 1, priceDiff: 0, stockChoice: { disposition: 'ORIGINAL', confirmed: true } }, { newId: replacement.id, newQty: 1, priceDiff: 0 }],
        payments: [{ paymentMode: 'CASH', amount: 700 }], replacementPaymentMethod: 'CASH' }, actor);
    assert.equal(rejected.success, false);
    assert.match(rejected.error, /required: 2/);
    assert.deepEqual(await counts(), before);
    assert.equal(await stock(original.id), 0);
    assert.equal(await stock(replacement.id), 1);
    const legacy = await variant({ stock: 0, tracked: false });
    const accepted = await exchange(null, { originalInvoiceId: sale.id, userId: actor.id, discount: 0,
        items: [{ returnedId: original.id, returnedQty: 1, newId: legacy.id, newQty: 1, priceDiff: 0, stockChoice: { disposition: 'ORIGINAL', confirmed: true } }], payments: [], replacementPaymentMethod: 'CASH' }, actor);
    assert.equal(accepted.success, true, accepted.error);
    assert.equal(await stock(legacy.id), -1);
});

test('mapped legacy returns contribute to tracked replacement availability without changing the financial source', async () => {
    const original = await variant({ stock: 10, tracked: false });
    const categoryId = (await database.product.findUnique({ where: { id: original.productId } })).categoryId;
    const replacement = await variant({ stock: 0, categoryId });
    const sale = await seedSale(original);
    const result = await exchange(null, { originalInvoiceId: sale.id, userId: actor.id, discount: 0,
        items: [{ returnedId: original.id, returnedQty: 1, newId: replacement.id, newQty: 1, priceDiff: 0,
            stockChoice: { disposition: 'TRACKED', targetVariantId: replacement.id, confirmed: true } }],
        payments: [], replacementPaymentMethod: 'CASH' }, actor);
    assert.equal(result.success, true, result.error);
    assert.equal(await stock(original.id), 10);
    assert.equal(await stock(replacement.id), 0);
    const returned = await database.inventoryMovement.findFirst({ where: { reference: result.data.exchange.id, type: 'EXCHANGE_RETURN' } });
    assert.equal(returned.variantId, replacement.id);
    const exchangeItem = await database.exchangeItem.findFirst({ where: { exchangeId: result.data.exchange.id } });
    assert.equal(exchangeItem.returnedItemId, original.id);
    assert.equal(result.data.replacementSale.payments.find(payment => payment.paymentMode === 'EXCHANGE_CREDIT').amount, 700);
});

test('held returns do not provide stock credit when checking tracked replacement availability', async () => {
    const item = await variant({ stock: 0 });
    const sale = await seedSale(item);
    const before = await counts();
    const result = await exchange(null, { originalInvoiceId: sale.id, userId: actor.id, discount: 0,
        items: [{ returnedId: item.id, returnedQty: 1, newId: item.id, newQty: 1, priceDiff: 0,
            stockChoice: { disposition: 'HOLD', confirmed: true, reason: 'Damaged garment' } }],
        payments: [], replacementPaymentMethod: 'CASH' }, actor);
    assert.equal(result.success, false);
    assert.match(result.error, /required: 1/);
    assert.equal(await stock(item.id), 0);
    assert.deepEqual(await counts(), before);
});

test('a later sale failure rolls back already decremented tracked stock and its movement', async () => {
    const item = await variant({ stock: 2 });
    const missing = { ...item, id: 'missing-variant' };
    const before = await counts();
    const result = await checkout(null, payload([{ variant: item, quantity: 1 }, { variant: missing, quantity: 1 }]));
    assert.equal(result.success, false);
    assert.deepEqual(await counts(), before);
    assert.equal(await stock(item.id), 2);
});

test('fresh balances are checked after an intervening committed sale, not a caller snapshot', async () => {
    const item = await variant({ stock: 2 });
    await database.productVariant.update({ where: { id: item.id }, data: { stock: 0 } });
    await assert.rejects(() => database.$transaction(tx => guard.assertTrackedStockAvailable(tx, [{ variantId: item.id, quantity: 1 }])), error => error.code === 'INSUFFICIENT_STOCK');
    assert.equal(await stock(item.id), 0);
});

test('two independent SQLite connections cannot both consume the last tracked piece', async () => {
    const item = await variant({ stock: 1 });
    const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
        const consume = client => client.$transaction(async tx => {
            await guard.assertTrackedStockAvailable(tx, [{ variantId: item.id, quantity: 1 }]);
            await tx.productVariant.update({ where: { id: item.id }, data: { stock: { decrement: 1 } } });
        }, { timeout: 10_000 });
        const results = await Promise.allSettled([consume(database), consume(second)]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(await stock(item.id), 0);
    } finally { await second.$disconnect(); }
});

test('old databases without tracking stay legacy and malformed tracking state fails closed without DDL', async () => {
    const legacy = await variant({ stock: 0, tracked: false });
    const calls = [];
    await guard.assertTrackedStockAvailable({ $queryRawUnsafe: async (...args) => { calls.push(args); return []; },
        $executeRawUnsafe: async () => { throw new Error('No writes on old schemas'); } }, [{ variantId: legacy.id, quantity: 9 }]);
    assert.equal(calls.length, 1);
    const tracked = await variant({ stock: 4 });
    await database.$executeRawUnsafe('UPDATE "StockVariantTracking" SET activatedAt = ? WHERE variantId = ?', 'invalid date', tracked.id);
    await assert.rejects(() => database.$transaction(tx => guard.assertTrackedStockAvailable(tx, [{ variantId: tracked.id, quantity: 1 }])), error => error.code === 'STOCK_UNAVAILABLE');
    assert.equal(await stock(tracked.id), 4);
    await assert.rejects(() => guard.assertTrackedStockAvailable({ $queryRawUnsafe: async () => { throw new Error('password=secret'); } }, [{ variantId: tracked.id, quantity: 1 }]), error => error.code === 'STOCK_UNAVAILABLE' && !error.message.includes('secret'));
});
