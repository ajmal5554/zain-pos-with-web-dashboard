const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = (name, run) => nodeTest(name, { timeout: 8000 }, run);
const root = path.resolve(__dirname, '..');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const actor = { id: 'return-owner', isActive: true, role: 'ADMIN' };
function options(overrides = {}) {
    return { sourceTracked: false, requiresChoice: true, items: [
        { id: 'tracked-xl', barcode: '123456', name: 'Shirt 700', description: 'Shirt | XL | Cotton | Checks', stock: 4 },
        { id: 'tracked-m', barcode: '123457', name: 'Shirt 700', description: 'Shirt | M | Cotton | Checks', stock: 2 },
    ], ...overrides };
}
function textOf(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node !== 'object') return String(node);
    return Array.isArray(node) ? node.map(textOf).join(' ') : textOf(node.props?.children);
}

/** Runs the actual selector, controlled parent value, effects and cleanups; only IPC and time are fake. */
function fixture({ user = actor, sourceVariantId = 'legacy-shirt', value, disabled = false, available = true } = {}) {
    let currentActor = user, props = { sourceVariantId, value, disabled }, tree;
    let hookIndex = 0, dirty = true, mounted = true, now = 0, nextTimer = 1;
    const hooks = [], effects = [], timers = new Map(), calls = [], changes = [];
    const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
    const element = (type, props, key) => ({ type, props: { ...props }, key });
    const react = {
        useState(initial) {
            const index = hookIndex++;
            if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
            return [hooks[index].value, next => {
                if (!mounted) return;
                const value = typeof next === 'function' ? next(hooks[index].value) : next;
                if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; dirty = true; }
            }];
        },
        useRef(initial) {
            const index = hookIndex++;
            if (!hooks[index]) hooks[index] = { value: { current: initial } };
            return hooks[index].value;
        },
        useEffect(effect, dependencies) {
            const index = hookIndex++;
            if (!hooks[index] || !same(hooks[index].dependencies, dependencies)) {
                const previous = hooks[index]; hooks[index] = { dependencies, cleanup: previous?.cleanup };
                effects.push({ index, effect });
            }
        },
    };
    const module = { exports: {} };
    const api = args => new Promise((resolve, reject) => calls.push({ args: copy(args),
        ok: data => resolve({ success: true, data }), fail: error => resolve({ success: false, error }), reject }));
    const window = available ? { electronAPI: { sales: { getReturnStockOptions: api } } } : {};
    const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/components/stock/ReturnStockSelector.tsx'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, window, Error,
        setTimeout: (callback, delay = 0) => { const id = nextTimer++; timers.set(id, { at: now + delay, callback }); return id; },
        clearTimeout: id => timers.delete(id),
        require(name) {
            if (name === 'react') return react;
            if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
            if (name.endsWith('/authStore')) return { useAuthStore: selector => selector({ user: currentActor }) };
            throw new Error(`Unexpected nonisolated dependency: ${name}`);
        },
    }, { filename: 'ReturnStockSelector.tsx' });
    function onChange(value) { changes.push(copy(value)); props = { ...props, value }; dirty = true; }
    function flush() {
        for (let commit = 0; dirty && mounted; commit++) {
            assert.ok(commit < 50, 'Return stock selector did not settle');
            dirty = false; hookIndex = 0;
            tree = module.exports.ReturnStockSelector({ ...props, onChange });
            for (const { index, effect } of effects.splice(0)) {
                hooks[index].cleanup?.(); hooks[index].cleanup = effect();
            }
        }
    }
    async function settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); flush(); } }
    function all(scope = tree) {
        const result = [];
        function visit(node, disabledByParent = false) {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) return node.forEach(child => visit(child, disabledByParent));
            result.push({ node, disabled: disabledByParent || Boolean(node.props?.disabled) });
            visit(node.props?.children, disabledByParent || node.type === 'fieldset' && Boolean(node.props.disabled));
        }
        visit(scope); return result;
    }
    function find(label, optional = false) {
        const found = all().find(({ node }) => node.props?.['aria-label'] === label)?.node;
        if (!optional) assert.ok(found, `Missing field ${label}. Visible: ${textOf(tree)}`);
        return found;
    }
    function checkbox() { const found = all().find(({ node }) => node.type === 'input' && node.props.type === 'checkbox')?.node; assert.ok(found, 'Missing physical confirmation'); return found; }
    function change(node, next) {
        assert.ok(node, 'Missing change control');
        assert.equal(all().find(value => value.node === node)?.disabled, false, 'Cannot edit a disabled return field');
        if (node.type === 'select') assert.ok(all(node).some(({ node: option }) => option.type === 'option' && option.props.value === next && !option.props.disabled), `Unavailable destination ${next}`);
        node.props.onChange({ target: node.props.type === 'checkbox' ? { checked: next } : { value: next } }); flush();
    }
    function retry() {
        const button = all().find(({ node }) => node.type === 'button' && textOf(node) === 'Retry')?.node;
        assert.ok(button, 'Missing lookup retry'); button.props.onClick(); flush();
    }
    async function advance(milliseconds = 0) {
        const target = now + milliseconds;
        for (;;) {
            const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at; timers.delete(next[0]); next[1].callback(); await settle();
        }
        now = target; await settle();
    }
    const setProps = patch => { props = { ...props, ...patch }; dirty = true; flush(); };
    function setActor(user) { currentActor = user; dirty = true; flush(); }
    function unmount() { mounted = false; for (const hook of hooks) hook?.cleanup?.(); }
    flush();
    return { calls, changes, all, find, checkbox, change, retry, advance, settle, setProps, setActor, unmount,
        latest: () => calls.at(-1), text: () => textOf(tree), tree: () => tree, value: () => copy(props.value),
        valid: () => module.exports.validReturnStockChoice(props.value), validate: module.exports.validReturnStockChoice,
        async load(data = options()) { await advance(0); calls.at(-1).ok(data); await settle(); },
    };
}

