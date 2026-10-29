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

test('direct manual/Excel stock: identities, batches, retries, corrections, rollback and legacy isolation', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-stock-entry-'));
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    const db = new PrismaClient({ datasources: { db: { url: 'file:' + path.join(directory, 'stock.db').replaceAll('\\', '/') } } });
    try {
        const sql = execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'prisma/generated/client/schema.prisma'), '--script'], { encoding: 'utf8', cwd: root });
        for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
        const user = await db.user.create({ data: { username: 'entry-test', name: 'Test owner', password: 'fixture-only', role: 'ADMIN', isActive: true } });
        const category = await db.category.create({ data: { name: 'Shirts' } });
        const old = await db.product.create({ data: { name: 'Shirt 700', categoryId: category.id, variants: { create: { sku: 'OLD-700', barcode: '4649001', mrp: 700, sellingPrice: 700, costPrice: 0, stock: -7 } } }, include: { variants: true } });
        const service = load('electron/stock-conversion.service');
        const row = { name: 'Crazy Heart Plain - XL', category: 'Shirts', brand: 'Crazy Heart', size: 'XL', mrp: 700, quantity: 15,
            attributes: { collar: 'Regular Collar', pocket: 'Single Pocket', pattern: 'Plain', sleeve: 'Full Sleeve', fabric: 'Cotton', fit: 'Slim Fit', color: 'White' } };
        const input = { operationId: randomUUID(), batchName: 'Rack one audit', rows: [row, { ...row, attributes: { ...row.attributes, fabric: 'Linen' }, quantity: 2 }] };
        const saved = await service.saveStockEntry(db, input, user);
        assert.equal(saved.totalPieces, 17); assert.equal(saved.items.length, 2);
        assert.notEqual(saved.items[0].barcode, saved.items[1].barcode);
        assert.ok(saved.items.every(item => /^\d{6}$/.test(item.barcode)));
        const retry = await service.saveStockEntry(db, input, user);
        assert.equal(retry.batchId, saved.batchId); assert.equal(await db.productVariant.count(), 3);
        await assert.rejects(service.saveStockEntry(db, { ...input, batchName: 'Changed' }, user), /Operation ID/);
        const inventory = (await load('electron/inventory-workspace.service').getInventoryWorkspace(db, { scope: 'TRACKED', groupBy: 'SIZE' })).data;
        assert.equal(inventory.stats.quantity, 17); assert.equal(inventory.items.length, 2);
        assert.ok(inventory.items.every(item => item.name === row.name));
        assert.equal(inventory.items[0].variants[0].attributes.batchName, 'Rack one audit');
        const adjust = { operationId: randomUUID(), variantId: saved.items[0].variantId, kind: 'RECOUNT', quantity: 12, expectedStock: 15, reason: 'Count corrected after import' };
        await service.adjustTrackedStock(db, adjust, user); await service.adjustTrackedStock(db, adjust, user);
        assert.equal((await db.productVariant.findUnique({ where: { id: adjust.variantId } })).stock, 12);
        await assert.rejects(service.adjustTrackedStock(db, { ...adjust, operationId: randomUUID() }, user), /Stock changed/);
        const before = await db.product.count();
        await assert.rejects(service.saveStockEntry(db, { ...input, operationId: randomUUID(), rows: [row, { ...row, quantity: -1 }] }, user), /whole piece/);
        assert.equal(await db.product.count(), before);
        await assert.rejects(service.saveStockEntry(db, input, { ...user, role: 'STAFF', permManageInventory: false }), /Permission/);
        assert.equal((await db.productVariant.findUnique({ where: { id: old.variants[0].id } })).stock, -7);

        const audit = load('electron/excel-audit.service').createExcelAuditService({ filePath: path.join(directory, 'audit.json') });
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
            ['ID', 'Category', 'Brand', 'Pattern', 'Fabric', 'Size', 'Quantity', 'MRP'],
            ['excel-one', 'Shirts', 'Crazy Heart', 'Plain', 'Cotton', 'XL', 3, 700],
            ['excel-two', 'Accessories', 'Example', 'Plain', '', '', 0, 100],
        ]), 'Stock Audit');
        const preview = await audit.preview({ fileName: 'test.xlsx', bytes: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) }, user.id);
        const status = await audit.commit(preview.token, user.id);
        const excelRows = audit.list().items;
        const excelInput = { operationId: randomUUID(), batchName: 'Excel batch', fileHash: status.fileHash, rows: excelRows.map(item => ({ sourceRowId: item.id,
            name: 'Edited name', category: item.category, brand: item.brand || '', size: item.size || '', mrp: item.mrp, quantity: item.countedQuantity, attributes: item.attributes })) };
        // Operator edits the imported count before saving.
        excelInput.rows[0].quantity = 4;
        const imported = await service.saveStockEntry(db, excelInput, user);
        assert.equal(imported.totalPieces, 4); assert.equal(imported.items[1].stock, 0);
        assert.equal((await service.getAuditRowStatuses(db, excelRows.map(item => item.id), user))['excel-one'].state, 'POSTED');
        await assert.rejects(service.saveStockEntry(db, { ...excelInput, operationId: randomUUID() }, user), /already saved/);
        const preparedRow = { id: 'earlier-setup', sourceRow: 4, name: 'Old name', category: 'Shirts', brand: 'Crazy Heart', size: 'L', mrp: 700, countedQuantity: 3, attributes: { fabric: 'Cotton' }, barcode: null, lastUpdated: null };
        const prepared = await service.prepareAuditStyle(db, { operationId: randomUUID(), fileHash: status.fileHash, fileName: 'test.xlsx', rowIds: [preparedRow.id], rows: [preparedRow], productName: 'Old name', categoryId: category.id, taxRate: 5, styleConfirmed: true }, user);
        const previous = await db.productVariant.findUnique({ where: { id: prepared.variantIds[0] } });
        const recovered = await service.saveStockEntry(db, { operationId: randomUUID(), batchName: 'Finish earlier setup', fileHash: status.fileHash, rows: [{ ...row, sourceRowId: preparedRow.id, size: 'L', quantity: 6 }] }, user);
        assert.equal(recovered.items[0].variantId, previous.id);
        assert.equal(recovered.items[0].barcode, previous.barcode);
        assert.equal((await service.getAuditRowStatuses(db, [preparedRow.id], user))[preparedRow.id].state, 'POSTED');
        // A late failure must roll back earlier rows as well.
        const duplicateCategory = await db.category.create({ data: { name: ' shirts ' } });
        const batchCount = await db.$queryRawUnsafe('SELECT count(*) AS n FROM "StockEntryBatch"');
        await assert.rejects(service.saveStockEntry(db, { operationId: randomUUID(), batchName: 'Atomic', rows: [{ ...row, category: 'New accessories' }, row] }, user), /ambiguous/);
        assert.equal(await db.category.count({ where: { name: 'New accessories' } }), 0);
        assert.equal((await db.$queryRawUnsafe('SELECT count(*) AS n FROM "StockEntryBatch"'))[0].n, batchCount[0].n);
        await db.category.delete({ where: { id: duplicateCategory.id } });
        const rackRow = { ...row, brand: 'Rack brand', attributes: { ...row.attributes, custom_stretch: 'Stretch' } };
        const rack = await service.saveStockEntry(db, { operationId: randomUUID(), batchName: 'Rack A', mergeMatching: true,
            rows: [{ ...rackRow, quantity: 4 }, { ...rackRow, size: 'L', quantity: 2 }] }, user);
        const variants = await db.productVariant.findMany({ where: { id: { in: rack.items.map(item => item.variantId) } } });
        assert.equal(variants[0].productId, variants[1].productId, 'sizes share an actual style');
        const repeatedInput = { operationId: randomUUID(), batchName: 'Rack B', mergeMatching: true, rows: [{ ...rackRow, name: 'Another readable name', quantity: 3 }] };
        const repeated = await service.saveStockEntry(db, repeatedInput, user);
        assert.equal(repeated.items[0].barcode, rack.items[0].barcode); assert.equal(repeated.items[0].stock, 7);
        await service.saveStockEntry(db, repeatedInput, user);
        assert.equal((await db.productVariant.findUnique({ where: { id: rack.items[0].variantId } })).stock, 7);
        const different = await service.saveStockEntry(db, { ...repeatedInput, operationId: randomUUID(), rows: [{ ...rackRow, attributes: { ...rackRow.attributes, custom_stretch: 'No stretch' }, quantity: 1 }] }, user);
        assert.notEqual(different.items[0].barcode, rack.items[0].barcode);
        const rackInventory = (await load('electron/inventory-workspace.service').getInventoryWorkspace(db, { scope: 'TRACKED', search: rack.items[0].barcode, groupBy: 'SIZE' })).data;
        assert.equal(rackInventory.items[0].variants[0].attributes.custom_stretch, 'Stretch');
        const customFiltered = await load('electron/inventory-workspace.service').getInventoryWorkspace(db, { scope: 'TRACKED', attributes: { custom_stretch: 'No stretch' }, groupBy: 'SIZE' });
        assert.equal(customFiltered.data.stats.quantity, 1);
        assert.ok(customFiltered.data.facets.attributes.some(item => item.key === 'custom_stretch' && item.values.includes('Stretch')));
        assert.equal((await load('electron/inventory-workspace.service').getInventoryWorkspace(db, { attributes: { costPrice: '700' } })).success, false);
        const setupService = load('electron/stock-audit-setup.service');
        const setup = await setupService.getStockAuditSetup(db, user);
        assert.equal(setup.revision, 0);
        assert.ok(setup.categories.find(item => item.name === 'Shirts').groups.some(group => group.key === 'collar'));
        assert.equal(setup.categories.find(item => item.name === 'Mundus & Dhotis').groups.some(group => group.key === 'collar'), false);
        const customCategory = { name: 'Custom garments', brands: ['My brand'], groups: [{ key: 'custom_wash', label: 'Wash', options: ['Stone wash', 'Plain'] }], scales: [{ name: 'Shop sizes', sizes: ['A', 'B'] }] };
        const setupInput = { operationId: randomUUID(), expectedRevision: 0, categories: [...setup.categories, customCategory] };
        const stored = await setupService.saveStockAuditSetup(db, setupInput, user);
        assert.equal(stored.revision, 1);
        assert.equal((await setupService.saveStockAuditSetup(db, setupInput, user)).revision, 1);
        const reloaded = await setupService.getStockAuditSetup(db, user);
        assert.equal(reloaded.categories.find(item => item.name === customCategory.name).groups[0].label, 'Wash');
        assert.equal(reloaded.categories.find(item => item.name === customCategory.name).scales[0].sizes[1], 'B');
        await assert.rejects(setupService.saveStockAuditSetup(db, { ...setupInput, operationId: randomUUID() }, user), /changed in another window/);
        await assert.rejects(setupService.saveStockAuditSetup(db, { ...setupInput, operationId: randomUUID(), expectedRevision: 1, categories: [{ ...customCategory, groups: [{ key: 'costPrice', label: 'Bad field', options: [] }] }] }, user), /valid keys/);
        await assert.rejects(setupService.getStockAuditSetup(db, { ...user, role: 'CASHIER', permManageInventory: false }), /Permission/);
        assert.equal(await db.sale.count(), 0);
    } finally {
        await db.$disconnect();
        const resolved = path.resolve(directory);
        assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
        assert.ok(path.basename(resolved).startsWith('zain-stock-entry-'));
        fs.rmSync(resolved, { recursive: true, force: true });
    }
});

