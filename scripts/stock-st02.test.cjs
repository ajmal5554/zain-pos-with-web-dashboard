const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const transpile = (source) =>
    ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;

let database, temporaryDirectory, databaseUrl;
let catalogueService, catalogueDescription;
let checkoutHandler, updateSaleHandler, exchangeHandler;
let adminUser, cashierUser;

before(async () => {
    // 1. Create isolated disposable temporary directory and SQLite database
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-stock-st02-'));
    const dbPath = path.join(temporaryDirectory, 'test-st02.db').replaceAll('\\', '/');

    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    databaseUrl = 'file:' + dbPath;
    database = new PrismaClient({
        datasources: { db: { url: `file:${dbPath}` } },
    });

    // 2. Generate schema matching runtime PrismaClient
    const { execFileSync } = require('node:child_process');
    const sql = execFileSync(
        process.execPath,
        [
            path.join(root, 'node_modules/prisma/build/index.js'),
            'migrate',
            'diff',
            '--from-empty',
            '--to-schema-datamodel',
            path.join(root, 'prisma/generated/client/schema.prisma'),
            '--script',
        ],
        { encoding: 'utf8', cwd: root }
    );
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
        await database.$executeRawUnsafe(statement);
    }

    // 3. Load description library
    const descSource = fs.readFileSync(path.join(root, 'src/lib/catalogueDescription.ts'), 'utf8');
    const descExports = {};
    vm.runInNewContext(transpile(descSource), { exports: descExports, module: { exports: descExports } });
    catalogueDescription = descExports;

    // 4. Load catalogue service
    const catSource = fs.readFileSync(path.join(root, 'electron/catalogue.service.ts'), 'utf8');
    const catExports = {};
    const catContext = {
        exports: catExports,
        module: { exports: catExports },
        require: (mod) => {
            if (mod === 'crypto' || mod === 'node:crypto') {
                const c = require('node:crypto');
                return { ...c, default: c };
            }
            if (mod.includes('catalogueDescription')) return catalogueDescription;
            return require(mod);
        },
        console,
        Buffer,
    };
    vm.runInNewContext(transpile(catSource), catContext);
    catalogueService = catExports;

    // Run schema upgrade
    await catalogueService.ensureCatalogueSchema(database);

    // 5. Load main.ts handlers for sales:checkout, sales:updateSale, and sales:exchange
    const mainSource = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');

    // Create admin and cashier users
    adminUser = await database.user.create({
        data: {
            id: randomUUID(),
            username: 'admin_test',
            password: 'test-password',
            name: 'Admin User',
            role: 'ADMIN',
            permManageProducts: true,
            permViewCostPrice: true,
            permEditSales: true,
            isActive: true,
        },
    });

    cashierUser = await database.user.create({
        data: {
            id: randomUUID(),
            username: 'cashier_test',
            password: 'test-password',
            name: 'Cashier User',
            role: 'CASHIER',
            permManageProducts: false,
            permViewCostPrice: false,
            permEditSales: false,
            isActive: true,
        },
    });

    // 5. Load sale edit domain
    const saleEditSource = fs.readFileSync(path.join(root, 'src/lib/saleEdit.ts'), 'utf8');
    const saleEditDomain = { exports: {} };
    vm.runInNewContext(transpile(saleEditSource), { exports: saleEditDomain.exports, module: saleEditDomain });
    const trackedStock = { exports: {} };
    vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'electron/tracked-stock.service.ts'), 'utf8')), {
        exports: trackedStock.exports, module: trackedStock,
    });

    const costHelpers={exports:{}};
    vm.runInNewContext(transpile(fs.readFileSync(path.join(root,'electron/stock-cost.service.ts'),'utf8')),{exports:costHelpers.exports,module:costHelpers,require,Date});
    const mainContext = {
        ...costHelpers.exports,
        ...saleEditDomain.exports,
        ...trackedStock.exports,
        checkAnyVariantPrepared: catalogueService.checkAnyVariantPrepared,
        enrichCatalogueVariants: catalogueService.enrichCatalogueVariants,
        formatVariantDescription: catalogueDescription.formatVariantDescription,
        prisma: database,
        ipcMain: {
            handle: (channel, handler) => {
                if (channel === 'sales:checkout') checkoutHandler = handler;
                if (channel === 'sales:updateSale') updateSaleHandler = handler;
            },
        },
        createSecureIpcHandler: (channel, _perm, handler) => {
            if (channel === 'sales:exchange') exchangeHandler = handler;
        },
        PermissionMiddleware: { editSale: null },
        sanitizeString: (val, max = 500) => (val == null ? undefined : String(val).trim().slice(0, max)),
        roundCurrency: (val) => Math.round(Number(val || 0) * 100) / 100,
        cloudSync: {
            queueSale: async () => {},
            queueExchange: async () => {},
            syncAuditLogs: async () => {},
        },
        getNextBillNoForDate: async () => `BILL-${randomUUID().slice(0, 8)}`,
        saleCounterSinceLastBackup: 0,
        console: { error() {}, log() {}, info() {}, warn() {} },
    };

    // Slice checkout handler, updateSale, and exchange from main.ts
    const validationSlice = mainSource.slice(
        mainSource.indexOf('// --- Input Validation Helpers ---'),
        mainSource.indexOf('function validateProductData(')
    );
    const checkoutSlice = mainSource.slice(
        mainSource.indexOf("ipcMain.handle('sales:checkout'"),
        mainSource.indexOf("ipcMain.handle('sales:updatePayment'")
    );
    const updateSaleSlice = mainSource.slice(
        mainSource.indexOf("ipcMain.handle('sales:updateSale'"),
        mainSource.indexOf('// Professional Exchange Handler')
    );
    const exchangeSlice = mainSource.slice(
        mainSource.indexOf('// Professional Exchange Handler'),
        mainSource.indexOf('// Retrieve structured Exchange/Refund details')
    );

    vm.runInNewContext(
        transpile(validationSlice + '\n' + checkoutSlice + '\n' + updateSaleSlice + '\n' + exchangeSlice),
        mainContext
    );
});

