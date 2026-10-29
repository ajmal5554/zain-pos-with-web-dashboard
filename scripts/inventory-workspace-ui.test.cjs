const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = (name, run) => nodeTest(name, { timeout: 8000 }, run);
const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const owner = { id: 'owner', role: 'ADMIN', isActive: true, permManageInventory: true, permManageProducts: true };

const variant = (id, productId, size, overrides = {}) => ({ id, productId, name: 'Shirt 700',
    categoryId: 'shirts', category: 'Shirts', sku: id, barcode: `000-${id}`, size, stock: 2,
    minStock: 0, mrp: 700, sellingPrice: 700, scope: 'TRACKED', updatedAt: '2026-10-14T08:15:00.000Z',
    attributes: { brand: 'Crazy Heart', fabric: 'Cotton', pattern: 'Checks', sleeveLength: 'Full sleeve' }, ...overrides });
function workspace(overrides = {}) {
    const first = [variant('a-M', 'product-a', 'M'), variant('a-L', 'product-a', 'L')];
    const second = [variant('b-M', 'product-b', 'M', { attributes: { brand: 'Second Brand', fabric: 'Linen', pattern: 'Plain' } })];
    const groups = [{ id: 'product-a', name: 'Shirt 700', category: 'Shirts', variants: first, quantity: 4, mrpValue: 2800 },
        { id: 'product-b', name: 'Shirt 700', category: 'Shirts', variants: second, quantity: 2, mrpValue: 1400 }];
    return { scope: 'TRACKED', groupBy: 'STYLE', items: groups, page: 1, pageSize: 30, totalPages: 1,
        totalMatching: 2, stats: { styleCount: 2, variantCount: 3, quantity: 6, mrpValue: 4200, categoryCount: 1 },
        facets: { categories: [{ id: 'shirts', name: 'Shirts' }], brands: ['Crazy Heart', 'Second Brand'],
            sizes: ['M', 'L'], fabrics: ['Cotton', 'Linen'], patterns: ['Checks', 'Plain'], qualities: [] }, ...overrides };
}
function textOf(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node !== 'object') return String(node);
    return Array.isArray(node) ? node.map(textOf).join(' ') : textOf(node.props?.children);
}

