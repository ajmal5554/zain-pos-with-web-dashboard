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
const id = () => randomUUID();
const copy = value => JSON.parse(JSON.stringify(value));
let db, directory, description, catalogue, drafts, conversion, workspace, returns, shirts, pants, admin, cashier, disabled, legacy;

function load(file) {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, Buffer, console,
        require(name) {
            if (name.includes('catalogueDescription')) return description;
            if (name.includes('catalogue.service')) return catalogue;
            if (name.includes('stock-draft.service')) return drafts;
            if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(path.join(root, file)), name + '.ts')));
            if (name.includes('inventory-workspace.service')) return workspace;
            return require(name);
        },
    }, { filename: file });
    return module.exports;
}
before(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-return-stock-test-'));
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    db = new PrismaClient({ datasources: { db: { url: `file:${path.join(directory, 'returns.db').replaceAll('\\', '/')}` } } });
    const sql = execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'prisma/generated/client/schema.prisma'), '--script'], { encoding: 'utf8', cwd: root });
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
    description = load('src/lib/catalogueDescription.ts'); catalogue = load('electron/catalogue.service.ts');
    drafts = load('electron/stock-draft.service.ts'); conversion = load('electron/stock-conversion.service.ts');
    workspace = load('electron/inventory-workspace.service.ts'); returns = load('electron/return-stock.service.ts');
    await catalogue.ensureCatalogueSchema(db);
    shirts = await db.category.create({ data: { name: 'Return Shirts' } });
    pants = await db.category.create({ data: { name: 'Return Pants' } });
    admin = await db.user.create({ data: { username: 'return-admin', password: 'fixture', role: 'ADMIN', name: 'Return admin' } });
    cashier = await db.user.create({ data: { username: 'return-cashier', password: 'fixture', role: 'CASHIER', name: 'Cashier', permEditSales: false } });
    disabled = { ...admin, isActive: false };
    legacy = await variant('Legacy Shirt 700', shirts, { stock: -20 });
});
after(async () => {
    await db?.$disconnect();
    if (directory) {
        const absolute = path.resolve(directory);
        assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep));
        assert.ok(path.basename(absolute).startsWith('zain-return-stock-test-'));
        fs.rmSync(absolute, { recursive: true, force: true });
    }
});
async function variant(name, category = shirts, options = {}) {
    const product = await db.product.create({ data: { name, categoryId: category.id, isActive: options.productActive ?? true } });
    const saved = await db.productVariant.create({ data: { productId: product.id, sku: id(), barcode: id(), size: 'XL', mrp: 700, sellingPrice: 700, costPrice: 423, stock: options.stock ?? 5, isActive: options.active ?? true } });
    if (options.prepared || options.details) {
        await db.$executeRawUnsafe('UPDATE "ProductVariant" SET "isPrepared" = ? WHERE "id" = ?', options.prepared ? 1 : 0, saved.id);
        await db.$executeRawUnsafe('INSERT INTO "ProductVariantGarmentDetail" ("variantId", "isPrepared", "brand", "fabric", "quality", "metadata") VALUES (?, ?, ?, ?, ?, ?)', saved.id, options.prepared ? 1 : 0, 'Crazy Heart', 'Cotton', 'Standard', JSON.stringify({ supplierCost: 423, privateNote: 'PRIVATE SUPPLIER BALANCE', fabric: 'Cotton' }));
    }
    return { ...saved, product };
}
async function tracked(name = 'Tracked Shirt', category = shirts, options = {}) {
    await conversion.ensureStockConversionSchema(db);
    const saved = await variant(name, category, options);
    await db.$executeRawUnsafe('INSERT INTO "StockVariantTracking" ("variantId", "activatedAt") VALUES (?, ?)', saved.id, '2026-10-14T10:00:00.000Z');
    return saved;
}
const choice = (disposition, extra = {}) => ({ disposition, confirmed: true, ...extra });
const entry = (sourceVariantId, selected, quantity = 1) => ({ sourceVariantId, quantity, choice: selected });
async function resolve(entries, user = admin) { return db.$transaction(tx => returns.resolveReturnStockRoutes(tx, entries, user)); }
async function stock(variantId) { return (await db.productVariant.findUnique({ where: { id: variantId } })).stock; }

