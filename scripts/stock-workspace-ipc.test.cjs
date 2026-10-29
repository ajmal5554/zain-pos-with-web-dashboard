const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const logs = [];
const logger = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(name => [name, (...args) => logs.push(args)]));
const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
function load(relative) {
    const exports = {};
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, relative), 'utf8')), {
        exports, module: { exports }, Date, Map, WeakSet,
        require: name => name === './logger' ? { logger } : require(name),
    });
    return exports;
}
const auth = load('electron/session-auth.service.ts');
const { PermissionMiddleware, PermissionService } = load('electron/permission.service.ts');
const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const routes = ['stock:getInventory', 'stockConversion:prepare', 'stockConversion:postBatch', 'stockConversion:adjust', 'stockConversion:saveEntry', 'stockAuditSetup:get', 'stockAuditSetup:save'];
let senderId = 200000;
function fixture(t) {
    const users = new Map([
        ['admin', { id: 'admin', role: 'ADMIN', isActive: true }],
        ['inventory', { id: 'inventory', role: 'CASHIER', isActive: true, permManageInventory: true }],
        ['products', { id: 'products', role: 'CASHIER', isActive: true, permManageProducts: true }],
        ['both', { id: 'both', role: 'CASHIER', isActive: true, permManageProducts: true, permManageInventory: true }],
        ['cashier', { id: 'cashier', role: 'CASHIER', isActive: true }],
    ]);
    const calls = [], handlers = new Map();
    const savedRows = [{ id: 'saved-row', countedQuantity: 4, attributes: { fabric: 'Cotton' } }];
    const context = {
        logger, PermissionMiddleware, PermissionService, Error,
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
        prisma: { user: { findUnique: async ({ where }) => users.get(where.id) || null } },
        resolveElectronSessionUser: auth.resolveElectronSessionUser,
        validateIpcRequest: async () => { throw new Error('Renderer identity must not authenticate stock workspace actions'); },
        excelAuditService: { resolveRows: (hash, ids) => {
            calls.push({ route: 'resolveRows', hash, ids });
            if (hash !== 'saved-hash' || JSON.stringify(ids) !== '["saved-row"]') throw new Error('Audit snapshot changed. Reload.');
            return { rows: savedRows, fileName: 'saved.xlsx' };
        } },
        getInventoryWorkspace: async (_db, input) => { calls.push({ route: routes[0], input }); return { success: true, data: { scope: input.scope } }; },
    };
    context.getStockAuditSetup = async (_db, user) => { calls.push({ route: routes[5], user }); return { route: routes[5] }; };
    for (const [name, route] of [['prepareAuditStyle', routes[1]], ['postStockBatch', routes[2]], ['adjustTrackedStock', routes[3]], ['saveStockEntry', routes[4]], ['saveStockAuditSetup', routes[6]]]) {
        context[name] = async (_db, input, user) => { calls.push({ route, input, user }); return { route }; };
    }
    const helperStart = main.indexOf('function createSecureIpcHandler<');
    const helperEnd = main.indexOf('// --- Input Validation Helpers ---', helperStart);
    const start = main.indexOf('// --- Inventory Workspace Handlers:');
    const end = main.indexOf('// --- Excel Audit Handlers:', start);
    assert.ok(helperStart >= 0 && helperEnd > helperStart && start >= 0 && end > start);
    vm.runInNewContext(compile(main.slice(helperStart, helperEnd) + main.slice(start, end)), context);
    assert.deepEqual([...handlers.keys()].sort(), [...routes].sort());
    const event = { sender: { id: ++senderId, isDestroyed: () => false } };
    t.after(() => auth.clearElectronSession(event.sender.id));
    return { users, calls, context, savedRows, bind: id => id ? auth.electronSessions.bind(event.sender.id, id) : auth.clearElectronSession(event.sender.id), request: (route, input = {}) => handlers.get(route)(event, input) };
}
const selection = () => ({ operationId: 'one-operation', fileHash: 'saved-hash', rowIds: ['saved-row'], productName: 'Shirt', categoryId: 'category', taxRate: 5, styleConfirmed: true });

