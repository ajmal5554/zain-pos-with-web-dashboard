const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Execute the real inventory component, extracted movement modal, and page wrapper.
// These are component-state tests, not browser layout or IPC integration tests.
const compile = relative => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const compiled = compile('src/components/stock/InventoryWorkspaceView.tsx');
const movementCompiled = compile('src/components/stock/MovementHistoryModal.tsx');
const wrapperCompiled = compile('src/pages/Stock.tsx');
const originalTimezone = process.env.TZ;
process.env.TZ = 'Asia/Kolkata';
after(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
});

const catalog = Array.from({ length: 120 }, (_, i) => ({
    id: `variant-${i}`, sku: `SKU-${i}`, barcode: String(1000 + i),
    stock: i < 2 ? -1 : i < 5 ? 0 : 1, minStock: 5, isActive: true,
    product: { id: `product-${i}`, name: `Shirt ${i}`, isActive: true,
        category: { id: i % 2 ? 'b' : 'a', name: i % 2 ? 'Category B' : 'Category A' } },
}));

function response(args, variants = catalog) {
    const base = variants.filter(v =>
        v.product.name.toLowerCase().includes((args.search || '').toLowerCase()) &&
        (!args.categoryId || args.categoryId === 'ALL' || v.product.category.id === args.categoryId));
    const matching = base.filter(v => args.balanceFilter === 'POSITIVE' ? v.stock > 0 :
        args.balanceFilter === 'ZERO' ? v.stock === 0 : args.balanceFilter === 'NEGATIVE' ? v.stock < 0 : true);
    const totalPages = Math.ceil(matching.length / args.pageSize) || 1;
    const page = Math.min(args.page, totalPages);
    const items = matching.slice((page - 1) * args.pageSize, page * args.pageSize).map(v => ({
        id: args.groupBy === 'SIZE' ? v.id : v.product.id, name: v.product.name, category: v.product.category.name,
        quantity: v.stock, mrpValue: args.scope === 'TRACKED' ? v.stock * 700 : null,
        variants: [{ id: v.id, productId: v.product.id, name: v.product.name, categoryId: v.product.category.id,
            category: v.product.category.name, sku: v.sku, barcode: v.barcode, size: 'XL', stock: v.stock,
            minStock: v.minStock, mrp: 700, sellingPrice: 700, scope: args.scope,
            attributes: { brand: 'Crazy Heart', fabric: 'Cotton', pattern: 'Checks', quality: 'Premium' }, updatedAt: '2026-10-08T10:00:00Z' }],
    }));
    return { scope: args.scope, groupBy: args.groupBy, items, page, pageSize: args.pageSize, totalPages,
        totalMatching: matching.length, facets: { categories: [{ id: 'a', name: 'Category A' }, { id: 'b', name: 'Category B' }],
            brands: ['Crazy Heart'], sizes: ['XL'], fabrics: ['Cotton'], patterns: ['Checks'], qualities: ['Premium'] },
        stats: { styleCount: matching.length, variantCount: matching.length,
            quantity: matching.reduce((sum, v) => sum + v.stock, 0), mrpValue: args.scope === 'TRACKED' ? matching.reduce((sum, v) => sum + v.stock * 700, 0) : null,
            categoryCount: new Set(matching.map(v => v.product.category.id)).size } };
}