test('before the first activation original legacy return behavior remains unchanged without schema or stock writes', async () => {
    const options = await returns.getReturnStockOptions(db, { sourceVariantId: legacy.id }, admin);
    assert.deepEqual(copy(options), { sourceTracked: false, requiresChoice: false, items: [] });
    const routes = await resolve([entry(legacy.id)]);
    assert.deepEqual(copy(routes.get(legacy.id)), { sourceVariantId: legacy.id, targetVariantId: legacy.id, quantity: 1, disposition: 'ORIGINAL', reason: null });
    assert.equal(await stock(legacy.id), -20);
    const tables = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE name='StockVariantTracking'");
    assert.equal(tables.length, 0);
});

test('once tracking is activated legacy garments require an explicit confirmed destination', async () => {
    await tracked();
    await assert.rejects(resolve([entry(legacy.id)]), /Identify the returned garment/);
    for (const selected of [{ disposition: 'ORIGINAL' }, { disposition: 'UNKNOWN', confirmed: true }, { disposition: 'ORIGINAL', confirmed: false }]) {
        await assert.rejects(resolve([entry(legacy.id, selected)]), /Confirm the physical/);
    }
    const route = (await resolve([entry(legacy.id, choice('ORIGINAL'))])).get(legacy.id);
    assert.equal(route.targetVariantId, legacy.id);
    assert.equal(route.disposition, 'ORIGINAL');
    assert.equal(await stock(legacy.id), -20);
});

test('safe candidate lookup includes only active explicitly tracked variants in the original category and exposes no costs', async () => {
    const allowed = await tracked('Candidate cotton', shirts, { details: true });
    const wrongCategory = await tracked('Candidate pant', pants);
    const inactive = await tracked('Candidate inactive', shirts, { active: false });
    const inactiveProduct = await tracked('Candidate product inactive', shirts, { productActive: false });
    const prepared = await tracked('Candidate prepared', shirts, { prepared: true });
    const generic = await variant('Candidate untracked', shirts);
    const negative = await tracked('Candidate negative', shirts, { stock: -1 });
    const options = await returns.getReturnStockOptions(db, { sourceVariantId: legacy.id, search: 'Candidate' }, admin);
    assert.equal(options.requiresChoice, true);
    assert.deepEqual(copy(options.items.map(value => value.id)), [allowed.id]);
    assert.deepEqual(Object.keys(options.items[0]).sort(), ['barcode', 'description', 'id', 'name', 'stock']);
    assert.doesNotMatch(JSON.stringify(options), /cost|supplier|private|423/i);
    for (const target of [wrongCategory, inactive, inactiveProduct, prepared, generic]) await assert.rejects(resolve([entry(legacy.id, choice('TRACKED', { targetVariantId: target.id }))]), /active tracked item in the original/);
    await assert.rejects(resolve([entry(legacy.id, choice('TRACKED', { targetVariantId: negative.id }))]), /stock balance is invalid/);
    const routes = await resolve([entry(legacy.id, choice('TRACKED', { targetVariantId: allowed.id }), 2)]);
    assert.equal(routes.get(legacy.id).targetVariantId, allowed.id);
    assert.equal(routes.get(legacy.id).sourceVariantId, legacy.id);
});

test('a tracked return stays on its original variant or can be held; it cannot be remapped to another item', async () => {
    const original = await tracked(), other = await tracked();
    const options = await returns.getReturnStockOptions(db, { sourceVariantId: original.id }, admin);
    assert.deepEqual(copy(options), { sourceTracked: true, requiresChoice: false, items: [] });
    assert.equal((await resolve([entry(original.id)])).get(original.id).targetVariantId, original.id);
    assert.equal((await resolve([entry(original.id, choice('TRACKED', { targetVariantId: original.id }))])).get(original.id).targetVariantId, original.id);
    await assert.rejects(resolve([entry(original.id, choice('TRACKED', { targetVariantId: other.id }))]), /original stock variant/);
    const held = (await resolve([entry(original.id, choice('HOLD', { reason: 'Damaged' }))])).get(original.id);
    assert.equal(held.targetVariantId, null);
    assert.equal(held.reason, 'Damaged');
});

