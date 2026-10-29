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
let catalogueService, catalogueDescription, stockDraftService;
let adminUser, cashierUser, unpermittedUser, disabledUser;

function loadModule(filePath, customContext = {}) {
    const source = fs.readFileSync(filePath, 'utf8');
    const exports = {};
    const context = {
        exports,
        module: { exports },
        require: (mod) => {
            if (mod === 'crypto' || mod === 'node:crypto') {
                const c = require('node:crypto');
                return { ...c, default: c };
            }
            if (mod.includes('catalogueDescription')) return catalogueDescription;
            if (mod.includes('catalogue.service')) return catalogueService;
            if (mod.includes('stock-draft.service')) return stockDraftService;
            return require(mod);
        },
        console,
        Buffer,
        ...customContext,
    };
    vm.runInNewContext(transpile(source), context);
    return exports;
}

before(async () => {
    // 1. Create isolated disposable temporary directory and SQLite database
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-stock-st03a-'));
    const dbPath = path.join(temporaryDirectory, 'test-st03a.db').replaceAll('\\', '/');

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
    catalogueDescription = loadModule(path.join(root, 'src/lib/catalogueDescription.ts'));

    // 4. Load catalogue service
    catalogueService = loadModule(path.join(root, 'electron/catalogue.service.ts'));
    await catalogueService.ensureCatalogueSchema(database);

    // 5. Load stock draft service
    stockDraftService = loadModule(path.join(root, 'electron/stock-draft.service.ts'));
    await stockDraftService.ensureStockDraftSchema(database);

    // 6. Seed test users
    adminUser = {
        id: randomUUID(),
        username: 'admin_audit',
        password: 'hash',
        name: 'Admin Auditor',
        role: 'ADMIN',
        isActive: true,
        permManageInventory: true,
        permManageProducts: true,
        permViewCostPrice: true,
    };
    await database.user.create({ data: adminUser });

    cashierUser = {
        id: randomUUID(),
        username: 'cashier_inv',
        password: 'hash',
        name: 'Cashier with Inv',
        role: 'CASHIER',
        isActive: true,
        permManageInventory: true,
        permManageProducts: false,
        permViewCostPrice: false,
    };
    await database.user.create({ data: cashierUser });

    unpermittedUser = {
        id: randomUUID(),
        username: 'cashier_no_inv',
        password: 'hash',
        name: 'Plain Cashier',
        role: 'CASHIER',
        isActive: true,
        permManageInventory: false,
        permManageProducts: false,
        permViewCostPrice: false,
    };
    await database.user.create({ data: unpermittedUser });

    disabledUser = {
        id: randomUUID(),
        username: 'disabled_user',
        password: 'hash',
        name: 'Disabled Staff',
        role: 'CASHIER',
        isActive: false,
        permManageInventory: true,
        permManageProducts: false,
    };
    await database.user.create({ data: disabledUser });
});

