const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const originalRevision = '2026-10-09T09:00:00.000Z';
const newerRevision = '2026-10-09T09:01:00.000Z';
const copy = value => JSON.parse(JSON.stringify(value));

function loadModules(axios) {
    const cache = new Map();
    function load(sourcePath) {
        if (cache.has(sourcePath)) return cache.get(sourcePath).exports;
        const module = { exports: {} };
        cache.set(sourcePath, module);
        const source = fs.readFileSync(sourcePath, 'utf8');
        const compiled = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
        }).outputText;
        const localRequire = name => {
            if (name === 'axios') return axios;
            if (name === '@prisma/client') return { PrismaClient: class { constructor() { throw new Error('Live Prisma clients are forbidden in sync fixtures'); } } };
            if (name.startsWith('.')) return load(path.resolve(path.dirname(sourcePath), name + '.ts'));
            if (name === 'crypto' || name === 'node:crypto') return require('node:crypto');
            throw new Error(`Unexpected dependency: ${name}`);
        };
        vm.runInNewContext(compiled, {
            exports: module.exports, module, require: localRequire,
            process: { env: { CLOUD_SYNC_SECRET: 'fixture-secret' } }, Date,
            console: { log() {}, warn() {}, error() {}, info() {} },
        }, { filename: sourcePath });
        return module.exports;
    }
    return {
        catalogueSync: load(path.join(root, 'electron/catalogue-sync.service.ts')),
        sync: load(path.join(root, 'electron/sync.service.ts')),
    };
}