test('HOLD requires a reason and does not restock inactive, damaged or unidentified garments', async () => {
    const inactive = await variant('Inactive source', shirts, { active: false });
    await assert.rejects(resolve([entry(inactive.id, choice('ORIGINAL'))]), /inactive or prepared/);
    for (const reason of ['', ' '.repeat(3), 'x'.repeat(501), 'Invalid\u0000reason']) await assert.rejects(resolve([entry(inactive.id, choice('HOLD', { reason }))]), /Explain why/);
    const route = (await resolve([entry(inactive.id, choice('HOLD', { reason: '  Unidentified old label  ' }))])).get(inactive.id);
    assert.equal(route.targetVariantId, null);
    assert.equal(route.reason, 'Unidentified old label');
    assert.equal(await stock(inactive.id), 5);
});

test('invalid, duplicate and excessive quantities and invalid identities are rejected', async () => {
    for (const quantity of [0, -1, 0.5, NaN, Infinity, 1_000_000_001]) await assert.rejects(resolve([entry(legacy.id, choice('ORIGINAL'), quantity)]), /positive whole pieces/);
    await assert.rejects(resolve([entry(legacy.id, choice('ORIGINAL')), entry(legacy.id, choice('ORIGINAL'))]), /duplicate items/);
    await assert.rejects(resolve([]), /Select between/);
    await assert.rejects(resolve([entry('missing', choice('ORIGINAL'))]), /no longer exists/);
    await assert.rejects(resolve([entry('bad\u0000id', choice('ORIGINAL'))]), /valid returned item/);
    await assert.rejects(returns.getReturnStockOptions(db, { sourceVariantId: legacy.id, search: {} }, admin), /Invalid returned stock search/);
});

test('multiple legacy return lines mapped to the same tracked target share one validated balance capacity', async () => {
    const first = await variant('Old return one'), second = await variant('Old return two');
    const destination = await tracked('Near maximum', shirts, { stock: 999_999_999 });
    await assert.rejects(resolve([entry(first.id, choice('TRACKED', { targetVariantId: destination.id })), entry(second.id, choice('TRACKED', { targetVariantId: destination.id }))]), /supported limit/);
    assert.equal(await stock(destination.id), 999_999_999);
});

test('cost and edit permissions apply to all lookups, resolutions and audit writes', async () => {
    for (const user of [cashier, disabled, null]) {
        await assert.rejects(returns.getReturnStockOptions(db, { sourceVariantId: legacy.id }, user), /Permission denied/);
        await assert.rejects(resolve([entry(legacy.id, choice('ORIGINAL'))], user), /Permission denied/);
        await assert.rejects(returns.recordReturnStockRoutes(db, new Map(), id(), 'REFUND', user, new Date()), /Permission denied/);
    }
});