function createPage(options = {}) {
    const slots = [], effects = [], timers = new Map(), requests = [];
    let cursor = 0, dirty = true, tree, clock = 0, timerId = 0, unmounted = false, lateUpdates = 0;
    let actor = options.user || { id: 'owner', role: 'ADMIN', isActive: true, permManageInventory: true };
    let props = options.mode === 'movement' ? { variantId: 'variant-0', onClose: () => { closed++; }, ...options.props }
        : { scope: 'LEGACY', ...options.props };
    let closed = 0;
    const react = {
        useState(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
            return [slots[index], value => {
                if (unmounted) { lateUpdates++; return; }
                const next = typeof value === 'function' ? value(slots[index]) : value;
                if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
            }];
        },
        useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
        useMemo(fn) { cursor++; return fn(); },
        useEffect(fn, deps) {
            const index = cursor++, old = slots[index];
            if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
                effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
            }
        },
    };
    react.default = react;
    react.Fragment = 'Fragment';
    const jsx = (type, props, key) => ({ type, props, key });
    const stockService = {
        getOverview(args) {
            let resolve, reject;
            const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
            requests.push({ args, resolve, reject });
            if (!options.manual) {
                try { resolve(options.overview ? options.overview(args) : response(args)); }
                catch (error) { reject(error); }
            }
            return promise;
        },
        getMovements(args) {
            const movements = options.movements || [{ id: 'move', type: 'OUT', quantity: -1,
                reason: 'Sale', reference: 'sale-reference-123', createdAt: '2026-10-08T10:00:00Z', operatorName: 'Cashier' }];
            let resolve, reject;
            const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
            requests.push({ args, resolve, reject });
            if (!options.manual) resolve({ variant: { ...catalog[0], id: args.variantId }, movements: movements.slice(args.offset, args.offset + args.limit), totalMovements: movements.length, offset: args.offset, limit: args.limit });
            return promise;
        },
    };
    const useAuthStore = Object.assign(() => ({ user: actor }), { getState: () => ({ user: actor }) });
    const mockedRequire = name => {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        if (name === 'react-router-dom') return { useNavigate: () => () => {} };
        if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) });
        if (name.endsWith('/authStore')) return { useAuthStore };
        if (name.endsWith('/stock.service')) return { stockService };
        if (name.endsWith('/inventory-workspace.service')) return { inventoryWorkspaceService: { getInventory: args => stockService.getOverview(args) } };
        const component = ['Button', 'Input', 'Modal', 'InventoryWorkspaceView', 'StockEntryView', 'RackAuditView', 'QuickStockCount', 'MovementHistoryModal', 'TrackedStockAdjustmentModal'].find(key => name.endsWith(`/${key}`));
        if (component) return { [component]: component };
        throw new Error(`Unexpected page import: ${name}`);
    };
    class FixedDate extends Date {
        constructor(...args) { super(...(args.length ? args : [options.now || '2026-10-08T12:00:00+05:30'])); }
    }
    const module = { exports: {} };
    const selectedModule = options.mode === 'movement' ? movementCompiled : options.mode === 'wrapper' ? wrapperCompiled : compiled;
    new Function('require', 'exports', 'module', 'setTimeout', 'clearTimeout', 'Date', 'window', selectedModule)(
        mockedRequire, module.exports, module,
        (fn, delay) => { timers.set(++timerId, { fn, at: clock + delay }); return timerId; },
        id => timers.delete(id), FixedDate, { electronAPI: { stock: { getInventory() {} } } });
    function expand(node) {
        if (Array.isArray(node)) return node.map(expand);
        if (!node || typeof node !== 'object') return node;
        if (typeof node.type === 'function') return expand(node.type(node.props));
        return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
    }
    function render() {
        let iterations = 0;
        while (dirty) {
            assert.ok(++iterations < 30, 'Page must settle without a render/refetch loop');
            dirty = false; cursor = 0;
            const entry = options.mode === 'movement' ? module.exports.MovementHistoryModal : options.mode === 'wrapper' ? module.exports.Stock : module.exports.InventoryWorkspaceView;
            tree = expand(entry(props));
            effects.splice(0).forEach(fn => fn());
        }
    }
    async function flush() { for (let i = 0; i < 8; i++) { render(); await Promise.resolve(); } render(); }
    function walk(node, predicate, result = []) {
        if (Array.isArray(node)) node.forEach(child => walk(child, predicate, result));
        else if (node && typeof node === 'object') {
            if (node.type === 'Modal' && node.props.isOpen === false) return result;
            if (predicate(node)) result.push(node);
            walk(node.props?.children, predicate, result);
        }
        return result;
    }
    function text(node) {
        if (Array.isArray(node)) return node.map(text).join(' ');
        if (node && typeof node === 'object') return text(node.props?.children);
        return node == null || typeof node === 'boolean' ? '' : String(node);
    }
    const page = {
        requests, flush, textOf: node => text(node).replace(/\s+/g, ' ').trim(),
        text: () => text(tree).replace(/\s+/g, ' ').trim(),
        all: predicate => walk(tree, predicate),
        find(predicate) { const matches = walk(tree, predicate); assert.ok(matches.length, 'Expected page control'); return matches[0]; },
        async act(fn) { fn(); await flush(); },
        async advance(ms = 300) {
            clock += ms;
            for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); }
            await flush();
        },
        summary: () => walk(tree, n => n.type === 'p' && n.props.className?.includes('text-2xl font-bold')).map(text),
        async user(next) { actor = next; dirty = true; await flush(); },
        async props(next) { props = { ...props, ...next }; dirty = true; await flush(); },
        closed: () => closed,
        dispose() { slots.forEach(slot => slot?.cleanup?.()); unmounted = true; },
        lateUpdates: () => lateUpdates,
    };
    return page;
}