function fixture(options = {}) {
    // This fixture stores rows in memory. No Prisma client, SQLite file, or HTTP connection is created.
    const products = new Map();
    const variants = new Map();
    const details = new Map();
    const flags = new Map();
    const sales = new Map();
    const requests = [];
    const acknowledgements = [];
    const productQueries = [];
    let onInventoryPost = options.onInventoryPost;
    const cloudStatus = options.cloudStatus ?? {};
    const cloudReply = options.cloudReply ?? { success: true };

    function addProduct(id, garment = null, variantFields = {}) {
        products.set(id, {
            id, name: 'Formal Shirt', categoryId: 'category-1', isActive: true,
            updatedAt: originalRevision, isSynced: false,
        });
        const variant = {
            id: id + '-variant', productId: id, sku: id + '-sku', barcode: id + '-barcode',
            size: 'XL', color: 'Blue', mrp: 700, sellingPrice: 650, costPrice: 325,
            stock: 12, minStock: 5, isActive: true, isSynced: false, updatedAt: originalRevision,
            ...variantFields,
        };
        variants.set(variant.id, variant);
        flags.set(variant.id, garment?.isPrepared ? 1 : 0);
        if (garment) details.set(variant.id, { variantId: variant.id, isPrepared: 0, ...garment });
        return { product: products.get(id), variant };
    }
    function matches(row, where = {}) {
        if (where.isSynced !== undefined && row.isSynced !== where.isSynced) return false;
        if (typeof where.id === 'string' && row.id !== where.id) return false;
        if (where.id?.gt && !(row.id > where.id.gt)) return false;
        if (where.id?.in && !where.id.in.includes(row.id)) return false;
        if (where.updatedAt && new Date(row.updatedAt).getTime() !== new Date(where.updatedAt).getTime()) return false;
        return true;
    }
    function rowsFor(model) {
        return model === 'product' ? products : model === 'productVariant' ? variants : model === 'sale' ? sales : new Map();
    }
    function basicModel(model) {
        return {
            count: async ({ where = {} } = {}) => [...rowsFor(model).values()].filter(row => matches(row, where)).length,
            findMany: async ({ where = {}, take } = {}) => {
                const rows = [...rowsFor(model).values()].filter(row => matches(row, where));
                return copy(take ? rows.slice(0, take) : rows);
            },
            updateMany: async ({ where, data }) => {
                acknowledgements.push({ model, where: copy(where), data: copy(data) });
                let count = 0;
                for (const row of rowsFor(model).values()) {
                    if (!matches(row, where)) continue;
                    Object.assign(row, data);
                    // Mimic Prisma @updatedAt: acknowledgement must explicitly retain the revision.
                    if (data.updatedAt === undefined) row.updatedAt = '2026-10-09T10:00:00.000Z';
                    count++;
                }
                return { count };
            },
        };
    }
    const prisma = {
        product: basicModel('product'), productVariant: basicModel('productVariant'), sale: basicModel('sale'),
        exchange: basicModel('exchange'), refund: basicModel('refund'), customer: basicModel('customer'),
        inventoryMovement: basicModel('inventoryMovement'),
        syncQueue: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
        $transaction: async callback => callback(prisma),
        $queryRawUnsafe: async (sql, ...ids) => {
            if (options.queryError) throw new Error(options.queryError);
            if (sql.includes('sqlite_master')) return options.legacySchema
                ? [{ name: 'ProductVariant' }] : [{ name: 'ProductVariant' }, { name: 'ProductVariantGarmentDetail' }];
            if (sql.startsWith('PRAGMA table_info("ProductVariant")')) return options.legacySchema
                ? [{ name: 'id' }] : [{ name: 'id' }, { name: 'isPrepared' }];
            if (sql.startsWith('SELECT * FROM "ProductVariantGarmentDetail"')) return copy([...details.values()].filter(row => ids.includes(row.variantId)));
            if (sql.startsWith('SELECT "id", "isPrepared" FROM "ProductVariant"')) return ids.filter(id => variants.has(id)).map(id => ({ id, isPrepared: flags.get(id) || 0 }));
            throw new Error('Unexpected fixture query: ' + sql);
        },
    };
    prisma.product.findMany = async (args = {}) => {
        productQueries.push(copy(args));
        if (productQueries.length > 20) throw new Error('Product sync cursor did not advance');
        let rows = [...products.values()].filter(row => {
            if (!matches(row, args.where)) return false;
            if (!args.where?.OR) return true;
            return !row.isSynced || [...variants.values()].some(v => v.productId === row.id && !v.isSynced);
        });
        if (args.orderBy?.id === 'asc') rows.sort((a, b) => a.id.localeCompare(b.id));
        if (args.take) rows = rows.slice(0, args.take);
        return copy(rows.map(row => ({
            ...row, category: { id: 'category-1', name: 'Shirts' },
            variants: [...variants.values()].filter(v => v.productId === row.id),
        })));
    };
    const axios = {
        get: async (url, requestOptions) => {
            requests.push({ method: 'GET', url, options: copy(requestOptions) });
            if (options.statusError) throw new Error(options.statusError);
            return { data: copy(cloudStatus) };
        },
        post: async (url, body, requestOptions) => {
            requests.push({ method: 'POST', url, body: copy(body), options: copy(requestOptions) });
            if (url.endsWith('/inventory')) {
                if (onInventoryPost) await onInventoryPost({ body, products, variants, details, flags });
                if (options.inventoryError) throw new Error(options.inventoryError);
                return { data: copy(cloudReply) };
            }
            if (url.endsWith('/verify-sales')) return { data: { success: true, missingIds: [], statusMismatchIds: [] } };
            return { data: { success: true } };
        },
    };
    const modules = loadModules(axios);
    modules.sync.setPrismaInstance(prisma);
    modules.sync.cloudSync.setApiUrl('https://isolated-fixture.invalid');
    modules.sync.cloudSync.setSyncSecret('fixture-secret');
    return {
        ...modules, prisma, products, variants, details, flags, sales, requests, acknowledgements, productQueries,
        addProduct, setOnInventoryPost: callback => { onInventoryPost = callback; },
        snapshot: () => prisma.product.findMany({ include: { variants: true } }),
        inventoryPosts: () => requests.filter(request => request.method === 'POST' && request.url.endsWith('/inventory')),
    };
}

const garment = {
    isPrepared: 1, brand: 'Crazy Heart', fabric: 'Cotton', quality: 'Premium', pattern: 'Checks',
    sleeve: 'Full Sleeve', fit: 'Slim', collar: 'Button Down', pocket: 'One', styleRef: 'CR-01',
    metadata: JSON.stringify({ identityNote: 'Reviewed model', nested: { source: 'owner' } }),
};
const metadataServer = { capabilities: { catalogueMetadataVersion: 1 } };

test('Actual catalogue serializer holds prepared/attribute records for a legacy server and leaves rows unchanged', async () => {
    const f = fixture();
    const prepared = f.addProduct('a-prepared', garment);
    f.addProduct('b-attributes', { isPrepared: 0, fabric: 'Denim' });
    const rawFlag = f.addProduct('c-raw-flag');
    f.flags.set(rawFlag.variant.id, 1);
    f.addProduct('z-legacy');
    const before = copy([...f.products.values(), ...f.variants.values(), ...f.details.values()]);
    const batch = await f.catalogueSync.prepareCatalogueSync(f.prisma, await f.snapshot(), {});
    assert.equal(batch.supportsMetadata, false);
    assert.deepEqual(Array.from(batch.ready, p => p.id), ['z-legacy']);
    assert.deepEqual(Array.from(batch.pending, p => p.id), ['a-prepared', 'b-attributes', 'c-raw-flag']);
    assert.equal(batch.pending[0].variants[0].barcode, prepared.variant.barcode);
    assert.equal(f.acknowledgements.length, 0);
    assert.deepEqual(copy([...f.products.values(), ...f.variants.values(), ...f.details.values()]), before);
});