test('physical routing and audit remain atomic with refund financial records and exactly one restock destination', async () => {
    const source = await variant('Financial original', shirts, { stock: -10 }), destination = await tracked('Physical destination', shirts, { stock: 4 });
    const sale = await db.sale.create({ data: {
        billNo: id(), userId: admin.id, subtotal: 700, discount: 50, taxAmount: 30.95, cgst: 15.475, sgst: 15.475,
        grandTotal: 650, paidAmount: 650, changeAmount: 0, paymentMethod: 'CASH',
        items: { create: { variantId: source.id, productName: 'Financial original', quantity: 1, mrp: 700, sellingPrice: 700, taxRate: 5, taxAmount: 30.95, total: 700 } },
    } });
    async function refund(fail = false, disposition = 'TRACKED') {
        return db.$transaction(async tx => {
            const routes = await returns.resolveReturnStockRoutes(tx, [entry(source.id, choice(disposition, disposition === 'HOLD' ? { reason: 'Do not sell damaged item' } : { targetVariantId: destination.id }))], admin);
            const now = new Date();
            const result = await tx.refund.create({ data: { originalInvoiceId: sale.id, totalRefundAmount: 650, reason: 'Customer return', createdBy: admin.id,
                items: { create: { variantId: source.id, quantity: 1, amount: 650 } }, payments: { create: { paymentMode: 'CASH', amount: 650 } } }, include: { items: true, payments: true } });
            for (const route of routes.values()) if (route.targetVariantId) {
                await tx.productVariant.update({ where: { id: route.targetVariantId }, data: { stock: { increment: route.quantity } } });
                await tx.inventoryMovement.create({ data: { variantId: route.targetVariantId, type: 'REFUND', quantity: route.quantity, reference: result.id, createdBy: admin.id } });
            }
            await returns.recordReturnStockRoutes(tx, routes, result.id, 'REFUND', admin, now);
            if (fail) throw new Error('Synthetic financial commit failure');
            return result;
        });
    }
    const beforeAudit = await db.auditLog.count({ where: { action: 'RETURN_STOCK_ROUTE' } });
    await assert.rejects(refund(true), /Synthetic financial commit failure/);
    assert.equal(await stock(source.id), -10);
    assert.equal(await stock(destination.id), 4);
    assert.equal(await db.refund.count({ where: { originalInvoiceId: sale.id } }), 0);
    assert.equal(await db.auditLog.count({ where: { action: 'RETURN_STOCK_ROUTE' } }), beforeAudit);
    const completed = await refund();
    assert.equal(completed.items[0].variantId, source.id);
    assert.equal(completed.items[0].amount, 650);
    assert.equal(completed.totalRefundAmount, 650);
    assert.equal(completed.payments[0].amount, 650);
    assert.equal(await stock(source.id), -10);
    assert.equal(await stock(destination.id), 5);
    const movements = await db.inventoryMovement.findMany({ where: { reference: completed.id } });
    assert.equal(movements.length, 1);
    assert.equal(movements[0].variantId, destination.id);
    const audit = await db.auditLog.findFirst({ where: { action: 'RETURN_STOCK_ROUTE', details: { contains: completed.id } } });
    const details = JSON.parse(audit.details);
    assert.equal(details.sourceVariantId, source.id);
    assert.equal(details.targetVariantId, destination.id);
    assert.equal(details.reference, completed.id);
    const unchangedSale = await db.sale.findUnique({ where: { id: sale.id }, include: { items: true } });
    assert.equal(unchangedSale.grandTotal, 650);
    assert.equal(unchangedSale.items[0].variantId, source.id);
    const held = await refund(false, 'HOLD');
    assert.equal(await stock(destination.id), 5);
    assert.equal((await db.inventoryMovement.findMany({ where: { reference: held.id } })).length, 0);
    assert.equal(JSON.parse((await db.auditLog.findFirst({ where: { action: 'RETURN_STOCK_ROUTE', details: { contains: held.id } } })).details).targetVariantId, null);
});

test('corrupt tracked stock or activation dates block restocking while holding changes no stock', async () => {
    const source = await tracked('Corrupt tracked balance', shirts, { stock: -1 });
    await assert.rejects(resolve([entry(source.id)]), /stock balance is invalid/);
    const held = (await resolve([entry(source.id, choice('HOLD', { reason: 'Balance needs investigation' }))])).get(source.id);
    assert.equal(held.targetVariantId, null);
    await db.$executeRawUnsafe('UPDATE "StockVariantTracking" SET "activatedAt" = ? WHERE "variantId" = ?', '2026-02-30T10:00:00.000Z', source.id);
    try { await assert.rejects(resolve([entry(legacy.id, choice('ORIGINAL'))]), /tracking state needs repair/); }
    finally { await db.$executeRawUnsafe('UPDATE "StockVariantTracking" SET "activatedAt" = ? WHERE "variantId" = ?', '2026-10-14T10:00:00.000Z', source.id); }
});
