const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const domain = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'src/lib/refund.ts'), 'utf8')), { exports: domain.exports });
const { quoteRefund, validateReturnQuantities, validateRefundPayments } = domain.exports;
const saleEditDomain = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'src/lib/saleEdit.ts'), 'utf8')), { exports: saleEditDomain.exports });
const catalogueDescription = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'src/lib/catalogueDescription.ts'), 'utf8')), { exports: catalogueDescription.exports });
const catalogueDomain = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'electron/catalogue.service.ts'), 'utf8')), {
    exports: catalogueDomain.exports,
    require: name => name === '../src/lib/catalogueDescription' ? catalogueDescription.exports : require(name),
});
const stockHelpers = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'electron/tracked-stock.service.ts'), 'utf8')), { exports: stockHelpers.exports });
const returnStockHelpers = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'electron/return-stock.service.ts'), 'utf8')), {
    exports: returnStockHelpers.exports,
    require: name => name === './catalogue.service' ? catalogueDomain.exports
        : name === '../src/lib/catalogueDescription' ? catalogueDescription.exports
        : name === './inventory-workspace.service' ? { getInventoryWorkspace: () => { throw new Error('Unexpected return candidate read during refund'); } } : require(name),
});
const costHelpers={exports:{}};
vm.runInNewContext(transpile(fs.readFileSync(path.join(root,'electron/stock-cost.service.ts'),'utf8')),{exports:costHelpers.exports,module:costHelpers,require,Date});
const shirt = { variantId: 'shirt', quantity: 1, sellingPrice: 700, productName: 'Shirt' };
const pant = { variantId: 'pant', quantity: 1, sellingPrice: 1000, productName: 'Pant' };
const bill = (items = [shirt, pant], grandTotal = 1600) => ({ status: 'COMPLETED', items, grandTotal, refunds: [], exchanges: [] });
const pick = (id = 'shirt', qty = 1) => ({ id, qty });