test('legacy returns before activation automatically keep original stock and add no extra form', async () => {
    const h = fixture(); await h.load(options({ requiresChoice: false, sourceTracked: false, items: [] }));
    assert.equal(h.tree(), null);
    assert.deepEqual(h.value(), { disposition: 'ORIGINAL', confirmed: true });
    assert.equal(h.valid(), true);
    assert.deepEqual(h.calls[0].args, { sourceVariantId: 'legacy-shirt', search: '' });
    h.unmount();
});

test('active legacy returns require an explicit destination and physical confirmation', async () => {
    const h = fixture(); await h.load();
    assert.equal(h.valid(), false);
    assert.match(h.text(), /Where will this returned garment go/);
    h.change(h.find('Returned garment stock destination'), 'ORIGINAL');
    assert.equal(h.valid(), false);
    h.change(h.checkbox(), true);
    assert.deepEqual(h.value(), { disposition: 'ORIGINAL', confirmed: true });
    assert.equal(h.valid(), true);
    h.change(h.find('Returned garment stock destination'), 'TRACKED');
    assert.equal(h.valid(), false);
    assert.equal(h.value().targetVariantId, undefined);
    h.unmount();
});

test('a mapped tracked target requires its exact barcode selection and renewed physical confirmation', async () => {
    const h = fixture(); await h.load();
    h.change(h.find('Returned garment stock destination'), 'TRACKED');
    h.change(h.checkbox(), true);
    assert.equal(h.valid(), false, 'Confirmation alone cannot invent a tracked destination');
    h.change(h.find('Matching tracked item'), 'tracked-xl');
    assert.equal(h.value().confirmed, false);
    assert.equal(h.valid(), false);
    assert.match(h.text(), /123456/);
    h.change(h.checkbox(), true);
    assert.equal(h.valid(), true);
    assert.equal(h.value().targetVariantId, 'tracked-xl');
    h.change(h.find('Matching tracked item'), 'tracked-m');
    assert.equal(h.value().confirmed, false);
    assert.equal(h.valid(), false);
    h.unmount();
});

test('holding a garment requires a nonblank reason and confirmation resets whenever its reason changes', async () => {
    const h = fixture(); await h.load();
    h.change(h.find('Returned garment stock destination'), 'HOLD');
    h.change(h.checkbox(), true);
    assert.equal(h.valid(), false);
    h.change(h.find('Reason for holding returned garment'), '   ');
    h.change(h.checkbox(), true);
    assert.equal(h.valid(), false);
    h.change(h.find('Reason for holding returned garment'), 'Torn seam; inspection needed');
    assert.equal(h.value().confirmed, false);
    h.change(h.checkbox(), true);
    assert.equal(h.valid(), true);
    h.change(h.find('Reason for holding returned garment'), 'Different reason');
    assert.equal(h.valid(), false);
    h.unmount();
});