// Real component + real renderer service; only IPC, UI primitives and React's
// commit loop are simulated. No inventory database or live balances are modified.
function fixture({ user = owner, scope = 'TRACKED', available = true, callbacks = true } = {}) {
    let actor = user, tree, hookIndex = 0, dirty = true, mounted = true, currentKey;
    let hooks = [], effects = [], now = 0, nextTimer = 1;
    const timers = new Map(), calls = [], movementCalls = [], editCalls = [], auditCalls = [];
    let props = { scope, ...(callbacks ? { onViewMovements: id => movementCalls.push(id),
        onEditProduct: id => editCalls.push(id), onOpenAudit: () => auditCalls.push('open') } : {}) };
    const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }),
        Fragment: 'Fragment',
        useState(initial) {
            const index = hookIndex++;
            if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
            const target = hooks[index];
            return [target.value, value => {
                if (!mounted || !hooks.includes(target)) return;
                const next = typeof value === 'function' ? value(target.value) : value;
                if (!Object.is(next, target.value)) { target.value = next; dirty = true; }
            }];
        },
        useRef(initial) {
            const index = hookIndex++;
            if (!hooks[index]) hooks[index] = { value: { current: initial } };
            return hooks[index].value;
        },
        useEffect(effect, dependencies) {
            const index = hookIndex++;
            if (!hooks[index] || !equal(hooks[index].dependencies, dependencies)) {
                hooks[index] = { dependencies, cleanup: hooks[index]?.cleanup };
                effects.push({ index, effect });
            }
        },
    };
    const useAuthStore = Object.assign(() => ({ user: actor }), { getState: () => ({ user: actor }) });
    const window = { electronAPI: { stock: available ? { getInventory: args => new Promise((resolve, reject) => calls.push({ args,
        ok: data => resolve({ success: true, data }), fail: error => resolve({ success: false, error }), reject })) } : {} } };
    const service = { exports: {} };
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/services/inventory-workspace.service.ts'), 'utf8')),
        { exports: service.exports, module: service, window, Error,
            require: name => { if (name.endsWith('/authStore')) return { useAuthStore }; throw new Error(`Unexpected service dependency: ${name}`); } });
    const module = { exports: {} };
    const context = { exports: module.exports, module, window, Date, Error,
        setTimeout: (callback, delay = 0) => { const id = nextTimer++; timers.set(id, { callback, at: now + delay }); return id; },
        clearTimeout: id => timers.delete(id),
        require: name => {
            if (name === 'react') return { __esModule: true, default: react, ...react };
            if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => `Icon:${String(key)}` });
            if (name.endsWith('/authStore')) return { useAuthStore };
            if (name.endsWith('/inventory-workspace.service')) return service.exports;
            const component = ['Button', 'Input', 'QuickStockCount'].find(key => name.endsWith(`/${key}`));
            if (component) return { [component]: component };
            throw new Error(`Unexpected component dependency: ${name}`);
        },
    };
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/components/stock/InventoryWorkspaceView.tsx'), 'utf8')), context);
    function cleanupInner() { for (const hook of hooks) hook?.cleanup?.(); hooks = []; effects = []; }
    function expand(node) {
        if (!node || typeof node !== 'object') return node;
        if (Array.isArray(node)) return node.map(expand);
        if (typeof node.type === 'function') return expand(node.type(node.props));
        return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
    }
    function flush() {
        for (let commits = 0; dirty && mounted; commits++) {
            assert.ok(commits < 50, 'UI must settle without repeated requests');
            dirty = false; hookIndex = 0;
            let next = module.exports.InventoryWorkspaceView(props);
            if (typeof next?.type === 'function') {
                const key = next.props?.key;
                if (key !== currentKey) { cleanupInner(); currentKey = key; hookIndex = 0; }
                next = next.type(next.props);
            } else if (hooks.length) { cleanupInner(); currentKey = undefined; }
            tree = expand(next);
            for (const { index, effect } of effects.splice(0)) { hooks[index].cleanup?.(); hooks[index].cleanup = effect(); }
        }
    }
    async function settle() { for (let i = 0; i < 14; i++) { await Promise.resolve(); flush(); } }
    function all(scope = tree) {
        const result = [];
        const visit = node => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) { node.forEach(visit); return; }
            result.push(node); visit(node.props?.children);
        };
        visit(scope); return result;
    }
    const match = (actual, expected) => expected instanceof RegExp ? expected.test(actual) : actual === expected;
    function control(predicate, label, scope = tree) { const node = all(scope).find(predicate); assert.ok(node, `Missing ${label}. Visible: ${textOf(scope)}`); return node; }
    const button = (label, scope = tree) => control(n => ['Button', 'button'].includes(n.type) && match(textOf(n).replace(/\s+/g, ' ').trim(), label), `button ${label}`, scope);
    const aria = label => control(n => match(n.props?.['aria-label'] || '', label), `control ${label}`);
    const start = callback => { const result = callback(); flush(); return result; };
    const click = node => { assert.ok(!node.props.disabled, 'Cannot click disabled control'); return start(() => node.props.onClick()); };
    const change = (node, value) => { assert.ok(!node.props.disabled, 'Cannot change disabled control'); return start(() => node.props.onChange({ target: { value } })); };
    async function advance(milliseconds) {
        const target = now + milliseconds;
        for (;;) {
            const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at; timers.delete(next[0]); next[1].callback(); await settle();
        }
        now = target; await settle();
    }
    flush();
    return { calls, movementCalls, editCalls, auditCalls, settle, start, all, button, aria, click, change, advance,
        text: (scope = tree) => textOf(scope).replace(/\s+/g, ' ').trim(), latest: () => calls.at(-1),
        load: async data => { calls.at(-1).ok(data || workspace()); await settle(); },
        setActor: next => { actor = next; dirty = true; flush(); },
        setProps: next => { props = { ...props, ...next }; dirty = true; flush(); },
        unmount: () => { cleanupInner(); mounted = false; },
    };
}