after(async () => {
    if (database) await database.$disconnect();
    if (temporaryDirectory && fs.existsSync(temporaryDirectory)) {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});

// Helper to seed a category and prepared product with variants
async function createTestPreparedProduct(name, categoryName, variantsData) {
    let cat = await database.category.findUnique({ where: { name: categoryName } });
    if (!cat) {
        cat = await database.category.create({ data: { name: categoryName } });
    }

    const saveRes = await catalogueService.saveProduct(
        database,
        {
            requestId: randomUUID(),
            name,
            categoryId: cat.id,
            variants: variantsData.map((v) => ({
                ...v,
                mrp: v.mrp || 800,
                sellingPrice: v.sellingPrice || 700,
                costPrice: v.costPrice || 450,
                isActive: true,
            })),
        },
        adminUser
    );

    const prodId = saveRes.id || saveRes.productId;
    return await database.product.findUnique({
        where: { id: prodId },
        include: { variants: true },
    });
}

// -------------------------------------------------------------
// D1: Save/reopen a draft; restart while offline survives
// -------------------------------------------------------------
test('D1: Save and reopen a draft survives connection restart; header, lines, observed time, and draft-only status persist', async () => {
    const prod = await createTestPreparedProduct('Cotton Oxford Shirt', 'Shirts', [
        { barcode: 'D10000000001', sku: 'SKU-D1-1', size: 'M', brand: 'Zain Signature', quality: 'Standard' },
    ]);
    const vId = prod.variants[0].id;

    const opId = randomUUID();
    const draftId = randomUUID();
    const observedAtStr = '2026-10-10T11:30:00.000Z';

    const createRes = await stockDraftService.createDraft(
        database,
        {
            operationId: opId,
            draftId,
            batchDescription: 'Rack B Section 1 - Long Sleeve Shirts',
            observedAt: observedAtStr,
            sourceReference: 'Old audit row 15',
            notes: 'Counted before lunch break',
            lines: [
                {
                    variantId: vId,
                    countedQuantity: 12,
                    notes: 'Hanger 1-12',
                },
            ],
        },
        adminUser
    );

    assert.equal(createRes.success, true);
    assert.equal(createRes.draftId, draftId);
    assert.equal(createRes.revision, 1);
    assert.equal(createRes.status, 'DRAFT');

    // Simulate app restart / fresh SQLite connection
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    const freshDb = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    try {
        const fetched = await stockDraftService.getDraft(freshDb, { draftId }, adminUser);
        assert.equal(fetched.id, draftId);
        assert.equal(fetched.operationKind, 'CONVERSION_ADDITION');
        assert.equal(fetched.status, 'DRAFT');
        assert.equal(fetched.batchDescription, 'Rack B Section 1 - Long Sleeve Shirts');
        assert.equal(fetched.sourceReference, 'Old audit row 15');
        assert.equal(fetched.notes, 'Counted before lunch break');
        assert.equal(new Date(fetched.observedAt).toISOString(), observedAtStr);
        assert.equal(fetched.revision, 1);
        assert.equal(fetched.lines.length, 1);
        assert.equal(fetched.lines[0].variantId, vId);
        assert.equal(fetched.lines[0].countedQuantity, 12);
        assert.equal(fetched.lines[0].snapshot.barcode, 'D10000000001');
        assert.equal(fetched.totalCountedPieces, 12);
        assert.equal(fetched.uncountedLines, 0);

        // Verify ProductVariant live stock remains unchanged (0)
        const liveVariant = await freshDb.productVariant.findUnique({ where: { id: vId } });
        assert.equal(liveVariant.stock, 0);
    } finally {
        await freshDb.$disconnect();
    }
});

// -------------------------------------------------------------
// D2: Two prepared variants sharing name and price remain distinct
// -------------------------------------------------------------
test('D2: Two prepared variants sharing name/price have separate identities; editing one line does not alter catalogue or other variant', async () => {
    const prod = await createTestPreparedProduct('Linen Plain Shirt 700', 'Shirts', [
        { barcode: 'D20000000001', sku: 'SKU-D2-A', size: 'L', brand: 'Zain', quality: 'Premium Linen', sellingPrice: 700 },
        { barcode: 'D20000000002', sku: 'SKU-D2-B', size: 'L', brand: 'Zain', quality: 'Standard Linen', sellingPrice: 700 },
    ]);
    const [vA, vB] = prod.variants;

    const opCreate = randomUUID();
    const draftId = randomUUID();

    await stockDraftService.createDraft(
        database,
        {
            operationId: opCreate,
            draftId,
            batchDescription: 'Identical Name/Price Distinction Batch',
            lines: [
                { variantId: vA.id, countedQuantity: 5 },
                { variantId: vB.id, countedQuantity: 8 },
            ],
        },
        adminUser
    );

    // Edit line 1 count to 15 while keeping line 2 at 8
    const opSave = randomUUID();
    const saveRes = await stockDraftService.saveDraft(
        database,
        {
            operationId: opSave,
            draftId,
            expectedRevision: 1,
            batchDescription: 'Identical Name/Price Distinction Batch',
            lines: [
                { variantId: vA.id, countedQuantity: 15 },
                { variantId: vB.id, countedQuantity: 8 },
            ],
        },
        adminUser
    );
    assert.equal(saveRes.revision, 2);

    const draft = await stockDraftService.getDraft(database, { draftId }, adminUser);
    assert.equal(draft.lines.length, 2);
    const lineA = draft.lines.find((l) => l.variantId === vA.id);
    const lineB = draft.lines.find((l) => l.variantId === vB.id);

    assert.equal(lineA.countedQuantity, 15);
    assert.equal(lineA.snapshot.barcode, 'D20000000001');
    assert.equal(lineB.countedQuantity, 8);
    assert.equal(lineB.snapshot.barcode, 'D20000000002');
    assert.equal(draft.totalCountedPieces, 23);

    // Catalogue records must be completely untouched
    const freshA = await database.productVariant.findUnique({ where: { id: vA.id } });
    const freshB = await database.productVariant.findUnique({ where: { id: vB.id } });
    assert.equal(freshA.stock, 0);
    assert.equal(freshB.stock, 0);
    assert.equal(freshA.barcode, 'D20000000001');
    assert.equal(freshB.barcode, 'D20000000002');
});

// -------------------------------------------------------------
// D3: Save empty/incomplete, blank-count and explicit-zero drafts
// -------------------------------------------------------------
test('D3: Incomplete drafts are durable; blank count is distinct from explicit zero; zero is not an activation', async () => {
    const prod = await createTestPreparedProduct('Checks Poplin Shirt', 'Shirts', [
        { barcode: 'D30000000001', sku: 'SKU-D3-1', size: 'S' },
        { barcode: 'D30000000002', sku: 'SKU-D3-2', size: 'M' },
    ]);
    const [v1, v2] = prod.variants;

    // 1. Empty draft (0 lines)
    const emptyDraftId = randomUUID();
    const emptyRes = await stockDraftService.createDraft(
        database,
        {
            operationId: randomUUID(),
            draftId: emptyDraftId,
            batchDescription: 'Empty batch header prepared in advance',
            lines: [],
        },
        adminUser
    );
    assert.equal(emptyRes.success, true);
    assert.equal(emptyRes.totalLines, 0);

    const fetchedEmpty = await stockDraftService.getDraft(database, { draftId: emptyDraftId }, adminUser);
    assert.equal(fetchedEmpty.totalLines, 0);
    assert.equal(fetchedEmpty.totalCountedPieces, 0);

    // 2. Draft with one blank-count (uncounted) and one explicit-zero count
    const mixedDraftId = randomUUID();
    await stockDraftService.createDraft(
        database,
        {
            operationId: randomUUID(),
            draftId: mixedDraftId,
            batchDescription: 'Mixed Blank and Zero Test Batch',
            lines: [
                { variantId: v1.id, countedQuantity: null, notes: 'Awaiting search on high shelf' },
                { variantId: v2.id, countedQuantity: 0, notes: 'Confirmed no pieces in this section' },
            ],
        },
        adminUser
    );

    const fetchedMixed = await stockDraftService.getDraft(database, { draftId: mixedDraftId }, adminUser);
    assert.equal(fetchedMixed.totalLines, 2);
    assert.equal(fetchedMixed.totalCountedPieces, 0);
    assert.equal(fetchedMixed.uncountedLines, 1);

    const lineBlank = fetchedMixed.lines.find((l) => l.variantId === v1.id);
    const lineZero = fetchedMixed.lines.find((l) => l.variantId === v2.id);

    assert.equal(lineBlank.countedQuantity, null); // Strictly uncounted
    assert.equal(lineZero.countedQuantity, 0); // Explicit zero pieces counted in batch
});

// -------------------------------------------------------------
// D4: Supply negative, fractional, non-finite quantities or nonexistent target IDs
// -------------------------------------------------------------
test('D4: Backend rejects invalid quantities (negative, fractional, NaN) or nonexistent/non-prepared IDs atomically', async () => {
    const prod = await createTestPreparedProduct('Twill Heavy Shirt', 'Shirts', [
        { barcode: 'D40000000001', sku: 'SKU-D4-1', size: 'XL' },
    ]);
    const validVariantId = prod.variants[0].id;

    // Negative count rejected
    await assert.rejects(
        stockDraftService.createDraft(
            database,
            {
                operationId: randomUUID(),
                batchDescription: 'Negative count test',
                lines: [{ variantId: validVariantId, countedQuantity: -3 }],
            },
            adminUser
        ),
        /non-negative whole piece/
    );

    // Fractional count rejected
    await assert.rejects(
        stockDraftService.createDraft(
            database,
            {
                operationId: randomUUID(),
                batchDescription: 'Fractional count test',
                lines: [{ variantId: validVariantId, countedQuantity: 2.5 }],
            },
            adminUser
        ),
        /non-negative whole piece/
    );

    // Non-finite (Infinity) rejected
    await assert.rejects(
        stockDraftService.createDraft(
            database,
            {
                operationId: randomUUID(),
                batchDescription: 'Infinity count test',
                lines: [{ variantId: validVariantId, countedQuantity: Infinity }],
            },
            adminUser
        ),
        /non-negative whole piece/
    );

    // Nonexistent variant ID rejected
    await assert.rejects(
        stockDraftService.createDraft(
            database,
            {
                operationId: randomUUID(),
                batchDescription: 'Nonexistent variant test',
                lines: [{ variantId: 'nonexistent-uuid-9999', countedQuantity: 5 }],
            },
            adminUser
        ),
        /Variant not found/
    );

    // Duplicate variant in same draft rejected
    await assert.rejects(
        stockDraftService.createDraft(
            database,
            {
                operationId: randomUUID(),
                batchDescription: 'Duplicate variant line test',
                lines: [
                    { variantId: validVariantId, countedQuantity: 5 },
                    { variantId: validVariantId, countedQuantity: 3 },
                ],
            },
            adminUser
        ),
        /Duplicate variant line/
    );
});

// -------------------------------------------------------------
// D5: Retry create/save; reuse ID with different content; replay after later edit
// -------------------------------------------------------------
test('D5: Durable replay returns original outcome; different payload with same operationId is rejected; old replay does not overwrite newer state', async () => {
    const prod = await createTestPreparedProduct('Indigo Denim Shirt', 'Shirts', [
        { barcode: 'D50000000001', sku: 'SKU-D5-1', size: 'M' },
    ]);
    const vId = prod.variants[0].id;

    const opCreate = 'durable-op-create-555';
    const draftId = randomUUID();

    const payload = {
        operationId: opCreate,
        draftId,
        batchDescription: 'Durable Idempotency Batch',
        lines: [{ variantId: vId, countedQuantity: 10 }],
    };

    // First create call
    const res1 = await stockDraftService.createDraft(database, payload, adminUser);
    assert.equal(res1.success, true);
    assert.equal(res1.revision, 1);

    // Retry identical create call (simulating lost network response)
    const res2 = await stockDraftService.createDraft(database, payload, adminUser);
    assert.deepEqual(res1, res2);

    // Reusing the same operation ID with a different payload must be rejected
    await assert.rejects(
        stockDraftService.createDraft(
            database,
            {
                ...payload,
                batchDescription: 'Completely altered payload reusing operation ID',
            },
            adminUser
        ),
        /Operation ID was already used for a different draft payload/
    );

    // Save an update to revision 2
    const opSave = 'durable-op-save-777';
    const saveRes = await stockDraftService.saveDraft(
        database,
        {
            operationId: opSave,
            draftId,
            expectedRevision: 1,
            batchDescription: 'Updated Batch Name r2',
            lines: [{ variantId: vId, countedQuantity: 14 }],
        },
        adminUser
    );
    assert.equal(saveRes.revision, 2);

    // Replaying old create operation ID returns the original create result (rev 1)
    const replayCreate = await stockDraftService.createDraft(database, payload, adminUser);
    assert.equal(replayCreate.revision, 1);

    // But the database state remains on revision 2!
    const currentDraft = await stockDraftService.getDraft(database, { draftId }, adminUser);
    assert.equal(currentDraft.revision, 2);
    assert.equal(currentDraft.batchDescription, 'Updated Batch Name r2');
    assert.equal(currentDraft.lines[0].countedQuantity, 14);
});

// -------------------------------------------------------------
// D6: Competing edits on the same revision
// -------------------------------------------------------------
test('D6: Competing edits: first operator succeeds, second operator with stale revision is rejected', async () => {
    const prod = await createTestPreparedProduct('Floral Print Shirt', 'Shirts', [
        { barcode: 'D60000000001', sku: 'SKU-D6-1', size: 'L' },
    ]);
    const vId = prod.variants[0].id;
    const draftId = randomUUID();

    await stockDraftService.createDraft(
        database,
        {
            operationId: randomUUID(),
            draftId,
            batchDescription: 'Concurrency Test Batch',
            lines: [{ variantId: vId, countedQuantity: 4 }],
        },
        adminUser
    );

    // Operator 1 edits revision 1 -> revision 2
    const op1 = randomUUID();
    const res1 = await stockDraftService.saveDraft(
        database,
        {
            operationId: op1,
            draftId,
            expectedRevision: 1,
            batchDescription: 'Operator 1 Update',
            lines: [{ variantId: vId, countedQuantity: 7 }],
        },
        cashierUser
    );
    assert.equal(res1.revision, 2);

    // Operator 2 attempts to save against the stale revision 1
    const op2 = randomUUID();
    await assert.rejects(
        stockDraftService.saveDraft(
            database,
            {
                operationId: op2,
                draftId,
                expectedRevision: 1, // Stale!
                batchDescription: 'Operator 2 Stale Update',
                lines: [{ variantId: vId, countedQuantity: 9 }],
            },
            adminUser
        ),
        /Stale edit/
    );

    // State in DB is preserved from Operator 1
    const latest = await stockDraftService.getDraft(database, { draftId }, adminUser);
    assert.equal(latest.revision, 2);
    assert.equal(latest.batchDescription, 'Operator 1 Update');
    assert.equal(latest.lines[0].countedQuantity, 7);
});

// -------------------------------------------------------------
// D7: Cancel draft, restart/retry, then attempt older edit
// -------------------------------------------------------------
test('D7: Cancellation is terminal; record persists for audit; stale save cannot revive cancelled draft', async () => {
    const prod = await createTestPreparedProduct('Formal White Shirt', 'Shirts', [
        { barcode: 'D70000000001', sku: 'SKU-D7-1', size: '39' },
    ]);
    const vId = prod.variants[0].id;
    const draftId = randomUUID();

    await stockDraftService.createDraft(
        database,
        {
            operationId: randomUUID(),
            draftId,
            batchDescription: 'Terminal Cancellation Batch',
            lines: [{ variantId: vId, countedQuantity: 20 }],
        },
        adminUser
    );

    // Cancel draft at revision 1 -> becomes revision 2
    const cancelOp = 'op-cancel-d7';
    const cancelRes = await stockDraftService.cancelDraft(
        database,
        {
            operationId: cancelOp,
            draftId,
            expectedRevision: 1,
            reason: 'Audit batch damaged in transit',
        },
        adminUser
    );
    assert.equal(cancelRes.status, 'CANCELLED');
    assert.equal(cancelRes.revision, 2);

    // Replay cancellation returns original outcome idempotently
    const cancelReplay = await stockDraftService.cancelDraft(
        database,
        {
            operationId: cancelOp,
            draftId,
            expectedRevision: 1,
            reason: 'Audit batch damaged in transit',
        },
        adminUser
    );
    assert.deepEqual(cancelRes, cancelReplay);

    // Attempting a fresh cancellation on already cancelled draft fails
    await assert.rejects(
        stockDraftService.cancelDraft(
            database,
            {
                operationId: randomUUID(),
                draftId,
                expectedRevision: 2,
            },
            adminUser
        ),
        /Draft is already cancelled/
    );

    // Attempting to edit or save a cancelled draft fails
    await assert.rejects(
        stockDraftService.saveDraft(
            database,
            {
                operationId: randomUUID(),
                draftId,
                expectedRevision: 2,
                batchDescription: 'Attempt to revive',
                lines: [{ variantId: vId, countedQuantity: 25 }],
            },
            adminUser
        ),
        /Cancelled drafts cannot be edited or revived/
    );

    // Cancelled record and lines remain intact in database for audit review
    const cancelledRecord = await stockDraftService.getDraft(database, { draftId }, adminUser);
    assert.equal(cancelledRecord.status, 'CANCELLED');
    assert.equal(cancelledRecord.lines.length, 1);
    assert.equal(cancelledRecord.lines[0].countedQuantity, 20);
});

// -------------------------------------------------------------
// D8: Transaction failure rolls back completely
// -------------------------------------------------------------
test('D8: Mid-transaction failure rolls back header, lines, revision and operation record completely', async () => {
    const prod = await createTestPreparedProduct('Casual Khaki Shirt', 'Shirts', [
        { barcode: 'D80000000001', sku: 'SKU-D8-1', size: 'M' },
    ]);
    const vId = prod.variants[0].id;
    const draftId = randomUUID();

    await stockDraftService.createDraft(
        database,
        {
            operationId: randomUUID(),
            draftId,
            batchDescription: 'Rollback Initial Batch',
            lines: [{ variantId: vId, countedQuantity: 6 }],
        },
        adminUser
    );

    // Attempt a save where line 2 has an invalid quantity (-5), which fails mid-processing
    const failedOpId = randomUUID();
    await assert.rejects(
        stockDraftService.saveDraft(
            database,
            {
                operationId: failedOpId,
                draftId,
                expectedRevision: 1,
                batchDescription: 'Batch name that should not be committed',
                lines: [
                    { variantId: vId, countedQuantity: 10 },
                    { variantId: 'invalid-id-xyz', countedQuantity: -5 },
                ],
            },
            adminUser
        )
    );

    // Verify draft is completely rolled back to revision 1
    const current = await stockDraftService.getDraft(database, { draftId }, adminUser);
    assert.equal(current.revision, 1);
    assert.equal(current.batchDescription, 'Rollback Initial Batch');
    assert.equal(current.lines[0].countedQuantity, 6);

    // Operation record for the failed attempt was not created
    const opRows = await database.$queryRawUnsafe(
        'SELECT * FROM "StockDraftOperation" WHERE "operationId" = ?',
        failedOpId
    );
    assert.equal(opRows.length, 0);
});

// -------------------------------------------------------------
// D9: Unauthorized read/write and cost masking
// -------------------------------------------------------------
test('D8 regression: failure after the first replacement line rolls back real writes and permits the identical operation retry', async () => {
    const prod = await createTestPreparedProduct('Injected Rollback Shirt', 'Shirts', [
        { barcode: 'REVIEW-ROLLBACK-A', sku: 'REVIEW-ROLLBACK-A', size: 'M', fabric: 'Cotton' },
        { barcode: 'REVIEW-ROLLBACK-B', sku: 'REVIEW-ROLLBACK-B', size: 'L', fabric: 'Linen' },
    ]);
    const [variantA, variantB] = prod.variants;
    const created = await stockDraftService.createDraft(database, {
        operationId: randomUUID(), batchDescription: 'Original rollback batch', notes: 'Original header notes',
        lines: [{ variantId: variantA.id, countedQuantity: 4 }, { variantId: variantB.id, countedQuantity: 6 }],
    }, adminUser);
    const original = await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser);
    const headerBefore = JSON.stringify(await database.$queryRawUnsafe('SELECT * FROM "StockCountDraft" WHERE "id" = ?', created.draftId));
    const linesBefore = JSON.stringify(await database.$queryRawUnsafe('SELECT * FROM "StockCountDraftLine" WHERE "draftId" = ? ORDER BY "id"', created.draftId));
    const protectedBefore = await protectedRecordState();
    const saveInput = {
        operationId: randomUUID(), draftId: created.draftId, expectedRevision: 1,
        batchDescription: 'Updated rollback batch', notes: 'Updated header notes',
        lines: original.lines.map((line, index) => ({ id: line.id, variantId: line.variantId,
            countedQuantity: index === 0 ? 14 : 16, notes: `Updated line ${index + 1}` })),
    };
    let injectedFailures = 0;
    const failingPrisma = new Proxy(database, {
        get(target, property) {
            if (property === '$transaction') {
                return (callback, options) => target.$transaction(tx => callback(new Proxy(tx, {
                    get(transaction, transactionProperty) {
                        if (transactionProperty === '$executeRawUnsafe') {
                            return async (sql, ...parameters) => {
                                const result = await transaction.$executeRawUnsafe(sql, ...parameters);
                                if (sql.includes('INSERT INTO "StockCountDraftLine"')) {
                                    // Verify that actual header, deletion and first replacement writes
                                    // have happened inside SQLite before injecting the failure.
                                    const [header] = await transaction.$queryRawUnsafe('SELECT "revision" FROM "StockCountDraft" WHERE "id" = ?', created.draftId);
                                    const replacementLines = await transaction.$queryRawUnsafe('SELECT "countedQuantity" FROM "StockCountDraftLine" WHERE "draftId" = ?', created.draftId);
                                    assert.equal(Number(header.revision), 2);
                                    assert.equal(replacementLines.length, 1);
                                    assert.equal(Number(replacementLines[0].countedQuantity), 14);
                                    injectedFailures++;
                                    throw new Error('Injected failure after first replacement line');
                                }
                                return result;
                            };
                        }
                        const value = Reflect.get(transaction, transactionProperty);
                        return typeof value === 'function' ? value.bind(transaction) : value;
                    },
                })), options);
            }
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });

    await assert.rejects(stockDraftService.saveDraft(failingPrisma, saveInput, adminUser), /Injected failure after first replacement line/);
    assert.equal(injectedFailures, 1, 'The failure must happen after an actual replacement insert');
    assert.equal(JSON.stringify(await database.$queryRawUnsafe('SELECT * FROM "StockCountDraft" WHERE "id" = ?', created.draftId)), headerBefore);
    assert.equal(JSON.stringify(await database.$queryRawUnsafe('SELECT * FROM "StockCountDraftLine" WHERE "draftId" = ? ORDER BY "id"', created.draftId)), linesBefore);
    assert.equal((await database.$queryRawUnsafe('SELECT * FROM "StockDraftOperation" WHERE "operationId" = ?', saveInput.operationId)).length, 0);
    assert.deepEqual(await protectedRecordState(), protectedBefore);

    // Same payload, revision and operation ID are retried against the real client.
    const saved = await stockDraftService.saveDraft(database, saveInput, adminUser);
    assert.equal(saved.revision, 2);
    const current = await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser);
    assert.equal(current.batchDescription, saveInput.batchDescription);
    assert.equal(current.notes, saveInput.notes);
    for (const oldLine of original.lines) {
        const line = current.lines.find(item => item.id === oldLine.id);
        const intended = saveInput.lines.find(item => item.id === oldLine.id);
        assert.ok(line, 'Original stable line ID survives retry');
        assert.equal(line.countedQuantity, intended.countedQuantity);
        assert.equal(line.notes, intended.notes);
        assert.equal(JSON.stringify(line.snapshot), JSON.stringify(oldLine.snapshot));
    }
    assert.equal((await database.$queryRawUnsafe('SELECT * FROM "StockDraftOperation" WHERE "operationId" = ?', saveInput.operationId)).length, 1);
    assert.deepEqual(await protectedRecordState(), protectedBefore);
});

