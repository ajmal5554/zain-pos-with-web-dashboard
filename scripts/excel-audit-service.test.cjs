const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const XLSX = require('xlsx');

const test = (name, fn) => nodeTest(name, { timeout: 10_000 }, fn);
const root = path.resolve(__dirname, '..');
const copy = value => JSON.parse(JSON.stringify(value));
const OWNER = 'inventory-manager';
const HEADERS = ['ID', 'Category', 'Subtype', 'Brand', 'Pattern', 'Fabric', 'Collar', 'Pocket',
    'Sleeve', 'Fit', 'Color', 'Border', 'Size', 'Quantity', 'MRP (₹)', 'Total Value (₹)', 'Notes', 'Last Updated'];
const RAW_DATE = '08/10/2026 20:14:37 IST';

function auditRow(id = '0001', overrides = {}) {
    const record = { ID: id, Category: 'Shirt', Subtype: 'F/S', Brand: 'Crazy Heart', Pattern: 'Checks',
        Fabric: 'Cotton', Collar: 'Normal', Pocket: 'Single', Sleeve: 'Full Sleeve', Fit: 'Regular',
        Color: 'Blue', Border: '', Size: 'XL', Quantity: 3, 'MRP (₹)': 700, 'Total Value (₹)': 2100,
        Notes: 'PRIVATE supplier note', 'Last Updated': RAW_DATE, ...overrides };
    return HEADERS.map(header => record[header]);
}

function workbook(rows = [auditRow()], options = {}) {
    const sheet = XLSX.utils.aoa_to_sheet([options.headers ?? HEADERS, ...rows]);
    options.changeSheet?.(sheet);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, options.sheetName ?? 'Stock Audit');
    if (options.summary !== false) {
        const summary = XLSX.utils.aoa_to_sheet([
            ['Summary', 'Value'], ['Total stock', 999999], ['Total value', 'PRIVATE finance'],
            ['Notes', 'PRIVATE supplier balance'], ['Count', 999999],
        ]);
        summary.B2 = { t: 'n', v: 999999, f: 'SUM(1,2)' };
        XLSX.utils.book_append_sheet(book, summary, 'Summary');
    }
    options.changeWorkbook?.(book);
    return {
        fileName: options.fileName ?? 'Zain_Stock_Audit.xlsx',
        bytes: XLSX.write(book, { type: 'buffer', bookType: options.bookType ?? 'xlsx' }),
    };
}

function fixture(t, options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-excel-audit-'));
    const filePath = path.join(directory, 'excel-audit.json');
    let failRename = false;
    let currentTime = new Date('2026-10-14T10:00:00.000Z');
    const fsOps = Object.create(fs.promises);
    fsOps.rename = async (...args) => {
        if (failRename) throw new Error('PRIVATE filename and parser data must not escape');
        return fs.promises.rename(...args);
    };
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(path.join(root, 'electron/excel-audit.service.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(source, {
        module, exports: module.exports, Buffer, ArrayBuffer, Uint8Array,
        require(name) {
            if (name === 'node:fs') return { ...fs, promises: fsOps };
            if (name === 'xlsx') return options.xlsx ?? XLSX;
            return require(name);
        },
    }, { filename: 'excel-audit.service.ts' });
    const create = () => module.exports.createExcelAuditService({ filePath, now: () => new Date(currentTime) });
    const service = create();
    t.after(() => {
        const absolute = path.resolve(directory);
        assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep));
        assert.ok(path.basename(absolute).startsWith('zain-excel-audit-'));
        fs.rmSync(absolute, { recursive: true, force: true });
    });
    return {
        service, create, filePath, directory,
        preview: (input = workbook(), owner = OWNER) => service.preview(input, owner),
        import: async (input = workbook(), owner = OWNER) => {
            const preview = await service.preview(input, owner);
            return service.commit(preview.token, owner);
        },
        failRename: value => { failRename = value; },
        advance: milliseconds => { currentTime = new Date(currentTime.getTime() + milliseconds); },
    };
}