const search = (page, value) => page.act(() => page.find(n => n.type === 'Input' && n.props['aria-label'] === 'Search inventory').props.onChange({ target: { value } }));
const select = async (page, label, value) => {
    if (label === 'All Recorded Balances' && !page.all(n => n.type === 'select' && n.props['aria-label'] === 'Filter recorded balance').length) {
        await page.act(() => page.find(n => n.type === 'Button' && page.textOf(n).startsWith('More filters')).props.onClick());
    }
    return page.act(() => page.find(n => n.type === 'select' && page.textOf(n).toLowerCase().includes(label.toLowerCase())).props.onChange({ target: { value } }));
};
const click = (page, label) => page.act(() => page.find(n => (n.type === 'Button' || n.type === 'button') && (page.textOf(n) === label || n.props['aria-label'] === ({ Next: 'Next inventory page', Prev: 'Previous inventory page' }[label] || label))).props.onClick());

test('pending search uses the latest category and balance, with no obsolete timer request', async () => {
    const page = createPage(); await page.flush();
    await search(page, 'Shirt');
    await select(page, 'All Categories', 'b');
    await select(page, 'All Recorded Balances', 'POSITIVE');
    assert.equal(page.requests.length, 1, 'Wait for the search before fetching combined criteria');
    await page.advance();
    assert.deepEqual(page.requests.at(-1).args, { scope: 'LEGACY', groupBy: 'STYLE', page: 1, pageSize: 30, search: 'Shirt', categoryId: 'b', balanceFilter: 'POSITIVE' });
    assert.equal(page.requests.length, 2);
    assert.equal(page.find(n => n.type === 'select' && n.props.value === 'POSITIVE').props.value, 'POSITIVE');
});

for (const outcome of ['success', 'failure']) test(`old request ${outcome} cannot replace newer results`, async () => {
    const page = createPage({ manual: true }); await page.flush();
    await search(page, 'Shirt 1'); await page.advance();
    page.requests[1].resolve(response(page.requests[1].args)); await page.flush();
    const current = page.text();
    if (outcome === 'success') page.requests[0].resolve(response(page.requests[0].args));
    else page.requests[0].reject(new Error('Old request failed'));
    await page.flush(); assert.equal(page.text(), current);
});

test('old responses cannot clear loading while a search is debouncing', async () => {
    const page = createPage({ manual: true }); await page.flush();
    await search(page, 'Shirt 1');
    page.requests[0].resolve(response(page.requests[0].args)); await page.flush();
    assert.deepEqual(page.summary(), ['…', '…', '…', '…']);
    await page.advance();
    assert.deepEqual(page.summary(), ['…', '…', '…', '…']);
    page.requests[1].resolve(response(page.requests[1].args)); await page.flush();
    assert.notEqual(page.summary()[0], '…');
});

for (const outcome of ['success', 'failure']) test(`old ${outcome} leaves a newer pending request loading`, async () => {
    const page = createPage({ manual: true }); await page.flush();
    await search(page, 'Shirt 1'); await page.advance();
    if (outcome === 'success') page.requests[0].resolve(response(page.requests[0].args));
    else page.requests[0].reject(new Error('Old request failed'));
    await page.flush();
    assert.deepEqual(page.summary(), Array(4).fill('…'));
    assert.doesNotMatch(page.text(), /Failed to load stock data/);
    page.requests[1].resolve(response(page.requests[1].args)); await page.flush();
    assert.notEqual(page.summary()[0], '…');
});