after(async () => {
    if (database) await database.$disconnect();
    if (temporaryDirectory && path.dirname(temporaryDirectory) === path.resolve(os.tmpdir())) {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});

// Helper to create a category
async function createCategory(name = 'Test Garments') {
    return await database.category.create({
        data: { id: randomUUID(), name: `${name}-${randomUUID().slice(0, 6)}` },
    });
}

// Fixture helper supplies required protocol fields; boundary tests call the service directly.
async function saveCatalogue(input, user = adminUser) {
    const payload = { ...input, requestId: input.requestId || randomUUID() };
    if (payload.id && payload.updatedAt === undefined) {
        payload.updatedAt = (await database.product.findUnique({ where: { id: payload.id } }))?.updatedAt;
    }
    return catalogueService.saveProduct(database, payload, user);
}
// =========================================================================
// ACCEPTANCE TEST SUITE: C1 - C14
// =========================================================================

test('C1: Open a product with three variants, reorder and edit one by stable ID', async () => {
    const category = await createCategory('C1 Category');
    const pId = randomUUID();
    const v1Id = randomUUID();
    const v2Id = randomUUID();
    const v3Id = randomUUID();

    await database.product.create({
        data: { id: pId, name: 'T-Shirt Classic', categoryId: category.id, isActive: true },
    });
    await database.productVariant.createMany({
        data: [
            { id: v1Id, productId: pId, sku: 'SKU-C1-1', barcode: 'BC-C1-1', size: 'M', mrp: 500, sellingPrice: 500, costPrice: 300, stock: 10, isActive: true },
            { id: v2Id, productId: pId, sku: 'SKU-C1-2', barcode: 'BC-C1-2', size: 'L', mrp: 600, sellingPrice: 600, costPrice: 350, stock: 20, isActive: true },
            { id: v3Id, productId: pId, sku: 'SKU-C1-3', barcode: 'BC-C1-3', size: 'XL', mrp: 700, sellingPrice: 700, costPrice: 400, stock: 30, isActive: true },
        ],
    });

    // 1. Fetch via getProduct
    const fetched = await catalogueService.getProduct(database, pId, adminUser);
    assert.equal(fetched.variants.length, 3);

    // 2. Reorder variants: [v3, v1, v2] and edit v2 (L -> XXL, sellingPrice 600 -> 650)
    const reorderedVariants = [
        fetched.variants.find((v) => v.id === v3Id),
        fetched.variants.find((v) => v.id === v1Id),
        {
            ...fetched.variants.find((v) => v.id === v2Id),
            size: 'XXL',
            sellingPrice: 650,
            fabric: 'Cotton Lycra',
        },
    ];

    const savePayload = {
        id: pId,
        name: fetched.name,
        categoryId: fetched.categoryId,
        updatedAt: fetched.updatedAt,
        variants: reorderedVariants.map(({ stock, ...v }) => v),
    };

    const saveResult = await saveCatalogue(savePayload, adminUser);
    assert.ok(saveResult && saveResult.id);

    // 3. Verify all 3 variants persist with stable IDs, unchanged stock, and stable barcodes
    const verifyVariants = await database.productVariant.findMany({
        where: { productId: pId },
        orderBy: { barcode: 'asc' },
    });

    assert.equal(verifyVariants.length, 3);
    const v1 = verifyVariants.find((v) => v.id === v1Id);
    const v2 = verifyVariants.find((v) => v.id === v2Id);
    const v3 = verifyVariants.find((v) => v.id === v3Id);

    assert.ok(v1 && v2 && v3, 'All 3 variants must retain their stable primary keys');
    assert.equal(v1.stock, 10, 'v1 stock must remain untouched');
    assert.equal(v2.stock, 20, 'v2 stock must remain untouched');
    assert.equal(v3.stock, 30, 'v3 stock must remain untouched');

    assert.equal(v2.size, 'XXL', 'v2 size must be updated');
    assert.equal(v2.sellingPrice, 650, 'v2 sellingPrice must be updated');
    assert.equal(v1.barcode, 'BC-C1-1');
    assert.equal(v2.barcode, 'BC-C1-2');
    assert.equal(v3.barcode, 'BC-C1-3');
});

test('C2: Exact request replay survives a new connection without duplicating a temporary variant', async () => {
    const category = await createCategory('C2');
    const product = await database.product.create({ data: { name: 'Polo Shirt', categoryId: category.id } });
    const existing = await database.productVariant.create({ data: {
        productId: product.id, sku: randomUUID(), barcode: 'BC-C2-EX', mrp: 800, sellingPrice: 800, costPrice: 400, stock: 5,
    } });
    const payload = {
        requestId: randomUUID(), id: product.id, updatedAt: product.updatedAt,
        name: product.name, categoryId: category.id,
        variants: [
            { id: existing.id, barcode: existing.barcode, mrp: 800, sellingPrice: 800 },
            { id: 'temp-c2', barcode: 'BC-C2-NEW', mrp: 850, sellingPrice: 850 },
        ],
    };
    const first = await catalogueService.saveProduct(database, payload, adminUser);
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    const restarted = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
        const replay = await catalogueService.saveProduct(restarted, payload, adminUser);
        assert.equal(replay.id, first.id);
        assert.equal(replay.variants.length, 2);
        assert.equal(replay.variants.find(v => v.barcode === 'BC-C2-NEW').id, first.variants.find(v => v.barcode === 'BC-C2-NEW').id);
        assert.equal(await database.inventoryMovement.count({ where: { variantId: { in: replay.variants.map(v => v.id) } } }), 0);
        await assert.rejects(() => catalogueService.saveProduct(restarted, { ...payload, name: 'Different request data' }, adminUser), /request ID was already used/);
    } finally { await restarted.$disconnect(); }

    const createPayload = { requestId: randomUUID(), name: 'Retry New Product', categoryId: category.id,
        variants: [{ id: 'temp-new-product', barcode: 'BC-C2-PRODUCT', mrp: 400, sellingPrice: 400 }] };
    const created = await catalogueService.saveProduct(database, createPayload, adminUser);
    const retried = await catalogueService.saveProduct(database, createPayload, adminUser);
    assert.equal(created.id, retried.id);
    assert.equal(await database.product.count({ where: { name: createPayload.name } }), 1);
});