test('style grouping keeps identical names as separate stable product identities and shows readable attributes', async () => {
    const h = fixture(); await h.load();
    const groups = h.all().filter(node => node.type === 'tr' && node.props.className?.includes('bg-indigo-50/50'));
    assert.deepEqual(groups.map(node => node.props['data-product-id']), ['product-a', 'product-b']);
    assert.match(h.text(groups[0]), /Crazy Heart/);
    assert.match(h.text(groups[0]), /Cotton/);
    assert.match(h.text(groups[0]), /Sleeve Length\s*:\s*Full sleeve/);
    assert.match(h.text(groups[1]), /Linen/);
    assert.match(h.text(), /Pieces in stock/);
    assert.match(h.text(), /Stock value \(MRP\)/);
    assert.match(h.text(), /Only audited items with their new labels are included/);
    assert.match(h.text(), /₹4,200/);
    assert.equal(h.all().some(node => node.type === 'button' && ['+', '−', '-'].includes(h.text(node))), false);
    h.unmount();
});

test('movement and edit callbacks receive variant and product IDs rather than the shared item name', async () => {
    const h = fixture(); await h.load();
    const rows = h.all().filter(node => node.type === 'tr' && node.props['data-variant-id']);
    for (const rowNode of rows) {
        const controls = h.all(rowNode).filter(node => node.type === 'Button');
        h.click(controls.find(node => node.props.title === 'Movement history'));
        h.click(controls.find(node => node.props.title === 'Edit product'));
    }
    assert.deepEqual(h.movementCalls, ['a-M', 'a-L', 'b-M']);
    assert.deepEqual(h.editCalls, ['product-a', 'product-a', 'product-b']);
    h.unmount();
});

test('inventory rows show the selling price and distinguish a different MRP', async () => {
    const h = fixture();
    const data = workspace();
    data.items[0].variants[0].sellingPrice = 650;
    await h.load(data);
    const row = h.all().find(node => node.type === 'tr' && node.props['data-variant-id'] === 'a-M');
    const priceCell = h.all(row).filter(node => node.type === 'td')[2];
    assert.match(h.text(priceCell), /₹650/);
    assert.match(h.text(priceCell), /MRP: ₹700/);
    const samePrice = h.all().find(node => node.type === 'tr' && node.props['data-variant-id'] === 'a-L');
    assert.equal((h.text(h.all(samePrice).filter(node => node.type === 'td')[2]).match(/₹700/g) || []).length, 1);
    h.unmount();
});

test('By size asks the backend for size entries and removes style section headings', async () => {
    const h = fixture(); await h.load();
    h.click(h.button('By size'));
    assert.equal(h.latest().args.groupBy, 'SIZE');
    assert.equal(h.latest().args.page, 1);
    const original = workspace();
    await h.load(workspace({ groupBy: 'SIZE', totalMatching: 3, items: original.items.flatMap(group => group.variants.map(value => ({ ...group, id: value.id, variants: [value], quantity: value.stock }))) }));
    assert.equal(h.button('By size').props['aria-pressed'], true);
    assert.equal(h.all().some(node => node.type === 'tr' && node.props.className?.includes('bg-indigo-50/50')), false);
    assert.equal(h.all().filter(node => node.type === 'tr' && node.props['data-variant-id']).length, 3);
    assert.match(h.text(), /3 size entries/);
    h.unmount();
});

test('available filters are dynamic; absent quality and colour controls are omitted and only selected values are sent', async () => {
    const h = fixture(); await h.load();
    assert.equal(h.all().some(node => node.props['aria-label'] === 'Filter by quality'), false);
    assert.equal(h.all().some(node => /color|colour/i.test(node.props['aria-label'] || '')), false);
    h.click(h.button('More filters'));
    assert.equal(h.all().some(node => node.props['aria-label'] === 'Filter by quality'), false);
    h.change(h.aria('Filter by fabric'), 'Cotton');
    assert.equal(h.latest().args.fabric, 'Cotton');
    assert.equal(h.latest().args.brand, undefined);
    assert.equal(h.latest().args.quality, undefined);
    assert.equal(h.latest().args.balanceFilter, undefined);
    await h.load();
    h.change(h.aria('Filter by category'), 'shirts');
    assert.equal(h.latest().args.categoryId, 'shirts');
    assert.equal(h.latest().args.fabric, 'Cotton');
    await h.load();
    h.click(h.button('Clear filters'));
    assert.equal(h.latest().args.fabric, undefined);
    assert.equal(h.latest().args.categoryId, undefined);
    h.unmount();
});