test('D9: Unauthorized users without permManageInventory are denied; costs are strictly omitted', async () => {
    // 1. Plain cashier without permManageInventory is rejected
    await assert.rejects(
        stockDraftService.listDrafts(database, {}, unpermittedUser),
        /Permission Denied/
    );

    await assert.rejects(
        stockDraftService.createDraft(
            database,
            {
                operationId: randomUUID(),
                batchDescription: 'Unauthorized Draft',
                lines: [],
            },
            unpermittedUser
        ),
        /Permission Denied/
    );

    // 2. Disabled user is rejected
    await assert.rejects(
        stockDraftService.listDrafts(database, {}, disabledUser),
        /Permission Denied/
    );

    // 3. Authorized searchVariants returns NO costPrice
    const results = await stockDraftService.searchPreparedVariants(database, { search: 'Shirt' }, cashierUser);
    assert.ok(results.length > 0);
    for (const item of results) {
        assert.equal(item.costPrice, undefined);
    }

    // 4. Authorized getDraft returns NO costPrice in lines or snapshots
    const draftList = await stockDraftService.listDrafts(database, {}, cashierUser);
    if (draftList.items.length > 0) {
        const d = await stockDraftService.getDraft(database, { draftId: draftList.items[0].id }, cashierUser);
        for (const line of d.lines) {
            assert.equal(line.snapshot.costPrice, undefined);
            assert.equal(line.currentLiveDetails?.costPrice, undefined);
        }
    }
});

