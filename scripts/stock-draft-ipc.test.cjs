const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const ts = require('typescript');
const bcrypt = require('bcryptjs');
const { createDevBridgeHandler } = require('../electron/devBridge.cjs');

// Run the actual routes and permission/session helpers. Services and users are
// injected in memory: these tests never open Prisma or an installed database.
const root = path.resolve(__dirname, '..');
const logger = { info() {}, warn() {}, error() {}, debug() {} };
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
const routes = ['list', 'get', 'searchVariants', 'create', 'save', 'cancel'];
const serviceNames = ['listDrafts', 'getDraft', 'searchPreparedVariants', 'createDraft', 'saveDraft', 'cancelDraft'];
const bindingNames = ['stockDraftList', 'stockDraftGet', 'stockDraftSearchVariants', 'stockDraftCreate', 'stockDraftSave', 'stockDraftCancel'];
let senderSequence = 70000;

function usersFixture() {
    return new Map([
        ['admin', { id: 'admin', username: 'admin', role: 'ADMIN', isActive: true }],
        ['inventory', { id: 'inventory', username: 'inventory', role: 'CASHIER', isActive: true, permManageInventory: true }],
        ['cashier', { id: 'cashier', username: 'cashier', role: 'CASHIER', isActive: true, permManageInventory: false }],
    ]);
}

function servicesFixture(calls) {
    return Object.fromEntries(serviceNames.map(name => [name, async (_db, args, actor) => {
        calls.push({ name, args, actor });
        return { actorId: actor.id, name };
    }]));
}

function electronFixture(t) {
    const users = usersFixture(), calls = [], handlers = new Map();
    const services = servicesFixture(calls);
    const context = {
        logger, PermissionMiddleware, Date,
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
        prisma: { user: { findUnique: async ({ where }) => users.get(where.id) || null } },
        resolveElectronSessionUser: auth.resolveElectronSessionUser,
        validateIpcRequest: async () => { throw new Error('Caller-supplied identity path must not run'); },
        ...Object.fromEntries(bindingNames.map((name, index) => [name, services[serviceNames[index]]])),
    };
    const helperStart = main.indexOf('function createSecureIpcHandler<');
    const helperEnd = main.indexOf('// --- Input Validation Helpers ---', helperStart);
    const routeStart = main.indexOf('// --- Stock Count Drafts Handlers (ST-03A) ---');
    const routeEnd = main.indexOf('// --- Catalogue & Label Readiness Handlers (ST-02) ---', routeStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart && routeStart >= 0 && routeEnd > routeStart);
    vm.runInNewContext(compile(main.slice(helperStart, helperEnd) + '\n' + main.slice(routeStart, routeEnd)), context);
    const event = { sender: { id: ++senderSequence, isDestroyed: () => false } };
    t.after(() => auth.clearElectronSession(event.sender.id));
    const bind = actor => auth.electronSessions.bind(event.sender.id, actor);
    const request = (route, args = {}) => handlers.get(`stockDraft:${route}`)(event, args);
    return { users, calls, event, bind, request };
}

test('draft Electron routes deny anonymous and forged privileged identities', async t => {
    const f = electronFixture(t);
    for (const route of routes) {
        const anonymous = await f.request(route, { userId: 'admin', role: 'ADMIN', permManageInventory: true });
        assert.equal(anonymous.success, false, route);
        f.bind('cashier');
        const forged = await f.request(route, { userId: 'admin', role: 'ADMIN', permManageInventory: true });
        assert.equal(forged.success, false, route);
        auth.clearElectronSession(f.event.sender.id);
    }
    assert.equal(f.calls.length, 0);
});

test('draft Electron routes use the authenticated inventory operator for all six operations', async t => {
    const f = electronFixture(t);
    f.bind('inventory');
    for (const route of routes) {
        const response = await f.request(route, { userId: 'admin', role: 'ADMIN' });
        assert.equal(response.success, true, route);
        assert.equal(response.data.actorId, 'inventory', route);
    }
    assert.equal(f.calls.length, 6);
    assert.ok(f.calls.every(call => call.actor.password === undefined));
});

test('draft Electron routes refresh revoked permissions and deny disabled or logged-out sessions', async t => {
    const f = electronFixture(t);
    f.bind('inventory');
    f.users.set('inventory', { ...f.users.get('inventory'), permManageInventory: false });
    for (const route of routes) assert.equal((await f.request(route)).success, false, route);
    f.users.set('inventory', { ...f.users.get('inventory'), permManageInventory: true, isActive: false });
    assert.equal((await f.request('list')).success, false);
    f.users.set('inventory', { ...f.users.get('inventory'), isActive: true });
    assert.equal((await f.request('get')).success, false, 'Disabled session must stay revoked');
    f.bind('inventory');
    auth.clearElectronSession(f.event.sender.id);
    for (const route of routes) assert.equal((await f.request(route, { userId: 'admin' })).success, false, route);
    assert.equal(f.calls.length, 0);
});

