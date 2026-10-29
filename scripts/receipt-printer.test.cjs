const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
test('receipt printing resolves category from the sale variant ID', async () => {
    const receipt = {}; let sent, lookup;
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/print.service.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
        exports: receipt, console,
        require: name => name === 'date-fns' ? require(name) : name === '../lib/db' ? { db: { productVariants: { findMany: async args => { lookup = args; return [{ id:'v1',product:{category:{name:'Shirts'}} }]; } } } } : {},
        window: { electronAPI: { settings: { get: async () => ({success:true,data:null}) }, print: { receipt: async data => { sent=data; return {success:true}; } } } }
    });
    await receipt.printService.printReceipt({billNo:1,date:new Date(),items:[{variantId:'v1',name:'Brooklyn | Cotton | XL',quantity:1,total:700}],subtotal:700,discount:0,cgst:0,sgst:0,grandTotal:700}, {receiptPrinter:'Epson'});
    assert.equal(lookup.where.id.in[0],'v1');
    assert.match(sent.html,/Brooklyn \(Shirts\)/); assert.doesNotMatch(sent.html,/Cotton|XL/);
});
vm.runInNewContext(ts.transpileModule(fs.readFileSync('electron/receipt-printer.service.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: exportsObject, setTimeout, clearTimeout });
test('receipt preserves current contents while hiding item attribute descriptions', () => {
    const receipt = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/print.service.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: receipt, require: name => name === 'date-fns' ? require(name) : {}, console });
    const data = { billNo: 2310, date: new Date('2026-10-27T12:00:00Z'), customerName: 'Walk-in Customer', items: [{name:'Shirts 775',quantity:1,mrp:775,rate:775,total:775}], subtotal:775,discount:25,cgst:17.86,sgst:17.86,grandTotal:750 };
    const html = receipt.generateReceiptHtml(data, receipt.DEFAULT_RECEIPT_LAYOUT);
    assert.match(html,/TOTAL:/); assert.match(html,/₹750.00/); assert.match(html,/714.28/);
    assert.match(html,/Gross Subtotal/);
    data.items[0].name = 'Brooklyn - Plain | L | Full Sleeve | Denim';
    data.items[0].variantInfo = 'Collar: Regular | Double Pocket';
    data.items[0].categoryName = 'Shirts';
    const compact = receipt.generateReceiptHtml(data, receipt.DEFAULT_RECEIPT_LAYOUT.map(block => ({...block, styles: {...block.styles, showVariantInfo:true}})));
    assert.match(compact,/Brooklyn - Plain \(Shirts\)/);
    assert.doesNotMatch(compact,/Full Sleeve|Denim|Double Pocket/);
});
test('receipts preserve driver paper settings and never retry on another device', async () => {
    let jobs = [], closed = 0, success = true;
    class Window {
        webContents = {
            getPrintersAsync: async () => [{ name: 'Receipt USB' }],
            executeJavaScript: async source => source.includes('Math.max') ? 500 : undefined,
            print: (options, callback) => { jobs.push(options); callback(success, 'Driver rejected job'); }
        };
        async loadURL() {}
        isDestroyed() { return false; }
        close() { closed++; }
    }
    const send = exportsObject.sendReceipt;
    assert.equal((await send(Window, { html: '<p>Bill</p>' })).success, false);
    assert.equal((await send(Window, { html: '<p>Bill</p>', options: { deviceName: 'Missing' } })).success, false);
    assert.equal(jobs.length, 0);
    assert.equal((await send(Window, { html: '<p>Bill</p>', options: { deviceName: 'Receipt USB', pageSize: '58mm' } })).success, true);
    assert.equal(jobs[0].deviceName, 'Receipt USB'); assert.equal('pageSize' in jobs[0], false);
    success = false;
    const failure = await send(Window, { html: '<p>Bill</p>', options: { deviceName: 'Receipt USB' } });
    assert.match(failure.error, /Driver rejected/); assert.equal(jobs.length, 2); assert.equal(closed, 3);
});

test('stalled Windows discovery returns a stage error and closes the hidden window without submitting', async () => {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('electron/receipt-printer.service.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, setTimeout: fn => setTimeout(fn, 1), clearTimeout });
    let closed = false, printed = false;
    class Window {
        webContents = { getPrintersAsync: () => new Promise(() => {}), print() { printed = true; } };
        isDestroyed() { return false; }
        close() { closed = true; }
    }
    const result = await exports.sendReceipt(Window, { html: '<p>Test</p>', options: { deviceName: 'Receipt' } });
    assert.equal(result.success, false); assert.match(result.error, /detecting Windows printers/);
    assert.equal(closed, true); assert.equal(printed, false);
});

test('receipt supports Rate column left of Qty and Rate subline for multi-quantity items', () => {
    const receipt = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/print.service.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: receipt, require: name => name === 'date-fns' ? require(name) : {}, console });

    const data = {
        billNo: 5001,
        date: new Date('2026-10-28T12:00:00Z'),
        customerName: 'Customer A',
        items: [
            { name: 'Shirt 700', quantity: 2, rate: 700, mrp: 750, total: 1400 },
            { name: 'Pant 1000', quantity: 1, rate: 1000, mrp: 1100, total: 1000 }
        ],
        subtotal: 2400,
        discount: 0,
        cgst: 57.14,
        sgst: 57.14,
        grandTotal: 2400
    };

    // Test 1: Rate column is placed to the left of Qty
    const htmlWithRateCol = receipt.generateReceiptHtml(data, receipt.DEFAULT_RECEIPT_LAYOUT, { showRate: true });
    // In header: Item must appear before Rate, and Rate must appear before Qty
    const itemIndex = htmlWithRateCol.indexOf('>Item<');
    const rateIndex = htmlWithRateCol.indexOf('>Rate<');
    const qtyIndex = htmlWithRateCol.indexOf('>Qty<');
    const amtIndex = htmlWithRateCol.indexOf('>Amt<');
    assert.ok(itemIndex !== -1 && rateIndex !== -1 && qtyIndex !== -1 && amtIndex !== -1);
    assert.ok(itemIndex < rateIndex, 'Item should be before Rate');
    assert.ok(rateIndex < qtyIndex, 'Rate should be to the left of Qty');
    assert.ok(qtyIndex < amtIndex, 'Qty should be before Amt');

    // Test 2: Rate subline when showRateSubline is true and qty > 1
    const htmlWithSubline = receipt.generateReceiptHtml(data, receipt.DEFAULT_RECEIPT_LAYOUT, { showRateSubline: true });
    assert.match(htmlWithSubline, /2 @ ₹700\.00/);
    // Should NOT have 1 @ ₹1000.00 since qty is 1
    assert.doesNotMatch(htmlWithSubline, /1 @ ₹1000\.00/);
});
