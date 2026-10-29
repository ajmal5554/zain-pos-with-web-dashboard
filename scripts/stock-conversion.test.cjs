const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const id = () => crypto.randomUUID();
let database, directory, databaseUrl, description, catalogue, drafts, conversion, category, admin, inventory, cashier, disabled;

function load(relative, overrides = {}) {
    const module = { exports: {} };
    const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(compiled, {
        module, exports: module.exports, Buffer, console,
        require(name) {
            if (Object.hasOwn(overrides, name)) return overrides[name];
            if (name.includes('catalogueDescription')) return description;
            if (name.includes('catalogue.service')) return catalogue;
            if (name.includes('stock-draft.service')) return drafts;
            if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(path.join(root, relative)), name + '.ts')), overrides);
            return require(name);
        },
    }, { filename: relative });
    return module.exports;
}

before(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-conversion-test-'));
    databaseUrl = `file:${path.join(directory, 'conversion.db').replaceAll('\\', '/')}`;
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const sql = execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'prisma/generated/client/schema.prisma'), '--script'], { encoding: 'utf8', cwd: root });
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await database.$executeRawUnsafe(statement);
    description = load('src/lib/catalogueDescription.ts');
    catalogue = load('electron/catalogue.service.ts');
    drafts = load('electron/stock-draft.service.ts');
    conversion = load('electron/stock-conversion.service.ts');
    category = await database.category.create({ data: { name: 'Conversion Shirts' } });
    async function user(name, extra) {
        return database.user.create({ data: { username: name, password: 'fixture-hash', name, role: 'CASHIER', isActive: true, ...extra } });
    }
    admin = await user('conversion-admin', { role: 'ADMIN', permManageInventory: true, permManageProducts: true });
    inventory = await user('conversion-stock', { permManageInventory: true, permManageProducts: false });
    cashier = await user('conversion-cashier', { permManageInventory: false, permManageProducts: false });
    disabled = await user('conversion-disabled', { isActive: false, permManageInventory: true, permManageProducts: true });
});
after(async () => {
    await database?.$disconnect();
    if (directory) {
        const absolute = path.resolve(directory);
        assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep));
        assert.ok(path.basename(absolute).startsWith('zain-conversion-test-'));
        fs.rmSync(absolute, { recursive: true, force: true });
    }
});