test('C3: Two garments share price/size/pattern but differ in quality/model maintain distinct identities', async () => {
    const category = await createCategory('C3 Category');

    const desc1 = catalogueDescription.formatVariantDescription('Shirt', {
        brand: 'Crazy Heart',
        size: 'XL',
        pattern: 'Checks',
        fabric: 'Cotton',
        quality: 'Luxury Combed',
        styleRef: 'CR-01',
    });

    const desc2 = catalogueDescription.formatVariantDescription('Shirt', {
        brand: 'Crazy Heart',
        size: 'XL',
        pattern: 'Checks',
        fabric: 'Cotton',
        quality: 'Daily Wear',
        styleRef: 'CR-02',
    });

    assert.notEqual(desc1, desc2, 'Formatted descriptions must be distinct');
    assert.ok(desc1.includes('Luxury Combed'));
    assert.ok(desc2.includes('Daily Wear'));

    // Save product with both distinct variants
    const payload = {
        name: 'Shirt',
        categoryId: category.id,
        variants: [
            {
                barcode: 'BC-C3-QUALITY-A',
                sellingPrice: 700,
                mrp: 700,
                size: 'XL',
                brand: 'Crazy Heart',
                pattern: 'Checks',
                fabric: 'Cotton',
                quality: 'Luxury Combed',
                styleRef: 'CR-01',
                isPrepared: true,
            },
            {
                barcode: 'BC-C3-QUALITY-B',
                sellingPrice: 700,
                mrp: 700,
                size: 'XL',
                brand: 'Crazy Heart',
                pattern: 'Checks',
                fabric: 'Cotton',
                quality: 'Daily Wear',
                styleRef: 'CR-02',
                isPrepared: true,
            },
        ],
    };

    const res = await saveCatalogue(payload, adminUser);
    assert.ok(res && res.id);

    const fetched = await catalogueService.getProduct(database, res.id, adminUser);
    assert.equal(fetched.variants.length, 2);
    assert.notEqual(fetched.variants[0].id, fetched.variants[1].id);
    assert.notEqual(fetched.variants[0].barcode, fetched.variants[1].barcode);
    assert.notEqual(fetched.variants[0].quality, fetched.variants[1].quality);
});

test('C4: Save existing generic Shirt 700 beside prepared specific shirt without altering legacy bill', async () => {
    const category = await createCategory('C4 Category');
    const pId = randomUUID();
    const genericVarId = randomUUID();

    await database.product.create({
        data: { id: pId, name: 'Shirt 700', categoryId: category.id, isActive: true },
    });
    await database.productVariant.create({
        data: {
            id: genericVarId,
            productId: pId,
            sku: 'SKU-SHIRT-700',
            barcode: '700',
            mrp: 700,
            sellingPrice: 700,
            costPrice: 400,
            stock: 42,
            isActive: true,
        },
    });

    // Create legacy bill referencing the generic variant
    const saleId = randomUUID();
    await database.sale.create({
        data: {
            id: saleId,
            billNo: 'BILL-OLD-700',
            userId: adminUser.id,
            subtotal: 700,
            discount: 0,
            taxAmount: 0,
            cgst: 0,
            sgst: 0,
            grandTotal: 700,
            paidAmount: 700,
            changeAmount: 0,
            items: {
                create: [
                    {
                        id: randomUUID(),
                        variantId: genericVarId,
                        productName: 'Shirt 700',
                        quantity: 1,
                        mrp: 700,
                        sellingPrice: 700,
                        taxRate: 5.0,
                        taxAmount: 0,
                        total: 700,
                    },
                ],
            },
        },
    });

    // Add a new specific prepared variant alongside Shirt 700
    const fetched = await catalogueService.getProduct(database, pId, adminUser);
    const savePayload = {
        id: pId,
        name: fetched.name,
        categoryId: fetched.categoryId,
        variants: [
            ...fetched.variants.map(({ stock, ...v }) => v),
            {
                barcode: '007001',
                sellingPrice: 700,
                mrp: 700,
                brand: 'Crazy Heart',
                size: '38',
                pattern: 'Checks',
                fabric: 'Cotton',
                quality: 'Premium Combed',
                isPrepared: true,
            },
        ],
    };

    const saveResult = await saveCatalogue(savePayload, adminUser);
    assert.ok(saveResult && saveResult.id);

    // Verify generic variant still exists with barcode 700 and stock 42
    const updatedProd = await catalogueService.getProduct(database, pId, adminUser);
    const genericVar = updatedProd.variants.find((v) => v.id === genericVarId);
    assert.equal(genericVar.barcode, '700');
    assert.equal(genericVar.stock, 42);
    assert.equal(genericVar.isPrepared, false);

    // Verify historical bill remains intact and attached
    const oldBillItem = await database.saleItem.findFirst({ where: { saleId } });
    assert.equal(oldBillItem.variantId, genericVarId);
    assert.equal(oldBillItem.productName, 'Shirt 700');
});

test('C5: Duplicate barcode rejected across active and inactive records', async () => {
    const category = await createCategory('C5 Category');
    const existingBarcode = 'BC-C5-DUPE-CHECK';

    // Create an inactive variant with existingBarcode
    const inactiveProd = await database.product.create({
        data: { id: randomUUID(), name: 'Archived Product', categoryId: category.id, isActive: false },
    });
    await database.productVariant.create({
        data: {
            id: randomUUID(),
            productId: inactiveProd.id,
            sku: 'SKU-C5-ARCHIVED',
            barcode: existingBarcode,
            mrp: 500,
            sellingPrice: 500,
            costPrice: 300,
            stock: 0,
            isActive: false,
        },
    });

    // checkBarcode must report it as already existing
    const check = await catalogueService.checkBarcode(database, existingBarcode);
    assert.equal(check.exists, true);

    // Attempt to save a new product using the same barcode
    const payload = {
        name: 'New Product',
        categoryId: category.id,
        variants: [{ barcode: existingBarcode, mrp: 600, sellingPrice: 600, isPrepared: true }],
    };

    await assert.rejects(
        async () => {
            await saveCatalogue(payload, adminUser);
        },
        /already assigned|duplicate/i
    );
});

test('C6: Save and reopen barcode preserves leading zeros (0012345)', async () => {
    const category = await createCategory('C6 Category');
    const leadingZeroBarcode = '0012345';

    const saveRes = await saveCatalogue(
        {
            name: 'Pants Formal',
            categoryId: category.id,
            variants: [
                {
                    barcode: leadingZeroBarcode,
                    mrp: 999,
                    sellingPrice: 999,
                    brand: 'Raymond',
                    size: '32',
                    isPrepared: true,
                },
            ],
        },
        adminUser
    );
    assert.ok(saveRes && saveRes.id);

    // Reopen product
    const fetched = await catalogueService.getProduct(database, saveRes.id, adminUser);
    const variant = fetched.variants[0];
    assert.strictEqual(variant.barcode, '0012345', 'Barcode must preserve exact string leading zeros');
    assert.notStrictEqual(variant.barcode, 12345);
});

