const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const bcrypt = require('bcryptjs');
const { createDevBridgeHandler } = require('../electron/devBridge.cjs');

function loadTypeScript(relativePath, extra = {}) {
    const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
    const exports = {};
    vm.runInNewContext(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText, { exports, module: { exports }, require, Date, console, ...extra });
    return exports;
}

const sessionAuth = loadTypeScript('electron/session-auth.service.ts');

async function fixture(t) {
    // Every database/service dependency is injected. No Prisma client or pos.db is opened.
    const password = bcrypt.hashSync('correct-password', 4);
    const users = new Map([
        ['admin', { id: 'admin-id', username: 'admin', role: 'ADMIN', isActive: true, password }],
        ['manager', { id: 'manager-id', username: 'manager', role: 'CASHIER', isActive: true, permManageProducts: true, permViewCostPrice: false, password }],
        ['cashier', { id: 'cashier-id', username: 'cashier', role: 'CASHIER', isActive: true, permManageProducts: false, permPrintSticker: false, password }],
        ['printer', { id: 'printer-id', username: 'printer', role: 'CASHIER', isActive: true, permPrintSticker: true, password }],
    ]);
    const calls = [];
    const catalogueResult = { id: 'product-1', variants: [{ id: 'variant-1', costPrice: 275, isPrepared: true, fabric: 'Cotton' }] };
    const prisma = {
        user: {
            findUnique: async ({ where }) => [...users.values()].find(u => u.id === where.id || u.username === where.username) || null,
            findMany: async () => [...users.values()].map(({ password: _password, ...user }) => user),
        },
        product: {
            findMany: async args => {
                calls.push({ operation: 'generic-read', args });
                return [{ ...catalogueResult, relatedUser: { password: 'never-return-this', id: 'nested-user' } }];
            },
            update: async () => { throw new Error('Generic mutations must never run'); },
        },
    };
    const catalogueService = {
        saveProduct: async (_db, args, user) => {
            calls.push({ operation: 'save', args, user });
            return catalogueResult;
        },
        getProduct: async (_db, id, user) => {
            calls.push({ operation: 'get', id, user });
            return catalogueResult;
        },
        listProducts: async (_db, args, user) => {
            calls.push({ operation: 'list', args, user });
            return [catalogueResult];
        },
        listVariants: async (_db, args, user) => {
            calls.push({ operation: 'variants', args, user });
            return catalogueResult.variants;
        },
        checkBarcode: async () => { calls.push({ operation: 'check' }); return { exists: false }; },
        reserveBarcode: async (_db, args, user) => {
            calls.push({ operation: 'reserve', args, user });
            return { barcode: '0012345' };
        },
    };
    const server = http.createServer(createDevBridgeHandler({ prisma, catalogueService }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const port = server.address().port;
    async function request(channel, args = {}, token, extraHeaders = {}) {
        const body = JSON.stringify({ channel, args });
        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: '127.0.0.1', port, path: '/api/ipc', method: 'POST',
                headers: {
                    'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
                    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders,
                },
            }, res => {
                let text = '';
                res.on('data', chunk => { text += chunk; });
                res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
            });
            req.on('error', reject);
            req.end(body);
        });
    }
    async function login(username = 'manager') {
        const result = await request('auth:login', { username, password: 'correct-password' });
        assert.equal(result.body.success, true);
        assert.match(result.body.sessionToken, /^[a-f0-9]{64}$/);
        assert.equal(result.body.data.password, undefined);
        return result.body.sessionToken;
    }
    return { users, calls, request, login };
}

test('HTTP catalogue, barcode, label and generic reads reject anonymous callers and forged IDs', async t => {
    const f = await fixture(t);
    for (const channel of [
        'catalogue:saveProduct', 'catalogue:getProduct', 'catalogue:listProducts',
        'catalogue:listVariants', 'catalogue:checkBarcode', 'catalogue:generateBarcode',
        'print:label', 'print:testLabel', 'db:secureQuery',
    ]) {
        const response = await f.request(channel, { userId: 'admin-id', role: 'ADMIN', permManageProducts: true });
        assert.equal(response.status, 401, channel);
        assert.equal(response.body.success, false, channel);
    }
    assert.equal(f.calls.length, 0);
});

