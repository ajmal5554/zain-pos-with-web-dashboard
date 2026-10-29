const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
const XLSX = require('xlsx');
const root = path.resolve(__dirname, '..');
const modules = new Map();
function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const exports = {}; modules.set(relative, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, relative + '.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText, { exports, module: { exports }, Buffer, Uint8Array, ArrayBuffer, Date, console,
        require: name => name.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), name))) : require(name) });
    return exports;
}

test('real workbook → reviewed name/category → saved count → inventory, with reusable progress and unchanged old billing stock', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-stock-import-flow-'));
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    const db = new PrismaClient({ datasources: { db: { url: 'file:' + path.join(directory, 'stock.db').replaceAll('\\', '/') } } });
    try {
        const sql = execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'prisma/generated/client/schema.prisma'), '--script'], { encoding: 'utf8', cwd: root });
        for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
        const user = await db.user.create({ data: { username: 'isolated-stock-test', name: 'Test owner', password: 'fixture-only', role: 'ADMIN', isActive: true } });
        const oldCategory = await db.category.create({ data: { name: 'Old clothing' } });
        const old = await db.product.create({ data: { name: 'Shirt 700', categoryId: oldCategory.id, variants: { create: { sku: 'OLD-700', barcode: '4649001', mrp: 700, sellingPrice: 700, costPrice: 0, stock: -7 } } }, include: { variants: true } });
        const audit = load('electron/excel-audit.service').createExcelAuditService({ filePath: path.join(directory, 'audit.json') });
        const conversion = load('electron/stock-conversion.service');
        const drafts = load('electron/stock-draft.service');
        const inventory = load('electron/inventory-workspace.service');
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
            ['ID', 'Category', 'Brand', 'Pattern', 'Fabric', 'Size', 'Quantity', 'MRP'],
            ['audited-xl', 'Shirts', 'Crazy Heart', 'Checks', 'Cotton', 'XL', 3, 700],
            ['audited-nosize', 'Accessories', 'Example', 'Plain', '', '', 2, 100],
        ]), 'Stock Audit');
        const preview = await audit.preview({ fileName: 'isolated-audit.xlsx', bytes: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) }, user.id);
        const status = await audit.commit(preview.token, user.id);
        const rows = audit.list().items;
        assert.deepEqual(Object.keys(await conversion.getAuditRowStatuses(db, rows.map(row => row.id), user)), []);
        const input = { operationId: randomUUID(), fileHash: status.fileHash, rowIds: [rows[0].id], productName: 'Crazy Heart Checks', categoryId: '', categoryName: 'Shirts', taxRate: 5, styleConfirmed: true, ...audit.resolveRows(status.fileHash, [rows[0].id]) };
        const prepared = await conversion.prepareAuditStyle(db, input, user);
        const progress = await conversion.getAuditRowStatuses(db, [rows[0].id], user);
        assert.equal(progress[rows[0].id].state, 'PREPARED'); assert.equal(progress[rows[0].id].draftId, prepared.draftId);
        assert.equal((await inventory.getInventoryWorkspace(db, { scope: 'TRACKED' })).data.stats.quantity, 0);
        const saved = await drafts.getDraft(db, { draftId: prepared.draftId }, user);
        assert.equal(saved.lines[0].catalogueStatus, 'OK');
        const revision = await drafts.saveDraft(db, { operationId: randomUUID(), draftId: saved.id, expectedRevision: saved.revision,
            batchDescription: saved.batchDescription, sourceReference: saved.sourceReference, observedAt: saved.observedAt, notes: saved.notes,
            lines: saved.lines.map(line => ({ id: line.id, variantId: line.variantId, countedQuantity: 4, notes: line.notes })) }, user);
        const post = { operationId: randomUUID(), draftId: saved.id, expectedRevision: revision.revision, held: true, labelsApplied: true, countsChecked: true };
        await conversion.postStockBatch(db, post, user); await conversion.postStockBatch(db, post, user);
        const listed = await inventory.getInventoryWorkspace(db, { scope: 'TRACKED' });
        assert.equal(listed.success, true); assert.equal(listed.data.stats.quantity, 4);
        assert.equal(listed.data.items[0].name, 'Crazy Heart Checks'); assert.equal(listed.data.items[0].variants[0].size, 'XL');
        assert.match(listed.data.items[0].variants[0].barcode, /^\d{6}$/);
        assert.equal((await conversion.getAuditRowStatuses(db, [rows[0].id], user))[rows[0].id].state, 'POSTED');
        const noSize = await conversion.prepareAuditStyle(db, { ...input, operationId: randomUUID(), rowIds: [rows[1].id], productName: 'Example accessory', categoryName: 'Accessories', ...audit.resolveRows(status.fileHash, [rows[1].id]) }, user);
        assert.equal((await drafts.getDraft(db, { draftId: noSize.draftId }, user)).lines[0].snapshot.size, null);
        assert.equal((await db.productVariant.findUnique({ where: { id: old.variants[0].id } })).stock, -7);
        assert.equal(await db.sale.count(), 0);
    } finally {
        await db.$disconnect();
        const resolved = path.resolve(directory);
        assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
        assert.ok(path.basename(resolved).startsWith('zain-stock-import-flow-'));
        fs.rmSync(resolved, { recursive: true, force: true });
    }
});