test('search uses the latest filters, resets pagination, and rejects responses from before the search', async () => {
    const h = fixture(); await h.load(workspace({ totalMatching: 65, totalPages: 3 }));
    h.click(h.aria('Next inventory page'));
    await h.load(workspace({ page: 2, totalMatching: 65, totalPages: 3 }));
    h.click(h.button('Refresh'));
    const old = h.latest();
    h.change(h.aria('Search inventory'), 'Linen');
    h.change(h.aria('Filter by brand'), 'Second Brand');
    const beforeDebounce = h.calls.length;
    await h.advance(300);
    assert.equal(h.calls.length, beforeDebounce + 1);
    assert.equal(h.latest().args.page, 1);
    assert.equal(h.latest().args.search, 'Linen');
    assert.equal(h.latest().args.brand, 'Second Brand');
    await h.load(workspace({ items: [workspace().items[1]], totalMatching: 1 }));
    old.ok(workspace({ items: [{ ...workspace().items[0], name: 'Old stale style' }], page: 2 })); await h.settle();
    assert.equal(h.text().includes('Old stale style'), false);
    assert.match(h.text(), /Linen/);
    h.unmount();
});

test('failed refresh marks previous rows stale and summary unavailable; retry restores actual zero balances', async () => {
    const h = fixture(); await h.load();
    const oldMovement = h.aria(/Movement history for/).props.onClick;
    h.click(h.button('Refresh'));
    h.latest().fail('Inventory database unavailable'); await h.settle();
    assert.match(h.text(), /last loaded results/);
    assert.match(h.text(), /Unavailable/);
    assert.match(h.text(), /Crazy Heart/);
    assert.equal(h.aria(/Movement history for/).props.disabled, true);
    await h.start(oldMovement);
    assert.equal(h.movementCalls.length, 0);
    h.click(h.button('Retry loading inventory'));
    const zero = workspace(); zero.stats.quantity = 0; zero.stats.mrpValue = 0;
    zero.items.forEach(group => { group.quantity = 0; group.mrpValue = 0; group.variants.forEach(value => { value.stock = 0; }); });
    await h.load(zero);
    assert.equal(h.text().includes('Unavailable'), false);
    assert.match(h.text(), /₹0/);
    assert.equal(h.aria(/Movement history for/).props.disabled, false);
    h.unmount();
});

test('unfiltered tracked-empty state opens the audit workflow; filtered empty results offer clearing filters instead', async () => {
    const h = fixture();
    const empty = workspace({ items: [], totalMatching: 0, stats: { styleCount: 0, variantCount: 0, quantity: 0, mrpValue: 0, categoryCount: 0 } });
    await h.load(empty);
    h.click(h.button('Import Excel stock'));
    assert.deepEqual(h.auditCalls, ['open']);
    h.change(h.aria('Search inventory'), 'missing'); await h.advance(300); await h.load(empty);
    assert.equal(h.text().includes('Import Excel stock'), false);
    assert.match(h.text(), /No stock matches these filters/);
    assert.ok(h.button('Clear filters'));
    h.unmount();
});

test('legacy balances are explicitly unverified and never presented as tracked stock valuation', async () => {
    const h = fixture({ scope: 'LEGACY' });
    const old = workspace({ scope: 'LEGACY', stats: { styleCount: 2, variantCount: 3, quantity: -23, mrpValue: null, categoryCount: 1 } });
    old.items.forEach(group => { group.mrpValue = null; group.variants.forEach(value => { value.scope = 'LEGACY'; }); });
    await h.load(old);
    assert.equal(h.latest().args.scope, 'LEGACY');
    assert.match(h.text(), /Recorded balance is unverified/);
    assert.match(h.text(), /-23/);
    assert.equal(h.text().includes('Stock value (MRP)'), false);
    assert.equal(h.text().includes('₹4,200'), false);
    h.click(h.button('More filters'));
    h.change(h.aria('Filter recorded balance'), 'NEGATIVE');
    assert.equal(h.latest().args.balanceFilter, 'NEGATIVE');
    h.unmount();
});

