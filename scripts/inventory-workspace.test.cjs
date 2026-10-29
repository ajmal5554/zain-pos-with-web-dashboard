const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const modules = new Map();
function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const module = { exports: {} };
    modules.set(relative, module.exports);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, relative + '.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const localRequire = name => name.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), name))) : require(name);
    new Function('require', 'exports', 'module', code)(localRequire, module.exports, module);
    return module.exports;
}
const { getInventoryWorkspace } = load('electron/inventory-workspace.service');
const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
const attributes = ['brand', 'fabric', 'quality', 'pattern', 'sleeve', 'fit', 'collar', 'pocket', 'styleRef'];

async function fixture(t, { legacy = false, tracking = true } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-inventory-workspace-'));
    const database = new PrismaClient({ datasources: { db: { url: `file:${path.join(directory, 'inventory.db').replaceAll('\\', '/')}` } } });
    t.after(async () => {
        await database.$disconnect();
        const resolved = path.resolve(directory);
        if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('zain-inventory-workspace-')) {
            fs.rmSync(resolved, { recursive: true, force: true });
        }
    });
    await database.$executeRawUnsafe('CREATE TABLE "Category" (id TEXT PRIMARY KEY, name TEXT)');
    await database.$executeRawUnsafe('CREATE TABLE "Product" (id TEXT PRIMARY KEY, name TEXT, categoryId TEXT, isActive INTEGER DEFAULT 1)');
    await database.$executeRawUnsafe('CREATE TABLE "ProductVariant" (id TEXT PRIMARY KEY, productId TEXT, sku TEXT UNIQUE, barcode TEXT UNIQUE, size TEXT, color TEXT, mrp REAL, sellingPrice REAL, costPrice REAL, stock INTEGER, minStock INTEGER, isActive INTEGER DEFAULT 1, updatedAt TEXT'
        + (legacy ? '' : ', isPrepared INTEGER DEFAULT 0') + ')');
    if (!legacy) await database.$executeRawUnsafe('CREATE TABLE "ProductVariantGarmentDetail" (variantId TEXT PRIMARY KEY, isPrepared INTEGER DEFAULT 0, '
        + attributes.map(name => `"${name}" TEXT`).join(', ') + ', formattedDescription TEXT, metadata TEXT, createdAt TEXT, updatedAt TEXT)');
    if (tracking) await database.$executeRawUnsafe('CREATE TABLE "StockVariantTracking" (variantId TEXT PRIMARY KEY, activatedAt TEXT)');
    await database.$executeRawUnsafe('INSERT INTO "Category" (id,name) VALUES (?,?),(?,?)', 'shirts', 'Shirts', 'pants', 'Pants');
    for (const [id, name, categoryId, active] of [
        ['style-a', 'Shirt 700', 'shirts', 1], ['style-b', 'Shirt 700', 'shirts', 1],
        ['style-prepared', 'Shirt 700', 'shirts', 1], ['style-legacy', 'Shirt 700', 'shirts', 1],
        ['style-pants', 'Pant 1000', 'pants', 1], ['style-inactive', 'Shirt 700', 'shirts', 0],
    ]) await database.$executeRawUnsafe('INSERT INTO "Product" (id,name,categoryId,isActive) VALUES (?,?,?,?)', id, name, categoryId, active);
    for (const [id, productId, size, stock, price, prepared, active] of [
        ['a-small', 'style-a', 'S', 2, 700, 0, 1], ['a-medium', 'style-a', 'M', 3, 700, 0, 1],
        ['b-xl', 'style-b', 'XL', 4, 700, 0, 1], ['prep-column', 'style-prepared', 'XL', 0, 700, 1, 1],
        ['prep-sidecar', 'style-prepared', 'L', 7, 700, 0, 1], ['legacy-positive', 'style-legacy', 'Standard', 50, 700, 0, 1],
        ['legacy-negative', 'style-legacy', 'L', -2, 700, 0, 1], ['pants-32', 'style-pants', '32', 1, 1000, 0, 1],
        ['inactive-variant', 'style-a', 'XXL', 20, 700, 0, 0], ['inactive-product', 'style-inactive', 'XL', 30, 700, 0, 1],
    ]) {
        await database.$executeRawUnsafe('INSERT INTO "ProductVariant" (id,productId,sku,barcode,size,color,mrp,sellingPrice,costPrice,stock,minStock,isActive,updatedAt'
            + (legacy ? '' : ',isPrepared') + ') VALUES (' + Array(legacy ? 13 : 14).fill('?').join(',') + ')',
        id, productId, `SKU-${id}`, `00-${id}`, size, null, price, price - 50, 333.33, stock, 5, active, '2026-10-14T10:00:00.000Z', ...legacy ? [] : [prepared]);
        if (!legacy) {
            const fabric = id.startsWith('b-') ? 'Linen' : productId === 'style-pants' ? 'Denim' : 'Cotton';
            const quality = id.startsWith('b-') ? 'Standard' : 'Premium';
            await database.$executeRawUnsafe('INSERT INTO "ProductVariantGarmentDetail" (variantId,isPrepared,brand,fabric,quality,pattern,sleeve,fit,styleRef,metadata) VALUES (?,?,?,?,?,?,?,?,?,?)',
                id, id === 'prep-sidecar' ? 1 : 0, productId === 'style-pants' ? 'Other Brand' : 'Crazy Heart', fabric, quality,
                id.startsWith('b-') || productId === 'style-pants' ? 'Plain' : 'Checks', 'Full Sleeve', 'Regular', productId,
                JSON.stringify({ subtype: 'Formal', design: 'Micro checks', border: 'Narrow', costPrice: 888.88, password: 'secret-metadata', supplier: 'private-supplier', arbitrary: { secret: 'nested-secret' } }));
        }
    }
    if (tracking) for (const id of ['a-small', 'a-medium', 'b-xl', 'pants-32', 'prep-column']) {
        await database.$executeRawUnsafe('INSERT INTO "StockVariantTracking" (variantId,activatedAt) VALUES (?,?)', id, '2026-10-14T09:00:00.000Z');
    }
    return database;
}

