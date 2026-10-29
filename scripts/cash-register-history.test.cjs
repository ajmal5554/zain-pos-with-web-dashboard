const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
let database, temporaryDirectory;
const handlers = new Map();
let sales = [];
const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

before(async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-register-history-'));
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    database = new PrismaClient({ datasources: { db: { url: `file:${path.join(temporaryDirectory, 'test.db').replaceAll('\\', '/')}` } } });
    // Only a disposable database is used. Sales are stubbed because these tests
    // exercise history selection and closing identity, not POS accounting.
    await database.$executeRawUnsafe(`CREATE TABLE "CashRegister" (
        id TEXT PRIMARY KEY, date TEXT NOT NULL, openedAt TEXT NOT NULL,
        closedAt TEXT, openingFloat REAL NOT NULL, closingExpected REAL,
        closingActual REAL, difference REAL, status TEXT NOT NULL, notes TEXT
    )`);
    await database.$executeRawUnsafe(`CREATE TABLE "CashDrawerTx" (
        id TEXT PRIMARY KEY, registerId TEXT NOT NULL, type TEXT NOT NULL,
        category TEXT NOT NULL, amount REAL NOT NULL, note TEXT NOT NULL, createdAt TEXT NOT NULL
    )`);
    const source = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    const start = source.indexOf('function getLocalDateString()');
    const end = source.indexOf('// Test printer connection', start);
    assert.ok(start > 0 && end > start);
    const compiled = ts.transpileModule(source.slice(start, end), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(compiled, {
        require, console, Date,
        prisma: {
            $queryRawUnsafe: (...args) => database.$queryRawUnsafe(...args),
            $executeRawUnsafe: (...args) => database.$executeRawUnsafe(...args),
            sale: { findMany: async () => sales },
            refund: { findMany: async () => [] }
        },
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
        getUserPermissions: async () => ({ isActive: true, role: 'ADMIN' })
    });
});

beforeEach(async () => {
    sales = [];
    await database.$executeRawUnsafe('DELETE FROM "CashDrawerTx"');
    await database.$executeRawUnsafe('DELETE FROM "CashRegister"');
});

after(async () => {
    if (database) await database.$disconnect();
    if (temporaryDirectory && path.dirname(temporaryDirectory) === path.resolve(os.tmpdir()) && path.basename(temporaryDirectory).startsWith('zain-register-history-')) {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});

async function closing(id, date, closedAt, openingFloat = 100, actual = 200, openedAt = `${date}T09:00:00.000Z`) {
    await database.$executeRawUnsafe(`INSERT INTO "CashRegister"
        (id, date, openedAt, closedAt, openingFloat, closingExpected, closingActual, difference, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'CLOSED')`,
        id, date, openedAt, closedAt, openingFloat, actual, actual);
}

async function history(limit = 365) {
    const response = await handlers.get('register:get-history')(null, { limit });
    assert.equal(response.success, true, response.error);
    return response.data;
}

test('same-day legacy closings show only the latest, without changing records or saved balances', async () => {
    await closing('earlier', '2026-10-01', '2026-10-01T12:00:00.000Z', 9880, 9903);
    await closing('latest', '2026-10-01', '2026-10-01T14:00:00.000Z', 9903, 10403);
    await database.$executeRawUnsafe(`INSERT INTO "CashDrawerTx" VALUES ('out', 'latest', 'CASH_OUT', 'EXPENSE', 50, 'Test', '2026-10-01T13:00:00.000Z')`);
    const rows = await history();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'latest');
    assert.equal(rows[0].openingFloat, 9903);
    assert.equal(rows[0].closingActual, 10403);
    assert.equal(rows[0].transactions[0].id, 'out');
    const stored = await database.$queryRawUnsafe('SELECT * FROM "CashRegister" ORDER BY id');
    assert.equal(stored.length, 2);
    assert.equal(stored[0].closingActual, 9903);
});

test('limit applies to distinct days and equal timestamps choose a stable record', async () => {
    await closing('old', '2026-09-30', '2026-09-30T14:00:00.000Z');
    await closing('a', '2026-10-01', '2026-10-01T14:00:00.000Z');
    await closing('b', '2026-10-01', '2026-10-01T14:00:00.000Z');
    await closing('early-open', '2026-10-01', '2026-10-01T14:00:00.000Z', 100, 200, '2026-10-01T08:00:00.000Z');
    assert.deepEqual(Array.from(await history(2), row => row.id), ['b', 'old']);
    assert.equal((await history(1))[0].id, 'b');
});

test('reopen hides an older same-day closing and closing again updates the same register', async () => {
    const date = today();
    await closing('earlier', date, new Date(Date.now() - 120000).toISOString());
    await closing('latest', date, new Date(Date.now() - 60000).toISOString(), 200, 200);
    const reopened = await handlers.get('register:reopen')(null, { registerId: 'latest' });
    assert.equal(reopened.success, true, reopened.error);
    assert.equal(reopened.data.id, 'latest');
    assert.equal((await history()).length, 0);
    sales = [{ id: 'sale', billNo: 'test', createdAt: new Date(), payments: [{ paymentMode: 'CASH', amount: 50 }] }];
    const closed = await handlers.get('register:close')(null, { registerId: 'latest', actualCashCounted: 250 });
    assert.equal(closed.success, true, closed.error);
    assert.equal(closed.data.register.id, 'latest');
    assert.equal(closed.data.expected, 250);
    assert.equal(closed.data.difference, 0);
    const rows = await history();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'latest');
    assert.equal(rows[0].closingActual, 250);
    const stored = await database.$queryRawUnsafe('SELECT id FROM "CashRegister"');
    assert.equal(stored.length, 2);
});
