const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { exports, require: name => {
        if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`);
        return mocks[name];
    }, process: { env: { JWT_SECRET: 'test-only' } }, console });
    return exports;
}

test('API auth rejects missing, invalid, malformed, deleted and inactive sessions; database failures stay server errors', async () => {
    let decoded = { userId: 'u1' }, active = true, failure;
    class JsonWebTokenError extends Error {}
    const { authMiddleware } = load('zain-pos-api/src/middleware/auth.ts', {
        jsonwebtoken: { JsonWebTokenError, verify() { if (failure === 'jwt') throw new JsonWebTokenError(); return decoded; } },
        '@prisma/client': { PrismaClient: class { user = { findUnique: async () => { if (failure === 'db') throw new Error('offline'); return active === null ? null : { isActive: active }; } }; } }
    });
    async function invoke(token = 'Bearer token') {
        const result = { next: false };
        const req = { headers: { authorization: token } };
        const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
        await authMiddleware(req, res, error => { result.next = true; result.error = error; });
        return { ...result, userId: req.userId };
    }
    assert.equal((await invoke('')).status, 401);
    failure = 'jwt'; assert.equal((await invoke()).status, 401);
    failure = undefined; decoded = {}; assert.equal((await invoke()).status, 401);
    decoded = { userId: 'u1' }; active = false; assert.equal((await invoke()).status, 401);
    active = null; assert.equal((await invoke()).status, 401);
    active = true; const valid = await invoke(); assert.equal(valid.next, true); assert.equal(valid.userId, 'u1');
    failure = 'db'; const unavailable = await invoke(); assert.equal(unavailable.error.message, 'offline'); assert.equal(unavailable.status, undefined);
});

test('dashboard passes date filters to top-products and rejects partial failures instead of reporting zero sales', async () => {
    const calls = []; let failSummary = false;
    const { dashboardService } = load('zain-pos-dashboard/src/features/dashboard/services/dashboard.service.ts', {
        '@/lib/api': { get: async (url, options) => {
            calls.push({ url, options });
            if (url === '/sales/summary') { if (failSummary) throw new Error('unavailable'); return { data: { totalSales: 500, totalOrders: 1, averageOrderValue: 500 } }; }
            if (url === '/sales/audit-payment-modes') return { data: { CASH: [], UPI: [], CARD: [] } };
            return { data: [] };
        } },
        'date-fns': { differenceInDays: (end, start) => (end - start) / 86400000 }
    });
    const start = new Date('2026-10-01T00:00:00+05:30'), end = new Date('2026-10-20T23:59:59+05:30');
    assert.equal((await dashboardService.getStats(start, end)).summary.totalSales, 500);
    const top = calls.find(call => call.url === '/reports/top-products');
    assert.equal(top.options.params.startDate, start.toISOString());
    assert.equal(top.options.params.endDate, end.toISOString());
    await dashboardService.getStats(); // All Time supported without dereferencing null dates.
    failSummary = true;
    await assert.rejects(dashboardService.getStats(start, end), /unavailable/);
});
