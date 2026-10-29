const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const auth = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'electron/session-auth.service.ts'), 'utf8')), {
    exports: auth.exports, module: auth, Date, Map, WeakSet,
});
const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const admin = { id: 'admin', role: 'ADMIN', isActive: true, permViewCostPrice: true, permPrintSticker: true };
const cashier = { id: 'cashier', role: 'CASHIER', isActive: true, permManageProducts: false, permViewCostPrice: false };

function fixture(user = cashier) {
    const handlers = new Map();
    const calls = [];
    const userMap = new Map([[admin.id, admin], [cashier.id, user]]);
    const middleware = rule => async actor => ({ allowed: Boolean(actor?.isActive && rule(actor)), reason: 'Permission denied' });
    const context = {
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
        logger: { warn() {}, error() {} },
        prisma: { user: { findUnique: async ({ where }) => userMap.get(where.id) } },
        resolveElectronSessionUser: auth.exports.resolveElectronSessionUser,
        validateIpcRequest: async () => { throw new Error('Untrusted identity path must not run'); },
        PermissionMiddleware: {
            authenticated: middleware(() => true),
            manageProducts: middleware(actor => actor.role === 'ADMIN' || actor.permManageProducts),
        },
        catalogueSaveProduct: async (_db, input, actor) => { calls.push(['save', actor.id, input]); return { id: 'saved', actor: actor.id }; },
        catalogueGetProduct: async (_db, id, actor) => ({ id, actor: actor.id }),
        catalogueListProducts: async (_db, _args, actor) => [{ actor: actor.id }],
        catalogueListVariants: async (_db, _args, actor) => [{ actor: actor.id, isPrepared: true }],
        catalogueReserveBarcode: async (_db, _args, actor) => ({ actor: actor.id, barcode: '001001' }),
        catalogueCheckBarcode: async () => ({ exists: false }),
        Date,
    };
    const helper = main.slice(main.indexOf('function createSecureIpcHandler<'), main.indexOf('// --- Input Validation Helpers ---'));
    const routes = main.slice(main.indexOf('// --- Catalogue & Label Readiness Handlers (ST-02) ---'));
    vm.runInNewContext(compile(helper + '\n' + routes), context);
    const senderId = Math.floor(Math.random() * 1e9);
    const event = { sender: { id: senderId, isDestroyed: () => false } };
    const bind = id => auth.exports.electronSessions.bind(senderId, id);
    const close = () => auth.exports.clearElectronSession(senderId);
    return { handlers, calls, event, bind, close, userMap, context };
}

test('actual catalogue IPC rejects anonymous calls even with a forged admin ID', async () => {
    const f = fixture();
    try {
        for (const channel of ['catalogue:saveProduct', 'catalogue:listProducts', 'catalogue:listVariants', 'catalogue:generateBarcode']) {
            const response = await f.handlers.get(channel)(f.event, { userId: admin.id });
            assert.equal(response.success, false, channel);
            assert.match(response.error, /Authentication required/);
        }
        assert.equal(f.calls.length, 0);
    } finally { f.close(); }
});

test('actual catalogue IPC uses the session instead of a spoofed privileged user', async () => {
    const f = fixture();
    try {
        f.bind(cashier.id);
        const denied = await f.handlers.get('catalogue:saveProduct')(f.event, { userId: admin.id });
        assert.equal(denied.success, false);
        const read = await f.handlers.get('catalogue:listProducts')(f.event, { userId: admin.id });
        assert.equal(read.success, true);
        assert.equal(read.data[0].actor, cashier.id);
        assert.equal(f.calls.length, 0);
    } finally { f.close(); }
});

test('actual catalogue IPC works without renderer userId after password-established session', async () => {
    const f = fixture();
    try {
        f.bind(admin.id);
        const listed = await f.handlers.get('catalogue:listVariants')(f.event, {});
        assert.equal(listed.success, true);
        assert.equal(listed.data[0].isPrepared, true);
        const saved = await f.handlers.get('catalogue:saveProduct')(f.event, { requestId: 'request', name: 'Shirt' });
        assert.equal(saved.success, true);
        assert.equal(f.calls[0][1], admin.id);
    } finally { f.close(); }
});