test('style pages preserve same-name same-price product IDs and include every matching child variant', async t => {
    const database = await fixture(t);
    const result = await getInventoryWorkspace(database, { scope: 'TRACKED', groupBy: 'STYLE', pageSize: 1, page: 2 });
    assert.equal(result.success, true);
    assert.equal(result.data.totalMatching, 3);
    assert.equal(result.data.totalPages, 3);
    assert.equal(result.data.items[0].id, 'style-a');
    assert.deepEqual(result.data.items[0].variants.map(row => row.id), ['a-medium', 'a-small']);
    assert.equal(result.data.items[0].quantity, 5);
    assert.equal(result.data.items[0].mrpValue, 3500);
    const next = await getInventoryWorkspace(database, { scope: 'TRACKED', groupBy: 'STYLE', pageSize: 1, page: 3 });
    assert.equal(next.data.items[0].id, 'style-b');
    assert.equal(next.data.items[0].name, result.data.items[0].name);
    assert.equal(next.data.items[0].variants[0].mrp, result.data.items[0].variants[0].mrp);
});

test('size rows use variant IDs and pagination clamps without changing full-filter totals', async t => {
    const database = await fixture(t);
    const result = await getInventoryWorkspace(database, { groupBy: 'SIZE', pageSize: 2, page: 999 });
    assert.equal(result.success, true);
    assert.equal(result.data.page, 2);
    assert.equal(result.data.totalMatching, 4);
    assert.equal(result.data.items.length, 2);
    assert.ok(result.data.items.every(group => group.variants.length === 1 && group.id === group.variants[0].id));
    assert.deepEqual(result.data.stats, { styleCount: 3, variantCount: 4, quantity: 10, mrpValue: 7300, categoryCount: 2 });
});

test('only explicit tracking records activate scope and either preparation flag takes precedence', async t => {
    const database = await fixture(t);
    const prepared = await getInventoryWorkspace(database, { scope: 'PREPARED', groupBy: 'SIZE' });
    assert.equal(prepared.success, true);
    assert.deepEqual(prepared.data.items.flatMap(group => group.variants.map(row => row.id)).sort(), ['prep-column', 'prep-sidecar']);
    assert.equal(prepared.data.stats.quantity, 7);
    assert.equal(prepared.data.stats.mrpValue, null);
    const legacy = await getInventoryWorkspace(database, { scope: 'LEGACY', groupBy: 'SIZE' });
    assert.equal(legacy.success, true);
    assert.deepEqual(legacy.data.items.flatMap(group => group.variants.map(row => row.id)).sort(), ['legacy-negative', 'legacy-positive']);
    assert.equal(legacy.data.stats.quantity, 48);
    assert.equal(legacy.data.stats.mrpValue, null);
    assert.ok(legacy.data.items.every(group => group.mrpValue === null));
});