test('single piece refunds exact net amount; full bill needs no allocation', () => {
    assert.equal(quoteRefund(bill([shirt], 600), [pick()]).total, 600);
    assert.equal(quoteRefund(bill([shirt], 650), [pick()]).total, 650);
    assert.equal(quoteRefund(bill(), [pick(), pick('pant')]).total, 1600);
});
test('partial refund explicitly confirms original discount; zero is a valid confirmation', () => {
    assert.equal(quoteRefund(bill(), [pick()]).requiresDiscount, true);
    assert.equal(quoteRefund(bill(), [pick()], 50).total, 650);
    assert.equal(quoteRefund(bill(), [pick()], 100).total, 600);
    assert.equal(quoteRefund(bill(), [pick()], 0).total, 700);
    assert.equal(quoteRefund(bill([{ ...shirt, sellingPrice: 425 }, pant], 1400), [pick()], 25).total, 400);
});
test('multiple pieces on one line still need a partial-return discount', () => {
    const sale = bill([{ ...shirt, quantity: 2 }], 1300);
    assert.equal(quoteRefund(sale, [pick()]).requiresDiscount, true);
    assert.equal(quoteRefund(sale, [pick('shirt', 2)]).total, 1300);
});
test('remaining full return receives remaining payment, not an invented proportional value', () => {
    const sale = bill();
    sale.refunds.push({ totalRefundAmount: 650, items: [{ variantId: 'shirt', quantity: 1, amount: 650 }] });
    const quote = quoteRefund(sale, [pick('pant')]);
    assert.equal(quote.total, 950);
    assert.equal(quote.discount, 50);
    assert.equal(quote.automatic, true);
    assert.throws(() => quoteRefund(sale, [pick()], 50), /quantity/);
});
test('reject duplicate, fractional, invalid, and already-exchanged quantities', () => {
    for (const qty of [0, -1, 0.5, NaN, Infinity, 2]) assert.throws(() => quoteRefund(bill(), [pick('shirt', qty)], 50));
    assert.throws(() => quoteRefund(bill(), [pick(), pick()], 50), /once/);
    assert.throws(() => quoteRefund(bill(), [pick('missing')], 50), /original/);
    const sale = bill();
    sale.exchanges.push({ items: [{ returnedItemId: 'shirt', returnedQty: 1 }] });
    assert.throws(() => quoteRefund(sale, [pick()], 50), /quantity/);
    assert.throws(() => validateReturnQuantities(sale, [pick()]), /quantity/);
});
test('discount and cash-payment limits are enforced, including non-finite inputs', () => {
    for (const value of [-1, 101, NaN, Infinity]) assert.throws(() => quoteRefund(bill(), [pick()], value));
    for (const payments of [[{ paymentMode: 'SPLIT', amount: 650 }], [{ paymentMode: 'CASH', amount: -1 }], [{ paymentMode: 'UPI', amount: NaN }], [{ paymentMode: 'CASH', amount: 700 }]]) {
        assert.throws(() => validateRefundPayments(payments, 650));
    }
    validateRefundPayments([{ paymentMode: 'CASH', amount: 250 }, { paymentMode: 'UPI', amount: 400 }], 650);
    validateRefundPayments([], 0);
});
test('paise allocation reconciles across multiple partial-return lines', () => {
    const sale = bill([{ ...shirt, sellingPrice: 1 }, { ...pant, sellingPrice: 1 }, { variantId: 'third', quantity: 1, sellingPrice: 1 }], 2.99);
    const quote = quoteRefund(sale, [pick(), pick('pant')], 0.01);
    assert.equal(Math.round(quote.items.reduce((sum, item) => sum + item.amount, 0) * 100), 199);
});
test('previous partial refunds consume the available bill discount', () => {
    const sale = bill([shirt, pant, { variantId: 'third', quantity: 1, sellingPrice: 425 }], 2000);
    sale.refunds.push({ totalRefundAmount: 600, items: [{ variantId: 'shirt', quantity: 1, amount: 600 }] });
    assert.equal(quoteRefund(sale, [pick('third')], 25).total, 400);
    assert.throws(() => quoteRefund(sale, [pick('third')], 26), /between/);
});
test('exchange-funded replacement cannot turn store credit into a cash refund', () => {
    const sale = { ...bill([shirt], 700), paymentMethod: 'EXCHANGE', payments: [{ paymentMode: 'EXCHANGE_CREDIT', amount: 700 }] };
    assert.throws(() => quoteRefund(sale, [pick()], 0), /cash paid/);
});

