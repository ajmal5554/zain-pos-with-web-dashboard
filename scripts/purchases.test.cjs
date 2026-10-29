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

test('purchase receipts: immutable costs, price batches, rollback, replay, debt and drawer payments', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-purchases-test-'));
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    const db = new PrismaClient({ datasources: { db: { url: 'file:' + path.join(directory, 'purchases.db').replaceAll('\\', '/') } } });
    try {
        const sql = execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'prisma/generated/client/schema.prisma'), '--script'], { encoding: 'utf8', cwd: root });
        for (const statement of sql.split(';').map(v => v.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
        const user = await db.user.create({ data: { username: 'purchase-owner', name: 'Owner', password: 'fixture-only', role: 'ADMIN', isActive: true } });
        const conversion = load('electron/stock-conversion.service'), purchases = load('electron/purchases.service');
        const stock = await conversion.saveStockEntry(db, { operationId: randomUUID(), batchName: 'Opening audit', rows: [{ name: 'Crazy Heart Plain XL', category: 'Shirts', brand: 'Crazy Heart', size: 'XL', mrp: 700, quantity: 15, attributes: { fabric: 'Cotton', pattern: 'Plain', custom_finish: 'Soft' } }] }, user);
        const variantId = stock.items[0].variantId;
        const line = { variantId, quantity: 10, unitCost: 450, sellingPrice: 700, mrp: 700, expectedSellingPrice: 700, expectedMrp: 700 };
        const input = { operationId: randomUUID(), supplier: 'Supplier One', invoiceNumber: '2026-1', invoiceDate: '2026-10-01', batchName: 'October delivery', discount: 100, charges: 50, paid: 1000, paymentMode: 'UPI', lines: [line] };
        await assert.rejects(purchases.receivePurchase(db, input, { ...user, role: 'CASHIER', permManageInventory: true, permViewCostPrice: false }), /permissions/);
        const first = await purchases.receivePurchase(db, input, user);
        assert.equal(first.totalPaise, 445000); assert.equal(first.barcodes[0], stock.items[0].barcode);
        assert.equal((await db.productVariant.findUnique({ where: { id: variantId } })).stock, 25);
        assert.equal((await db.productVariant.findUnique({ where: { id: variantId } })).costPrice, 0);
        assert.equal((await purchases.receivePurchase(db, input, user)).id, first.id);
        assert.equal((await db.productVariant.findUnique({ where: { id: variantId } })).stock, 25);
        await assert.rejects(purchases.receivePurchase(db, { ...input, supplier: 'Changed' }, user), /different content/);
        await assert.rejects(purchases.receivePurchase(db, { ...input, operationId: randomUUID(), supplier: 'supplier one' }, user), /already recorded/);
        let detail = await purchases.purchaseDetail(db, { id: first.id }, user);
        assert.equal(Number(detail.duePaise), 345000); assert.equal(Number(detail.lines[0].landedTotalPaise), 445000);
        const upgraded = await purchases.receivePurchase(db, { ...input, operationId: randomUUID(), invoiceNumber: '2026-2', discount: 0, charges: 0, paid: 0, lines: [{ ...line, unitCost: 500, sellingPrice: 750, mrp: 800 }] }, user);
        assert.notEqual(upgraded.barcodes[0], first.barcodes[0]); assert.match(upgraded.barcodes[0], /^\d{6}$/);
        const newVariant = await db.productVariant.findUnique({ where: { barcode: upgraded.barcodes[0] } });
        assert.equal(newVariant.stock, 10); assert.equal(newVariant.sellingPrice, 750); assert.equal(newVariant.mrp, 800);
        assert.equal((await db.productVariant.findUnique({ where: { id: variantId } })).sellingPrice, 700);
        const attrs = await db.$queryRawUnsafe('SELECT metadata FROM ProductVariantGarmentDetail WHERE variantId=?', newVariant.id);
        assert.equal(JSON.parse(attrs[0].metadata).custom_finish, 'Soft');
        await assert.rejects(purchases.receivePurchase(db, { ...input, operationId: randomUUID(), invoiceNumber: 'bad', lines: [line, { ...line, variantId: newVariant.id, expectedSellingPrice: 999 }] }, user), /price changed/);
        assert.equal((await db.productVariant.findUnique({ where: { id: variantId } })).stock, 25, 'late failure rolls back earlier receipt');
        assert.equal((await purchases.listPurchases(db, {}, user)).total, 2);
        const p = { operationId: randomUUID(), purchaseId: first.id, amount: 500, mode: 'BANK' };
        await purchases.payPurchase(db, p, user); await purchases.payPurchase(db, p, user);
        detail = await purchases.purchaseDetail(db, { id: first.id }, user); assert.equal(Number(detail.duePaise), 295000); assert.equal(detail.payments.length, 2);
        await assert.rejects(purchases.payPurchase(db, { ...p, operationId: randomUUID(), amount: 4000 }, user), /exceeds/);
        await assert.rejects(purchases.payPurchase(db, { ...p, operationId: randomUUID(), mode: 'CASH_DRAWER' }, user), /Open today/);
        const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        await db.$executeRawUnsafe('CREATE TABLE CashRegister (id TEXT PRIMARY KEY, date TEXT, openingFloat REAL, status TEXT, openedAt TEXT)');
        await db.$executeRawUnsafe('CREATE TABLE CashDrawerTx (id TEXT PRIMARY KEY, registerId TEXT, type TEXT, category TEXT, amount REAL, note TEXT, createdAt TEXT)');
        const register = { id: randomUUID() };
        await db.$executeRawUnsafe('INSERT INTO CashRegister VALUES (?, ?, 5000, ?, ?)', register.id, date, 'OPEN', new Date().toISOString());
        const cash = { operationId: randomUUID(), purchaseId: first.id, amount: 500, mode: 'CASH_DRAWER' };
        await purchases.payPurchase(db, cash, user); await purchases.payPurchase(db, cash, user);
        const cashTx = await db.$queryRawUnsafe('SELECT * FROM CashDrawerTx'); assert.equal(cashTx.length, 1); assert.equal(cashTx[0].amount, 500); assert.equal(cashTx[0].type, 'CASH_OUT');
        await db.$executeRawUnsafe("UPDATE CashRegister SET status='CLOSED' WHERE id=?", register.id);
        await assert.rejects(purchases.payPurchase(db, { ...cash, operationId: randomUUID() }, user), /Open today/);
        assert.equal((await purchases.purchaseItems(db, { search: stock.items[0].barcode }, user)).length, 1);
        assert.equal((await purchases.listPurchases(db, { search: 'no supplier' }, user)).total, 0);
        for (const change of [{ discount: 99999 }, { paid: 99999 }, { invoiceDate: '2026-02-30' }, { lines: [{ ...line, unitCost: 450.001 }] }, { lines: [line, line] }]) await assert.rejects(purchases.receivePurchase(db, { ...input, operationId: randomUUID(), invoiceNumber: randomUUID(), ...change }, user));
        const paidInvoice = await purchases.receivePurchase(db, { ...input, operationId: randomUUID(), invoiceNumber: 'paid', discount: 0, charges: 0, paid: 4500, paymentMode: 'PERSONAL_CASH' }, user);
        assert.equal(Number((await purchases.purchaseDetail(db, { id: paidInvoice.id }, user)).duePaise), 0);
        assert.equal((await db.$queryRawUnsafe('SELECT * FROM CashDrawerTx')).length, 1, 'personal cash does not reduce drawer');
        assert.doesNotThrow(() => JSON.stringify(detail), 'IPC detail contains serializable numeric values');
        const rounded = await purchases.receivePurchase(db, { ...input, operationId: randomUUID(), invoiceNumber: 'rounding', discount: 0.01, charges: 0.02, paid: 0, lines: [{ ...line, quantity: 3, unitCost: 333.33 }, { ...line, variantId: newVariant.id, expectedSellingPrice: 750, expectedMrp: 800, sellingPrice: 750, mrp: 800, quantity: 2, unitCost: 499.99 }] }, user);
        const roundedDetail = await purchases.purchaseDetail(db, {id: rounded.id}, user);
        assert.equal(roundedDetail.lines.reduce((sum,l) => sum + Number(l.landedTotalPaise),0), rounded.totalPaise, 'allocated costs sum exactly to invoice total');
        assert.equal((await purchases.listPurchases(db,{search:'rounding'},user)).totals.totalPaise,rounded.totalPaise);
        await assert.rejects(purchases.listPurchases(db,{}, {...user,isActive:false}), /permissions/);

    } finally {
        await db.$disconnect();
        assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