test('safe garment and category details are retained without prices/costs or arbitrary metadata leaking', async t => {
    const database = await fixture(t);
    const result = await getInventoryWorkspace(database, { search: 'a-small', groupBy: 'SIZE' });
    assert.equal(result.success, true);
    const row = result.data.items[0].variants[0];
    assert.equal(row.barcode, '00-a-small');
    assert.equal(row.category, 'Shirts');
    assert.equal(row.attributes.brand, 'Crazy Heart');
    assert.equal(row.attributes.fabric, 'Cotton');
    assert.equal(row.attributes.quality, 'Premium');
    assert.equal(row.attributes.subtype, 'Formal');
    assert.equal(row.attributes.design, 'Micro checks');
    assert.equal(row.attributes.border, 'Narrow');
    assert.equal(row.mrp, 700);
    assert.equal(row.sellingPrice, 650);
    assert.ok(!/costPrice|metadataRaw|formattedDescription|secret-metadata|private-supplier|nested-secret|888\.88|333\.33/.test(JSON.stringify(result)));
});

test('category and structured attribute filters combine, normalize whitespace/case, and total all matching variants', async t => {
    const database = await fixture(t);
    const result = await getInventoryWorkspace(database, {
        scope: 'TRACKED', groupBy: 'STYLE', categoryId: 'shirts', brand: ' crazy   HEART ',
        fabric: 'cotton', pattern: 'CHECKS', quality: 'premium', size: 'm', pageSize: 1,
    });
    assert.equal(result.success, true);
    assert.equal(result.data.totalMatching, 1);
    assert.equal(result.data.items[0].variants.length, 1);
    assert.equal(result.data.items[0].variants[0].id, 'a-medium');
    assert.deepEqual(result.data.stats, { styleCount: 1, variantCount: 1, quantity: 3, mrpValue: 2100, categoryCount: 1 });
    assert.deepEqual(result.data.facets.fabrics, ['Cotton', 'Denim', 'Linen']);
    assert.equal(result.data.facets.categories.length, 2);
});

test('tokenized search matches independent safe attributes and never searches private metadata', async t => {
    const database = await fixture(t);
    const result = await getInventoryWorkspace(database, { search: 'cotton formal sleeve 700' });
    assert.equal(result.success, true);
    assert.equal(result.data.items.length, 1);
    assert.equal(result.data.items[0].variants.length, 2);
    assert.equal(result.data.stats.quantity, 5);
    const hidden = await getInventoryWorkspace(database, { search: 'secret-metadata' });
    assert.equal(hidden.success, true);
    assert.equal(hidden.data.stats.variantCount, 0);
    assert.equal(hidden.data.page, 1);
    assert.equal(hidden.data.totalPages, 1);
});