test('stock workspace denies anonymous, forged and product-only callers', async t => {
    const f = fixture(t);
    for (const actor of [null, 'cashier', 'products']) {
        if (actor) f.bind(actor);
        for (const route of routes) assert.equal((await f.request(route, { ...selection(), userId: 'admin', permManageInventory: true })).success, false);
    }
    assert.equal(f.calls.length, 0);
});
test('inventory operators can read and post but preparing catalogue requires both permissions', async t => {
    const f = fixture(t); f.bind('inventory');
    const read = await f.request(routes[0], { scope: 'TRACKED' });
    assert.equal(read.success, true); assert.equal(read.data.scope, 'TRACKED'); assert.equal(read.data.success, undefined);
    assert.equal((await f.request(routes[1], selection())).success, false);
    for (const route of routes.slice(2)) assert.equal((await f.request(route, { operationId: 'retry' })).success, true);
    assert.equal(f.calls.length, 6);
    for (const call of f.calls.slice(1)) assert.equal(call.user.id, 'inventory');
});
test('preparation uses saved audit rows and trusted operator, ignoring renderer counts and file name', async t => {
    const f = fixture(t); f.bind('both');
    const result = await f.request(routes[1], { ...selection(), rows: [{ id: 'forged', countedQuantity: 999 }], fileName: 'forged.xlsx', userId: 'admin' });
    assert.equal(result.success, true);
    assert.deepEqual(f.calls.map(call => call.route), ['resolveRows', routes[1]]);
    const call = f.calls[1]; assert.equal(call.input.rows, f.savedRows); assert.equal(call.input.fileName, 'saved.xlsx'); assert.equal(call.user.id, 'both');
});
test('stale audit source or unavailable inbox stops preparation before any product write', async t => {
    const f = fixture(t); f.bind('admin');
    assert.equal((await f.request(routes[1], { ...selection(), fileHash: 'old-hash' })).success, false);
    assert.equal(f.calls.filter(call => call.route === routes[1]).length, 0);
    f.context.excelAuditService = null;
    assert.match((await f.request(routes[1], selection())).error, /starting/);
});
test('stock routes recheck disabled, revoked and logged-out sessions', async t => {
    const f = fixture(t); f.bind('both');
    assert.equal((await f.request(routes[1], selection())).success, true);
    f.users.set('both', { ...f.users.get('both'), permManageProducts: false });
    assert.equal((await f.request(routes[1], selection())).success, false);
    f.users.set('both', { ...f.users.get('both'), isActive: false });
    for (const route of routes) assert.equal((await f.request(route, selection())).success, false);
    f.bind('missing');
    for (const route of routes) assert.equal((await f.request(route, selection())).success, false);
    f.bind(null);
    for (const route of routes) assert.equal((await f.request(route, selection())).success, false);
});
test('expected stock failures return actionable errors without logging audit contents', async t => {
    const f = fixture(t); f.bind('admin'); logs.length = 0;
    f.context.postStockBatch = async () => { throw new Error('Stale batch revision. Reload.'); };
    const result = await f.request(routes[2], { privateCount: 'sensitive-audit-data' });
    assert.equal(result.success, false); assert.match(result.error, /Stale batch revision/);
    assert.equal(JSON.stringify(logs).includes('sensitive-audit-data'), false);
});
test('preload exposes only dedicated read and explicit stock action channels', async () => {
    let api; const calls = [];
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8')), {
        exports: {}, require: name => {
            assert.equal(name, 'electron');
            return { contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } }, ipcRenderer: { invoke: async (...args) => { calls.push(args); } } };
        },
    });
    const input = selection();
    await api.stock.getInventory({ scope: 'LEGACY' }); await api.stockConversion.prepare(input); await api.stockConversion.postBatch(input); await api.stockConversion.adjust(input); await api.stockConversion.saveEntry(input); await api.stockAuditSetup.get(); await api.stockAuditSetup.save(input);
    assert.deepEqual(calls.map(call => call[0]), routes);
    assert.equal(calls[1][1], input); assert.deepEqual(Object.keys(api.stockConversion).sort(), ['adjust', 'postBatch', 'prepare', 'saveEntry']);
});

test('direct Excel entry validates saved source IDs while accepting reviewed count edits', async t => {
    const f = fixture(t); f.bind('inventory');
    const input = { operationId: 'entry', batchName: 'Rack 1', fileHash: 'saved-hash', rows: [{ sourceRowId: 'saved-row', quantity: 12 }] };
    assert.equal((await f.request(routes[4], input)).success, true);
    assert.deepEqual(f.calls.map(call => call.route), ['resolveRows', routes[4]]);
    assert.equal(f.calls[1].input.rows[0].quantity, 12);
    assert.equal(f.calls[1].user.id, 'inventory');
    f.calls.length = 0;
    assert.equal((await f.request(routes[4], { ...input, fileHash: 'stale' })).success, false);
    assert.equal(f.calls.some(call => call.route === routes[4]), false);
});