test('search immediately clears the old target and confirmation, debounces lookup and ignores older search results', async () => {
    const h = fixture(); await h.load();
    h.change(h.find('Returned garment stock destination'), 'TRACKED');
    h.change(h.find('Matching tracked item'), 'tracked-xl'); h.change(h.checkbox(), true);
    h.change(h.find('Search matching returned stock'), 'Cotton');
    assert.equal(h.value().targetVariantId, undefined); assert.equal(h.value().confirmed, false);
    assert.equal(h.valid(), false);
    assert.equal(h.find('Matching tracked item').props.disabled, true);
    const count = h.calls.length; await h.advance(199); assert.equal(h.calls.length, count);
    await h.advance(1); const firstSearch = h.latest(); assert.equal(firstSearch.args.search, 'Cotton');
    h.change(h.find('Search matching returned stock'), 'Linen'); await h.advance(200); const newest = h.latest();
    newest.ok(options({ items: [{ id: 'linen-l', barcode: '888888', name: 'Shirt', description: 'Linen L', stock: 1 }] })); await h.settle();
    firstSearch.ok(options()); await h.settle();
    assert.match(h.text(), /888888/); assert.doesNotMatch(h.text(), /123456/);
    assert.equal(h.value().targetVariantId, undefined);
    h.unmount();
});

test('late lookup success and failure for a previous source cannot replace the currently rendered source', async () => {
    for (const fail of [false, true]) {
        const h = fixture(); await h.advance(0); const previous = h.latest();
        h.setProps({ sourceVariantId: 'legacy-pant', value: undefined }); await h.advance(0);
        assert.equal(h.latest().args.sourceVariantId, 'legacy-pant');
        h.latest().ok(options({ items: [{ id: 'pants-l', barcode: '777777', name: 'Pant', description: 'Pant L', stock: 1 }] })); await h.settle();
        if (fail) previous.fail('Old source failure'); else previous.ok(options({ sourceTracked: false, requiresChoice: false, items: [] }));
        await h.settle();
        assert.equal(h.valid(), false); assert.ok(h.tree()); assert.doesNotMatch(h.text(), /Old source failure/);
        h.change(h.find('Returned garment stock destination'), 'TRACKED'); assert.match(h.text(), /777777/);
        h.unmount();
    }
});

test('account changes discard old lookups and invalidate a previously confirmed physical destination', async () => {
    const h = fixture(); await h.load();
    h.change(h.find('Returned garment stock destination'), 'TRACKED');
    h.change(h.find('Matching tracked item'), 'tracked-xl'); h.change(h.checkbox(), true);
    assert.equal(h.valid(), true);
    h.setActor({ ...actor, id: 'different-return-owner' });
    assert.equal(h.valid(), false, 'A new account must review the physical garment again');
    assert.equal(h.value().targetVariantId, undefined);
    await h.advance(0); h.latest().fail('New account read denied'); await h.settle();
    assert.match(h.text(), /New account read denied/); assert.equal(h.valid(), false);
    h.unmount();
});

test('source changes invalidate a confirmed target immediately and late account results are ignored', async () => {
    const h = fixture(); await h.load();
    h.change(h.find('Returned garment stock destination'), 'TRACKED');
    h.change(h.find('Matching tracked item'), 'tracked-xl'); h.change(h.checkbox(), true);
    h.setProps({ sourceVariantId: 'other-original' });
    assert.equal(h.valid(), false, 'The old physical confirmation cannot carry across original items');
    assert.equal(h.value().targetVariantId, undefined);
    await h.advance(0); const oldAccount = h.latest();
    h.setActor({ ...actor, id: 'other-owner' }); await h.advance(0);
    h.latest().ok(options()); await h.settle();
    oldAccount.ok(options({ requiresChoice: false, sourceTracked: false, items: [] })); await h.settle();
    assert.ok(h.tree()); assert.equal(h.valid(), false);
    h.unmount();
});