test('actual catalogue IPC rechecks disabled users and rejects calls after logout', async () => {
    const f = fixture();
    try {
        f.bind(admin.id);
        f.userMap.set(admin.id, { ...admin, isActive: false });
        const disabled = await f.handlers.get('catalogue:listProducts')(f.event, {});
        assert.equal(disabled.success, false);
        f.userMap.set(admin.id, admin);
        const invalidated = await f.handlers.get('catalogue:listProducts')(f.event, {});
        assert.equal(invalidated.success, false);
    } finally { f.close(); }
});

test('actual billing preparation lookup fails closed on database errors', async () => {
    const start = main.indexOf('async function checkAnyVariantPreparedSafe(');
    const end = main.indexOf('function validateProductData(', start);
    const exports = {};
    vm.runInNewContext(compile(main.slice(start, end) + '\nexports.guard = checkAnyVariantPreparedSafe;'), { exports });
    await assert.rejects(exports.guard({ $queryRawUnsafe: async () => { throw new Error('read failed'); } }, ['prepared']), /Unable to verify/);
    assert.equal(await exports.guard({ $queryRawUnsafe: async () => [] }, ['legacy']), false);
    await assert.rejects(exports.guard({ $queryRawUnsafe: async query => query.startsWith('SELECT name') ? [{ name: 'ProductVariantGarmentDetail' }] : [] }, ['partial']), /Unable to verify/);
});

function genericRouteFixture(user = admin) {
    const f = fixture(user);
    let queries = 0;
    const permitted = async () => ({ allowed: true });
    Object.assign(f.context.PermissionMiddleware, {
        manageUsers: permitted, deleteProduct: permitted, viewReports: permitted,
        adminOnly: permitted, editSettings: permitted,
    });
    Object.assign(f.context, {
        containsSensitiveQueryField: auth.exports.containsSensitiveQueryField,
        maskSessionResult: auth.exports.maskSessionResult,
        debouncedProductSync() {},
    });
    for (const model of ['product', 'productVariant', 'category', 'inventoryMovement', 'customer']) {
        f.context.prisma[model] = new Proxy({}, { get: () => async () => { queries++; return { costPrice: 123, nested: { password: 'secret', costPrice: 456 } }; } });
    }
    const start = main.indexOf('// Secure database query handler with permission validation');
    const end = main.indexOf('// Settings (SECURE VERSIONS)', start);
    vm.runInNewContext(compile(main.slice(start, end)), f.context);
    f.bind(user.id);
    return { ...f, queryCount: () => queries, query: args => f.handlers.get('db:secureQuery')(f.event, args) };
}

test('actual generic IPC blocks direct and nested catalogue bypasses even for an admin', async () => {
    const f = genericRouteFixture();
    try {
        const attempts = [
            { model: 'productVariant', method: 'update', args: { where: { id: 'v' }, data: { stock: 50 } } },
            { model: 'productVariant', method: 'updateMany', args: { data: { isPrepared: false } } },
            { model: 'product', method: 'create', args: { data: { name: 'Bypass' } } },
            { model: 'category', method: 'update', args: { data: { products: { updateMany: { data: { name: 'Bypass' } } } } } },
            { model: 'inventoryMovement', method: 'create', args: { data: { variant: { update: { stock: 999 } } } } },
            { model: 'customer', method: 'update', args: { data: { sales: { create: { items: { create: [] } } } } } },
        ];
        for (const args of attempts) assert.equal((await f.query(args)).success, false, JSON.stringify(args));
        assert.equal(f.queryCount(), 0);
        assert.equal((await f.query({ model: 'productVariant', method: 'update', args: { where: { id: 'v' }, data: { isActive: false } } })).success, true);
        assert.equal(f.queryCount(), 1);
    } finally { f.close(); }
});