test('return lookup, refund and exchange use the signed-in editor and reject forged or revoked identities', async t => {
    const handlers = new Map(), calls = [];
    const users = new Map([
        ['admin', { id: 'admin', isActive: true, role: 'ADMIN' }],
        ['editor', { id: 'editor', isActive: true, role: 'CASHIER', permEditSales: true }],
        ['cashier', { id: 'cashier', isActive: true, role: 'CASHIER' }],
    ]);
    const event = { sender: { id: ++senderId, isDestroyed: () => false } };
    t.after(() => auth.clearElectronSession(event.sender.id));
    const context = {
        logger, PermissionMiddleware, Error, console: { error() {}, log() {} },
        resolveElectronSessionUser: auth.resolveElectronSessionUser,
        validateIpcRequest: async () => { throw new Error('Renderer identities cannot authenticate return stock writes'); },
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
        getReturnStockOptions: async (_db, input, user) => { calls.push(user.id); return { sourceTracked: false, requiresChoice: true, items: [] }; },
        prisma: {
            user: { findUnique: async ({ where }) => users.get(where.id) || null },
            $transaction: async () => { calls.push('transaction'); throw new Error('Synthetic end before financial writes'); },
        },
    };
    const helperStart = main.indexOf('function createSecureIpcHandler<');
    const helperEnd = main.indexOf('// --- Input Validation Helpers ---', helperStart);
    const section = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)));
    vm.runInNewContext(compile(main.slice(helperStart, helperEnd)
        + section('// --- Return Stock Lookup:', '// --- Inventory Workspace Handlers:')
        + section('// Professional Refund Handler', '// Void Sale —')
        + section('// Professional Exchange Handler', '// Retrieve structured Exchange/Refund details')), context);
    const channels = ['sales:getReturnStockOptions', 'sales:refund', 'sales:exchange'];
    const input = { userId: 'admin', sourceVariantId: 'source', requestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', items: [] };
    for (const actor of [null, 'cashier']) {
        if (actor) auth.electronSessions.bind(event.sender.id, actor);
        for (const channel of channels) assert.equal((await handlers.get(channel)(event, input)).success, false);
    }
    assert.equal(calls.length, 0);
    auth.electronSessions.bind(event.sender.id, 'editor');
    assert.equal((await handlers.get(channels[0])(event, input)).success, true);
    assert.equal(calls[0], 'editor');
    for (const channel of channels.slice(1)) assert.match((await handlers.get(channel)(event, input)).error, /Synthetic end/);
    users.set('editor', { ...users.get('editor'), permEditSales: false });
    const before = calls.length;
    for (const channel of channels) assert.equal((await handlers.get(channel)(event, input)).success, false);
    assert.equal(calls.length, before);
});

test('retained overview and movement reads cannot be opened using a forged inventory user ID', async t => {
    const handlers = new Map(), calls = [];
    const users = new Map([
        ['inventory', { id: 'inventory', isActive: true, role: 'CASHIER', permManageInventory: true }],
        ['cashier', { id: 'cashier', isActive: true, role: 'CASHIER' }],
    ]);
    const event = { sender: { id: ++senderId, isDestroyed: () => false } };
    t.after(() => auth.clearElectronSession(event.sender.id));
    const context = {
        logger, PermissionMiddleware, resolveElectronSessionUser: auth.resolveElectronSessionUser,
        validateIpcRequest: async () => { throw new Error('Forged read identity must not authenticate stock history'); },
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
        prisma: { user: { findUnique: async ({ where }) => users.get(where.id) || null } },
        getStockOverview: async () => { calls.push('overview'); return { success: true }; },
        getStockMovements: async () => { calls.push('movements'); return { success: true }; },
    };
    const helperStart = main.indexOf('function createSecureIpcHandler<');
    const helperEnd = main.indexOf('// --- Input Validation Helpers ---', helperStart);
    const start = main.indexOf('// --- Stock & Inventory Handlers (ST-01) ---');
    const end = main.indexOf('// --- Return Stock Lookup:', start);
    vm.runInNewContext(compile(main.slice(helperStart, helperEnd) + main.slice(start, end)), context);
    for (const actor of [null, 'cashier']) {
        if (actor) auth.electronSessions.bind(event.sender.id, actor);
        for (const handler of handlers.values()) assert.equal((await handler(event, { userId: 'inventory', variantId: 'private' })).success, false);
    }
    assert.equal(calls.length, 0);
    auth.electronSessions.bind(event.sender.id, 'inventory');
    for (const handler of handlers.values()) assert.equal((await handler(event, {})).success, true);
    users.set('inventory', { ...users.get('inventory'), permManageInventory: false });
    for (const handler of handlers.values()) assert.equal((await handler(event, { userId: 'inventory' })).success, false);
    assert.deepEqual(calls, ['overview', 'movements']);
});