// -------------------------------------------------------------
// D10: Catalogue rename/deactivation detected without silent substitution
// -------------------------------------------------------------
test('D10: Catalogue changes/deactivation are flagged as review items; original snapshot is preserved without silent substitution', async () => {
    const prod = await createTestPreparedProduct('Original Garment Name', 'Shirts', [
        { barcode: 'D100000000001', sku: 'SKU-D10-1', size: '38' },
    ]);
    const v = prod.variants[0];
    const draftId = randomUUID();

    await stockDraftService.createDraft(
        database,
        {
            operationId: randomUUID(),
            draftId,
            batchDescription: 'Catalogue Review Status Batch',
            lines: [{ variantId: v.id, countedQuantity: 7 }],
        },
        adminUser
    );

    // Verify initial snapshot status is OK
    let draft = await stockDraftService.getDraft(database, { draftId }, adminUser);
    assert.equal(draft.lines[0].catalogueStatus, 'OK');
    assert.equal(draft.lines[0].snapshot.productName, 'Original Garment Name');

    // Deactivate product in catalogue
    await database.product.update({
        where: { id: prod.id },
        data: { isActive: false },
    });

    // Re-fetch draft: status must be UNAVAILABLE, never silently substituted
    draft = await stockDraftService.getDraft(database, { draftId }, adminUser);
    assert.equal(draft.lines[0].catalogueStatus, 'UNAVAILABLE');
    assert.equal(draft.lines[0].snapshot.productName, 'Original Garment Name');
    assert.match(draft.lines[0].statusMessage, /deactivated or unavailable/);
});