test('Actual smart sync uploads legacy products and sales while metadata products remain unsynced', async () => {
    const f = fixture();
    const held = f.addProduct('a-held', garment, { stock: 0 });
    const legacy = f.addProduct('z-legacy');
    f.sales.set('sale-1', { id: 'sale-1', billNo: 'BILL-1', status: 'COMPLETED', updatedAt: originalRevision, isSynced: false, items: [], payments: [] });
    const result = await f.sync.cloudSync.verifyAndSync();
    assert.equal(result.success, true, result.error);
    assert.equal(result.cataloguePending, 1);
    assert.equal(result.productsSynced, 1);
    assert.equal(result.salesSynced, 1);
    assert.match(result.message, /pending a compatible cloud catalogue update/);
    assert.equal(held.product.isSynced, false);
    assert.equal(held.variant.isSynced, false);
    assert.equal(held.variant.stock, 0);
    assert.equal(legacy.product.isSynced, true);
    assert.equal(legacy.variant.isSynced, true);
    assert.equal(f.sales.get('sale-1').isSynced, true);
    assert.deepEqual(f.inventoryPosts().flatMap(post => post.body.products.map(p => p.id)), ['z-legacy']);
    assert.ok(!f.acknowledgements.some(ack => ack.where.id === held.product.id || ack.where.id === held.variant.id));
});

test('Untouched legacy schemas remain compatible without creating or requiring sidecars', async () => {
    const f = fixture({ legacySchema: true });
    const legacy = f.addProduct('legacy');
    const result = await f.sync.cloudSync.verifyAndSync();
    assert.equal(result.success, true, result.error);
    assert.equal(result.cataloguePending, 0);
    assert.equal(legacy.variant.isSynced, true);
    assert.equal(f.inventoryPosts()[0].body.products[0].variants[0].costPrice, 325);
});

test('Version 1 upload includes every garment attribute, metadata, leading-zero code and full parent description', async () => {
    const f = fixture({ cloudStatus: metadataServer, cloudReply: { success: true, catalogueMetadataVersion: 1 } });
    const row = f.addProduct('prepared', garment, { barcode: '0012345', stock: 0 });
    const result = await f.sync.cloudSync.verifyAndSync();
    assert.equal(result.success, true, result.error);
    assert.equal(result.cataloguePending, 0);
    const post = f.inventoryPosts()[0];
    assert.equal(post.body.catalogueMetadataVersion, 1);
    assert.equal(post.options.headers['x-sync-secret'], 'fixture-secret');
    const uploaded = post.body.products[0].variants[0];
    for (const field of ['brand', 'fabric', 'quality', 'pattern', 'sleeve', 'fit', 'collar', 'pocket', 'styleRef']) {
        assert.equal(uploaded[field], garment[field], field);
    }
    assert.deepEqual(uploaded.metadata, JSON.parse(garment.metadata));
    assert.equal(uploaded.metadataRaw, garment.metadata);
    assert.equal(uploaded.barcode, '0012345');
    assert.equal(uploaded.isPrepared, true);
    assert.equal(uploaded.costPrice, 325);
    assert.equal(uploaded.formattedDescription, 'Formal Shirt | Crazy Heart | XL | Full Sleeve | Checks | Cotton | Premium | Slim | Blue | Collar: Button Down | Pocket: One | Ref: CR-01');
    assert.equal(row.product.isSynced, true);
    assert.equal(row.variant.isSynced, true);
    assert.equal(row.product.updatedAt, originalRevision);
    assert.equal(row.variant.updatedAt, originalRevision);
    assert.equal(row.variant.stock, 0);
    assert.equal(f.flags.get(row.variant.id), 1);
});

test('Missing/old metadata ACK, rejected uploads and transport failures never acknowledge local catalogue revisions', async t => {
    for (const scenario of [
        { name: 'missing ACK', cloudReply: { success: true }, expected: /did not acknowledge catalogue metadata/ },
        { name: 'version zero ACK', cloudReply: { success: true, catalogueMetadataVersion: 0 }, expected: /did not acknowledge catalogue metadata/ },
        { name: 'server rejection', cloudReply: { success: false, error: 'Rejected fixture upload' }, expected: /Rejected fixture upload/ },
        { name: 'network failure', inventoryError: 'Fixture network unavailable', expected: /Fixture network unavailable/ },
    ]) {
        await t.test(scenario.name, async () => {
            const f = fixture({ cloudStatus: metadataServer, ...scenario });
            const row = f.addProduct('prepared', garment);
            const result = await f.sync.cloudSync.verifyAndSync();
            assert.equal(result.success, false);
            assert.match(result.error, scenario.expected);
            assert.equal(row.product.isSynced, false);
            assert.equal(row.variant.isSynced, false);
            assert.equal(f.acknowledgements.length, 0);
        });
    }
});