test('actual audit header layout previews without writes, excludes Summary, and commits public item details', async t => {
    const f = fixture(t);
    const preview = await f.preview(workbook([auditRow('0001'), auditRow('0002', { Category: 'Pant', Quantity: 2, Size: '32' })]));
    assert.equal(fs.existsSync(f.filePath), false);
    assert.equal(f.service.status().imported, false);
    assert.equal(preview.status.rowCount, 2);
    assert.equal(preview.status.totalQuantity, 5);
    assert.equal(preview.status.sheetName, 'Stock Audit');
    assert.equal(preview.items[0].id, '0001');
    assert.equal(preview.items[0].sourceRow, 2);
    assert.equal(preview.items[0].name, 'Shirt');
    assert.equal(preview.items[0].mrp, 700);
    assert.equal(preview.items[0].attributes.fabric, 'Cotton');
    assert.equal(preview.items[0].attributes.subtype, 'F/S');
    assert.equal(preview.items[0].lastUpdated, RAW_DATE);
    assert.ok(preview.warnings.some(message => message.includes('Category is used')));
    assert.ok(preview.warnings.some(message => message.includes('Summary')));
    const status = await f.service.commit(preview.token, OWNER);
    assert.equal(status.imported, true);
    assert.equal(status.totalQuantity, 5);
    assert.equal(status.importedAt, '2026-10-14T10:00:00.000Z');
    const saved = fs.readFileSync(f.filePath, 'utf8');
    assert.equal(saved.includes('PRIVATE'), false);
    assert.equal(saved.includes('Total Value'), false);
    assert.equal(saved.includes('Notes'), false);
    assert.equal(f.service.list().items.length, 2);
});

test('preparation resolves only selected IDs from the current saved audit and returns independent copies', async t => {
    const f = fixture(t);
    const status = await f.import(workbook([auditRow('saved-one'), auditRow('saved-two', { Size: 'M', Quantity: 7 })]));
    const saved = f.service.list().items;
    const result = f.service.resolveRows(status.fileHash, [saved[1].id]);
    assert.equal(result.fileName, 'Zain_Stock_Audit.xlsx');
    assert.equal(result.rows[0].countedQuantity, 7);
    result.rows[0].countedQuantity = 999;
    result.rows[0].attributes.fabric = 'Forged';
    const again = f.service.resolveRows(status.fileHash, [saved[1].id]);
    assert.equal(again.rows[0].countedQuantity, 7);
    assert.equal(again.rows[0].attributes.fabric, 'Cotton');
    for (const ids of [[], [saved[0].id, saved[0].id], ['missing'], [42], Array(101).fill(saved[0].id)]) assert.throws(() => f.service.resolveRows(status.fileHash, ids));
    assert.throws(() => f.service.resolveRows('stale-hash', [saved[0].id]), /reload|changed/i);
    await f.import(workbook([auditRow('replacement')]));
    assert.throws(() => f.service.resolveRows(status.fileHash, [saved[0].id]), /reload|changed/i);
});

test('blank Quantity stays uncounted while explicit zero is a counted observation', async t => {
    const f = fixture(t);
    const preview = await f.preview(workbook([auditRow('zero', { Quantity: 0 }), auditRow('blank', { Quantity: '' })]));
    assert.deepEqual(copy(preview.items.map(row => row.countedQuantity)), [0, null]);
    assert.equal(preview.status.countedRows, 1);
    assert.equal(preview.status.uncountedRows, 1);
    assert.equal(preview.status.totalQuantity, 0);
    assert.ok(preview.warnings.some(message => message.includes('blank Quantity')));
    await f.service.commit(preview.token, OWNER);
    const restarted = f.create();
    await restarted.initialize();
    assert.deepEqual(copy(restarted.list().items.map(row => row.countedQuantity)), [0, null]);
});