// -------------------------------------------------------------
// D11: Invariant: Draft actions change NO live stock, preparation, movements, sales, or cash
// -------------------------------------------------------------
test('D10 regression: count/note saves preserve the original snapshot, stable line ID and creation time after catalogue changes', async () => {
    const prod = await createTestPreparedProduct('Snapshot Original Shirt', 'Shirts', [{
        barcode: 'REVIEW-SNAPSHOT-1', sku: 'REVIEW-SNAPSHOT-1', size: 'M', color: 'Blue',
        brand: 'Original Brand', fabric: 'Cotton', quality: 'Standard', pattern: 'Checks',
        sleeve: 'Full', fit: 'Slim', collar: 'Regular', pocket: 'Single', styleRef: 'Model A',
    }]);
    const variant = prod.variants[0];
    const created = await stockDraftService.createDraft(database, {
        operationId: randomUUID(), batchDescription: 'Snapshot preservation batch',
        lines: [{ variantId: variant.id, countedQuantity: 4 }],
    }, adminUser);
    const original = await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser);
    const originalLine = original.lines[0];
    await database.$executeRawUnsafe('UPDATE "StockCountDraftLine" SET "createdAt" = ? WHERE "id" = ?',
        '2020-01-02T03:04:05.000Z', originalLine.id);
    const [originalRow] = await database.$queryRawUnsafe('SELECT * FROM "StockCountDraftLine" WHERE "id" = ?', originalLine.id);

    await database.product.update({ where: { id: prod.id }, data: { name: 'Snapshot Renamed Shirt' } });
    await database.productVariant.update({ where: { id: variant.id }, data: { size: 'L', color: 'Green', sellingPrice: 750 } });
    await database.$executeRawUnsafe('UPDATE "ProductVariantGarmentDetail" SET "quality" = ?, "fabric" = ?, "formattedDescription" = NULL WHERE "variantId" = ?',
        'Premium', 'Linen', variant.id);
    const changed = await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser);
    assert.equal(changed.lines[0].catalogueStatus, 'CHANGED');
    for (const message of ['Name changed', 'Size changed', 'colour changed', 'Selling price changed', 'Quality changed', 'Fabric changed']) {
        assert.ok(changed.lines[0].statusMessage.includes(message), message);
    }
    for (const detail of ['Linen', 'Checks', 'Full', 'Slim', 'Collar: Regular', 'Pocket: Single']) {
        assert.ok(changed.lines[0].currentLiveDetails.formattedDescription.includes(detail), detail);
    }
    const protectedBefore = await protectedRecordState();
    const save = {
        operationId: randomUUID(), draftId: created.draftId, expectedRevision: 1,
        batchDescription: original.batchDescription,
        lines: [{ id: originalLine.id, variantId: variant.id, countedQuantity: 6, notes: 'Recheck physical identity' }],
    };
    await stockDraftService.saveDraft(database, save, adminUser);
    const saved = await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser);
    const [savedRow] = await database.$queryRawUnsafe('SELECT * FROM "StockCountDraftLine" WHERE "id" = ?', originalLine.id);
    assert.equal(saved.lines[0].id, originalLine.id);
    assert.equal(saved.lines[0].countedQuantity, 6);
    assert.equal(saved.lines[0].notes, 'Recheck physical identity');
    assert.equal(JSON.stringify(saved.lines[0].snapshot), JSON.stringify(originalLine.snapshot));
    assert.equal(saved.lines[0].catalogueStatus, 'CHANGED');
    assert.equal(savedRow.snapshotAttributes, originalRow.snapshotAttributes);
    assert.equal(new Date(savedRow.createdAt).toISOString(), new Date(originalRow.createdAt).toISOString());

    // Omitting a line ID cannot replace it or refresh the captured identity either.
    await stockDraftService.saveDraft(database, {
        ...save, operationId: randomUUID(), expectedRevision: 2,
        lines: [{ variantId: variant.id, countedQuantity: 6, notes: 'Recheck physical identity' }],
    }, adminUser);
    const unchanged = await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser);
    assert.equal(unchanged.lines[0].id, originalLine.id);
    assert.equal(JSON.stringify(unchanged.lines[0].snapshot), JSON.stringify(originalLine.snapshot));
    assert.deepEqual(await protectedRecordState(), protectedBefore);
});