test('clearing a pending search cancels its timer and preserves the latest category', async () => {
    const page = createPage(); await page.flush();
    await search(page, 'Shirt 1'); await page.advance(150);
    await search(page, ''); await select(page, 'All Categories', 'a');
    const before = page.requests.length; await page.advance();
    assert.equal(page.requests.length, before, 'Cancelled search must not issue a later request');
    assert.equal(page.requests.at(-1).args.search, undefined);
    assert.equal(page.requests.at(-1).args.categoryId, 'a');
});

test('unmount invalidates an outstanding overview request', async () => {
    const page = createPage({ manual: true }); await page.flush(); page.dispose();
    page.requests[0].resolve(response(page.requests[0].args)); await page.flush();
    assert.equal(page.lateUpdates(), 0);
});

for (const balance of ['POSITIVE', 'ZERO', 'NEGATIVE']) test(`${balance} recorded-balance filter resets page three to page one`, async () => {
    const page = createPage(); await page.flush(); await click(page, 'Next'); await click(page, 'Next');
    assert.equal(page.requests.at(-1).args.page, 3);
    await select(page, 'All Recorded Balances', balance);
    assert.equal(page.requests.at(-1).args.page, 1);
    assert.equal(page.requests.at(-1).args.balanceFilter, balance);
    assert.doesNotMatch(page.text(), /Page 3 of 1|Showing 101 to 2/);
});

test('clearing the selected category filter resets pagination', async () => {
    const page = createPage(); await page.flush(); await select(page, 'All Categories', 'a'); await click(page, 'Next');
    await click(page, 'Clear filters');
    assert.equal(page.requests.at(-1).args.page, 1); assert.equal(page.requests.at(-1).args.categoryId, undefined);
});

for (const remaining of [2, 0]) test(`refresh accepts a clamped page when ${remaining} variants remain, without looping`, async () => {
    let variants = catalog;
    const page = createPage({ overview: args => response(args, variants) }); await page.flush();
    await click(page, 'Next'); await click(page, 'Next'); const before = page.requests.length;
    variants = catalog.slice(0, remaining); await click(page, 'Refresh');
    assert.equal(page.requests.at(-1).args.page, 1);
    assert.equal(page.requests.length - before, 2, 'One refresh and at most one corrective page fetch');
    assert.doesNotMatch(page.text(), /Page 3 of 1/);
    if (remaining === 0) assert.match(page.text(), /No old items remain/);
});

test('first failure and refresh failure show unavailable totals; successful empty data shows real zeros', async () => {
    let fail = true;
    const page = createPage({ overview: args => { if (fail) throw new Error('Cannot read stock'); return response(args, []); } });
    await page.flush(); assert.match(page.text(), /Inventory could not be refreshed/);
    assert.deepEqual(page.summary(), Array(4).fill('Unavailable'));
    fail = false; await click(page, 'Retry loading inventory'); assert.deepEqual(page.summary(), Array(4).fill('0'));
    fail = true; await click(page, 'Refresh'); assert.deepEqual(page.summary(), Array(4).fill('Unavailable'));
});

test('movement rows show reason and reference independently, including missing values', async () => {
    const movements = [
        { id: 'both', reason: 'Sale', reference: 'sale-reference-123' },
        { id: 'reason', reason: 'Damaged', reference: null },
        { id: 'reference', reason: null, reference: 'exchange-reference-456' },
        { id: 'neither', reason: null, reference: null },
    ].map(m => ({ ...m, type: 'OUT', quantity: -1, createdAt: '2026-10-08T10:00:00Z' }));
    const page = createPage({ mode: 'movement', movements }); await page.flush();
    assert.match(page.text(), /Sale/); assert.match(page.text(), /sale-reference-123/);
    assert.match(page.text(), /Damaged/); assert.match(page.text(), /exchange-reference-456/);
    const cells = page.all(n => n.type === 'td').map(page.textOf);
    assert.ok(cells.filter(value => value === '—').length >= 4);
});