test('text and zero-padded numeric IDs and barcodes preserve leading zeros with common aliases', async t => {
    const f = fixture(t);
    const input = workbook([
        ['000000123', 'Shirt 700', 'Shirts', '00004649396', 0, '₹ 700.50', '2026-10-08T20:14:00+05:30'],
        [42, 'Pant 1000', 'Pants', 123, '1,000', '1,000.00', RAW_DATE],
    ], {
        headers: ['Audit ID', 'Product Name', 'Category', 'Barcode', 'Qty', 'Selling Price', 'Updated At'],
        changeSheet(sheet) { sheet.A3.z = '000000'; sheet.D3.z = '00000000'; },
    });
    const preview = await f.preview(input);
    assert.equal(preview.items[0].id, '000000123');
    assert.equal(preview.items[0].barcode, '00004649396');
    assert.equal(preview.items[1].id, '000042');
    assert.equal(preview.items[1].barcode, '00000123');
    assert.equal(preview.items[1].countedQuantity, 1000);
    assert.equal(preview.items[0].mrp, 700.5);
    assert.equal(preview.items[0].lastUpdated, '2026-10-08T20:14:00+05:30');
});

test('numeric unsafe, negative, fractional and precision-lost identifiers are rejected', async t => {
    const f = fixture(t);
    for (const field of ['ID', 'Barcode']) {
        for (const value of [-1, 1.25, 1_234_567_890_123_456, Number.MAX_SAFE_INTEGER + 1]) {
            const input = workbook([[field === 'ID' ? value : 'safe-id', 'Shirt', field === 'Barcode' ? value : '0001', 1]], {
                headers: ['ID', 'Category', 'Barcode', 'Quantity'],
            });
            await assert.rejects(f.preview(input), /stored as text/);
        }
    }
    assert.equal(fs.existsSync(f.filePath), false);
});

test('missing IDs get deterministic source-row identities and an explicit warning', async t => {
    const f = fixture(t);
    const input = workbook([['Shirt', 'XL', 2], ['Shirt', 'L', 3]], { headers: ['Category', 'Size', 'Quantity'] });
    const first = await f.preview(input);
    const second = await f.preview(input);
    assert.deepEqual(copy(first.items.map(row => row.id)), copy(second.items.map(row => row.id)));
    assert.notEqual(first.items[0].id, first.items[1].id);
    assert.ok(first.warnings.some(message => message.includes('have no ID')));
});

test('duplicate explicit IDs reject the whole upload without changing an imported inbox', async t => {
    const f = fixture(t);
    await f.import();
    const oldBytes = fs.readFileSync(f.filePath);
    await assert.rejects(f.preview(workbook([auditRow('same'), auditRow('same')])), /repeats an ID/);
    assert.deepEqual(fs.readFileSync(f.filePath), oldBytes);
    assert.equal(f.service.list().items[0].id, '0001');
});

test('negative, fractional, infinite, malformed and boolean quantities reject without leaking cell values', async t => {
    const f = fixture(t);
    for (const quantity of [-1, 1.5, 'Infinity', 'NaN', '1,2', 'PRIVATE invalid cell', true, 1_000_000_001]) {
        const error = await f.preview(workbook([auditRow('bad', { Quantity: quantity })])).catch(error => error);
        assert.ok(error instanceof Error || error?.message);
        assert.match(error.message, /Quantity/);
        assert.equal(error.message.includes('PRIVATE'), false);
    }
    assert.equal(fs.existsSync(f.filePath), false);
});

test('formula cells in every imported field reject cached values while private total formulas are ignored', async t => {
    const f = fixture(t);
    for (const address of ['A2', 'B2', 'F2', 'M2', 'N2', 'O2', 'R2']) {
        const input = workbook([auditRow()], { changeSheet(sheet) { sheet[address].f = '1+2'; } });
        await assert.rejects(f.preview(input), /formula/);
    }
    const valid = workbook([auditRow()], { changeSheet(sheet) { sheet.P2.f = 'N2*O2'; sheet.Q2.f = 'PRIVATE()'; } });
    const preview = await f.preview(valid);
    assert.equal(preview.items[0].countedQuantity, 3);
});