test('D10 regression: every garment attribute, size, colour, price and preparation change is flagged even with a stale cached description', async () => {
    const attributes = { brand: 'Brand A', fabric: 'Cotton', quality: 'Cotton', pattern: 'Plain', sleeve: 'Full',
        fit: 'Regular', collar: 'Regular', pocket: 'Single', styleRef: 'Model A' };
    const prod = await createTestPreparedProduct('Attribute Review Shirt', 'Shirts', [{
        barcode: 'REVIEW-ATTRIBUTES-1', sku: 'REVIEW-ATTRIBUTES-1', size: 'M', color: 'Blue', ...attributes,
    }]);
    const variant = prod.variants[0];
    const created = await stockDraftService.createDraft(database, {
        operationId: randomUUID(), batchDescription: 'Full metadata review', lines: [{ variantId: variant.id, countedQuantity: 2 }],
    }, adminUser);
    for (const [field, originalValue] of Object.entries(attributes)) {
        // Field names are this test's fixed synthetic garment attribute list.
        await database.$executeRawUnsafe(`UPDATE "ProductVariantGarmentDetail" SET "${field}" = ? WHERE "variantId" = ?`, `Changed ${field}`, variant.id);
        const changed = await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser);
        assert.equal(changed.lines[0].catalogueStatus, 'CHANGED', field);
        const label = field === 'styleRef' ? 'Style/model reference' : field[0].toUpperCase() + field.slice(1);
        assert.ok(changed.lines[0].statusMessage.includes(`${label} changed`), field);
        await database.$executeRawUnsafe(`UPDATE "ProductVariantGarmentDetail" SET "${field}" = ? WHERE "variantId" = ?`, originalValue, variant.id);
        assert.equal((await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser)).lines[0].catalogueStatus, 'OK', field);
    }
    for (const [field, replacement, expected] of [['size', 'XL', 'Size changed'], ['color', 'Black', 'colour changed'], ['sellingPrice', 725, 'Selling price changed']]) {
        await database.productVariant.update({ where: { id: variant.id }, data: { [field]: replacement } });
        const changed = await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser);
        assert.equal(changed.lines[0].catalogueStatus, 'CHANGED');
        assert.ok(changed.lines[0].statusMessage.includes(expected));
        await database.productVariant.update({ where: { id: variant.id }, data: { [field]: variant[field] } });
    }
    await database.$executeRawUnsafe('UPDATE "ProductVariant" SET "isPrepared" = 0 WHERE "id" = ?', variant.id);
    await database.$executeRawUnsafe('UPDATE "ProductVariantGarmentDetail" SET "isPrepared" = 0 WHERE "variantId" = ?', variant.id);
    const changed = await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser);
    assert.equal(changed.lines[0].catalogueStatus, 'CHANGED');
    assert.match(changed.lines[0].statusMessage, /Preparation status changed/);
    assert.equal(changed.lines[0].currentLiveDetails.isPrepared, false);
    await stockDraftService.saveDraft(database, {
        operationId: randomUUID(), draftId: created.draftId, expectedRevision: 1, batchDescription: 'Full metadata review',
        lines: [{ id: changed.lines[0].id, variantId: variant.id, countedQuantity: 3 }],
    }, adminUser);
    assert.equal((await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser)).lines[0].catalogueStatus, 'CHANGED');
});