for (const now of ['2026-10-08T00:15:00+05:30', '2026-10-08T05:29:00+05:30']) test(`Today uses the Indian calendar at ${now}`, async () => {
    const page = createPage({ mode: 'movement', now }); await page.flush(); await click(page, 'Today');
    assert.deepEqual(page.all(n => n.type === 'input' && n.props.type === 'date').map(n => n.props.value), ['2026-10-08', '2026-10-08']);
});

for (const [label, from] of [['7 Days', '2025-12-27'], ['30 Days', '2025-12-04']]) test(`${label} includes exactly that many local dates across New Year`, async () => {
    const page = createPage({ mode: 'movement', now: '2026-01-02T00:15:00+05:30' }); await page.flush(); await click(page, label);
    assert.deepEqual(page.all(n => n.type === 'input' && n.props.type === 'date').map(n => n.props.value), [from, '2026-01-02']);
});

const movementResponse = (args, movements = [], id = args.variantId) => ({ variant: { ...catalog[0], id },
    movements, totalMovements: movements.length, offset: args.offset, limit: args.limit });
const movementRows = count => Array.from({ length: count }, (_, i) => ({ id: `move-${i}`, type: 'OUT', quantity: -1,
    reason: `Movement ${i}`, reference: `bill-${i}`, createdAt: '2026-10-08T10:00:00Z', operatorName: 'Cashier' }));

test('movement pagination requests stable 50-row offsets and changing a date resets to the first page', async () => {
    const page = createPage({ mode: 'movement', movements: movementRows(120) });
    await page.flush(); await click(page, 'Next'); await click(page, 'Next');
    assert.equal(page.requests.at(-1).args.offset, 100);
    assert.match(page.text(), /Showing 101 to 120 of 120/);
    await page.act(() => page.find(n => n.type === 'input' && n.props['aria-label'] === 'Movement from date').props.onChange({ target: { value: '2026-10-01' } }));
    assert.deepEqual(page.requests.at(-1).args, { variantId: 'variant-0', fromDate: '2026-10-01', toDate: undefined, limit: 50, offset: 0 });
    assert.match(page.text(), /Showing 1 to 50 of 120/);
    await click(page, 'Next'); await click(page, 'Prev');
    assert.equal(page.requests.at(-1).args.offset, 0);
});

test('All Time clears both movement dates and pagination after a bounded range', async () => {
    const page = createPage({ mode: 'movement', movements: movementRows(60) });
    await page.flush(); await click(page, '7 Days'); await click(page, 'Next'); await click(page, 'All Time');
    assert.equal(page.requests.at(-1).args.fromDate, undefined);
    assert.equal(page.requests.at(-1).args.toDate, undefined);
    assert.equal(page.requests.at(-1).args.offset, 0);
    assert.deepEqual(page.all(n => n.type === 'input' && n.props.type === 'date').map(n => n.props.value), ['', '']);
});

test('an inverted movement date range shows a clear correction and never queries it', async () => {
    const page = createPage({ mode: 'movement' }); await page.flush();
    await page.act(() => page.find(n => n.type === 'input' && n.props['aria-label'] === 'Movement from date').props.onChange({ target: { value: '2026-10-10' } }));
    const before = page.requests.length;
    await page.act(() => page.find(n => n.type === 'input' && n.props['aria-label'] === 'Movement to date').props.onChange({ target: { value: '2026-10-01' } }));
    assert.equal(page.requests.length, before);
    assert.match(page.text(), /From date must be on or before the to date/);
    await page.act(() => page.find(n => n.type === 'input' && n.props['aria-label'] === 'Movement to date').props.onChange({ target: { value: '2026-10-11' } }));
    assert.equal(page.requests.at(-1).args.toDate, '2026-10-11');
    assert.doesNotMatch(page.text(), /From date must/);
});