async function httpFixture(t) {
    const users = usersFixture(), calls = [];
    const password = bcrypt.hashSync('isolated-test-password', 4);
    for (const [id, user] of users) users.set(id, { ...user, password });
    const prisma = { user: {
        findUnique: async ({ where }) => [...users.values()].find(user => user.id === where.id || user.username === where.username) || null,
    } };
    const server = http.createServer(createDevBridgeHandler({ prisma, stockDraftService: servicesFixture(calls) }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const port = server.address().port;
    async function request(channel, args = {}, token) {
        const body = JSON.stringify({ channel, args });
        return new Promise((resolve, reject) => {
            const req = http.request({ hostname: '127.0.0.1', port, path: '/api/ipc', method: 'POST', headers: {
                'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            } }, res => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
            });
            req.on('error', reject);
            req.end(body);
        });
    }
    async function login(username) {
        const response = await request('auth:login', { username, password: 'isolated-test-password' });
        assert.equal(response.body.success, true);
        return response.body.sessionToken;
    }
    return { users, calls, request, login };
}

test('draft HTTP routes deny anonymous callers and forged inventory permission fields', async t => {
    const f = await httpFixture(t);
    const token = await f.login('cashier');
    for (const route of routes) {
        const channel = `stockDraft:${route}`;
        const forged = { userId: 'admin', role: 'ADMIN', permManageInventory: true };
        assert.equal((await f.request(channel, forged)).status, 401, channel);
        assert.equal((await f.request(channel, forged, token)).status, 403, channel);
    }
    assert.equal(f.calls.length, 0);
});

test('draft HTTP routes keep real inventory actor identity and refresh permission revocation', async t => {
    const f = await httpFixture(t);
    const token = await f.login('inventory');
    for (const route of routes) {
        const response = await f.request(`stockDraft:${route}`, { userId: 'admin' }, token);
        assert.equal(response.status, 200, route);
        assert.equal(response.body.data.actorId, 'inventory', route);
    }
    assert.equal(f.calls.length, 6);
    f.users.set('inventory', { ...f.users.get('inventory'), permManageInventory: false });
    for (const route of routes) assert.equal((await f.request(`stockDraft:${route}`, {}, token)).status, 403, route);
    assert.equal(f.calls.length, 6);
});

test('draft HTTP routes reject disabled accounts and revoked logout tokens', async t => {
    const f = await httpFixture(t);
    const disabledToken = await f.login('inventory');
    f.users.set('inventory', { ...f.users.get('inventory'), isActive: false });
    assert.equal((await f.request('stockDraft:list', {}, disabledToken)).status, 401);
    f.users.set('inventory', { ...f.users.get('inventory'), isActive: true });
    assert.equal((await f.request('stockDraft:list', {}, disabledToken)).status, 401);
    const logoutToken = await f.login('inventory');
    assert.equal((await f.request('auth:logout', {}, logoutToken)).body.success, true);
    for (const route of routes) assert.equal((await f.request(`stockDraft:${route}`, { userId: 'admin' }, logoutToken)).status, 401, route);
    assert.equal(f.calls.length, 0);
});

function browserFixture(fetchResponse) {
    const window = { addEventListener() {} };
    const bridge = { exports: {} };
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/lib/browserBridge.ts'), 'utf8')), {
        exports: bridge.exports, module: bridge, window,
        console: { info() {} }, fetch: fetchResponse,
    });
    bridge.exports.initBrowserBridge();
    const service = { exports: {} };
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/services/stock-draft.service.ts'), 'utf8')), {
        exports: service.exports, module: service, window,
    });
    return service.exports.stockDraftService;
}

test('browser draft transport loss and malformed HTTP responses stay uncertain for every write', async () => {
    const failures = [
        async () => { throw new Error('Connection lost after sending write'); },
        async () => ({ ok: true, json: async () => { throw new Error('Truncated response'); } }),
        async () => ({ ok: false, status: 502, statusText: 'Bad Gateway', json: async () => { throw new Error('Proxy HTML'); } }),
        async () => ({ ok: false, status: 502, json: async () => ({ error: 'Proxy failure' }) }),
    ];
    for (const fetchResponse of failures) {
        const service = browserFixture(fetchResponse);
        for (const action of ['createDraft', 'saveDraft', 'cancelDraft']) {
            await assert.rejects(service[action]({ operationId: 'stable-attempt', draftId: 'stable-draft' }), error => {
                assert.equal(error.confirmedRejected, false, action);
                return true;
            });
        }
    }
});

test('explicit server draft rejection is recoverable without classifying it by message text', async () => {
    for (const status of [200, 500]) {
        const service = browserFixture(async () => ({
            ok: status === 200, status,
            json: async () => ({ success: false, error: 'Inactive catalogue items cannot be added to a draft.' }),
        }));
        for (const action of ['createDraft', 'saveDraft', 'cancelDraft']) {
            await assert.rejects(service[action]({ operationId: 'rejected-attempt' }), error => {
                assert.equal(error.confirmedRejected, true, action);
                assert.match(error.message, /Inactive/);
                return true;
            });
        }
    }
});

test('unavailable draft API rejects before sending a request', async () => {
    const service = { exports: {} };
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/services/stock-draft.service.ts'), 'utf8')), {
        exports: service.exports, module: service, window: {},
    });
    for (const action of ['createDraft', 'saveDraft', 'cancelDraft']) {
        await assert.rejects(service.exports.stockDraftService[action]({}), error => {
            assert.equal(error.confirmedRejected, true, action);
            assert.match(error.message, /API is unavailable/);
            return true;
        });
    }
});