function row(sourceId = id(), size = 'XL', count = 10, extra = {}) {
    return { id: sourceId, sourceRow: 2, name: 'Shirt 700', barcode: '4649396', size, category: 'Shirt', brand: 'Crazy Heart', mrp: 700,
        countedQuantity: count, attributes: { fabric: 'Cotton', quality: 'Standard', pattern: 'Checks', sleeve: 'Full Sleeve', subtype: 'F/S', border: null }, lastUpdated: null, ...extra };
}
function selection(rows = [row()]) {
    return { operationId: id(), fileHash: 'a'.repeat(64), fileName: 'synthetic-audit.xlsx', rowIds: rows.map(value => value.id), rows,
        productName: 'Shirt 700', categoryId: category.id, taxRate: 5, styleConfirmed: true };
}
function post(draftId, extra = {}) {
    return { operationId: id(), draftId, expectedRevision: 1, held: true, labelsApplied: true, countsChecked: true, ...extra };
}
async function prepared(rows) {
    const input = selection(rows);
    return { input, result: await conversion.prepareAuditStyle(database, input, admin) };
}
async function active(count = 10) {
    const { result } = await prepared([row(id(), 'XL', count)]);
    await conversion.postStockBatch(database, post(result.draftId), admin);
    return result;
}
async function stock(variantId) { return (await database.productVariant.findUnique({ where: { id: variantId } })).stock; }
async function raw(table, where = '', ...params) { return database.$queryRawUnsafe(`SELECT * FROM "${table}" ${where}`, ...params); }
function failingAudit(action) {
    return new Proxy(database, { get(target, key) {
        if (key === '$transaction') return (callback, options) => target.$transaction(tx => callback(new Proxy(tx, { get(transaction, model) {
            if (model === 'auditLog') return { ...transaction.auditLog, create: async args => {
                if (args.data.action === action) throw new Error('Synthetic audit write failure');
                return transaction.auditLog.create(args);
            } };
            const value = transaction[model]; return typeof value === 'function' ? value.bind(transaction) : value;
        } })), options);
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
}

test('preparation creates one zero-stock product style, distinct short codes and a durable blank-preserving draft', async () => {
    const original = await database.product.create({ data: { name: 'Shirt 700', categoryId: category.id, variants: { create: { sku: id(), barcode: '4649396', size: 'Standard', mrp: 700, sellingPrice: 700, costPrice: 400, stock: -7 } } }, include: { variants: true } });
    const { result } = await prepared([row(id(), 'XL', 10), row(id(), 'M', null)]);
    assert.notEqual(result.productId, original.id);
    const variants = await database.productVariant.findMany({ where: { productId: result.productId } });
    assert.equal(variants.length, 2);
    assert.equal(new Set(variants.map(value => value.barcode)).size, 2);
    assert.ok(variants.every(value => /^\d{6}$/.test(value.barcode) && value.stock === 0 && value.barcode !== '4649396'));
    assert.equal(await stock(original.variants[0].id), -7);
    const flags = await raw('ProductVariant', 'WHERE "productId" = ?', result.productId);
    assert.ok(flags.every(value => value.isPrepared === 1));
    assert.equal((await raw('StockVariantTracking', 'WHERE "variantId" = ?', result.variantIds[0])).length, 0);
    const saved = await drafts.getDraft(database, { draftId: result.draftId }, inventory);
    assert.equal(saved.lines[0].countedQuantity, 10);
    assert.equal(saved.lines[1].countedQuantity, null);
    assert.equal(saved.uncountedLines, 1);
    assert.equal((await raw('StockAuditRowMapping', 'WHERE "draftId" = ?', result.draftId)).length, 2);
    const evidence = await raw('StockCountDraftLine', 'WHERE "draftId" = ?', result.draftId);
    assert.equal(evidence[0].snapshotCategoryId, category.id);
    assert.equal(Number(evidence[0].snapshotMrp), 700);
    const metadata = JSON.parse(evidence[0].snapshotMetadata);
    assert.equal(metadata.subtype, 'F/S');
    assert.equal(metadata.fabric, 'Cotton');
    assert.equal((await database.inventoryMovement.findMany({ where: { variantId: { in: result.variantIds } } })).length, 0);
});

test('prepare replay is durable, payload conflicts reject and re-uploaded mapped IDs navigate to the existing batch', async () => {
    const { input, result } = await prepared();
    assert.deepEqual(clone(await conversion.prepareAuditStyle(database, input, admin)), clone(result));
    await assert.rejects(conversion.prepareAuditStyle(database, { ...input, productName: 'Different style' }, admin), /Operation ID was already used/);
    const reupload = { ...input, operationId: id(), fileHash: 'b'.repeat(64), fileName: 'new-audit.xlsx' };
    await assert.rejects(conversion.prepareAuditStyle(database, reupload, admin), error => error.message.includes('already prepared') && error.message.includes(result.draftId));
    assert.equal((await raw('StockAuditRowMapping', 'WHERE "sourceRowId" = ?', input.rowIds[0])).length, 1);
});

test('preparation never auto-merges incompatible styles, repeated sizes or unconfirmed selections', async () => {
    const valid = row(), other = row(id(), 'M');
    for (const altered of [
        { ...other, mrp: 800 }, { ...other, brand: 'Different' }, { ...other, category: 'Pant' },
        { ...other, size: ' xl ' }, { ...other, size: null },
        { ...other, attributes: { ...other.attributes, quality: 'Premium' } },
        { ...other, attributes: { ...other.attributes, border: 'Wide' } },
    ]) await assert.rejects(conversion.prepareAuditStyle(database, selection([valid, altered]), admin), /differ|distinct|reviewed size/);
    await assert.rejects(conversion.prepareAuditStyle(database, selection([row(id(), 'XL', 0)]), admin), /zero counted pieces/);
    const before = await database.product.count();
    await assert.rejects(conversion.prepareAuditStyle(database, { ...selection(), styleConfirmed: false }, admin), /Confirm/);
    const bad = selection(); bad.rowIds.push('not-in-saved-audit');
    await assert.rejects(conversion.prepareAuditStyle(database, bad, admin), /Select between/);
    assert.equal(await database.product.count(), before);
});

test('a no-size accessory can be prepared and activated without inventing a shirt size', async () => {
    const accessories = await database.category.create({ data: { name: 'Conversion Accessories' } });
    const input = selection([row(id(), null, 3, {
        name: 'Belt', category: 'Accessories', brand: null, mrp: 250,
        attributes: { material: 'Leather', subtype: 'Belt', sleeve: null, fabric: null },
    })]);
    input.productName = 'Leather Belt';
    input.categoryId = accessories.id;
    const result = await conversion.prepareAuditStyle(database, input, admin);
    const saved = await drafts.getDraft(database, { draftId: result.draftId }, inventory);
    assert.equal(saved.lines[0].snapshot.size, null);
    assert.equal(saved.lines[0].catalogueStatus, 'OK');
    await conversion.postStockBatch(database, post(result.draftId), inventory);
    const variant = await database.productVariant.findUnique({ where: { id: result.variantIds[0] } });
    assert.equal(variant.size, null);
    assert.equal(variant.stock, 3);
    assert.match(variant.barcode, /^\d{6}$/);
    const detail = (await raw('ProductVariantGarmentDetail', 'WHERE "variantId" = ?', variant.id))[0];
    assert.equal(JSON.parse(detail.metadata).material, 'Leather');
});

test('reviewed new audit categories are created atomically and replay never duplicates them', async () => {
    const input = { ...selection(), categoryId: '', categoryName: '  Audit   Kidswear  ' };
    const result = await conversion.prepareAuditStyle(database, input, admin);
    const product = await database.product.findUnique({ where: { id: result.productId }, include: { category: true } });
    assert.equal(product.category.name, 'Audit Kidswear');
    assert.deepEqual(clone(await conversion.prepareAuditStyle(database, input, admin)), clone(result));
    assert.equal(await database.category.count({ where: { name: 'Audit Kidswear' } }), 1);
    const second = await conversion.prepareAuditStyle(database, { ...selection(), categoryId: '', categoryName: 'audit kidswear' }, admin);
    assert.equal((await database.product.findUnique({ where: { id: second.productId } })).categoryId, product.categoryId);
    await conversion.postStockBatch(database, post(result.draftId), inventory);
    assert.equal(await stock(result.variantIds[0]), 10);
});

test('ambiguous, missing or conflicting reviewed categories cannot create partially prepared stock', async () => {
    const initialProducts = await database.product.count();
    for (const extra of [ { categoryId: '' }, { categoryName: 'Another category' }, { categoryId: 'not-present' } ]) {
        await assert.rejects(conversion.prepareAuditStyle(database, { ...selection(), ...extra }, admin), /category/i);
    }
    await database.category.create({ data: { name: 'Duplicate Audit category' } });
    await database.category.create({ data: { name: 'duplicate audit CATEGORY' } });
    await assert.rejects(conversion.prepareAuditStyle(database, { ...selection(), categoryId: '', categoryName: 'Duplicate audit category' }, admin), /More than one existing category/);
    assert.equal(await database.product.count(), initialProducts);
    const rollback = { ...selection(), categoryId: '', categoryName: 'Rolled back audit category' };
    await assert.rejects(conversion.prepareAuditStyle(failingAudit('STOCK_AUDIT_PREPARED'), rollback, admin), /Synthetic audit write failure/);
    assert.equal(await database.category.count({ where: { name: rollback.categoryName } }), 0);
    assert.equal((await raw('StockAuditRowMapping', 'WHERE "sourceRowId" = ?', rollback.rowIds[0])).length, 0);
    assert.equal(await database.product.count(), initialProducts);
});

test('Excel progress is read-only on an untouched database and does not expose progress to cashiers', async () => {
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    const untouched = new PrismaClient({ datasources: { db: { url: `file:${path.join(directory, 'untouched.db').replaceAll('\\', '/')}` } } });
    try {
        const before = await untouched.$queryRawUnsafe('SELECT name, sql FROM sqlite_master ORDER BY name');
        assert.deepEqual(clone(await conversion.getAuditRowStatuses(untouched, [id()], inventory)), {});
        assert.deepEqual(await untouched.$queryRawUnsafe('SELECT name, sql FROM sqlite_master ORDER BY name'), before);
        await assert.rejects(conversion.getAuditRowStatuses(untouched, [id()], cashier), /Permission Denied/);
    } finally { await untouched.$disconnect(); }
});

test('Excel progress resumes the prepared row and follows recovery of a cancelled count entry', async () => {
    const { input, result } = await prepared();
    const sourceRowId = input.rowIds[0], variantId = result.variantIds[0];
    const current = async () => (await conversion.getAuditRowStatuses(database, [sourceRowId, sourceRowId, 'not-prepared'], inventory))[sourceRowId];
    assert.deepEqual(clone(await current()), { state: 'PREPARED', draftId: result.draftId, variantId, productId: result.productId });
    await drafts.cancelDraft(database, { operationId: id(), draftId: result.draftId, expectedRevision: 1 }, inventory);
    assert.equal((await current()).state, 'CANCELLED');
    const recovered = await drafts.createDraft(database, { operationId: id(), batchDescription: 'Fresh held count after cancellation',
        lines: [{ variantId, countedQuantity: 9 }] }, inventory);
    assert.equal((await current()).state, 'PREPARED');
    assert.equal((await current()).draftId, recovered.draftId);
    await conversion.postStockBatch(database, post(recovered.draftId), inventory);
    assert.deepEqual(clone(await current()), { state: 'POSTED', draftId: recovered.draftId, variantId, productId: result.productId });
    const statuses = await conversion.getAuditRowStatuses(database, [sourceRowId, 'not-prepared'], inventory);
    assert.equal(Object.hasOwn(statuses, 'not-prepared'), false);
    assert.equal((await raw('StockAuditRowMapping', 'WHERE "sourceRowId" = ?', sourceRowId))[0].draftId, result.draftId);
    await assert.rejects(conversion.prepareAuditStyle(database, { ...input, operationId: id() }, admin), /already prepared/);
    assert.equal(await stock(variantId), 9);
});

test('identical audit metadata with reordered JSON keys does not falsely block a saved entry', async () => {
    const { result } = await prepared();
    const variantId = result.variantIds[0];
    const detail = (await raw('ProductVariantGarmentDetail', 'WHERE "variantId" = ?', variantId))[0];
    const metadata = JSON.parse(detail.metadata);
    metadata.attributes = Object.fromEntries(Object.entries(metadata.attributes).reverse());
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(metadata).reverse()));
    assert.notEqual(reordered, detail.metadata);
    await database.$executeRawUnsafe('UPDATE "ProductVariantGarmentDetail" SET "metadata" = ? WHERE "variantId" = ?', reordered, variantId);
    assert.equal((await drafts.getDraft(database, { draftId: result.draftId }, inventory)).lines[0].catalogueStatus, 'OK');
    await conversion.postStockBatch(database, post(result.draftId), inventory);
    assert.equal(await stock(variantId), 10);
});

test('added metadata and changed nested attributes are flagged during review before activation', async () => {
    const { result } = await prepared();
    const variantId = result.variantIds[0];
    const detail = (await raw('ProductVariantGarmentDetail', 'WHERE "variantId" = ?', variantId))[0];
    const metadata = JSON.parse(detail.metadata);
    metadata.attributes.border = 'Wide';
    await database.$executeRawUnsafe('UPDATE "ProductVariantGarmentDetail" SET "metadata" = ? WHERE "variantId" = ?', JSON.stringify(metadata), variantId);
    let line = (await drafts.getDraft(database, { draftId: result.draftId }, inventory)).lines[0];
    assert.equal(line.catalogueStatus, 'CHANGED');
    assert.match(line.statusMessage, /audit attributes changed/);
    await assert.rejects(conversion.postStockBatch(database, post(result.draftId), inventory), /identity changed/);
    await database.$executeRawUnsafe('UPDATE "StockCountDraftLine" SET "snapshotMetadata" = NULL WHERE "draftId" = ?', result.draftId);
    line = (await drafts.getDraft(database, { draftId: result.draftId }, inventory)).lines[0];
    assert.equal(line.catalogueStatus, 'CHANGED');
    assert.match(line.statusMessage, /audit attributes changed/);
});

test('new short codes avoid original source codes, saved codes, reserved codes and assigned SKUs', async () => {
    await conversion.ensureStockConversionSchema(database);
    const legacy = await database.product.create({ data: { name: 'Collision source', categoryId: category.id } });
    await database.productVariant.create({ data: { productId: legacy.id, sku: 'ST-444444', barcode: '222222', mrp: 1, sellingPrice: 1, costPrice: 0 } });
    await database.productVariant.create({ data: { productId: legacy.id, sku: '555555', barcode: '222223', mrp: 1, sellingPrice: 1, costPrice: 0 } });
    await database.$executeRawUnsafe('INSERT INTO "CatalogueBarcodeReservation" ("draftId", "userId", "barcode") VALUES (?, ?, ?)', id(), admin.id, '333333');
    const sequence = [111111, 222222, 333333, 444444, 555555, 666666];
    const controlled = load('electron/stock-conversion.service.ts', { crypto: { ...crypto, randomInt: () => sequence.shift() ?? 666666 } });
    const result = await controlled.prepareAuditStyle(database, selection([row(id(), 'M', 1, { barcode: '111111' })]), admin);
    assert.equal((await database.productVariant.findUnique({ where: { id: result.variantIds[0] } })).barcode, '666666');
});

test('active permissions are checked before preparation, posting, adjustment and operation replay', async () => {
    const { input, result } = await prepared();
    for (const user of [cashier, disabled]) {
        await assert.rejects(conversion.prepareAuditStyle(database, input, user), /Permission Denied/);
        await assert.rejects(conversion.postStockBatch(database, post(result.draftId), user), /Permission Denied/);
        await assert.rejects(conversion.adjustTrackedStock(database, { operationId: id(), variantId: result.variantIds[0], kind: 'RECEIPT', quantity: 1, reason: 'Receipt' }, user), /Permission Denied/);
    }
    await assert.rejects(conversion.prepareAuditStyle(database, input, inventory), /manage products/);
    const posting = post(result.draftId);
    await conversion.postStockBatch(database, posting, inventory);
    await assert.rejects(conversion.postStockBatch(database, posting, admin), /another operator/);
});

test('posting requires all confirmations and positive whole saved counts and makes no partial activation', async () => {
    const { result } = await prepared([row(id(), 'XL', 10), row(id(), 'M', null)]);
    for (const confirmation of ['held', 'labelsApplied', 'countsChecked']) await assert.rejects(conversion.postStockBatch(database, post(result.draftId, { [confirmation]: false }), admin), /Confirm/);
    await assert.rejects(conversion.postStockBatch(database, post(result.draftId), admin), /positive whole/);
    assert.equal(await stock(result.variantIds[0]), 0);
    assert.equal((await raw('StockVariantTracking', 'WHERE "variantId" = ?', result.variantIds[0])).length, 0);
    for (const invalid of [0, -1, 1.5]) {
        await database.$executeRawUnsafe('UPDATE "StockCountDraftLine" SET "countedQuantity" = ? WHERE "draftId" = ? AND "variantId" = ?', invalid, result.draftId, result.variantIds[1]);
        await assert.rejects(conversion.postStockBatch(database, post(result.draftId), admin), /positive whole/);
        assert.equal(await stock(result.variantIds[0]), 0);
    }
    assert.equal((await database.inventoryMovement.findMany({ where: { reference: result.draftId } })).length, 0);
    assert.equal((await raw('StockCountDraft', 'WHERE "id" = ?', result.draftId))[0].status, 'DRAFT');
});

test('successful posting activates both preparation flags, records one conversion per line and is durably idempotent', async () => {
    const { result } = await prepared([row(id(), 'XL', 10), row(id(), 'M', 3)]);
    const posting = post(result.draftId), posted = await conversion.postStockBatch(database, posting, admin);
    assert.equal(posted.totalPieces, 13);
    assert.equal(posted.status, 'POSTED');
    assert.equal(await stock(result.variantIds[0]), 10);
    assert.equal(await stock(result.variantIds[1]), 3);
    const variants = await raw('ProductVariant', 'WHERE "productId" = ?', result.productId);
    assert.ok(variants.every(value => value.isPrepared === 0 && value.isSynced === false || value.isPrepared === 0 && value.isSynced === 0));
    assert.ok((await raw('ProductVariantGarmentDetail', 'WHERE "variantId" IN (?, ?)', ...result.variantIds)).every(value => value.isPrepared === 0));
    assert.equal((await raw('StockVariantTracking', 'WHERE "variantId" IN (?, ?)', ...result.variantIds)).length, 2);
    const movements = await database.inventoryMovement.findMany({ where: { reference: result.draftId } });
    assert.equal(movements.length, 2);
    assert.ok(movements.every(value => value.type === 'CONVERSION' && value.quantity > 0));
    assert.deepEqual(clone(await conversion.postStockBatch(database, posting, admin)), clone(posted));
    await assert.rejects(conversion.postStockBatch(database, { ...posting, expectedRevision: 2 }, admin), /Operation ID was already used/);
    await assert.rejects(conversion.postStockBatch(database, post(result.draftId), admin), /already posted/);
    assert.equal((await database.inventoryMovement.findMany({ where: { reference: result.draftId } })).length, 2);
});

test('posted drafts are read-only, cancellable drafts remain terminal and POSTED list filtering works', async () => {
    const result = await active();
    const saved = await drafts.getDraft(database, { draftId: result.draftId }, inventory);
    assert.equal(saved.status, 'POSTED');
    await assert.rejects(drafts.saveDraft(database, { operationId: id(), draftId: saved.id, expectedRevision: saved.revision, batchDescription: saved.batchDescription, lines: saved.lines }, inventory), /Posted drafts cannot be edited/);
    await assert.rejects(drafts.cancelDraft(database, { operationId: id(), draftId: saved.id, expectedRevision: saved.revision }, inventory), /posted/);
    const listed = await drafts.listDrafts(database, { status: 'POSTED' }, inventory);
    assert.ok(listed.items.some(value => value.id === result.draftId));
    assert.ok(listed.items.every(value => value.status === 'POSTED'));
    const cancelled = await prepared();
    await drafts.cancelDraft(database, { operationId: id(), draftId: cancelled.result.draftId, expectedRevision: 1 }, inventory);
    await assert.rejects(conversion.postStockBatch(database, post(cancelled.result.draftId), admin), /cancelled/);
});

test('stale saved revisions reject and successful post uses the latest explicitly saved count', async () => {
    const { result } = await prepared();
    const saved = await drafts.getDraft(database, { draftId: result.draftId }, inventory);
    const changed = await drafts.saveDraft(database, { operationId: id(), draftId: saved.id, expectedRevision: 1, batchDescription: saved.batchDescription, lines: saved.lines.map(line => ({ ...line, countedQuantity: 12 })) }, inventory);
    await assert.rejects(conversion.postStockBatch(database, post(result.draftId), admin), /Stale batch revision/);
    assert.equal(await stock(result.variantIds[0]), 0);
    await conversion.postStockBatch(database, post(result.draftId, { expectedRevision: changed.revision }), admin);
    assert.equal(await stock(result.variantIds[0]), 12);
});

test('additional held batches add to tracked stock and preserve sales between counting and posting: 10 - 2 + 5 = 13', async () => {
    const result = await active(10), variantId = result.variantIds[0];
    const activation = (await raw('StockVariantTracking', 'WHERE "variantId" = ?', variantId))[0].activatedAt;
    const draft = await drafts.createDraft(database, { operationId: id(), batchDescription: 'Second held rack', lines: [{ variantId, countedQuantity: 5 }] }, inventory);
    await database.productVariant.update({ where: { id: variantId }, data: { stock: { decrement: 2 } } });
    await conversion.postStockBatch(database, post(draft.draftId), inventory);
    assert.equal(await stock(variantId), 13);
    assert.equal((await raw('StockVariantTracking', 'WHERE "variantId" = ?', variantId))[0].activatedAt, activation);
    const picker = await drafts.searchPreparedVariants(database, { search: (await database.productVariant.findUnique({ where: { id: variantId } })).barcode }, inventory);
    assert.equal(picker[0].id, variantId);
    assert.equal(picker[0].isTracked, true);
    assert.equal(picker[0].isPrepared, false);
});

test('generic legacy items remain ineligible and a prepared nonzero baseline cannot be activated', async () => {
    const product = await database.product.create({ data: { name: 'Generic legacy', categoryId: category.id } });
    const variant = await database.productVariant.create({ data: { productId: product.id, sku: id(), barcode: id(), mrp: 700, sellingPrice: 700, costPrice: 0, stock: -30 } });
    await assert.rejects(drafts.createDraft(database, { operationId: id(), batchDescription: 'Invalid legacy', lines: [{ variantId: variant.id, countedQuantity: 10 }] }, inventory), /neither in preparation nor explicitly tracked/);
    assert.equal((await drafts.searchPreparedVariants(database, { search: variant.barcode }, inventory)).length, 0);
    assert.equal(await stock(variant.id), -30);
    const { result } = await prepared();
    await database.productVariant.update({ where: { id: result.variantIds[0] }, data: { stock: 1 } });
    await assert.rejects(conversion.postStockBatch(database, post(result.draftId), admin), /Prepared stock must still be zero/);
    assert.equal(await stock(result.variantIds[0]), 1);
});

test('all reviewed identity fields and category-specific source metadata must still match at posting', async () => {
    const { result } = await prepared(), variantId = result.variantIds[0];
    const variant = (await raw('ProductVariant', 'WHERE "id" = ?', variantId))[0];
    const detail = (await raw('ProductVariantGarmentDetail', 'WHERE "variantId" = ?', variantId))[0];
    for (const [table, field, value, original] of [
        ['ProductVariant', 'barcode', '999998', variant.barcode], ['ProductVariant', 'sku', 'other-sku', variant.sku],
        ['ProductVariant', 'size', 'M', variant.size], ['ProductVariant', 'sellingPrice', 650, variant.sellingPrice], ['ProductVariant', 'mrp', 800, variant.mrp],
        ['ProductVariantGarmentDetail', 'fabric', 'Polyester', detail.fabric], ['ProductVariantGarmentDetail', 'quality', 'Premium', detail.quality],
        ['ProductVariantGarmentDetail', 'metadata', '{}', detail.metadata],
    ]) {
        const key = table === 'ProductVariant' ? 'id' : 'variantId';
        await database.$executeRawUnsafe(`UPDATE "${table}" SET "${field}" = ? WHERE "${key}" = ?`, value, variantId);
        await assert.rejects(conversion.postStockBatch(database, post(result.draftId), admin), /identity changed/);
        await database.$executeRawUnsafe(`UPDATE "${table}" SET "${field}" = ? WHERE "${key}" = ?`, original, variantId);
    }
    await database.product.update({ where: { id: result.productId }, data: { taxRate: 12 } });
    await assert.rejects(conversion.postStockBatch(database, post(result.draftId), admin), /identity changed/);
    assert.equal(await stock(variantId), 0);
});

test('old drafts do not silently gain missing identity checkpoints when counts are resaved', async () => {
    const { result } = await prepared();
    await database.$executeRawUnsafe('UPDATE "StockCountDraftLine" SET "snapshotCategoryId" = NULL, "snapshotTaxRate" = NULL, "snapshotMrp" = NULL WHERE "draftId" = ?', result.draftId);
    const draft = await drafts.getDraft(database, { draftId: result.draftId }, inventory);
    assert.equal(draft.lines[0].catalogueStatus, 'CHANGED');
    assert.match(draft.lines[0].statusMessage, /lacks reviewed category, tax or MRP/);
    const saved = await drafts.saveDraft(database, { operationId: id(), draftId: result.draftId, expectedRevision: draft.revision, batchDescription: draft.batchDescription, lines: draft.lines }, inventory);
    const line = (await raw('StockCountDraftLine', 'WHERE "draftId" = ?', result.draftId))[0];
    assert.equal(line.snapshotCategoryId, null);
    assert.equal(line.snapshotMrp, null);
    await assert.rejects(conversion.postStockBatch(database, post(result.draftId, { expectedRevision: saved.revision }), admin), /older draft lacks a reviewed/);
});

test('receipt, damage and guarded recount make signed stock movements, require reasons and never change sales or cash', async () => {
    const result = await active(10), variantId = result.variantIds[0];
    const saleCount = await database.sale.count();
    const cashTables = await database.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND lower(name) LIKE '%cash%' ORDER BY name");
    const receipt = { operationId: id(), variantId, kind: 'RECEIPT', quantity: 5, reason: 'Supplier delivery' };
    assert.equal((await conversion.adjustTrackedStock(database, receipt, inventory)).stock, 15);
    assert.equal((await conversion.adjustTrackedStock(database, receipt, inventory)).stock, 15);
    await assert.rejects(conversion.adjustTrackedStock(database, { ...receipt, quantity: 6 }, inventory), /Operation ID was already used/);
    assert.equal((await conversion.adjustTrackedStock(database, { operationId: id(), variantId, kind: 'DAMAGE', quantity: 2, reason: 'Torn pieces' }, inventory)).stock, 13);
    await assert.rejects(conversion.adjustTrackedStock(database, { operationId: id(), variantId, kind: 'DAMAGE', quantity: 14, reason: 'Too many' }, inventory), /Resulting stock/);
    await assert.rejects(conversion.adjustTrackedStock(database, { operationId: id(), variantId, kind: 'RECOUNT', quantity: 11, expectedStock: 15, reason: 'Shelf check' }, inventory), /Stock changed/);
    await assert.rejects(conversion.adjustTrackedStock(database, { operationId: id(), variantId, kind: 'RECOUNT', quantity: 11, reason: 'Shelf check' }, inventory), /Expected current stock/);
    await assert.rejects(conversion.adjustTrackedStock(database, { operationId: id(), variantId, kind: 'RECEIPT', quantity: 1, reason: '' }, inventory), /reason/);
    const recount = await conversion.adjustTrackedStock(database, { operationId: id(), variantId, kind: 'RECOUNT', quantity: 0, expectedStock: 13, reason: 'All pieces removed after damage' }, inventory);
    assert.equal(recount.stock, 0);
    assert.equal(recount.delta, -13);
    const movements = await database.inventoryMovement.findMany({ where: { variantId }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(movements.map(value => [value.type, value.quantity]), [['CONVERSION', 10], ['RECEIPT', 5], ['DAMAGE', -2], ['RECOUNT', -13]]);
    assert.equal(await database.sale.count(), saleCount);
    assert.deepEqual(await database.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND lower(name) LIKE '%cash%' ORDER BY name"), cashTables);
});

test('transaction failures roll back preparation, posting and adjustments with their mappings, movements and replay records', async () => {
    const input = selection(), initialProducts = await database.product.count();
    await assert.rejects(conversion.prepareAuditStyle(failingAudit('STOCK_AUDIT_PREPARED'), input, admin), /Synthetic audit write failure/);
    assert.equal(await database.product.count(), initialProducts);
    assert.equal((await raw('StockAuditRowMapping', 'WHERE "sourceRowId" = ?', input.rowIds[0])).length, 0);
    assert.equal((await raw('StockBatchPosting', 'WHERE "operationId" = ?', input.operationId)).length, 0);
    const result = await conversion.prepareAuditStyle(database, input, admin), posting = post(result.draftId);
    await assert.rejects(conversion.postStockBatch(failingAudit('STOCK_BATCH_POSTED'), posting, admin), /Synthetic audit write failure/);
    assert.equal(await stock(result.variantIds[0]), 0);
    assert.equal((await raw('StockVariantTracking', 'WHERE "variantId" = ?', result.variantIds[0])).length, 0);
    assert.equal((await database.inventoryMovement.findMany({ where: { reference: result.draftId } })).length, 0);
    assert.equal((await raw('StockCountDraft', 'WHERE "id" = ?', result.draftId))[0].status, 'DRAFT');
    await conversion.postStockBatch(database, posting, admin);
    const adjustment = { operationId: id(), variantId: result.variantIds[0], kind: 'DAMAGE', quantity: 2, reason: 'Broken fixture' };
    await assert.rejects(conversion.adjustTrackedStock(failingAudit('TRACKED_STOCK_ADJUSTED'), adjustment, inventory), /Synthetic audit write failure/);
    assert.equal(await stock(result.variantIds[0]), 10);
    assert.equal((await raw('StockBatchPosting', 'WHERE "operationId" = ?', adjustment.operationId)).length, 0);
    assert.equal((await conversion.adjustTrackedStock(database, adjustment, inventory)).stock, 8);
});

test('posting replay survives connection restart without activating legacy rows or duplicating movements', async () => {
    const { result } = await prepared(), posting = post(result.draftId);
    const original = await conversion.postStockBatch(database, posting, admin);
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    const restarted = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
        assert.deepEqual(clone(await conversion.postStockBatch(restarted, posting, admin)), clone(original));
        assert.equal((await restarted.inventoryMovement.findMany({ where: { reference: result.draftId } })).length, 1);
    } finally { await restarted.$disconnect(); }
});

test('corrupt activation timestamps and tracking primary keys block all conversion writes', async () => {
    const result = await active(10), variantId = result.variantIds[0];
    const activation = (await raw('StockVariantTracking', 'WHERE "variantId" = ?', variantId))[0].activatedAt;
    const draft = await drafts.createDraft(database, { operationId: id(), batchDescription: 'Corruption test', lines: [{ variantId, countedQuantity: 5 }] }, inventory);
    try {
        for (const value of ['', '2026-02-30T10:00:00.000Z', 'yesterday']) {
            await database.$executeRawUnsafe('UPDATE "StockVariantTracking" SET "activatedAt" = ? WHERE "variantId" = ?', value, variantId);
            await assert.rejects(conversion.postStockBatch(database, post(draft.draftId), admin), /tracking activation is invalid/);
            await assert.rejects(conversion.adjustTrackedStock(database, { operationId: id(), variantId, kind: 'RECEIPT', quantity: 1, reason: 'Corruption test' }, inventory), /tracking activation is invalid/);
        }
    } finally { await database.$executeRawUnsafe('UPDATE "StockVariantTracking" SET "activatedAt" = ? WHERE "variantId" = ?', activation, variantId); }
    await database.$executeRawUnsafe('ALTER TABLE "StockVariantTracking" RENAME TO "OriginalTracking"');
    try {
        await database.$executeRawUnsafe('CREATE TABLE "StockVariantTracking" ("variantId" TEXT NOT NULL, "activatedAt" TEXT NOT NULL)');
        await assert.rejects(conversion.postStockBatch(database, post(draft.draftId), admin), /tracking schema is incomplete/);
        await assert.rejects(conversion.prepareAuditStyle(database, selection(), admin), /tracking schema is incomplete/);
    } finally {
        await database.$executeRawUnsafe('DROP TABLE "StockVariantTracking"');
        await database.$executeRawUnsafe('ALTER TABLE "OriginalTracking" RENAME TO "StockVariantTracking"');
    }
    assert.equal(await stock(variantId), 10);
});