test('cost, supplier notes, hidden metadata and computed totals never enter persisted observations', async t => {
    const f = fixture(t);
    const input = workbook([['a', 'Shirt', 2, 700, 300, 'PRIVATE supplier', 'PRIVATE note', 600, 'Cotton']], {
        headers: ['ID', 'Category', 'Quantity', 'MRP', 'Cost Price', 'Supplier', 'Notes', 'Purchase Price', 'Fabric'],
    });
    const preview = await f.preview(input);
    await f.service.commit(preview.token, OWNER);
    const publicJson = JSON.stringify({ preview, list: f.service.list() });
    const saved = fs.readFileSync(f.filePath, 'utf8');
    for (const text of ['PRIVATE', 'Cost Price', 'Purchase Price', 'Supplier', 'Notes', 'costPrice']) {
        assert.equal(publicJson.includes(text), false, text);
        assert.equal(saved.includes(text), false, text);
    }
});

test('one unnamed valid audit sheet works, while multiple audit or unexplained data sheets reject', async t => {
    const f = fixture(t);
    assert.equal((await f.preview(workbook([auditRow()], { sheetName: 'Inventory Count' }))).status.rowCount, 1);
    const twoAudits = workbook([auditRow()], { changeWorkbook(book) {
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([HEADERS, auditRow('other')]), 'Other Audit');
    } });
    await assert.rejects(f.preview(twoAudits), /more than one audit/);
    const extraData = workbook([auditRow()], { changeWorkbook(book) {
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Something else'], ['PRIVATE']]), 'Other Data');
    } });
    await assert.rejects(f.preview(extraData), /additional data worksheet/);
    const emptyExtra = workbook([auditRow()], { changeWorkbook(book) {
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), 'Empty Sheet');
    } });
    assert.equal((await f.preview(emptyExtra)).status.rowCount, 1);
});

test('oversized uploads, rows, columns and non-Excel files fail before an inbox is written', async t => {
    const f = fixture(t);
    await assert.rejects(f.preview({ fileName: 'big.xlsx', bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }), /10 MB/);
    await assert.rejects(f.preview({ fileName: 'empty.xlsx', bytes: Buffer.alloc(0) }), /10 MB/);
    await assert.rejects(f.preview({ fileName: 'bad.xlsx', bytes: Buffer.from('Category,Quantity\nShirt,1') }), /not a supported Excel/);
    await assert.rejects(f.preview({ fileName: 'bad.csv', bytes: workbook().bytes }), /extension/);
    const tooManyColumns = workbook([auditRow()], { changeSheet(sheet) {
        sheet.BM1 = { t: 's', v: 'Unused column' }; sheet['!ref'] = 'A1:BM2';
    } });
    await assert.rejects(f.preview(tooManyColumns), /64 columns/);
    const tooManyRows = workbook([auditRow()], { changeSheet(sheet) {
        sheet.A20020 = { t: 's', v: 'far-away' }; sheet['!ref'] = 'A1:R20020';
    } });
    await assert.rejects(f.preview(tooManyRows), /too large|20,000 rows/);
    assert.equal(fs.existsSync(f.filePath), false);
});

test('a parsed preview is immutable, shows a sample, and commits the complete reviewed snapshot', async t => {
    const f = fixture(t);
    const input = workbook(Array.from({ length: 25 }, (_, index) => auditRow(`id-${index}`)));
    const preview = await f.preview(input);
    assert.equal(preview.items.length, 20);
    assert.equal(preview.status.rowCount, 25);
    preview.items[0].name = 'Edited outside service';
    preview.items[0].attributes.fabric = 'Edited outside service';
    input.bytes.fill(0);
    const status = await f.service.commit(preview.token, OWNER);
    assert.equal(status.rowCount, 25);
    assert.equal(f.service.list().items[0].name, 'Shirt');
    assert.equal(f.service.list().items[0].attributes.fabric, 'Cotton');
});