test('reselecting the current movement range refreshes instead of invalidating without a new request', async () => {
    const page = createPage({ mode: 'movement', manual: true }); await page.flush();
    await click(page, 'All Time');
    assert.equal(page.requests.length, 2);
    page.requests[1].resolve(movementResponse(page.requests[1].args, [{ ...movementRows(1)[0], reason: 'Refreshed all-time result' }]));
    await page.flush(); assert.match(page.text(), /Refreshed all-time result/);
    page.requests[0].resolve(movementResponse(page.requests[0].args, [{ ...movementRows(1)[0], reason: 'Obsolete initial result' }]));
    await page.flush(); assert.doesNotMatch(page.text(), /Obsolete initial result|Loading movements/);
    await click(page, 'Today');
    page.requests[2].resolve(movementResponse(page.requests[2].args, movementRows(1))); await page.flush();
    await click(page, 'Today'); assert.equal(page.requests.length, 4);
    page.requests[3].resolve(movementResponse(page.requests[3].args, movementRows(1))); await page.flush();
    assert.doesNotMatch(page.text(), /Loading movements/);
});

test('movement operator display prefers readable name, then operator ID, then System', async () => {
    const rows = [
        { id: 'named', operatorName: 'Owner Name', createdBy: 'hidden-user-id' },
        { id: 'by-id', operatorName: null, createdBy: 'staff-user-id' },
        { id: 'system', operatorName: null, createdBy: null },
    ].map(row => ({ ...row, type: 'RECEIPT', quantity: 1, reason: null, reference: null, createdAt: '2026-10-08T10:00:00Z' }));
    const page = createPage({ mode: 'movement', movements: rows }); await page.flush();
    assert.match(page.text(), /Owner Name/); assert.match(page.text(), /staff-user-id/); assert.match(page.text(), /System/);
    assert.doesNotMatch(page.text(), /hidden-user-id/);
    assert.match(page.text(), /Stock Received/);
});

for (const outcome of ['success', 'failure']) test(`superseded movement ${outcome} cannot overwrite a newer date query`, async () => {
    const page = createPage({ mode: 'movement', manual: true }); await page.flush(); await click(page, 'Today');
    page.requests[1].resolve(movementResponse(page.requests[1].args, [{ ...movementRows(1)[0], reason: 'Current date result' }]));
    await page.flush(); const current = page.text();
    if (outcome === 'success') page.requests[0].resolve(movementResponse(page.requests[0].args, [{ ...movementRows(1)[0], reason: 'Stale result' }]));
    else page.requests[0].reject(new Error('Stale failure'));
    await page.flush(); assert.equal(page.text(), current);
});

test('movement read errors and wrong-item responses fail closed and retry the intended item', async () => {
    const page = createPage({ mode: 'movement', manual: true }); await page.flush();
    page.requests[0].reject(new Error('Read unavailable')); await page.flush(); assert.match(page.text(), /Read unavailable/);
    await click(page, 'Retry');
    page.requests[1].resolve(movementResponse(page.requests[1].args, movementRows(1), 'wrong-variant'));
    await page.flush(); assert.match(page.text(), /wrong item history/);
    await click(page, 'Retry'); assert.equal(page.requests[2].args.variantId, 'variant-0');
    page.requests[2].resolve(movementResponse(page.requests[2].args, movementRows(1))); await page.flush();
    assert.match(page.text(), /Movement 0/); assert.doesNotMatch(page.text(), /wrong item history/);
});

test('movement responses after unmount never update detached component state', async () => {
    const page = createPage({ mode: 'movement', manual: true }); await page.flush(); page.dispose();
    page.requests[0].resolve(movementResponse(page.requests[0].args, movementRows(1))); await page.flush();
    assert.equal(page.lateUpdates(), 0);
});

test('movement access loss hides the dialog and discards pending reads', async () => {
    const page = createPage({ mode: 'movement', manual: true }); await page.flush();
    await page.user({ id: 'owner', role: 'CASHIER', isActive: true, permManageInventory: false });
    page.requests[0].resolve(movementResponse(page.requests[0].args, movementRows(1))); await page.flush();
    assert.equal(page.all(n => n.type === 'Modal').length, 0);
    assert.equal(page.all(n => n.type === 'td').length, 0);
    assert.equal(page.requests.length, 1);
});