test('lookup errors expose retry and a successful retry restores the form without inventing confirmation', async () => {
    const h = fixture(); await h.advance(0); h.latest().fail('Stock read is unavailable'); await h.settle();
    assert.match(h.text(), /Stock read is unavailable/); assert.equal(h.valid(), false);
    assert.equal(h.find('Returned garment stock destination', true), undefined);
    h.retry(); await h.advance(0); h.latest().ok(options()); await h.settle();
    assert.doesNotMatch(h.text(), /Stock read is unavailable/); assert.equal(h.valid(), false);
    assert.ok(h.find('Returned garment stock destination'));
    h.unmount();
});

test('missing desktop capability fails with an actionable error and no fabricated stock options', async () => {
    const h = fixture({ available: false }); await h.advance(0);
    assert.match(h.text(), /updated desktop app/); assert.equal(h.valid(), false); assert.equal(h.calls.length, 0);
    h.unmount();
});

test('lookup completions after unmount cannot publish a choice or update another return form', async () => {
    for (const fail of [false, true]) {
        const h = fixture(); await h.advance(0); const pending = h.latest(), before = h.changes.length;
        h.unmount();
        if (fail) pending.fail('Unmounted lookup'); else pending.ok(options({ requiresChoice: false, sourceTracked: false, items: [] }));
        await h.settle(); assert.equal(h.changes.length, before);
    }
});

test('an original tracked return defaults to its own barcode and still offers a confirmed hold', async () => {
    const h = fixture({ sourceVariantId: 'tracked-shirt' });
    await h.load(options({ sourceTracked: true, requiresChoice: false, items: [] }));
    assert.equal(h.valid(), true); assert.match(h.text(), /original tracked barcode/);
    assert.doesNotMatch(h.text(), /Identify and label a matching tracked item/);
    h.change(h.find('Returned garment stock destination'), 'HOLD');
    h.change(h.find('Reason for holding returned garment'), 'Damaged after sale');
    assert.equal(h.valid(), false); h.change(h.checkbox(), true); assert.equal(h.valid(), true);
    h.unmount();
});

test('tracked and preactivation HOLD remounts preserve hold intent and require a renewed reason and physical confirmation', async () => {
    for (const sourceTracked of [true, false]) {
        const h = fixture({ sourceVariantId: sourceTracked ? 'tracked-shirt' : 'legacy-shirt', value: { disposition: 'HOLD', reason: 'Damaged seam', confirmed: true } });
        await h.load(options({ sourceTracked, requiresChoice: false, items: [] }));
        assert.ok(h.tree(), 'A known HOLD intent must remain visible for physical review');
        assert.equal(h.value().disposition, 'HOLD');
        assert.equal(h.value().reason, undefined, 'A new component scope must renew the hold reason');
        assert.equal(h.valid(), false);
        h.change(h.checkbox(), true);
        assert.equal(h.valid(), false, 'Physical confirmation without a renewed reason remains invalid');
        h.change(h.find('Reason for holding returned garment'), 'Damaged seam checked again');
        assert.equal(h.valid(), false);
        h.change(h.checkbox(), true);
        assert.equal(h.valid(), true);
        h.unmount();
    }
});

test('disabled financial submissions cannot edit destination, target, reason or confirmation', async () => {
    const h = fixture(); await h.load();
    h.change(h.find('Returned garment stock destination'), 'HOLD');
    h.setProps({ disabled: true });
    for (const node of [h.find('Returned garment stock destination'), h.find('Reason for holding returned garment'), h.checkbox()]) {
        assert.throws(() => h.change(node, node.props.type === 'checkbox' ? true : 'Changed'), /disabled return field/);
    }
    h.unmount();
});

test('parent validity helper rejects missing, unconfirmed, blank target and blank hold choices', () => {
    const h = fixture();
    for (const value of [undefined, { disposition: 'ORIGINAL', confirmed: false }, { disposition: 'TRACKED', confirmed: true },
        { disposition: 'TRACKED', confirmed: true, targetVariantId: '   ' }, { disposition: 'HOLD', confirmed: true, reason: '   ' }]) assert.equal(h.validate(value), false);
    assert.equal(h.validate({ disposition: 'ORIGINAL', confirmed: true }), true);
    assert.equal(h.validate({ disposition: 'TRACKED', confirmed: true, targetVariantId: 'tracked-xl' }), true);
    assert.equal(h.validate({ disposition: 'HOLD', confirmed: true, reason: 'Damaged' }), true);
    h.unmount();
});