test('C7: Real print callback/copy validation is covered by the frontend print suite', {
    skip: 'Actual print callbacks are exercised by the separate UI print suite. Physical printer/scanner validation remains pending.',
}, () => {});

test('C8: Scan/select prepared conversion variant in POS, exchange, or updateSale is rejected with clear message', async () => {
    const category = await createCategory('C8 Category');
    const prepVarId = randomUUID();
    const liveVarId = randomUUID();

    const prod = await database.product.create({
        data: { id: randomUUID(), name: 'C8 Garment', categoryId: category.id },
    });
    await database.productVariant.createMany({
        data: [
            { id: prepVarId, productId: prod.id, sku: 'SKU-C8-PREP', barcode: 'BC-C8-PREP', mrp: 500, sellingPrice: 500, costPrice: 200, stock: 0, isActive: true },
            { id: liveVarId, productId: prod.id, sku: 'SKU-C8-LIVE', barcode: 'BC-C8-LIVE', mrp: 500, sellingPrice: 500, costPrice: 200, stock: 10, isActive: true },
        ],
    });
    // Ensure garment detail table reflects isPrepared
    await database.$executeRawUnsafe(
        `INSERT INTO "ProductVariantGarmentDetail" ("variantId", "isPrepared") VALUES (?, 1)`,
        prepVarId
    );
    await database.$executeRawUnsafe(
        `UPDATE "ProductVariant" SET isPrepared = 1 WHERE id = ?`,
        prepVarId
    );

    // 1. Attempt checkout with prepared variant
    const checkoutResult = await checkoutHandler(null, {
        userId: adminUser.id,
        subtotal: 500,
        discount: 0,
        grandTotal: 500,
        paidAmount: 500,
        items: [{ variantId: prepVarId, productName: 'C8 Garment', quantity: 1, sellingPrice: 500 }],
        payments: [{ paymentMode: 'CASH', amount: 500 }],
    });
    assert.equal(checkoutResult.success, false);
    assert.match(checkoutResult.error, /Stock conversion pending/);

    // 2. Normal sale with live variant must succeed
    const liveCheckoutResult = await checkoutHandler(null, {
        userId: adminUser.id,
        subtotal: 500,
        discount: 0,
        grandTotal: 500,
        paidAmount: 500,
        items: [{
            variantId: liveVarId,
            productName: 'C8 Garment Live',
            quantity: 1,
            mrp: 500,
            sellingPrice: 500,
            discount: 0,
            taxRate: 5.0,
            taxAmount: 23.81,
            total: 500,
        }],
        payments: [{ paymentMode: 'CASH', amount: 500 }],
        changeAmount: 0,
    });
    assert.equal(liveCheckoutResult.success, true, liveCheckoutResult.error);
    const normalSaleId = liveCheckoutResult.data.id;

    // 3. Attempt exchange replacement using prepared variant
    const exchangeResult = await exchangeHandler(
        null,
        {
            originalInvoiceId: normalSaleId,
            userId: adminUser.id,
            items: [
                { returnedId: liveVarId, returnedQty: 1, newId: prepVarId, newQty: 1, priceDiff: 0 },
            ],
            payments: [],
            replacementPaymentMethod: 'CASH',
        },
        adminUser
    );
    assert.equal(exchangeResult.success, false);
    assert.match(exchangeResult.error, /Stock conversion pending/);

    // 4. Attempt updateSale adding prepared variant
    const updateSaleResult = await updateSaleHandler(null, {
        saleId: normalSaleId,
        userId: adminUser.id,
        saleData: {
            ...liveCheckoutResult.data,
            items: [
                ...liveCheckoutResult.data.items,
                { variantId: prepVarId, productName: 'C8 Garment Prep', quantity: 1, sellingPrice: 500 },
            ],
        },
    });
    assert.equal(updateSaleResult.success, false);
    assert.match(updateSaleResult.error, /Stock conversion pending/);
});