test('durable restart, attribute search, pagination and returned-copy safety work after import', async t => {
    const f = fixture(t);
    await f.import(workbook([auditRow('a'), auditRow('b', { Fabric: 'Denim', Category: 'Pant' }), auditRow('c')]));
    const restarted = f.create();
    assert.equal((await restarted.initialize()).rowCount, 3);
    assert.equal(restarted.list({ page: 2, pageSize: 2 }).items[0].id, 'c');
    const found = restarted.list({ search: 'denim' });
    assert.equal(found.totalMatching, 1);
    assert.equal(found.items[0].name, 'Pant');
    found.items[0].attributes.fabric = 'Changed outside service';
    assert.equal(restarted.list({ search: 'denim' }).items[0].attributes.fabric, 'Denim');
});

test('importing the same bytes and retrying a successful commit are idempotent', async t => {
    const f = fixture(t);
    const input = workbook();
    const firstPreview = await f.preview(input);
    const firstStatus = await f.service.commit(firstPreview.token, OWNER);
    const saved = fs.readFileSync(f.filePath);
    f.advance(60_000);
    assert.deepEqual(copy(await f.service.commit(firstPreview.token, OWNER)), copy(firstStatus));
    const nextPreview = await f.preview(input);
    assert.equal(nextPreview.alreadyImported, true);
    assert.equal(nextPreview.replacesExisting, false);
    assert.ok(nextPreview.warnings.some(message => message.includes('will not duplicate')));
    assert.deepEqual(copy(await f.service.commit(nextPreview.token, OWNER)), copy(firstStatus));
    assert.deepEqual(fs.readFileSync(f.filePath), saved);
});

test('new workbook replaces the entire inbox only after explicit review and stale previews cannot replace it', async t => {
    const f = fixture(t);
    await f.import(workbook([auditRow('old-a'), auditRow('old-b')]));
    const newer = await f.preview(workbook([auditRow('new')]));
    const stale = await f.preview(workbook([auditRow('stale')]));
    assert.equal(newer.replacesExisting, true);
    assert.ok(newer.warnings.some(message => message.includes('entire previous')));
    assert.equal(f.service.status().rowCount, 2);
    await f.service.commit(newer.token, OWNER);
    assert.equal(f.service.status().rowCount, 1);
    assert.equal(f.service.list().items[0].id, 'new');
    await assert.rejects(f.service.commit(stale.token, OWNER), /changed after this preview/);
    assert.equal(f.service.list().items[0].id, 'new');
});

test('preview tokens are owner-bound, expire in ten minutes, and only four are retained', async t => {
    const f = fixture(t);
    const own = await f.preview();
    await assert.rejects(f.service.commit(own.token, 'another-manager'), /unavailable or expired/);
    assert.equal(fs.existsSync(f.filePath), false);
    await f.service.commit(own.token, OWNER);
    const expiring = await f.preview(workbook([auditRow('expiring')]));
    f.advance(10 * 60_000);
    await assert.rejects(f.service.commit(expiring.token, OWNER), /unavailable or expired/);
    const previews = [];
    for (let index = 0; index < 5; index++) previews.push(await f.preview(workbook([auditRow(`next-${index}`)])));
    await assert.rejects(f.service.commit(previews[0].token, OWNER), /unavailable or expired/);
    await f.service.commit(previews[4].token, OWNER);
    assert.equal(f.service.list().items[0].id, 'next-4');
});

test('atomic persistence failures preserve the previous inbox and the same preview can be retried', async t => {
    const f = fixture(t);
    await f.import(workbook([auditRow('previous')]));
    const previous = fs.readFileSync(f.filePath);
    const reviewed = await f.preview(workbook([auditRow('next')]));
    f.failRename(true);
    const error = await f.service.commit(reviewed.token, OWNER).catch(error => error);
    assert.match(error.message, /could not be saved/);
    assert.equal(error.message.includes('PRIVATE'), false);
    assert.deepEqual(fs.readFileSync(f.filePath), previous);
    assert.equal(f.service.list().items[0].id, 'previous');
    assert.equal(fs.readdirSync(f.directory).length, 1);
    f.failRename(false);
    await f.service.commit(reviewed.token, OWNER);
    assert.equal(f.service.list().items[0].id, 'next');
});