// Exercise the actual IPC transaction handler against a disposable SQLite database.
// Migration diff only reads the schema. Never use the configured shop DB URL.
let prisma, temporaryDirectory, refundHandler, exchangeHandler, updateHandler, getSaleHandler, actor;
before(async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-refund-test-'));
    // Match the actual runtime client. It currently contains pre-existing schema
    // additions (including cash-drawer fields) not in prisma/schema.prisma.
    const sql = execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'prisma/generated/client/schema.prisma'), '--script'], { encoding: 'utf8', cwd: root });
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    prisma = new PrismaClient({ datasources: { db: { url: `file:${path.join(temporaryDirectory, 'test.db').replaceAll('\\', '/')}` } } });
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
    actor = await prisma.user.create({ data: { username: 'test', password: 'not-a-real-account', name: 'Test', role: 'ADMIN' } });
    const source = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    const context = {
        ...domain.exports, ...saleEditDomain.exports, ...catalogueDescription.exports,
        ...stockHelpers.exports, ...returnStockHelpers.exports, ...costHelpers.exports,
        enrichCatalogueVariants: catalogueDomain.exports.enrichCatalogueVariants, prisma,
        ipcMain: { handle: (channel, handler) => { if (channel === 'sales:updateSale') updateHandler = handler; if (channel === 'sales:getSaleById') getSaleHandler = handler; } },
        PermissionMiddleware: { editSale: null },
        createSecureIpcHandler: (channel, _permission, handler) => { if (channel === 'sales:refund') refundHandler = handler; else exchangeHandler = handler; },
        sanitizeString: value => value == null ? undefined : String(value).trim().slice(0, 500),
        roundCurrency: value => Math.round(Number(value || 0) * 100) / 100,
        cloudSync: { queueRefund: async () => {}, queueSale: async () => {}, queueExchange: async () => {}, syncAuditLogs: async () => {} },
        getNextBillNoForDate: async () => `replacement-${randomUUID()}`,
        console: { error() {}, log() {} }
    };
    const refundSource = source.slice(source.indexOf('// Professional Refund Handler'), source.indexOf('// Void Sale —'));
    const exchangeSource = source.slice(source.indexOf('// Professional Exchange Handler'), source.indexOf('// Retrieve structured Exchange/Refund details'));
    assert.ok(refundSource.includes("'sales:refund'"));
    assert.ok(exchangeSource.includes("'sales:exchange'"));
    const validationSource = source.slice(source.indexOf('function validateSaleData('), source.indexOf('function validateProductData('));
    const editSource = source.slice(source.indexOf('// Get Sale By ID (for change detection'), source.indexOf('// Helper to compute actual net paid'));
    vm.runInNewContext(transpile(validationSource + '\n' + refundSource + '\n' + exchangeSource + '\n' + editSource), context);
});
after(async () => {
    if (prisma) await prisma.$disconnect();
    // Only remove the exact directory returned by mkdtemp under the OS temp root.
    if (temporaryDirectory && path.dirname(temporaryDirectory) === path.resolve(os.tmpdir()) && path.basename(temporaryDirectory).startsWith('zain-refund-test-')) {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});
async function fixture(prices = [700, 1000], discount = 100) {
    const category = await prisma.category.create({ data: { name: randomUUID() } });
    const variants = [];
    for (const price of prices) {
        const product = await prisma.product.create({ data: { name: `Item ${price}`, categoryId: category.id } });
        variants.push(await prisma.productVariant.create({ data: { productId: product.id, sku: randomUUID(), barcode: randomUUID(), mrp: price, sellingPrice: price, costPrice: 0, stock: 10, isSynced: true } }));
    }
    const subtotal = prices.reduce((a, b) => a + b, 0);
    const sale = await prisma.sale.create({ data: { billNo: randomUUID(), userId: actor.id, subtotal, discount, taxAmount: 0, cgst: 0, sgst: 0, grandTotal: subtotal - discount, paidAmount: subtotal - discount, changeAmount: 0,
        items: { create: variants.map(v => ({ variantId: v.id, productName: `Item ${v.sellingPrice}`, quantity: 1, mrp: v.mrp, sellingPrice: v.sellingPrice, discount: 0, taxRate: 5, taxAmount: 0, total: v.sellingPrice })) },
        payments: { create: [{ paymentMode: 'CASH', amount: subtotal - discount }] }
    }, include: { items: true, refunds: { include: { items: true } }, exchanges: { include: { items: true } }, payments: true } });
    return { sale, variants };
}
function payload(sale, variant, discount = 50) {
    const quote = quoteRefund(sale, [{ id: variant.id, qty: 1 }], discount);
    return { requestId: randomUUID(), originalInvoiceId: sale.id, userId: actor.id, reason: 'Test return', originalDiscount: quote.discount, totalAmount: quote.total, items: quote.items, payments: [{ paymentMode: 'CASH', amount: quote.total }] };
}
test('real refund transaction records actual payment, audit allocation, sync flag, and one restock on retry', async () => {
    const { sale, variants } = await fixture();
    const request = payload(sale, variants[0]);
    const first = await refundHandler(null, request, actor);
    assert.equal(first.success, true, first.error);
    assert.equal(first.data.totalRefundAmount, 650);
    assert.equal(first.data.payments[0].amount, 650);
    assert.equal(first.data.items[0].amount, 650);
    const retried = await refundHandler(null, request, actor);
    assert.equal(retried.data.id, first.data.id);
    const stock = await prisma.productVariant.findUnique({ where: { id: variants[0].id } });
    assert.equal(stock.stock, 11);
    assert.equal(stock.isSynced, false);
    assert.equal(await prisma.inventoryMovement.count({ where: { reference: first.data.id } }), 1);
    const audit = await prisma.auditLog.findUnique({ where: { id: `refund-request-${request.requestId}` } });
    assert.equal(JSON.parse(audit.details).originalDiscount, 50);
    assert.equal((await prisma.sale.findUnique({ where: { id: sale.id } })).grandTotal, 1600);
    const duplicate = await refundHandler(null, { ...request, requestId: randomUUID() }, actor);
    assert.equal(duplicate.success, false);
});
test('invalid payment leaves no refund or stock movement', async () => {
    const { sale, variants } = await fixture();
    const request = payload(sale, variants[0]);
    request.payments[0].amount = 700;
    const result = await refundHandler(null, request, actor);
    assert.equal(result.success, false);
    assert.equal(await prisma.refund.count({ where: { originalInvoiceId: sale.id } }), 0);
    assert.equal((await prisma.productVariant.findUnique({ where: { id: variants[0].id } })).stock, 10);
});
test('split-paid invoice refunds through a real mode and the final return reconciles to the original payment', async () => {
    const { sale, variants } = await fixture();
    await prisma.sale.update({ where: { id: sale.id }, data: { paymentMethod: 'SPLIT', payments: { deleteMany: {}, create: [{ paymentMode: 'CASH', amount: 600 }, { paymentMode: 'UPI', amount: 1000 }] } } });
    const request = payload(sale, variants[0]);
    request.payments = [{ paymentMode: 'UPI', amount: 650 }];
    const first = await refundHandler(null, request, actor);
    assert.equal(first.success, true, first.error);
    const refreshed = await prisma.sale.findUnique({ where: { id: sale.id }, include: { items: true, refunds: { include: { items: true } }, exchanges: { include: { items: true } }, payments: true } });
    const lastRequest = payload(refreshed, variants[1]);
    const last = await refundHandler(null, lastRequest, actor);
    assert.equal(last.success, true, last.error);
    assert.equal(last.data.totalRefundAmount, 950);
    assert.equal(first.data.totalRefundAmount + last.data.totalRefundAmount, sale.grandTotal);
});
test('exchange keeps full billed-price credit and refund cannot return the exchanged piece again', async () => {
    const { sale, variants } = await fixture([700, 725], 100);
    const result = await exchangeHandler(null, { originalInvoiceId: sale.id, userId: actor.id, discount: 0, items: [{ returnedId: variants[0].id, returnedQty: 1, newId: variants[1].id, newQty: 1, priceDiff: 25 }], payments: [{ paymentMode: 'UPI', amount: 25 }], replacementPaymentMethod: 'UPI' }, actor);
    assert.equal(result.success, true, result.error);
    assert.equal(result.data.replacementSale.payments.find(p => p.paymentMode === 'EXCHANGE_CREDIT').amount, 700);
    assert.equal(result.data.replacementSale.paidAmount, 25);
    const staleRefund = await refundHandler(null, payload(sale, variants[0]), actor);
    assert.equal(staleRefund.success, false);
    const live = await getSaleHandler(null, sale.id);
    assert.equal(live.data.exchanges.length, 1);
    const beforeStock = await prisma.productVariant.findUnique({ where: { id: variants[0].id } });
    const staleEdit = await updateHandler(null, { saleId: sale.id, saleData: sale, userId: actor.id });
    assert.equal(staleEdit.success, false);
    assert.match(staleEdit.error, /exchange/);
    assert.equal((await prisma.productVariant.findUnique({ where: { id: variants[0].id } })).stock, beforeStock.stock);
    assert.equal((await prisma.sale.findUnique({ where: { id: sale.id } })).grandTotal, sale.grandTotal);
});

test('new exchange bill snapshots garment details without changing the original bill description', async () => {
    const { sale, variants } = await fixture([700, 725], 100);
    await catalogueDomain.exports.ensureCatalogueSchema(prisma);
    await prisma.$executeRawUnsafe(
        'INSERT INTO "ProductVariantGarmentDetail" ("variantId", "isPrepared", "brand", "fabric", "quality", "pattern", "styleRef") VALUES (?, 0, ?, ?, ?, ?, ?)',
        variants[1].id, 'Crazy Heart', 'Cotton', 'Premium', 'Checks', 'CH-01'
    );
    const result = await exchangeHandler(null, {
        originalInvoiceId: sale.id, userId: actor.id, discount: 0,
        items: [{ returnedId: variants[0].id, returnedQty: 1, newId: variants[1].id, newQty: 1, priceDiff: 25 }],
        payments: [{ paymentMode: 'UPI', amount: 25 }], replacementPaymentMethod: 'UPI',
    }, actor);
    assert.equal(result.success, true, result.error);
    const replacement = await prisma.saleItem.findFirst({ where: { saleId: result.data.replacementSale.id } });
    assert.equal(replacement.productName, 'Item 725 | Crazy Heart | Checks | Cotton | Premium | Ref: CH-01');
    assert.equal(replacement.variantInfo, '');
    assert.equal((await prisma.saleItem.findUnique({ where: { id: sale.items[0].id } })).productName, sale.items[0].productName);
    assert.equal(result.data.replacementSale.paidAmount, 25);
});
test('POS updates reject refunded/voided bills but ordinary saved bills remain editable', async () => {
    const { sale, variants } = await fixture();
    const ordinary = await updateHandler(null, { saleId: sale.id, saleData: sale, userId: actor.id });
    assert.equal(ordinary.success, true, ordinary.error);
    const refunded = await refundHandler(null, payload(sale, variants[0]), actor);
    assert.equal(refunded.success, true, refunded.error);
    const live = await getSaleHandler(null, sale.id);
    assert.equal(live.data.refunds.length, 1);
    const staleEdit = await updateHandler(null, { saleId: sale.id, saleData: sale, userId: actor.id });
    assert.equal(staleEdit.success, false);
    assert.match(staleEdit.error, /refund/);
    const other = await fixture();
    await prisma.sale.update({ where: { id: other.sale.id }, data: { status: 'VOIDED' } });
    const voidedEdit = await updateHandler(null, { saleId: other.sale.id, saleData: other.sale, userId: actor.id });
    assert.equal(voidedEdit.success, false);
    assert.match(voidedEdit.error, /voided/);
});
test('failed POS update rolls back earlier stock changes', async () => {
    const { sale, variants } = await fixture();
    const originalIds = sale.items.map(item => item.id).sort();
    const result = await updateHandler(null, { saleId: sale.id, userId: actor.id, saleData: {
        ...sale,
        items: [{ ...sale.items[0], quantity: 2 }, { ...sale.items[1], variantId: 'missing-variant' }]
    } });
    assert.equal(result.success, false);
    assert.equal((await prisma.productVariant.findUnique({ where: { id: variants[0].id } })).stock, 10);
    assert.equal(await prisma.inventoryMovement.count({ where: { reference: sale.id } }), 0);
    const items = await prisma.saleItem.findMany({ where: { saleId: sale.id } });
    assert.deepEqual(items.map(item => item.id).sort(), originalIds);
});

// Execute the actual POS restoration function with synthetic storage and IPC.
// This checks stale-session handling without starting Electron or the shop DB.
function posRestoreHarness(sale, draftItems = [], changedAt = sale.updatedAt) {
    const source = fs.readFileSync(path.join(root, 'src/pages/POS.tsx'), 'utf8');
    const loadSource = source.slice(source.indexOf('    const loadData = async () => {'), source.indexOf('    const loadShopSettings ='));
    const session = { saleId: sale.id, originalSaleData: { ...sale, updatedAt: changedAt }, cartItems: draftItems, paidAmount: '650', discountAmount: '50', paymentMethod: 'CASH', splitAmounts: { CASH: 0, UPI: 0, CARD: 0 }, customerName: 'Test', showPayment: false };
    const state = { cart: draftItems.slice(), released: false, nextBill: false, currentSaleId: null, error: '' };
    const context = { ...saleEditDomain.exports, sessionLoadId: { current: 0 }, location: {},
        localStorage: { getItem: () => JSON.stringify(session) }, ACTIVE_SALE_SESSION_KEY: 'test',
        window: { electronAPI: { sales: { getSaleById: async () => ({ success: true, data: sale }) } } },
        useCartStore: { getState: () => ({ items: state.cart }) },
        clearCart: () => { state.cart = []; }, addItem: item => state.cart.push(item),
        clearActiveSaleSession: () => {},
        releasePostSaveUpdateWindow: () => { state.cart = []; state.released = true; },
        showNotification: message => { state.notification = message; },
        loadNextBillNo: async () => { state.nextBill = true; }, loadProducts: async () => {}, loadShopSettings: async () => {}, loadCustomers: async () => {},
        setSessionError: value => { state.error = value; }, setCurrentSaleId: id => { state.currentSaleId = id; },
        console: { error() {} }
    };
    for (const setter of ['setLoadingSession', 'setBillNo', 'setOriginalSaleData', 'setOriginalPaidAmount', 'setPaidAmount', 'setDiscountAmount', 'setPaymentMethod', 'setSplitAmounts', 'setCustomerName', 'setCustomerPhone', 'setCustomerSearchInput', 'setSelectedCustomerId', 'setShowPayment', 'setIsEditMode', 'setHasChanges']) context[setter] = () => {};
    context.exports = {};
    vm.runInNewContext(transpile(loadSource + '\nexports.load = loadData;'), context);
    return { state, load: context.exports.load, context };
}
test('POS discards stale exchanged/refunded/voided carts on return from History', async () => {
    for (const change of [{ exchanges: [{ id: 'ex' }] }, { refunds: [{ id: 'refund' }] }, { status: 'VOIDED' }]) {
        const sale = { ...bill(), id: 'saved', billNo: '123', updatedAt: '2026-09-29T12:00:00Z', ...change };
        const harness = posRestoreHarness(sale, [shirt]);
        await harness.load();
        assert.equal(harness.state.error, '');
        assert.equal(harness.state.released, true);
        assert.equal(harness.state.cart.length, 0);
        assert.equal(harness.state.nextBill, true);
    }
});
test('POS keeps ordinary draft corrections, including an intentionally empty draft', async () => {
    const sale = { ...bill(), id: 'saved', billNo: '123', updatedAt: '2026-09-29T12:00:00Z' };
    for (const draft of [[], [{ ...shirt, quantity: 2 }]]) {
        const harness = posRestoreHarness(sale, draft);
        await harness.load();
        assert.equal(harness.state.error, '');
        assert.equal(harness.state.released, false);
        assert.equal(harness.state.currentSaleId, 'saved');
        assert.equal(harness.state.cart.length, draft.length);
        if (draft.length) assert.equal(harness.state.cart[0].quantity, 2);
    }
});
test('POS reloads changed invoices and fails closed if their live status cannot be read', async () => {
    const sale = { ...bill(), id: 'saved', billNo: '123', updatedAt: '2026-09-29T12:01:00Z' };
    const changed = posRestoreHarness(sale, [shirt], '2026-09-29T12:00:00Z');
    await changed.load();
    assert.equal(changed.state.cart.length, 2);
    const failed = posRestoreHarness(sale, [shirt]);
    failed.context.window.electronAPI.sales.getSaleById = async () => ({ success: false, error: 'Database unavailable' });
    await failed.load();
    assert.match(failed.state.error, /Database unavailable/);
    assert.equal(failed.state.currentSaleId, null);
    assert.equal(failed.state.cart.length, 1);
});

test('actual refund handler keeps old financial item and amount while restocking only the identified tracked barcode', async () => {
    const { sale, variants } = await fixture();
    await catalogueDomain.exports.ensureCatalogueSchema(prisma);
    await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "StockVariantTracking" ("variantId" TEXT NOT NULL PRIMARY KEY, "activatedAt" TEXT NOT NULL)');
    const target = await prisma.productVariant.create({ data: { productId: variants[0].productId, sku: randomUUID(), barcode: randomUUID(), mrp: 700, sellingPrice: 700, costPrice: 0, stock: 0 } });
    await prisma.$executeRawUnsafe('INSERT INTO "StockVariantTracking" ("variantId", "activatedAt") VALUES (?, ?)', target.id, new Date().toISOString());
    try {
        const request = payload(sale, variants[0]);
        const missing = await refundHandler(null, request, actor);
        assert.equal(missing.success, false); assert.match(missing.error, /Identify the returned garment/);
        assert.equal(await prisma.refund.count({ where: { originalInvoiceId: sale.id } }), 0);
        request.items[0].stockChoice = { disposition: 'TRACKED', targetVariantId: target.id, confirmed: true };
        const first = await refundHandler(null, request, actor);
        assert.equal(first.success, true, first.error);
        assert.equal(first.data.items[0].variantId, variants[0].id);
        assert.equal(first.data.totalRefundAmount, 650);
        assert.equal((await prisma.productVariant.findUnique({ where: { id: variants[0].id } })).stock, 10);
        assert.equal((await prisma.productVariant.findUnique({ where: { id: target.id } })).stock, 1);
        const movements = await prisma.inventoryMovement.findMany({ where: { reference: first.data.id } });
        assert.equal(movements.length, 1); assert.equal(movements[0].variantId, target.id);
        const retry = await refundHandler(null, request, actor);
        assert.equal(retry.data.id, first.data.id);
        assert.equal((await prisma.productVariant.findUnique({ where: { id: target.id } })).stock, 1);
        const audits = await prisma.auditLog.findMany({ where: { action: 'RETURN_STOCK_ROUTE' } });
        const route = audits.map(row => JSON.parse(row.details)).filter(row => row.reference === first.data.id);
        assert.equal(route.length, 1); assert.equal(route[0].sourceVariantId, variants[0].id); assert.equal(route[0].targetVariantId, target.id);
    } finally { await prisma.$executeRawUnsafe('DELETE FROM "StockVariantTracking" WHERE "variantId" = ?', target.id); }
});

test('actual refund handler records held damaged stock without increasing any saleable balance', async () => {
    const { sale, variants } = await fixture();
    const request = payload(sale, variants[0]);
    request.items[0].stockChoice = { disposition: 'HOLD', confirmed: true, reason: 'Torn seam; held for inspection' };
    const result = await refundHandler(null, request, actor);
    assert.equal(result.success, true, result.error);
    assert.equal(result.data.totalRefundAmount, 650);
    assert.equal((await prisma.productVariant.findUnique({ where: { id: variants[0].id } })).stock, 10);
    assert.equal(await prisma.inventoryMovement.count({ where: { reference: result.data.id } }), 0);
    const rows = await prisma.auditLog.findMany({ where: { action: 'RETURN_STOCK_ROUTE' } });
    const route = rows.map(row => JSON.parse(row.details)).find(row => row.reference === result.data.id);
    assert.equal(route.disposition, 'HOLD'); assert.equal(route.targetVariantId, null); assert.match(route.reason, /Torn seam/);
});