test('HTTP permissions follow the password-authenticated account despite forged admin fields', async t => {
    const f = await fixture(t);
    const cashierToken = await f.login('cashier');
    for (const channel of ['catalogue:saveProduct', 'catalogue:generateBarcode', 'print:label', 'print:testLabel']) {
        const denied = await f.request(channel, { userId: 'admin-id', role: 'ADMIN', permManageProducts: true }, cashierToken);
        assert.equal(denied.status, 403, channel);
    }
    const managerToken = await f.login('manager');
    const saved = await f.request('catalogue:saveProduct', { userId: 'admin-id', name: 'Shirt' }, managerToken);
    assert.equal(saved.body.success, true);
    assert.equal(f.calls.find(c => c.operation === 'save').user.id, 'manager-id');
    assert.equal(f.calls.find(c => c.operation === 'save').user.password, undefined);
    const reserved = await f.request('catalogue:generateBarcode', { draftId: 'draft-1' }, managerToken);
    assert.equal(reserved.body.data.barcode, '0012345');
    const printerToken = await f.login('printer');
    const print = await f.request('print:label', {}, printerToken);
    assert.equal(print.status, 200);
    assert.equal(print.body.error, 'Hardware printing not available in web browser');
});

test('HTTP catalogue and nested generic reads mask hidden costs and passwords', async t => {
    const f = await fixture(t);
    const token = await f.login('manager');
    for (const channel of ['catalogue:getProduct', 'catalogue:listProducts', 'catalogue:listVariants']) {
        const response = await f.request(channel, { id: 'product-1', userId: 'admin-id' }, token);
        assert.equal(response.body.success, true);
        assert.ok(!JSON.stringify(response.body).includes('275'));
        assert.ok(JSON.stringify(response.body).includes('"costPrice":null'));
    }
    const generic = await f.request('db:secureQuery', {
        model: 'product', method: 'findMany', userId: 'admin-id', args: { include: { variants: true } },
    }, token);
    assert.equal(generic.body.data[0].variants[0].costPrice, null);
    assert.equal(generic.body.data[0].relatedUser.password, undefined);
    const hiddenCostQuery = await f.request('db:secureQuery', {
        model: 'product', method: 'findMany', args: { where: { variants: { some: { costPrice: { gt: 100 } } } } },
    }, token);
    assert.equal(hiddenCostQuery.status, 403);
    const adminToken = await f.login('admin');
    const visible = await f.request('catalogue:getProduct', { id: 'product-1' }, adminToken);
    assert.equal(visible.body.data.variants[0].costPrice, 275);
});

test('HTTP generic queries cannot mutate catalogue data', async t => {
    const f = await fixture(t);
    const token = await f.login('admin');
    const response = await f.request('db:secureQuery', {
        model: 'product', method: 'update', args: { where: { id: 'product-1' }, data: { variants: { update: { isPrepared: false } } } },
    }, token);
    assert.equal(response.body.success, false);
    assert.match(response.body.error, /not permitted in read bridge/);
});

test('HTTP logout invalidates the token and tokens in request bodies do not authenticate', async t => {
    const f = await fixture(t);
    const token = await f.login();
    const forged = await f.request('catalogue:listProducts', { sessionToken: token, userId: 'admin-id' });
    assert.equal(forged.status, 401);
    assert.equal((await f.request('auth:logout', {}, token)).body.success, true);
    assert.equal((await f.request('catalogue:listProducts', {}, token)).status, 401);
});

test('HTTP failed login and disabled accounts invalidate their existing sessions', async t => {
    const f = await fixture(t);
    const token = await f.login();
    const failed = await f.request('auth:login', { username: 'manager', password: 'wrong' }, token);
    assert.equal(failed.body.success, false);
    assert.equal((await f.request('catalogue:listProducts', {}, token)).status, 401);
    const secondToken = await f.login();
    f.users.get('manager').isActive = false;
    assert.equal((await f.request('catalogue:listProducts', {}, secondToken)).status, 401);
    f.users.get('manager').isActive = true;
    assert.equal((await f.request('catalogue:listProducts', {}, secondToken)).status, 401);
});

test('HTTP bridge rejects other origins even when they supply a valid token', async t => {
    const f = await fixture(t);
    const token = await f.login();
    const denied = await f.request('catalogue:listProducts', {}, token, { Origin: 'https://other.example' });
    assert.equal(denied.status, 403);
});