test('D10 regression: unavailable existing lines remain editable, but unavailable new lines are rejected', async () => {
    const prod = await createTestPreparedProduct('Unavailable Review Shirt', 'Shirts', [{ barcode: 'REVIEW-INACTIVE-1', sku: 'REVIEW-INACTIVE-1', size: 'M' }]);
    const variant = prod.variants[0];
    const created = await stockDraftService.createDraft(database, {
        operationId: randomUUID(), batchDescription: 'Unavailable item review', lines: [{ variantId: variant.id, countedQuantity: 4 }],
    }, adminUser);
    const original = await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser);
    await database.product.update({ where: { id: prod.id }, data: { isActive: false } });
    const protectedBefore = await protectedRecordState();
    await stockDraftService.saveDraft(database, {
        operationId: randomUUID(), draftId: created.draftId, expectedRevision: 1, batchDescription: 'Unavailable item review',
        lines: [{ id: original.lines[0].id, variantId: variant.id, countedQuantity: null, notes: 'Needs identification' }],
    }, adminUser);
    const saved = await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser);
    assert.equal(saved.lines[0].catalogueStatus, 'UNAVAILABLE');
    assert.equal(saved.lines[0].countedQuantity, null);
    assert.equal(saved.lines[0].notes, 'Needs identification');
    assert.equal(JSON.stringify(saved.lines[0].snapshot), JSON.stringify(original.lines[0].snapshot));
    const empty = await stockDraftService.createDraft(database, { operationId: randomUUID(), batchDescription: 'Empty rejection batch' }, adminUser);
    await assert.rejects(stockDraftService.saveDraft(database, {
        operationId: randomUUID(), draftId: empty.draftId, expectedRevision: 1, batchDescription: 'Empty rejection batch',
        lines: [{ variantId: variant.id, countedQuantity: 1 }],
    }, adminUser), /inactive/);
    assert.equal((await stockDraftService.getDraft(database, { draftId: empty.draftId }, adminUser)).revision, 1);
    assert.deepEqual(await protectedRecordState(), protectedBefore);
});

test('D2 regression: existing line IDs cannot be reassigned/replaced; genuinely new lines capture trusted current details', async () => {
    const prod = await createTestPreparedProduct('Line Identity Shirt', 'Shirts', [
        { barcode: 'REVIEW-LINE-A', sku: 'REVIEW-LINE-A', size: 'M', fabric: 'Cotton' },
        { barcode: 'REVIEW-LINE-B', sku: 'REVIEW-LINE-B', size: 'L', fabric: 'Linen', pattern: 'Stripes' },
    ]);
    const [variantA, variantB] = prod.variants;
    const created = await stockDraftService.createDraft(database, {
        operationId: randomUUID(), batchDescription: 'Line identity batch', lines: [{ variantId: variantA.id, countedQuantity: 2 }],
    }, adminUser);
    const original = await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser);
    const base = { draftId: created.draftId, expectedRevision: 1, batchDescription: 'Line identity batch' };
    await assert.rejects(stockDraftService.saveDraft(database, { ...base, operationId: randomUUID(),
        lines: [{ id: original.lines[0].id, variantId: variantB.id, countedQuantity: 2 }],
    }, adminUser), /cannot be reassigned/);
    await assert.rejects(stockDraftService.saveDraft(database, { ...base, operationId: randomUUID(),
        lines: [{ id: randomUUID(), variantId: variantA.id, countedQuantity: 2 }],
    }, adminUser), /line ID cannot be replaced/);
    assert.equal((await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser)).revision, 1);
    // Remove the cached description to verify the complete trusted fallback on newly added lines.
    await database.$executeRawUnsafe('UPDATE "ProductVariantGarmentDetail" SET "formattedDescription" = NULL WHERE "variantId" = ?', variantB.id);
    const newLineId = randomUUID();
    await stockDraftService.saveDraft(database, { ...base, operationId: randomUUID(), lines: [
        { id: original.lines[0].id, variantId: variantA.id, countedQuantity: 2 },
        { id: newLineId, variantId: variantB.id, countedQuantity: 5, snapshotDescription: 'Forged renderer snapshot' },
    ] }, adminUser);
    const saved = await stockDraftService.getDraft(database, { draftId: created.draftId }, adminUser);
    const newLine = saved.lines.find(line => line.variantId === variantB.id);
    assert.equal(newLine.id, newLineId);
    assert.equal(newLine.snapshot.barcode, variantB.barcode);
    assert.match(newLine.snapshot.description, /Linen/);
    assert.match(newLine.snapshot.description, /Stripes/);
    assert.equal(newLine.catalogueStatus, 'OK');
    assert.equal(saved.lines.find(line => line.variantId === variantA.id).id, original.lines[0].id);
});