test('A concurrent variant revision is not acknowledged by an older upload and is sent on the next sync', async () => {
    const f = fixture({ cloudStatus: metadataServer, cloudReply: { success: true, catalogueMetadataVersion: 1 } });
    const row = f.addProduct('prepared', garment, { stock: 8 });
    f.setOnInventoryPost(() => {
        row.variant.stock = 7;
        row.variant.updatedAt = newerRevision;
        f.setOnInventoryPost(null);
    });
    const first = await f.sync.cloudSync.verifyAndSync();
    assert.equal(first.success, true, first.error);
    assert.equal(f.inventoryPosts()[0].body.products[0].variants[0].stock, 8);
    assert.equal(row.variant.stock, 7);
    assert.equal(row.variant.updatedAt, newerRevision);
    assert.equal(row.variant.isSynced, false);
    assert.equal(row.product.isSynced, true);
    const attemptedAck = f.acknowledgements.find(ack => ack.model === 'productVariant');
    assert.equal(attemptedAck.where.updatedAt, originalRevision);
    const second = await f.sync.cloudSync.verifyAndSync();
    assert.equal(second.success, true, second.error);
    assert.equal(f.inventoryPosts()[1].body.products[0].variants[0].stock, 7);
    assert.equal(row.variant.isSynced, true);
    assert.equal(row.variant.updatedAt, newerRevision);
});

test('Smart sync pages past more than 100 held metadata products to upload a later legacy product', async () => {
    const f = fixture();
    for (let i = 0; i < 125; i++) f.addProduct('a-' + String(i).padStart(3, '0'), garment);
    const legacy = f.addProduct('z-legacy');
    const result = await f.sync.cloudSync.verifyAndSync();
    assert.equal(result.success, true, result.error);
    assert.equal(result.cataloguePending, 125);
    assert.equal(result.productsSynced, 1);
    assert.equal(legacy.variant.isSynced, true);
    assert.ok([...f.products.values()].filter(p => p.id !== 'z-legacy').every(p => p.isSynced === false));
    assert.deepEqual(f.inventoryPosts().flatMap(post => post.body.products.map(p => p.id)), ['z-legacy']);
    assert.equal(f.productQueries[0].take, 100);
    assert.equal(f.productQueries[1].where.id.gt, 'a-099');
    assert.equal(f.productQueries[2].where.id.gt, 'z-legacy');
});

test('Actual bulk sync keeps held catalogue records pending while acknowledging eligible legacy records', async () => {
    const f = fixture();
    const held = f.addProduct('a-held', garment);
    const legacy = f.addProduct('z-legacy');
    const progress = [];
    const result = await f.sync.cloudSync.bulkSyncAll(update => progress.push(copy(update)));
    assert.equal(result.success, true, result.error);
    assert.equal(result.cataloguePending, 1);
    assert.match(result.message, /catalogue products remain on this PC/);
    assert.equal(held.product.isSynced, false);
    assert.equal(held.variant.isSynced, false);
    assert.equal(legacy.product.isSynced, true);
    assert.equal(legacy.variant.isSynced, true);
    assert.match(progress.at(-1).message, /catalogue update pending/);
    assert.ok(progress.at(-1).percentage < 100);
    assert.equal(f.sync.cloudSync.getBulkSyncProgress(), null);
});

test('Bulk sync also requires a metadata ACK before marking products synced', async () => {
    const f = fixture({ cloudStatus: metadataServer, cloudReply: { success: true } });
    const row = f.addProduct('prepared', garment);
    const result = await f.sync.cloudSync.bulkSyncAll();
    assert.equal(result.success, false);
    assert.match(result.error, /did not acknowledge catalogue metadata/);
    assert.equal(row.product.isSynced, false);
    assert.equal(row.variant.isSynced, false);
    assert.equal(f.acknowledgements.length, 0);
});

test('Metadata read failures cannot silently fall back to legacy uploads', async () => {
    const f = fixture({ queryError: 'Fixture metadata unavailable' });
    const row = f.addProduct('prepared', garment);
    const result = await f.sync.cloudSync.verifyAndSync();
    assert.equal(result.success, false);
    assert.match(result.error, /Fixture metadata unavailable/);
    assert.equal(row.variant.isSynced, false);
    assert.equal(f.inventoryPosts().length, 0);
    assert.equal(f.acknowledgements.length, 0);
});