test('Electron sessions bind to the sender, refresh account permissions and clear on reload/logout/destruction', async () => {
    const sender = Object.assign(new EventEmitter(), { id: 881, mainFrame: {}, isDestroyed: () => false });
    const user = { id: 'real-user', isActive: true, role: 'CASHIER', password: 'secret', permManageProducts: true };
    const prisma = { user: { findUnique: async ({ where }) => where.id === user.id ? user : null } };
    const event = { sender, senderFrame: sender.mainFrame, userId: 'admin-id' };
    sessionAuth.bindElectronSession(sender, user.id);
    assert.equal((await sessionAuth.resolveElectronSessionUser(prisma, event)).id, user.id);
    user.permManageProducts = false;
    assert.equal((await sessionAuth.resolveElectronSessionUser(prisma, event)).permManageProducts, false);
    await assert.rejects(sessionAuth.resolveElectronSessionUser(prisma, { sender: { id: 882 } }), /Authentication required/);
    await assert.rejects(sessionAuth.resolveElectronSessionUser(prisma, { ...event, senderFrame: {} }), /Authentication required/);
    sender.emit('did-start-navigation', {}, 'http://preview/#/products', true, true);
    assert.equal((await sessionAuth.resolveElectronSessionUser(prisma, event)).id, user.id);
    sender.emit('did-start-navigation', {}, 'http://preview/', false, true);
    await assert.rejects(sessionAuth.resolveElectronSessionUser(prisma, event), /Authentication required/);
    sessionAuth.bindElectronSession(sender, user.id);
    sessionAuth.clearElectronSession(sender.id);
    await assert.rejects(sessionAuth.resolveElectronSessionUser(prisma, event), /Authentication required/);
    sessionAuth.bindElectronSession(sender, user.id);
    sender.emit('destroyed');
    await assert.rejects(sessionAuth.resolveElectronSessionUser(prisma, event), /Authentication required/);
});

test('Session expiry and revoked accounts fail closed', async () => {
    let now = 100;
    const sessions = new sessionAuth.SessionAuthStore({ now: () => now, ttlMs: 10 });
    sessions.bind('opaque-token', 'account');
    const prisma = { user: { findUnique: async () => ({ id: 'account', isActive: true }) } };
    assert.equal((await sessionAuth.resolveAuthenticatedSessionUser(prisma, sessions, 'opaque-token')).id, 'account');
    now = 110;
    await assert.rejects(sessionAuth.resolveAuthenticatedSessionUser(prisma, sessions, 'opaque-token'), /Authentication required/);
});

test('Nested cost field selectors and group/distinct queries cannot bypass masking', () => {
    assert.equal(sessionAuth.containsSensitiveQueryField({ include: { variants: { select: { costPrice: true } } } }, 'costPrice'), true);
    assert.equal(sessionAuth.containsSensitiveQueryField({ by: ['costPrice'] }, 'costPrice'), true);
    assert.equal(sessionAuth.containsSensitiveQueryField({ distinct: 'costPrice' }, 'costPrice'), true);
    assert.equal(sessionAuth.containsSensitiveQueryField({ where: { name: 'costPrice' } }, 'costPrice'), false);
    const masked = sessionAuth.maskSessionResult({ data: [{ nested: { password: 'secret', costPrice: 9 } }] }, { role: 'CASHIER' });
    assert.equal(masked.data[0].nested.password, undefined);
    assert.equal(masked.data[0].nested.costPrice, null);
});

test('Browser bridge retains tokens only in memory and clears them on logout and page reload', async () => {
    const requests = [];
    const listeners = new Map();
    const browserWindow = { addEventListener: (event, handler) => listeners.set(event, handler) };
    const browser = loadTypeScript('src/lib/browserBridge.ts', {
        window: browserWindow,
        fetch: async (_url, options) => {
            requests.push(options);
            const channel = JSON.parse(options.body).channel;
            return { ok: true, json: async () => channel === 'auth:login'
                ? { success: true, data: { id: 'account' }, sessionToken: 'private-token' }
                : { success: true, data: [] } };
        },
    });
    browser.initBrowserBridge();
    const api = browserWindow.electronAPI;
    const login = await api.auth.login({ username: 'manager', password: 'correct-password' });
    assert.equal(login.sessionToken, undefined);
    await api.catalogue.listVariants({});
    assert.equal(requests.at(-1).headers.Authorization, 'Bearer private-token');
    await api.auth.logout();
    assert.equal(requests.at(-1).headers.Authorization, 'Bearer private-token');
    await api.catalogue.listProducts({});
    assert.equal(requests.at(-1).headers.Authorization, undefined);
    await api.auth.login({ username: 'manager', password: 'correct-password' });
    listeners.get('pagehide')();
    assert.equal(JSON.parse(requests.at(-1).body).channel, 'auth:logout');
    assert.equal(requests.at(-1).keepalive, true);
    await api.catalogue.listProducts({});
    assert.equal(requests.at(-1).headers.Authorization, undefined);
});