test('C9: A real checkout commits while a catalogue save is waiting to enter its transaction', async () => {
    const category = await createCategory('C9');
    const product = await database.product.create({ data: { name: 'Kurta Set', categoryId: category.id } });
    const variant = await database.productVariant.create({ data: {
        productId: product.id, sku: randomUUID(), barcode: 'BC-C9', mrp: 1200, sellingPrice: 1200, costPrice: 600, stock: 20,
    } });
    let entered, release;
    const atTransaction = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const paused = new Proxy(database, {
        get(target, prop) {
            if (prop === '$transaction') return async (...args) => { entered(); await gate; return target.$transaction(...args); };
            const value = Reflect.get(target, prop);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    const payload = { requestId: randomUUID(), id: product.id, updatedAt: product.updatedAt,
        name: product.name, categoryId: category.id,
        variants: [{ id: variant.id, barcode: variant.barcode, mrp: 1300, sellingPrice: 1250 }] };
    const saving = catalogueService.saveProduct(paused, payload, adminUser);
    await atTransaction;
    try {
        const sold = await checkoutHandler(null, {
            userId: adminUser.id, subtotal: 2400, discount: 0, grandTotal: 2400, paidAmount: 2400, changeAmount: 0,
            items: [{ variantId: variant.id, productName: product.name, quantity: 2, mrp: 1200, sellingPrice: 1200,
                discount: 0, taxRate: 5, taxAmount: 114.29, total: 2400 }],
            payments: [{ paymentMode: 'CASH', amount: 2400 }],
        });
        assert.equal(sold.success, true, sold.error);
    } finally { release(); }
    await saving;
    const after = await database.productVariant.findUnique({ where: { id: variant.id } });
    assert.equal(after.stock, 18);
    assert.equal(after.sellingPrice, 1250);
    const moves = await database.inventoryMovement.findMany({ where: { variantId: variant.id } });
    assert.equal(moves.length, 1);
    assert.equal(moves[0].quantity, -2);
});

test('C10: Unauthorized catalogue request denied; costPrice masked; forged stock and activation rejected', async () => {
    const category = await createCategory('C10 Category');

    // 1. User without permManageProducts is denied
    await assert.rejects(
        async () => {
            await saveCatalogue(
                {
                    name: 'Unauthorized Product',
                    categoryId: category.id,
                    variants: [{ barcode: 'BC-C10-DENY', mrp: 500, sellingPrice: 500 }],
                },
                cashierUser
            );
        },
        /Permission Denied/
    );

    // 2. User without permViewCostPrice gets null costPrice
    const pId = randomUUID();
    const vId = randomUUID();
    await database.product.create({
        data: { id: pId, name: 'Secret Cost Item', categoryId: category.id },
    });
    await database.productVariant.create({
        data: {
            id: vId,
            productId: pId,
            sku: 'SKU-C10-COST',
            barcode: 'BC-C10-COST',
            mrp: 500,
            sellingPrice: 500,
            costPrice: 280,
            stock: 10,
        },
    });

    const maskedFetch = await catalogueService.getProduct(database, pId, cashierUser);
    assert.strictEqual(maskedFetch.variants[0].costPrice, null, 'costPrice must be masked for cashier');

    const adminFetch = await catalogueService.getProduct(database, pId, adminUser);
    assert.strictEqual(adminFetch.variants[0].costPrice, 280, 'costPrice visible to admin');

    // Forged quantity and activation writes fail atomically.
    const forged = { requestId: randomUUID(), name: 'Forged Stock Item', categoryId: category.id,
        variants: [{ barcode: 'BC-C10-FORGE', mrp: 500, sellingPrice: 500, stock: 9999 }] };
    await assert.rejects(() => catalogueService.saveProduct(database, forged, adminUser), /cannot write stock/);
    assert.equal(await database.product.count({ where: { name: forged.name } }), 0);
    const legitimate = await saveCatalogue({ name: 'Prepared Zero', categoryId: category.id,
        variants: [{ barcode: 'BC-C10-ZERO', mrp: 500, sellingPrice: 500 }] });
    assert.equal(legitimate.variants[0].stock, 0);
    assert.equal(legitimate.variants[0].isPrepared, true);
    await assert.rejects(() => catalogueService.saveProduct(database, { requestId: randomUUID(),
        id: legitimate.id, updatedAt: legitimate.updatedAt, name: legitimate.name, categoryId: category.id,
        variants: [{ id: legitimate.variants[0].id, mrp: 500, sellingPrice: 500, isPrepared: false }] }, adminUser), /cannot change preparation state/);
    const stillPrepared = await catalogueService.getProduct(database, legitimate.id, adminUser);
    assert.equal(stillPrepared.variants[0].isPrepared, true);
    const editorWithoutCost = { ...cashierUser, permManageProducts: true };
    const edited = await saveCatalogue({ id: pId, name: 'Secret Cost Item', categoryId: category.id,
        variants: [{ id: vId, mrp: 500, sellingPrice: 550, costPrice: 0 }] }, editorWithoutCost);
    assert.equal(edited.variants[0].costPrice, null);
    assert.equal((await database.productVariant.findUnique({ where: { id: vId } })).costPrice, 280);
});

test('C11: Stale edit rejected via optimistic locking; referenced variant not hard-deleted', async () => {
    const category = await createCategory('C11 Category');
    const pId = randomUUID();
    const vRefId = randomUUID();

    const originalDate = new Date('2026-10-01T10:00:00Z');
    await database.product.create({
        data: { id: pId, name: 'Referenced Product', categoryId: category.id, updatedAt: originalDate.toISOString() },
    });
    await database.productVariant.create({
        data: {
            id: vRefId,
            productId: pId,
            sku: 'SKU-C11-REF',
            barcode: 'BC-C11-REF',
            mrp: 500,
            sellingPrice: 500,
            costPrice: 250,
            stock: 5,
        },
    });

    // Reference variant in a sale item
    await database.sale.create({
        data: {
            id: randomUUID(),
            billNo: 'BILL-C11-REF',
            userId: adminUser.id,
            subtotal: 500,
            discount: 0,
            taxAmount: 0,
            cgst: 0,
            sgst: 0,
            grandTotal: 500,
            paidAmount: 500,
            changeAmount: 0,
            items: {
                create: [
                    {
                        id: randomUUID(),
                        variantId: vRefId,
                        productName: 'Referenced Product',
                        quantity: 1,
                        mrp: 500,
                        sellingPrice: 500,
                        taxRate: 5.0,
                        taxAmount: 0,
                        total: 500,
                    },
                ],
            },
        },
    });

    // 1. Submit edit omitting vRefId: variant remains active and is not deleted
    const omitPayload = {
        id: pId,
        name: 'Referenced Product',
        categoryId: category.id,
        updatedAt: originalDate.toISOString(),
        variants: [
            {
                barcode: 'BC-C11-NEW',
                mrp: 600,
                sellingPrice: 600,
                isPrepared: true,
            },
        ],
    };

    const omitResult = await saveCatalogue(omitPayload, adminUser);
    assert.ok(omitResult && omitResult.id);

    const vRefAfter = await database.productVariant.findUnique({ where: { id: vRefId } });
    assert.ok(vRefAfter, 'Referenced variant must NOT be hard deleted');
    assert.equal(vRefAfter.isActive, true, 'Omitted variant is not deleted or silently retired');

    // 2. Submit stale edit with old timestamp
    const stalePayload = {
        id: pId,
        name: 'Stale Edit Attempt',
        categoryId: category.id,
        updatedAt: originalDate.toISOString(), // Severely stale compared to latest updatedAt
        variants: [{ id: vRefId, barcode: 'BC-C11-REF', mrp: 550, sellingPrice: 550 }],
    };

    await assert.rejects(
        async () => {
            await saveCatalogue(stalePayload, adminUser);
        },
        /Stale edit/
    );
});

test('C12: Catalogue updates omitting garment metadata preserve it and preparation state', async () => {
    const category = await createCategory('C12');
    const first = await saveCatalogue({ name: 'Denim Jacket', categoryId: category.id,
        variants: [{ barcode: 'BC-C12', mrp: 1800, sellingPrice: 1800, brand: 'Levis', fabric: 'Denim 14oz',
            quality: 'Heavyweight', pattern: 'Solid', metadata: { legacy: { supplierReference: 'keep-me' } } }] });
    const variant = first.variants[0];
    const updated = await saveCatalogue({ id: first.id, updatedAt: first.updatedAt, name: first.name, categoryId: category.id,
        variants: [{ id: variant.id, mrp: 1800, sellingPrice: 1750 }] });
    assert.equal(updated.variants[0].isPrepared, true);
    assert.equal(updated.variants[0].fabric, 'Denim 14oz');
    assert.equal(updated.variants[0].quality, 'Heavyweight');
    assert.equal(updated.variants[0].metadata.legacy.supplierReference, 'keep-me');
    assert.equal(updated.variants[0].stock, 0);
    const selectable = await catalogueService.listVariants(database, { where: { id: variant.id } }, cashierUser);
    assert.equal(selectable[0].product.name, 'Denim Jacket');
    assert.equal(selectable[0].isPrepared, true);
    assert.equal(selectable[0].costPrice, null);
    assert.equal(selectable[0].formattedDescription, catalogueDescription.formatVariantDescription('Denim Jacket', selectable[0]));
});

test('C13: Additive schema upgrade on disposable existing legacy database preserves all records', async () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-stock-legacy-'));
    const legacyDbPath = path.join(legacyDir, 'legacy.db').replaceAll('\\', '/');

    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    const legacyDb = new PrismaClient({
        datasources: { db: { url: `file:${legacyDbPath}` } },
    });

    try {
        // Create pure legacy schema and data (no ProductVariantGarmentDetail, no isPrepared column)
        const stmts = [
            'CREATE TABLE "Category" (id TEXT PRIMARY KEY, name TEXT)',
            'CREATE TABLE "Product" (id TEXT PRIMARY KEY, name TEXT, categoryId TEXT)',
            'CREATE TABLE "ProductVariant" (id TEXT PRIMARY KEY, productId TEXT, sku TEXT, barcode TEXT, mrp REAL, sellingPrice REAL, costPrice REAL, stock INTEGER DEFAULT 0, isActive INTEGER DEFAULT 1)',
            'CREATE TABLE "Sale" (id TEXT PRIMARY KEY, billNo TEXT, grandTotal REAL)',
            "INSERT INTO \"Category\" VALUES ('cat-1', 'Legacy Cat')",
            "INSERT INTO \"Product\" VALUES ('prod-1', 'Legacy Shirt', 'cat-1')",
            "INSERT INTO \"ProductVariant\" VALUES ('var-1', 'prod-1', 'SKU-LEG-1', 'LEG-BC-1', 700, 700, 350, 25, 1)",
            "INSERT INTO \"Sale\" VALUES ('sale-1', 'BILL-LEG-100', 700)",
        ];
        for (const s of stmts) await legacyDb.$executeRawUnsafe(s);

        // Run additive migration
        await catalogueService.ensureCatalogueSchema(legacyDb);

        // Verify existing rows and values are intact
        const variant = await legacyDb.$queryRawUnsafe(`SELECT * FROM "ProductVariant" WHERE id='var-1'`);
        assert.equal(variant[0].barcode, 'LEG-BC-1');
        assert.equal(variant[0].stock, 25);
        assert.equal(variant[0].sellingPrice, 700);

        const sale = await legacyDb.$queryRawUnsafe(`SELECT * FROM "Sale" WHERE id='sale-1'`);
        assert.equal(sale[0].billNo, 'BILL-LEG-100');

        // Verify new table exists and is writable
        await legacyDb.$executeRawUnsafe(`
            INSERT INTO "ProductVariantGarmentDetail" ("variantId", "isPrepared", "fabric") VALUES ('var-1', 0, 'Cotton');
        `);
        const gd = await legacyDb.$queryRawUnsafe(`SELECT * FROM "ProductVariantGarmentDetail" WHERE variantId='var-1'`);
        assert.equal(gd[0].fabric, 'Cotton');
    } finally {
        await legacyDb.$disconnect();
        if (legacyDir && path.dirname(legacyDir) === path.resolve(os.tmpdir())) {
            fs.rmSync(legacyDir, { recursive: true, force: true });
        }
    }
});

test('C14: Long description, whitespace normalization, and HTML escaping for label preview', () => {
    // 1. Whitespace normalization
    const normalized = catalogueDescription.normalizeText('   Crazy   Heart   Brands   ');
    assert.equal(normalized, 'Crazy Heart Brands');

    // 2. Structured description formatting
    const formatted = catalogueDescription.formatVariantDescription('Formal Shirt', {
        brand: '  Peter   England  ',
        size: '42',
        sleeve: 'Full Sleeve',
        fit: 'Slim Fit',
        pattern: 'Checks',
        fabric: 'Cotton',
        quality: 'Super Luxury',
        styleRef: 'REF-PE-42',
    });
    assert.equal(
        formatted,
        'Formal Shirt | Peter England | 42 | Full Sleeve | Checks | Cotton | Super Luxury | Slim Fit | Ref: REF-PE-42'
    );

    // 3. HTML escaping for sticker label preview/print
    const maliciousInput = '<script>alert("XSS")</script> & "Quotes" \'Single\'';
    const escaped = catalogueDescription.escapeHtml(maliciousInput);
    assert.equal(escaped, '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt; &amp; &quot;Quotes&quot; &#39;Single&#39;');
    assert.ok(!escaped.includes('<script>'), 'Script tags must be fully escaped');
});

test('Readable names do not repeat a matching brand, with case and whitespace normalized', () => {
    assert.equal(catalogueDescription.formatVariantDescription('  CRAZY   HEART  ', {
        brand: 'Crazy Heart', size: 'XL', pattern: 'Checks', fabric: 'Cotton',
    }), 'CRAZY HEART | XL | Checks | Cotton');
});

test('Readable brand and pattern names retain size and the remaining garment details', () => {
    const attributes = {
        brand: '  crazy  heart ', size: 'XL', pattern: ' CHECKS ', sleeve: 'Full Sleeve',
        fabric: 'Cotton', quality: 'Premium', fit: 'Slim', color: 'Blue',
        collar: 'Regular', pocket: 'Single', styleRef: 'CH-01',
    };
    const original = JSON.stringify(attributes);
    assert.equal(catalogueDescription.formatVariantDescription(' Crazy  Heart\tChecks ', attributes),
        'Crazy Heart Checks | XL | Full Sleeve | Cotton | Premium | Slim | Blue | Collar: Regular | Pocket: Single | Ref: CH-01');
    assert.equal(JSON.stringify(attributes), original, 'Formatting must not change stored garment fields');
});

test('Similar substrings and partial brand phrases remain visible in descriptions', () => {
    assert.equal(catalogueDescription.formatVariantDescription('Zipper Checksums', {
        brand: 'Zi', pattern: 'Checks', size: 'XL', fabric: 'Cotton',
    }), 'Zipper Checksums | Zi | XL | Checks | Cotton');
    assert.equal(catalogueDescription.formatVariantDescription('Crazy Heartland', {
        brand: 'Crazy Heart', pattern: 'Plain', size: 'M',
    }), 'Crazy Heartland | Crazy Heart | M | Plain');
    assert.equal(catalogueDescription.formatVariantDescription('C++ Checks', {
        brand: 'C++', pattern: 'Checks', size: 'L',
    }), 'C++ Checks | L', 'Punctuation in an actual brand must be matched literally');
});

test('Traditional generic names keep their existing detailed formatting', () => {
    assert.equal(catalogueDescription.formatVariantDescription('Shirt 700', {
        brand: 'Crazy Heart', size: 'XL', sleeve: 'Full Sleeve', pattern: 'Checks',
        fabric: 'Cotton', quality: 'Premium',
    }), 'Shirt 700 | Crazy Heart | XL | Full Sleeve | Checks | Cotton | Premium');
    assert.equal(catalogueDescription.formatVariantDescription('Shirt 700', {}), 'Shirt 700');
});


test('Concurrent edits from separate SQLite connections cannot overwrite a committed revision', async () => {
    const category = await createCategory('Concurrent edits');
    const first = await saveCatalogue({ name: 'Concurrent Shirt', categoryId: category.id,
        variants: [{ barcode: 'CONCURRENT-EDIT', mrp: 500, sellingPrice: 500 }] });
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    const other = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await catalogueService.ensureCatalogueSchema(other);
    const base = { id: first.id, updatedAt: first.updatedAt, name: first.name, categoryId: category.id };
    const requests = [550, 600].map(price => ({ ...base, requestId: randomUUID(),
        variants: [{ id: first.variants[0].id, mrp: 600, sellingPrice: price }] }));
    try {
        const results = await Promise.allSettled(requests.map((payload, i) => catalogueService.saveProduct(i ? other : database, payload, adminUser)));
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        const rejected = results.findIndex(r => r.status === 'rejected');
        assert.ok(rejected >= 0);
        // A SQLite busy loser may retry; its original revision must then be rejected.
        await assert.rejects(() => catalogueService.saveProduct(other, requests[rejected], adminUser), /Stale edit/);
        const after = await catalogueService.getProduct(database, first.id, adminUser);
        assert.notEqual(new Date(after.updatedAt).getTime(), new Date(first.updatedAt).getTime());
        const posted = await database.$queryRawUnsafe('SELECT * FROM "CatalogueSaveRequest" WHERE "requestId" IN (?, ?)', requests[0].requestId, requests[1].requestId);
        assert.equal(posted.length, 1);
    } finally { await other.$disconnect(); }
});

test('Exact stale revision rejects even a one-millisecond-old edit and requires an edit token', async () => {
    const category = await createCategory('Exact revision');
    const first = await saveCatalogue({ name: 'Exact Version', categoryId: category.id,
        variants: [{ barcode: 'EXACT-REVISION', mrp: 500, sellingPrice: 500 }] });
    const payload = { id: first.id, name: first.name, categoryId: category.id,
        variants: [{ id: first.variants[0].id, mrp: 500, sellingPrice: 550 }] };
    await assert.rejects(() => catalogueService.saveProduct(database, { ...payload, requestId: randomUUID() }, adminUser), /Stale edit/);
    await assert.rejects(() => catalogueService.saveProduct(database, { ...payload, requestId: randomUUID(),
        updatedAt: new Date(new Date(first.updatedAt).getTime() - 1) }, adminUser), /Stale edit/);
    await assert.rejects(() => catalogueService.saveProduct(database, { ...payload, updatedAt: first.updatedAt }, adminUser), /request ID is required/);
});

test('A late duplicate barcode rolls back the product revision and earlier variant changes', async () => {
    const category = await createCategory('Rollback');
    const first = await saveCatalogue({ name: 'Atomic Shirt', categoryId: category.id,
        variants: [{ barcode: 'ATOMIC-FIRST', mrp: 500, sellingPrice: 500 }] });
    await saveCatalogue({ name: 'Other Shirt', categoryId: category.id,
        variants: [{ barcode: 'ATOMIC-DUPLICATE', mrp: 500, sellingPrice: 500 }] });
    const requestId = randomUUID();
    await assert.rejects(() => catalogueService.saveProduct(database, { requestId, id: first.id,
        updatedAt: first.updatedAt, name: first.name, categoryId: category.id, variants: [
            { id: first.variants[0].id, mrp: 500, sellingPrice: 550 },
            { id: 'temp-atomic-fail', barcode: 'ATOMIC-DUPLICATE', mrp: 500, sellingPrice: 500 },
        ] }, adminUser), /already assigned/);
    const after = await catalogueService.getProduct(database, first.id, adminUser);
    assert.equal(after.variants.length, 1);
    assert.equal(after.variants[0].sellingPrice, 500);
    assert.equal(new Date(after.updatedAt).getTime(), new Date(first.updatedAt).getTime());
    assert.equal((await database.$queryRawUnsafe('SELECT * FROM "CatalogueSaveRequest" WHERE "requestId" = ?', requestId)).length, 0);
});

test('Barcode reservations are stable, exclusive across concurrent drafts, and claimed by saved identity', async () => {
    const category = await createCategory('Reserved codes');
    const drafts = ['temp-reserve-a-' + randomUUID(), 'temp-reserve-b-' + randomUUID()];
    const simultaneous = await Promise.allSettled(drafts.map(draftId => catalogueService.reserveBarcode(database, { draftId }, adminUser)));
    const codes = [];
    for (let i = 0; i < drafts.length; i++) {
        codes.push(simultaneous[i].status === 'fulfilled' ? simultaneous[i].value :
            await catalogueService.reserveBarcode(database, { draftId: drafts[i] }, adminUser));
    }
    assert.notEqual(codes[0].barcode, codes[1].barcode);
    assert.equal((await catalogueService.reserveBarcode(database, { draftId: drafts[0] }, adminUser)).barcode, codes[0].barcode);
    await assert.rejects(() => saveCatalogue({ name: 'Wrong Draft', categoryId: category.id,
        variants: [{ id: 'temp-impostor', barcode: codes[0].barcode, mrp: 500, sellingPrice: 500 }] }), /reserved by another draft/);
    const saved = await saveCatalogue({ name: 'Right Draft', categoryId: category.id,
        variants: [{ id: drafts[0], barcode: codes[0].barcode, sku: '000SKU', mrp: 500, sellingPrice: 500 }] });
    const reopened = await catalogueService.getProduct(database, saved.id, adminUser);
    assert.equal(reopened.variants[0].barcode, codes[0].barcode);
    await assert.rejects(() => saveCatalogue({ id: saved.id, name: saved.name, categoryId: category.id,
        variants: [{ id: saved.variants[0].id, barcode: 'NEW-ASSIGNED-CODE', mrp: 500, sellingPrice: 500 }] }), /cannot be replaced/);
    await assert.rejects(() => saveCatalogue({ id: saved.id, name: saved.name, categoryId: category.id,
        variants: [{ id: saved.variants[0].id, sku: 'NEW-ASSIGNED-SKU', mrp: 500, sellingPrice: 500 }] }), /SKUs cannot be replaced/);
});

test('Referenced generic product and variant identity cannot be rewritten or rebarcoded', async () => {
    const category = await createCategory('Generic identity');
    const anotherCategory = await createCategory('Different category');
    const generic = await database.product.create({ data: { name: 'Shirt 700', categoryId: category.id } });
    const variant = await database.productVariant.create({ data: { productId: generic.id, sku: 'GENERIC-SKU',
        barcode: 'GENERIC-700', mrp: 700, sellingPrice: 700, costPrice: 300, stock: -12 } });
    await database.inventoryMovement.create({ data: { variantId: variant.id, type: 'OUT', quantity: -1, reason: 'Legacy history', createdBy: adminUser.id } });
    const base = { id: generic.id, name: generic.name, categoryId: category.id,
        variants: [{ id: variant.id, mrp: 700, sellingPrice: 700 }] };
    for (const change of [{ name: 'Crazy Heart XL' }, { categoryId: anotherCategory.id },
        { variants: [{ id: variant.id, brand: 'Crazy Heart', size: 'XL', mrp: 700, sellingPrice: 700 }] }]) {
        await assert.rejects(() => saveCatalogue({ ...base, ...change }), /has history/);
    }
    const after = await catalogueService.getProduct(database, generic.id, adminUser);
    assert.equal(after.name, 'Shirt 700');
    assert.equal(after.categoryId, category.id);
    assert.equal(after.variants[0].barcode, 'GENERIC-700');
    assert.equal(after.variants[0].stock, -12);
    assert.equal(after.variants[0].brand, null);
    assert.equal(await database.inventoryMovement.count({ where: { variantId: variant.id } }), 1);
});

test('Schema failure propagates and preparation checks only allow a clean legacy schema fallback', async () => {
    const broken = {
        $queryRawUnsafe: async () => [{ name: 'id' }, { name: 'isPrepared' }],
        $executeRawUnsafe: async () => { throw new Error('Injected DDL failure'); },
    };
    await assert.rejects(() => catalogueService.ensureCatalogueSchema(broken), /Injected DDL failure/);
    await assert.rejects(() => catalogueService.checkAnyVariantPrepared({
        $queryRawUnsafe: async () => { throw new Error('Injected read failure'); },
    }, ['variant']), /Injected read failure/);
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    const legacy = new PrismaClient({ datasources: { db: { url: 'file:' + path.join(temporaryDirectory, 'guard-legacy.db').replaceAll('\\', '/') } } });
    try {
        await legacy.$executeRawUnsafe('CREATE TABLE "ProductVariant" ("id" TEXT PRIMARY KEY)');
        await legacy.$executeRawUnsafe("INSERT INTO ProductVariant VALUES ('legacy')");
        assert.equal(await catalogueService.checkAnyVariantPrepared(legacy, ['legacy']), false);
        await legacy.$executeRawUnsafe('ALTER TABLE "ProductVariant" ADD COLUMN "isPrepared" INTEGER DEFAULT 0');
        await assert.rejects(() => catalogueService.checkAnyVariantPrepared(legacy, ['legacy']), /schema is incomplete/);
        await legacy.$executeRawUnsafe('CREATE TABLE "ProductVariantGarmentDetail" ("variantId" TEXT PRIMARY KEY, "isPrepared" INTEGER)');
        await legacy.$executeRawUnsafe("INSERT INTO ProductVariantGarmentDetail VALUES ('legacy', 1)");
        assert.equal(await catalogueService.checkAnyVariantPrepared(legacy, ['legacy']), true);
        await legacy.$executeRawUnsafe('ALTER TABLE "ProductVariantGarmentDetail" RENAME COLUMN "isPrepared" TO "brokenPrepared"');
        await assert.rejects(() => catalogueService.checkAnyVariantPrepared(legacy, ['legacy']));
    } finally { await legacy.$disconnect(); }
});


test('Simultaneous identical create requests produce one product and replay across renewed credentials', async () => {
    const category = await createCategory('Concurrent creation');
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    const other = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await catalogueService.ensureCatalogueSchema(other);
    const payload = { requestId: randomUUID(), name: 'Concurrent New Product', categoryId: category.id,
        variants: [{ id: 'temp-concurrent-create', barcode: 'CONCURRENT-CREATE', mrp: 450, sellingPrice: 450 }] };
    try {
        const results = await Promise.all([
            catalogueService.saveProduct(database, { ...payload, sessionToken: 'first-session' }, adminUser),
            catalogueService.saveProduct(other, { ...payload, sessionToken: 'renewed-session' }, adminUser),
        ]);
        assert.equal(results[0].id, results[1].id);
        assert.equal(results[0].variants[0].id, results[1].variants[0].id);
        assert.equal(await database.product.count({ where: { name: payload.name } }), 1);
        assert.equal(await database.productVariant.count({ where: { barcode: 'CONCURRENT-CREATE' } }), 1);
        assert.equal((await database.$queryRawUnsafe('SELECT * FROM "CatalogueSaveRequest" WHERE "requestId" = ?', payload.requestId)).length, 1);
    } finally { await other.$disconnect(); }
});