test('facets stay bounded without truncating matching rows or aggregate totals', async t => {
    const database = await fixture(t);
    await database.$transaction(async tx => {
        for (let index = 0; index < 205; index++) {
            const id = `facet-${String(index).padStart(3, '0')}`;
            await tx.$executeRawUnsafe('INSERT INTO "ProductVariant" (id,productId,sku,barcode,size,color,mrp,sellingPrice,costPrice,stock,minStock,isActive,updatedAt,isPrepared) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                id, 'style-a', `SKU-${id}`, `00-${id}`, 'XL', null, 700, 650, 333.33, 1, 5, 1, '2026-10-14T10:00:00.000Z', 0);
            await tx.$executeRawUnsafe('INSERT INTO "ProductVariantGarmentDetail" (variantId,isPrepared,brand) VALUES (?,?,?)', id, 0, `Brand ${index}`);
            await tx.$executeRawUnsafe('INSERT INTO "StockVariantTracking" (variantId,activatedAt) VALUES (?,?)', id, '2026-10-14T09:00:00.000Z');
        }
    });
    const result = await getInventoryWorkspace(database, { groupBy: 'STYLE', pageSize: 1, search: 'Shirt' });
    assert.equal(result.success, true);
    assert.equal(result.data.facets.brands.length, 200);
    assert.equal(result.data.stats.variantCount, 208);
    assert.equal(result.data.stats.quantity, 214);
    assert.equal(result.data.stats.mrpValue, 149800);
    assert.equal(result.data.totalMatching, 2);
    assert.equal(result.data.items[0].variants.length, 207);
});

test('balance filters retain unverified legacy semantics and exclude inactive variants/products', async t => {
    const database = await fixture(t);
    const result = await getInventoryWorkspace(database, { scope: 'LEGACY', balanceFilter: 'NEGATIVE' });
    assert.equal(result.success, true);
    assert.equal(result.data.stats.quantity, -2);
    assert.equal(result.data.stats.mrpValue, null);
    assert.equal(result.data.stats.variantCount, 1);
    const preparedZero = await getInventoryWorkspace(database, { scope: 'PREPARED', balanceFilter: 'ZERO' });
    assert.equal(preparedZero.data.stats.variantCount, 1);
    const tracked = await getInventoryWorkspace(database);
    assert.equal(tracked.data.stats.variantCount, 4);
    assert.ok(!JSON.stringify(tracked).includes('inactive-'));
});

test('missing tracking table never infers tracked status from positive quantities or preparation false', async t => {
    const database = await fixture(t, { tracking: false });
    const tracked = await getInventoryWorkspace(database);
    assert.equal(tracked.success, true);
    assert.equal(tracked.data.stats.variantCount, 0);
    assert.equal(tracked.data.stats.mrpValue, 0);
    const legacy = await getInventoryWorkspace(database, { scope: 'LEGACY' });
    assert.equal(legacy.data.stats.variantCount, 6);
    assert.equal(legacy.data.stats.quantity, 58);
    const prepared = await getInventoryWorkspace(database, { scope: 'PREPARED' });
    assert.equal(prepared.data.stats.variantCount, 2);
});

test('untouched old schemas are read without creating columns/tables or modifying any stock', async t => {
    const database = await fixture(t, { legacy: true, tracking: false });
    const before = await database.$queryRawUnsafe('SELECT name, sql FROM sqlite_master WHERE type = ? ORDER BY name', 'table');
    const stocks = await database.$queryRawUnsafe('SELECT id,stock FROM "ProductVariant" ORDER BY id');
    const result = await getInventoryWorkspace(database, { scope: 'LEGACY' });
    assert.equal(result.success, true);
    assert.equal(result.data.stats.variantCount, 8);
    assert.equal(result.data.stats.quantity, 65);
    assert.equal(result.data.stats.mrpValue, null);
    assert.deepEqual(await database.$queryRawUnsafe('SELECT name, sql FROM sqlite_master WHERE type = ? ORDER BY name', 'table'), before);
    assert.deepEqual(await database.$queryRawUnsafe('SELECT id,stock FROM "ProductVariant" ORDER BY id'), stocks);
});

test('partial preparation or tracking schemas fail closed and do not repair themselves on read', async t => {
    const database = await fixture(t);
    await database.$executeRawUnsafe('DROP TABLE "ProductVariantGarmentDetail"');
    assert.equal((await getInventoryWorkspace(database, { scope: 'LEGACY' })).success, false);
    assert.deepEqual(await database.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE name = 'ProductVariantGarmentDetail'"), []);
    const second = await fixture(t);
    await second.$executeRawUnsafe('DROP TABLE "StockVariantTracking"');
    await second.$executeRawUnsafe('CREATE TABLE "StockVariantTracking" (variantId TEXT)');
    assert.equal((await getInventoryWorkspace(second)).success, false);
    const columns = await second.$queryRawUnsafe('PRAGMA table_info("StockVariantTracking")');
    assert.equal(columns.length, 1);
});

test('invalid activation timestamps and read failures cannot downgrade tracked records or leak internal error details', async t => {
    const database = await fixture(t);
    await database.$executeRawUnsafe('UPDATE "StockVariantTracking" SET activatedAt = ? WHERE variantId = ?', 'not-a-date', 'a-small');
    const invalid = await getInventoryWorkspace(database, { scope: 'LEGACY' });
    assert.equal(invalid.success, false);
    const failed = await getInventoryWorkspace({ $transaction: async () => { throw new Error('private costPrice=375; password=secret'); } });
    assert.equal(failed.success, false);
    assert.ok(!/private|costPrice|password|secret/.test(failed.error));
});

test('invalid query states and oversized catalogues fail explicitly rather than returning misleading partial totals', async t => {
    const database = await fixture(t);
    for (const args of [{ scope: 'ALL' }, { groupBy: 'PRICE' }, { balanceFilter: 'LOW' }]) {
        assert.equal((await getInventoryWorkspace(database, args)).success, false);
    }
    const oversized = { $transaction: callback => callback({ productVariant: { findMany: async () => Array(20001).fill({}) } }) };
    assert.equal((await getInventoryWorkspace(oversized)).success, false);
});