test('prepared scope stays separate and is labelled unavailable at checkout', async () => {
    const h = fixture({ scope: 'PREPARED' }); await h.load(workspace({ scope: 'PREPARED' }));
    assert.equal(h.latest().args.scope, 'PREPARED');
    assert.match(h.text(), /Prepared items are not live stock/);
    assert.match(h.text(), /not available at checkout/);
    assert.equal(h.text().includes('Stock value (MRP)'), false);
    h.unmount();
});

test('unauthorized users make no reads; product editing is hidden without product permission or a callback', async () => {
    for (const user of [null, { ...owner, isActive: false }, { ...owner, role: 'CASHIER', permManageInventory: false }]) {
        const h = fixture({ user }); await h.settle();
        assert.equal(h.calls.length, 0);
        assert.match(h.text(), /need inventory access/);
        h.unmount();
    }
    const h = fixture({ user: { ...owner, role: 'CASHIER', permManageProducts: false } }); await h.load();
    assert.equal(h.all().some(node => node.props.title === 'Edit product'), false);
    assert.ok(h.aria(/Movement history for/));
    h.unmount();
    const noCallbacks = fixture({ callbacks: false }); await noCallbacks.load();
    assert.equal(noCallbacks.all().some(node => node.props.title === 'Edit product' || node.props.title === 'Movement history'), false);
    noCallbacks.unmount();
});

test('account, scope and unmount boundaries discard pending reads and captured row actions', async () => {
    const h = fixture(); const oldRead = h.latest();
    h.setActor({ ...owner, id: 'second-owner' });
    const currentData = workspace(); currentData.items[0].name = 'Current owner style';
    await h.load(currentData);
    oldRead.ok(workspace({ items: [{ ...workspace().items[0], name: 'Previous owner style' }] })); await h.settle();
    assert.match(h.text(), /Current owner style/);
    assert.equal(h.text().includes('Previous owner style'), false);
    const capturedEdit = h.aria(/Edit product/).props.onClick;
    h.setProps({ scope: 'LEGACY' });
    const oldScopeRead = h.latest();
    h.setProps({ scope: 'PREPARED' }); await h.load(workspace({ scope: 'PREPARED' }));
    oldScopeRead.ok(workspace({ scope: 'LEGACY', items: [{ ...workspace().items[0], name: 'Stale legacy style' }] })); await h.settle();
    assert.equal(h.text().includes('Stale legacy style'), false);
    await h.start(capturedEdit);
    assert.equal(h.editCalls.length, 0);
    h.click(h.button('Refresh'));
    const late = h.latest(); h.unmount(); late.ok(workspace()); await h.settle();
    assert.equal(h.editCalls.length, 0);
});

test('a clamped page response settles without a refetch loop and pagination follows the backend page', async () => {
    const h = fixture(); await h.load(workspace({ totalMatching: 65, totalPages: 3 }));
    h.click(h.aria('Next inventory page'));
    await h.load(workspace({ page: 2, totalMatching: 65, totalPages: 3 }));
    h.click(h.aria('Next inventory page'));
    await h.load(workspace({ page: 1, totalMatching: 2, totalPages: 1 }));
    // The clamp can request its final page once; the following same-page response is stable.
    await h.load(workspace());
    const settled = h.calls.length;
    await h.advance(1000);
    assert.equal(h.calls.length, settled);
    assert.match(h.text(), /Page 1 of 1/);
    assert.equal(h.aria('Next inventory page').props.disabled, true);
    h.unmount();
});

test('unavailable inventory bridge gives a clear message without fake data or API calls', async () => {
    const h = fixture({ available: false }); await h.settle();
    assert.match(h.text(), /updated desktop POS app/);
    assert.equal(h.calls.length, 0);
    h.unmount();
});