test('Stock has Inventory, Add manually and Excel upload tabs and keeps old billing lists out of Stock', async () => {
    const page = createPage({ mode: 'wrapper' }); await page.flush();
    assert.equal(page.find(n => n.type === 'InventoryWorkspaceView').props.scope, 'TRACKED');
    assert.equal(page.all(n => n.type === 'StockEntryView').length, 0);
    assert.deepEqual(page.all(n => n.type === 'button' && typeof n.props['aria-pressed'] === 'boolean').map(page.textOf), ['Inventory', 'Add manually', 'Excel upload']);
    await click(page, 'Excel upload'); assert.equal(page.all(n => n.type === 'InventoryWorkspaceView').length, 0);
    assert.equal(page.all(n => n.type === 'StockEntryView').length, 1);
    await click(page, 'Inventory');
    assert.equal(page.find(n => n.type === 'InventoryWorkspaceView').props.scope, 'TRACKED');
    assert.doesNotMatch(page.text(), /ST-03A|Count Drafts|Stock Overview|Old billing items|Audit & relabelling|Prepared items|Saved batches/);
});

test('the empty-inventory action opens Excel upload and completed stock refreshes Inventory', async () => {
    const page = createPage({ mode: 'wrapper' }); await page.flush();
    await page.act(() => page.find(n => n.type === 'InventoryWorkspaceView').props.onOpenAudit());
    const audit = page.find(n => n.type === 'StockEntryView'); await page.act(() => audit.props.onSaved());
    await click(page, 'Inventory'); assert.equal(page.find(n => n.type === 'InventoryWorkspaceView').key, 'tracked-1');
    assert.equal(page.all(n => n.type === 'InventoryWorkspaceView' && n.props.scope !== 'TRACKED').length, 0);
});

test('movement navigation uses the selected stable variant ID and closes only its history dialog', async () => {
    const page = createPage({ mode: 'wrapper' }); await page.flush();
    await page.act(() => page.find(n => n.type === 'InventoryWorkspaceView').props.onViewMovements('specific-variant-id'));
    assert.equal(page.find(n => n.type === 'MovementHistoryModal').props.variantId, 'specific-variant-id');
    await page.act(() => page.find(n => n.type === 'MovementHistoryModal').props.onClose());
    assert.equal(page.all(n => n.type === 'MovementHistoryModal').length, 0);
    assert.equal(page.find(n => n.type === 'InventoryWorkspaceView').props.scope, 'TRACKED');
});

test('Stock denies inactive and unauthorized accounts without rendering any inventory, audit or history', async () => {
    for (const user of [
        { id: 'disabled', role: 'ADMIN', isActive: false },
        { id: 'cashier', role: 'CASHIER', isActive: true, permManageInventory: false },
    ]) {
        const page = createPage({ mode: 'wrapper', user }); await page.flush();
        assert.match(page.text(), /need inventory access/);
        assert.equal(page.all(n => ['InventoryWorkspaceView', 'StockEntryView', 'MovementHistoryModal'].includes(n.type)).length, 0);
        assert.equal(page.requests.length, 0);
    }
});

test('stock tabs cannot discard an open count editor or pending stock request', async () => {
    const page = createPage({ mode: 'wrapper' }); await page.flush(); await click(page, 'Excel upload');
    const audit = page.find(node => node.type === 'StockEntryView');
    await page.act(() => audit.props.onBlockedChange(true));
    const tabs = page.all(node => node.type === 'button' && node.props['aria-pressed'] !== undefined);
    assert.equal(tabs.length, 3); assert.ok(tabs.every(node => node.props.disabled));
    await page.act(() => tabs[0].props.onClick());
    assert.equal(page.all(node => node.type === 'StockEntryView').length, 1);
    await page.act(() => audit.props.onBlockedChange(false));
    await click(page, 'Inventory');
    assert.equal(page.find(node => node.type === 'InventoryWorkspaceView').props.scope, 'TRACKED');
});