test('corrupt saved inbox errors remain visible and explicit reviewed replacement recovers safely', async t => {
    const f = fixture(t);
    fs.writeFileSync(f.filePath, 'PRIVATE corrupt original file');
    const original = fs.readFileSync(f.filePath);
    await assert.rejects(f.service.initialize(), /saved Excel audit could not be opened/);
    assert.throws(() => f.service.status(), /could not be opened/);
    assert.throws(() => f.service.list(), /could not be opened/);
    assert.deepEqual(fs.readFileSync(f.filePath), original);
    const reviewed = await f.preview();
    assert.equal(reviewed.replacesExisting, true);
    assert.deepEqual(fs.readFileSync(f.filePath), original);
    await f.service.commit(reviewed.token, OWNER);
    assert.equal(f.service.status().imported, true);
    assert.equal((await f.service.initialize()).imported, true);
    assert.equal(f.service.list().items[0].id, '0001');
});

test('a corrupt or valid saved file changed after preview cannot be overwritten by that token', async t => {
    const f = fixture(t);
    fs.writeFileSync(f.filePath, 'first corrupt saved file');
    await f.service.initialize().catch(() => undefined);
    const reviewed = await f.preview();
    fs.writeFileSync(f.filePath, 'second corrupt saved file');
    await assert.rejects(f.service.commit(reviewed.token, OWNER), /file changed after this preview/);
    assert.equal(fs.readFileSync(f.filePath, 'utf8'), 'second corrupt saved file');
});

test('invalid persisted row identities fail closed and parser exceptions expose fixed messages', async t => {
    const f = fixture(t);
    await f.import();
    const saved = JSON.parse(fs.readFileSync(f.filePath, 'utf8'));
    saved.rows[0].id = '   ';
    fs.writeFileSync(f.filePath, JSON.stringify(saved));
    await assert.rejects(f.create().initialize(), /could not be opened/);
    const broken = fixture(t, { xlsx: { ...XLSX, read() { throw new Error('PRIVATE parser input and source cells'); } } });
    const error = await broken.preview().catch(error => error);
    assert.match(error.message, /could not be read/);
    assert.equal(error.message.includes('PRIVATE'), false);
});

test('legacy .xls workbook upload is supported without running formulas or macros', async t => {
    const f = fixture(t);
    const preview = await f.preview(workbook([auditRow()], { fileName: 'audit.xls', bookType: 'biff8' }));
    assert.equal(preview.items[0].id, '0001');
    assert.equal(preview.status.totalQuantity, 3);
});

nodeTest('optional owner workbook matches the reviewed audit export schema', {
    skip: !process.env.EXCEL_AUDIT_TEST_FILE,
    timeout: 10_000,
}, async t => {
    const f = fixture(t);
    const file = process.env.EXCEL_AUDIT_TEST_FILE;
    const preview = await f.preview({ fileName: path.basename(file), bytes: fs.readFileSync(file) });
    assert.equal(preview.status.sheetName, 'Stock Audit');
    assert.equal(preview.status.rowCount, 110);
    assert.equal(preview.status.totalQuantity, 498);
    assert.equal(new Set(preview.items.map(item => item.id)).size, preview.items.length);
    assert.equal(fs.existsSync(f.filePath), false);
    await f.service.commit(preview.token, OWNER);
    const restarted = f.create();
    const saved = await restarted.initialize();
    assert.equal(saved.rowCount, 110);
    assert.equal(saved.totalQuantity, 498);
    const rows = restarted.list({ pageSize: 200 }).items;
    assert.equal(rows.length, 110);
    assert.equal(new Set(rows.map(item => item.id)).size, 110);
});