test('actual generic IPC masks nested costs and rejects cost-based inference without permission', async () => {
    const f = genericRouteFixture(cashier);
    try {
        const result = await f.query({ userId: admin.id, model: 'product', method: 'findMany', args: {} });
        assert.equal(result.success, true);
        assert.equal(result.data.costPrice, null);
        assert.equal(result.data.nested.costPrice, null);
        assert.equal('password' in result.data.nested, false);
        for (const args of [
            { where: { variants: { some: { costPrice: { gte: 100 } } } } },
            { select: { variants: { select: { costPrice: true } } } },
            { orderBy: { costPrice: 'asc' } },
            { distinct: ['costPrice'] },
        ]) assert.equal((await f.query({ model: 'productVariant', method: 'findMany', args })).success, false);
        assert.equal(f.queryCount(), 1);
    } finally { f.close(); }
});

test('actual label IPC rejects missing sessions and denied sticker permissions before printing', async () => {
    const f = fixture();
    let windows = 0;
    try {
        const permissions = { checkPermission: actor => ({ allowed: Boolean(actor.role === 'ADMIN' || actor.permPrintSticker), reason: 'Sticker printing is not permitted' }) };
        const printStart = main.indexOf("ipcMain.handle('print:label'");
        const printEnd = main.indexOf('// Global error handling was moved', printStart);
        vm.runInNewContext(compile(main.slice(printStart, printEnd)), {
            ...f.context,
            PermissionService: permissions,
            BrowserWindow: class { constructor() { windows++; } },
            console: { error() {} },
        });
        const print = f.handlers.get('print:label');
        assert.equal((await print(f.event, { html: '<div>label</div>' })).success, false);
        f.bind(cashier.id);
        const denied = await print(f.event, { html: '<div>label</div>', userId: admin.id });
        assert.equal(denied.success, false);
        assert.match(denied.error, /Sticker printing/);
        assert.equal(windows, 0);
    } finally { f.close(); }
});

test('actual label IPC rejects missing, changed and stale saved variant references before printing', async () => {
    const f = fixture();
    let windows = 0;
    try {
        f.bind(admin.id);
        const revision = new Date('2026-10-09T10:00:00Z');
        const saved = { id: 'saved', productId: 'p', barcode: '0012345', product: { updatedAt: revision } };
        f.context.prisma.productVariant = { findUnique: async ({ where }) => where.id === saved.id ? saved : null };
        const start = main.indexOf("ipcMain.handle('print:label'");
        const end = main.indexOf('// Global error handling was moved', start);
        vm.runInNewContext(compile(main.slice(start, end)), {
            ...f.context, PermissionService: { checkPermission: () => ({ allowed: true }) },
            BrowserWindow: class { constructor() { windows++; } }, console: { error() {} },
        });
        const print = data => f.handlers.get('print:label')(f.event, { html: '<div>label</div>', ...data });
        const valid = { variantId: 'saved', productId: 'p', barcode: '0012345', expectedUpdatedAt: revision.toISOString() };
        for (const invalid of [
            { ...valid, variantId: 'draft' }, { ...valid, productId: 'other' },
            { ...valid, barcode: '12345' }, { ...valid, expectedUpdatedAt: '2026-10-09T09:59:59Z' },
            { variantId: 'saved' },
        ]) {
            const response = await print(invalid);
            assert.equal(response.success, false);
            assert.match(response.error, /Save and reload/);
        }
        assert.equal(windows, 0);
    } finally { f.close(); }
});

test('actual test-label IPC also enforces session and sticker permission', async () => {
    const f = fixture();
    let windows = 0;
    try {
        const start = main.indexOf("ipcMain.handle('print:testLabel'");
        const end = main.indexOf('// CASH DRAWER / REGISTER RECONCILIATION IPC HANDLERS', start);
        vm.runInNewContext(compile(main.slice(start, end)), {
            ...f.context,
            PermissionService: { checkPermission: user => ({ allowed: user.role === 'ADMIN' || user.permPrintSticker, reason: 'Sticker permission denied' }) },
            BrowserWindow: class { constructor() { windows++; } },
        });
        const print = () => f.handlers.get('print:testLabel')(f.event, { data: {}, printer: '' });
        assert.equal((await print()).success, false);
        f.bind(cashier.id);
        assert.equal((await print()).success, false);
        assert.equal(windows, 0);
    } finally { f.close(); }
});