test('D10 schema upgrade: add structured snapshots without rewriting existing draft evidence', async () => {
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    const upgradePath = path.join(temporaryDirectory, 'old-draft-upgrade.db').replaceAll('\\', '/');
    const oldDb = new PrismaClient({ datasources: { db: { url: `file:${upgradePath}` } } });
    try {
        await oldDb.$executeRawUnsafe('CREATE TABLE "ProductVariant" ("id" TEXT NOT NULL PRIMARY KEY)');
        await oldDb.$executeRawUnsafe('CREATE TABLE "StockCountDraftLine" ("id" TEXT NOT NULL PRIMARY KEY, "draftId" TEXT NOT NULL, "variantId" TEXT NOT NULL, "snapshotDescription" TEXT, "snapshotSize" TEXT, "snapshotSellingPrice" REAL, "createdAt" DATETIME)');
        await oldDb.$executeRawUnsafe('INSERT INTO "StockCountDraftLine" ("id", "draftId", "variantId", "snapshotDescription", "snapshotSize", "snapshotSellingPrice", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
            'old-line', 'old-draft', 'old-variant', 'Original counted garment', 'M', 700, '2020-01-02T03:04:05.000Z');
        await stockDraftService.ensureStockDraftSchema(oldDb);
        const columns = await oldDb.$queryRawUnsafe('PRAGMA table_info("StockCountDraftLine")');
        assert.ok(columns.some(column => column.name === 'snapshotAttributes'));
        const [line] = await oldDb.$queryRawUnsafe('SELECT * FROM "StockCountDraftLine" WHERE "id" = ?', 'old-line');
        assert.equal(line.snapshotAttributes, null, 'Historical attributes are unknown, not copied from current catalogue');
        assert.equal(line.snapshotDescription, 'Original counted garment');
        assert.equal(line.snapshotSize, 'M');
        assert.equal(line.snapshotSellingPrice, 700);
        assert.equal(new Date(line.createdAt).toISOString(), '2020-01-02T03:04:05.000Z');
    } finally {
        await oldDb.$disconnect();
    }
});

async function protectedRecordState() {
    const variants = await database.$queryRawUnsafe('SELECT "id", "stock", "isPrepared" FROM "ProductVariant" ORDER BY "id"');
    const result = { variants: JSON.stringify(variants) };
    for (const table of ['InventoryMovement', 'Sale', 'SaleItem', 'Refund', 'RefundItem', 'RefundPayment', 'Exchange', 'ExchangeItem', 'ExchangePayment', 'CashTransaction', 'CashRegisterSession']) {
        const [row] = await database.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM "${table}"`);
        result[table] = Number(row.total);
    }
    return result;
}

test('D11: Draft create, save, and cancel change zero stock, movements, sales, or register records', async () => {
    const prod = await createTestPreparedProduct('Invariant Check Shirt', 'Shirts', [
        { barcode: 'D110000000001', sku: 'SKU-D11-1', size: 'M' },
    ]);
    const vId = prod.variants[0].id;

    // Snapshot database table counts and live stock before draft actions
    const stockBefore = (await database.productVariant.findUnique({ where: { id: vId } })).stock;
    const movementsBefore = await database.inventoryMovement.count();
    const salesBefore = await database.sale.count();

    const draftId = randomUUID();

    // 1. Create draft
    await stockDraftService.createDraft(
        database,
        {
            operationId: randomUUID(),
            draftId,
            batchDescription: 'Invariant Batch',
            lines: [{ variantId: vId, countedQuantity: 100 }],
        },
        adminUser
    );

    // 2. Save draft
    await stockDraftService.saveDraft(
        database,
        {
            operationId: randomUUID(),
            draftId,
            expectedRevision: 1,
            batchDescription: 'Invariant Batch Updated',
            lines: [{ variantId: vId, countedQuantity: 250 }],
        },
        adminUser
    );

    // 3. Cancel draft
    await stockDraftService.cancelDraft(
        database,
        {
            operationId: randomUUID(),
            draftId,
            expectedRevision: 2,
        },
        adminUser
    );

    // Verify after all actions: live stock, movements, sales are completely unchanged!
    const stockAfter = (await database.productVariant.findUnique({ where: { id: vId } })).stock;
    const movementsAfter = await database.inventoryMovement.count();
    const salesAfter = await database.sale.count();

    assert.equal(stockBefore, stockAfter, 'Stock must remain 0');
    assert.equal(movementsBefore, movementsAfter, 'Movements count must be unchanged');
    assert.equal(salesBefore, salesAfter, 'Sales count must be unchanged');
});

// -------------------------------------------------------------
// D12: Observed counts remain distinct from live stock & cloud sync
// -------------------------------------------------------------
test('D12: Observed draft counts remain local; no cloud sync flags or activation triggered', async () => {
    const prod = await createTestPreparedProduct('Local Draft Only Garment', 'Shirts', [
        { barcode: 'D120000000001', sku: 'SKU-D12-1', size: 'XL' },
    ]);
    const vId = prod.variants[0].id;

    const draftId = randomUUID();
    await stockDraftService.createDraft(
        database,
        {
            operationId: randomUUID(),
            draftId,
            batchDescription: 'Local Isolation Draft',
            lines: [{ variantId: vId, countedQuantity: 42 }],
        },
        adminUser
    );

    // Check ProductVariant and Product isSynced columns
    const pv = await database.productVariant.findUnique({
        where: { id: vId },
        include: { product: true },
    });

    // Variant stock is still 0, not 42
    assert.equal(pv.stock, 0);

    // Stock count drafts do not mutate isSynced on the product or variants
    assert.equal(pv.product.isSynced, false);
});
