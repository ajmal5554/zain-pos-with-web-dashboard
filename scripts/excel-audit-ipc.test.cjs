const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise actual authenticated registrations; no Electron app or POS database.
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
const { PermissionMiddleware } = load('electron/permission.service.ts');
const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const routes = ['status', 'list', 'preview', 'commit'];
let senderId = 100000;

function fixture(t) {
    const users = new Map([
        ['admin', { id: 'admin', role: 'ADMIN', isActive: true }],
        ['settings', { id: 'settings', role: 'CASHIER', isActive: true, permEditSettings: true }],
        ['inventory', { id: 'inventory', role: 'CASHIER', isActive: true, permManageInventory: true }],
        ['cashier', { id: 'cashier', role: 'CASHIER', isActive: true }],
    ]);
    const calls = [], handlers = new Map();
    const excelAuditService = Object.fromEntries(routes.map(route => [route, async (...args) => {
        calls.push({ route, args });
        return route === 'list' ? { route, items: [{ id: 'audit-row' }] } : { route };
    }]));
    const context = {
        logger, PermissionMiddleware, excelAuditService, Error,
        getAuditRowStatuses: async () => ({}),
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
        prisma: { user: { findUnique: async ({ where }) => users.get(where.id) || null } },
        resolveElectronSessionUser: auth.resolveElectronSessionUser,
        validateIpcRequest: async () => { throw new Error('Renderer-supplied user identity must not authenticate Excel uploads'); },
    };
    const helperStart = main.indexOf('function createSecureIpcHandler<');
    const helperEnd = main.indexOf('// --- Input Validation Helpers ---', helperStart);
    const start = main.indexOf('// --- Excel Audit Handlers:');
    const end = main.indexOf('// --- Stock Count Drafts Handlers (ST-03A) ---', start);
    assert.ok(helperStart >= 0 && helperEnd > helperStart && start >= 0 && end > start);
    vm.runInNewContext(compile(main.slice(helperStart, helperEnd) + main.slice(start, end)), context);
    assert.deepEqual([...handlers.keys()].sort(), routes.map(route => `excelAudit:${route}`).sort());
    const event = { sender: { id: ++senderId, isDestroyed: () => false } };
    t.after(() => auth.clearElectronSession(event.sender.id));
    return {
        users, calls, context, event,
        bind: id => auth.electronSessions.bind(event.sender.id, id),
        request: (route, args = {}) => handlers.get(`excelAudit:${route}`)(event, args),
    };
}

test('Excel audit denies anonymous, forged and settings-only callers for every operation', async t => {
    const f = fixture(t);
    for (const actor of [null, 'cashier', 'settings']) {
        if (actor) f.bind(actor);
        for (const route of routes) {
            assert.equal((await f.request(route, { userId: 'admin', role: 'ADMIN', permManageInventory: true })).success, false, route);
        }
    }
    assert.equal(f.calls.length, 0);
});

test('Excel audit inventory operators can review and import with authenticated preview ownership', async t => {
    const f = fixture(t);
    f.bind('inventory');
    const input = { fileName: 'counts.xlsx', bytes: new Uint8Array([1, 2]), token: 'reviewed-token', owner: 'admin:forged', userId: 'admin' };
    for (const route of routes) assert.equal((await f.request(route, input)).success, true, route);
    assert.deepEqual(f.calls.map(call => call.route), routes);
    assert.deepEqual(f.calls[0].args, []);
    assert.equal(f.calls[1].args[0], input);
    assert.deepEqual(f.calls[2].args, [input, `inventory:${f.event.sender.id}`]);
    assert.deepEqual(f.calls[3].args, ['reviewed-token', `inventory:${f.event.sender.id}`]);
    f.bind('admin');
    assert.equal((await f.request('commit', input)).success, true);
    assert.equal(f.calls.at(-1).args[1], `admin:${f.event.sender.id}`);
});

test('Excel audit rereads revoked permissions and denies disabled, missing and logged-out sessions', async t => {
    const f = fixture(t);
    f.bind('inventory');
    assert.equal((await f.request('list')).success, true);
    f.users.set('inventory', { ...f.users.get('inventory'), permManageInventory: false });
    for (const route of routes) assert.equal((await f.request(route, { permManageInventory: true })).success, false);
    f.bind('admin');
    f.users.set('admin', { ...f.users.get('admin'), isActive: false });
    assert.equal((await f.request('preview')).success, false);
    f.users.set('admin', { ...f.users.get('admin'), isActive: true });
    assert.equal((await f.request('preview')).success, false, 'Disabled sessions remain revoked');
    f.bind('admin');
    f.users.delete('admin');
    assert.equal((await f.request('status')).success, false);
    f.bind('inventory');
    auth.clearElectronSession(f.event.sender.id);
    assert.equal((await f.request('commit')).success, false);
    assert.equal(f.calls.length, 1);
});

test('Excel audit import owners differ across windows and file bytes are never logged', async t => {
    const first = fixture(t), second = fixture(t);
    first.bind('admin'); second.bind('admin'); logs.length = 0;
    const input = { fileName: 'counts.xlsx', bytes: new TextEncoder().encode('private-audit-content'), token: 'token', owner: 'forged' };
    assert.equal((await first.request('preview', input)).success, true);
    assert.equal((await second.request('commit', input)).success, true);
    assert.notEqual(first.calls[0].args[1], second.calls[0].args[1]);
    assert.equal(JSON.stringify(logs).includes('private-audit-content'), false);
});

test('saved audit rows include their actual stock progress and cannot claim a renderer-provided status', async t => {
    const f = fixture(t); f.bind('inventory');
    f.context.getAuditRowStatuses = async (_db, ids, user) => {
        assert.deepEqual(Array.from(ids), ['audit-row']); assert.equal(user.id, 'inventory');
        return { 'audit-row': { state: 'POSTED', draftId: 'saved-entry', variantId: 'specific-xl' } };
    };
    const result = await f.request('list', { stockStatus: 'PREPARED', userId: 'admin' });
    assert.equal(result.success, true);
    assert.equal(result.data.items[0].stockStatus, 'POSTED');
    assert.equal(result.data.items[0].stockDraftId, 'saved-entry');
    assert.equal(result.data.items[0].stockVariantId, 'specific-xl');
});

test('Excel audit returns a safe starting response before its file service is ready', async t => {
    const f = fixture(t); f.bind('admin'); f.context.excelAuditService = null;
    for (const route of routes) {
        const response = await f.request(route);
        assert.equal(response.success, false);
        assert.match(response.error, /starting/i);
    }
    assert.equal(f.calls.length, 0);
});

test('Excel preload exposes only the dedicated review channels and removes the Neon bridge', async () => {
    let api; const calls = [];
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8')), {
        exports: {},
        require: name => {
            assert.equal(name, 'electron');
            return {
                contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'electronAPI'); api = value; } },
                ipcRenderer: { invoke: async (...args) => { calls.push(args); return { success: true }; } },
            };
        },
    });
    const file = { fileName: 'counts.xlsx', bytes: new Uint8Array([1, 2]) };
    await api.excelAudit.status();
    await api.excelAudit.list({ search: 'shirt' });
    await api.excelAudit.preview(file);
    await api.excelAudit.commit({ token: 'reviewed-token' });
    assert.deepEqual(calls.map(call => call[0]), routes.map(route => `excelAudit:${route}`));
    assert.equal(calls[2][1], file);
    assert.deepEqual(Object.keys(api.excelAudit).sort(), [...routes].sort());
    assert.equal(api.neonAudit, undefined);
});
