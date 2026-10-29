const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');
// A missing response must fail this suite, never leave the review waiting indefinitely.
const test = (name, run) => nodeTest(name, { timeout: 8000 }, run);

// Node runs each test file in its own process. Exercise the shop's actual local zone.
process.env.TZ = 'Asia/Kolkata';
const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.React, esModuleInterop: true,
    },
}).outputText;
const copy = value => JSON.parse(JSON.stringify(value));
const manager = { id: 'inventory-manager', role: 'CASHIER', isActive: true, permManageInventory: true };

function detail(id = 'draft-a', overrides = {}) {
    return {
        id, operationKind: 'CONVERSION_ADDITION', status: 'DRAFT', revision: 3,
        batchDescription: `Batch ${id}`, sourceReference: 'Old rack', notes: 'Keep identity',
        observedAt: '2026-10-10T04:30:37.123Z', createdBy: manager.id, updatedBy: manager.id,
        createdAt: '2026-10-10T04:30:37.123Z', updatedAt: '2026-10-10T04:30:37.123Z',
        totalLines: 1, totalCountedPieces: 7, uncountedLines: 0,
        lines: [{
            id: `line-${id}`, draftId: id, variantId: 'prepared-variant', countedQuantity: 7,
            notes: 'Original line', sortOrder: 0, catalogueStatus: 'OK', statusMessage: '',
            snapshot: { productName: 'Shirt', barcode: '0012345', sku: 'SH-M',
                description: 'Shirt | M | Blue | Cotton', size: 'M', color: 'Blue', sellingPrice: 500 },
            currentLiveDetails: { productName: 'Shirt', barcode: '0012345', sku: 'SH-M',
                formattedDescription: 'Shirt | M | Blue | Cotton', sellingPrice: 500, isPrepared: true,
                stock: 0, size: 'M', color: 'Blue' },
        }],
        ...overrides,
    };
}

function summary(id) {
    return { ...detail(id), totalLines: 1, countedLines: 1,
        createdByName: 'Manager', updatedByName: 'Manager' };
}

function prepared(id, name) {
    return { id, productId: `p-${id}`, productName: name, barcode: `00-${id}`, sku: id,
        size: 'M', color: 'Blue', sellingPrice: 500, stock: 0, isPrepared: true,
        categoryName: 'Shirts', formattedDescription: `${name} | M | Blue` };
}

function textOf(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node !== 'object') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join(' ');
    return textOf(node.props?.children);
}

// A small React hook runner renders the actual TSX, commits effects/cleanups and rerenders
// state updates. External visual components stay as element nodes; their real props (including
// disabled, onClose and onConfirm) are inspected. IPC, timers and navigation are all fake.
function fixture(componentProps = {}) {
    let actor = manager;
    let tree, hookIndex = 0, dirty = true, mounted = true, now = 0, nextTimer = 1;
    const hooks = [], effects = [], timers = new Map(), calls = [], notices = [], navigations = [];
    const ui = Object.fromEntries(['Button', 'Input', 'Modal', 'ConfirmDialog'].map(name => [name, name]));
    const dependenciesEqual = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }),
        Fragment: 'Fragment',
        useState(initial) {
            const index = hookIndex++;
            if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
            const set = value => {
                if (!mounted) return;
                const next = typeof value === 'function' ? value(hooks[index].value) : value;
                if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; }
            };
            return [hooks[index].value, set];
        },
        useRef(initial) {
            const index = hookIndex++;
            if (!hooks[index]) hooks[index] = { value: { current: initial } };
            return hooks[index].value;
        },
        useMemo(factory, dependencies) {
            const index = hookIndex++;
            if (!hooks[index] || !dependenciesEqual(hooks[index].dependencies, dependencies)) {
                hooks[index] = { value: factory(), dependencies };
            }
            return hooks[index].value;
        },
        useCallback(callback, dependencies) { return react.useMemo(() => callback, dependencies); },
        useEffect(effect, dependencies) {
            const index = hookIndex++;
            if (!hooks[index] || !dependenciesEqual(hooks[index].dependencies, dependencies)) {
                const previous = hooks[index];
                hooks[index] = { dependencies, cleanup: previous?.cleanup };
                effects.push({ index, effect });
            }
        },
    };
    const ipc = {};
    for (const channel of ['list', 'get', 'searchVariants', 'create', 'save', 'cancel']) {
        ipc[channel] = args => {
            if (channel === 'list') {
                calls.push({ channel, args: copy(args) });
                return Promise.resolve({ success: true, data: {
                    items: [summary('draft-a'), summary('draft-b')], totalMatching: 2,
                    page: 1, pageSize: 20, totalPages: 1,
                    stats: { totalDrafts: 2, activeDraftCount: 2, cancelledDraftCount: 0 },
                } });
            }
            return new Promise((resolve, reject) => calls.push({ channel, args: copy(args), reference: args,
                ok: data => resolve({ success: true, data }),
                fail: (message, metadata = {}) => resolve({ success: false, error: message, ...metadata }), reject }));
        };
    }
    const window = { electronAPI: { stockDraft: ipc } };
    const service = { exports: {} };
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/services/stock-draft.service.ts'), 'utf8')),
        { exports: service.exports, module: service, window });
    const module = { exports: {} };
    const context = {
        exports: module.exports, module, console: { error() {}, log() {} }, crypto: webcrypto, Date,
        setTimeout: (callback, delay = 0) => { const id = nextTimer++; timers.set(id, { at: now + delay, callback }); return id; },
        clearTimeout: id => timers.delete(id),
        require: name => {
            if (name === 'react') return { __esModule: true, default: react, ...react };
            if (name === 'react-router-dom') return { useNavigate: () => route => navigations.push(route) };
            if (name === 'lucide-react') return new Proxy({}, { get: (_target, key) => `Icon:${String(key)}` });
            if (name.endsWith('/authStore')) return { useAuthStore: () => ({ user: actor }) };
            if (name.endsWith('/stock-draft.service')) return service.exports;
            if (name.endsWith('/stockDraftDateTime')) {
                const dateTime = { exports: {} };
                vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/lib/stockDraftDateTime.ts'), 'utf8')),
                    { exports: dateTime.exports, module: dateTime, Date });
                return dateTime.exports;
            }
            if (name.endsWith('/Toast')) return { showToast: (...args) => notices.push(args) };
            const component = Object.keys(ui).find(key => name.endsWith(`/${key}`));
            if (component) return { [component]: ui[component] };
            throw new Error(`Unexpected nonisolated component dependency: ${name}`);
        },
    };
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/components/stock/CountDraftsView.tsx'), 'utf8')), context);
    function flush() {
        for (let commits = 0; dirty && mounted; commits++) {
            assert.ok(commits < 50, 'Component did not settle after state/effect updates');
            dirty = false; hookIndex = 0;
            tree = module.exports.CountDraftsView({ canManageProducts: true, ...componentProps });
            for (const { index, effect } of effects.splice(0)) {
                hooks[index].cleanup?.();
                hooks[index].cleanup = effect();
            }
        }
    }
    async function settle() {
        for (let turn = 0; turn < 12; turn++) { await Promise.resolve(); flush(); }
    }
    function all(scope = tree, includeHidden = false) {
        const nodes = [];
        function visit(node) {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (!includeHidden && ['Modal', 'ConfirmDialog'].includes(node.type) && !node.props.isOpen) return;
            nodes.push(node);
            visit(node.props?.children);
        }
        visit(scope);
        return nodes;
    }
    const matches = (value, expected) => expected instanceof RegExp ? expected.test(value) : value === expected;
    function button(label, scope = tree, optional = false) {
        const node = all(scope).find(n => ['Button', 'button'].includes(n.type) && matches(textOf(n).replace(/\s+/g, ' ').trim(), label));
        if (!optional) assert.ok(node, `Missing button ${label}; visible: ${textOf(scope)}`);
        return node;
    }
    function input(selector, scope = modal()) {
        const node = all(scope).find(n => ['input', 'Input'].includes(n.type) && (
            selector === 'datetime-local' ? n.props.type === selector : matches(n.props.placeholder || '', selector)));
        assert.ok(node, `Missing input ${selector}`);
        return node;
    }
    function modal() { return all(tree, true).find(n => n.type === 'Modal'); }
    const start = callback => { const promise = callback(); flush(); return promise; };
    function change(node, value) {
        assert.ok(!node.props.disabled, `Cannot edit disabled input ${node.props.placeholder || node.props.type}`);
        return start(() => node.props.onChange({ target: { value } }));
    }
    function click(node) {
        assert.ok(!node.props.disabled, `Cannot click disabled ${textOf(node)}`);
        return start(() => node.props.onClick());
    }
    async function advance(milliseconds) {
        const target = now + milliseconds;
        for (;;) {
            const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at; timers.delete(next[0]); next[1].callback(); await settle();
        }
        now = target; await settle();
    }
    function open(id = 'draft-a') {
        const row = all().find(n => n.type === 'tr' && textOf(n).includes(`Batch ${id}`));
        assert.ok(row, `Missing list row ${id}`);
        return click(button(/^(Edit|View)$/, row));
    }
    async function load(id = 'draft-a', data = detail(id)) {
        const pending = open(id); latest('get').ok(data); await pending; await settle();
    }
    const latest = channel => calls.filter(call => call.channel === channel).at(-1);
    const count = channel => calls.filter(call => call.channel === channel).length;
    const close = () => start(() => modal().props.onClose());
    function unmount() {
        mounted = false;
        for (const hook of hooks) hook?.cleanup?.();
    }
    flush();
    return { calls, notices, navigations, settle, start, all, button, input, modal, change, click, advance,
        open, load, latest, count, close, unmount, text: scope => textOf(scope || tree),
        newDraft: () => click(button('Add counted items')),
        setActor: user => { actor = user; dirty = true; flush(); },
        batch: () => input(/Rack A/), picker: () => input(/Search items/),
    };
}

test('failed detail loading never enables rendered save/cancel or issues a write; retry loads intended draft', async () => {
    const h = fixture(); await h.settle();
    await h.load();
    const oldSave = h.button('Save counts', h.modal()).props.onClick;
    h.close();
    const pending = h.open('draft-b');
    h.latest('get').fail('Database busy'); await pending; await h.settle();
    assert.match(h.text(h.modal()), /Database busy/);
    for (const label of ['Save counts', 'Cancel these items']) {
        const control = h.button(label, h.modal(), true);
        assert.ok(!control || control.props.disabled, `${label} must not be enabled after a failed read`);
    }
    await h.start(oldSave); await h.settle();
    assert.equal(h.count('save') + h.count('create') + h.count('cancel'), 0);
    const retry = h.click(h.button(/Reload Latest|Retry.*load|Retry/, h.modal()));
    h.latest('get').ok(detail('draft-b')); await retry; await h.settle();
    assert.equal(h.batch().props.value, 'Batch draft-b');
    assert.equal(Boolean(h.button('Save counts', h.modal()).props.disabled), false);
    h.unmount();
});

test('a late read success or failure after close/new cannot overwrite the new editor', async () => {
    for (const fail of [false, true]) {
        const h = fixture(); await h.settle();
        const pending = h.open(); const read = h.latest('get');
        h.close(); h.newDraft(); h.change(h.batch(), 'New physical batch');
        if (fail) read.fail('Old read failed'); else read.ok(detail());
        await pending; await h.settle();
        assert.equal(h.batch().props.value, 'New physical batch');
        assert.match(h.modal().props.title, /New/);
        assert.equal(h.text(h.modal()).includes('Old read failed'), false);
        h.unmount();
    }
});

test('an unresolved create blocks close/new; a fresh editor after reconciliation uses a new create operation', async () => {
    const h = fixture(); await h.settle();
    h.newDraft(); h.change(h.batch(), 'First batch');
    const newCallback = h.button('Add counted items').props.onClick;
    const saveCallback = h.button('Save counts', h.modal()).props.onClick;
    const first = h.start(saveCallback); const write = h.latest('create');
    await h.start(saveCallback); assert.equal(h.count('create'), 1);
    h.close(); h.start(newCallback);
    assert.equal(h.modal().props.isOpen, true);
    assert.equal(h.batch().props.value, 'First batch');
    assert.ok(write.args.draftId, 'Create captures its durable draft ID before sending');
    write.ok({ draftId: write.args.draftId, revision: 1, status: 'DRAFT', message: 'Old create committed' });
    await h.settle();
    assert.equal(h.latest('get').args.draftId, write.args.draftId);
    h.latest('get').ok(detail(write.args.draftId, { revision: 1, batchDescription: 'First batch' }));
    await first; await h.settle();
    h.close(); h.newDraft(); h.change(h.batch(), 'Second batch');
    assert.match(h.modal().props.title, /New/);
    assert.equal(h.batch().props.value, 'Second batch');
    const second = h.click(h.button('Save counts', h.modal()));
    assert.equal(h.count('create'), 2); assert.equal(h.count('save'), 0);
    assert.notEqual(h.latest('create').args.operationId, write.args.operationId);
    h.latest('create').reject(new Error('Response lost')); await second; await h.settle(); h.unmount();
});

test('late create completion after session replacement cannot retarget a new user editor', async () => {
    const h = fixture(); await h.settle(); h.newDraft(); h.change(h.batch(), 'Old session batch');
    const first = h.click(h.button('Save counts', h.modal())); const old = h.latest('create');
    h.setActor({ ...manager, id: 'next-operator' }); await h.settle();
    h.newDraft(); h.change(h.batch(), 'New operator batch');
    old.ok({ draftId: old.args.draftId, revision: 1, status: 'DRAFT' }); await first; await h.settle();
    assert.equal(h.batch().props.value, 'New operator batch');
    assert.match(h.modal().props.title, /New/);
    const second = h.click(h.button('Save counts', h.modal()));
    assert.equal(h.count('save'), 0); assert.equal(h.count('create'), 2);
    assert.notEqual(h.latest('create').args.operationId, old.args.operationId);
    h.latest('create').fail('Stopped after observing new identity'); await second; await h.settle(); h.unmount();
});

test('prepared searches ignore old responses before the next debounce and across editor/session changes', async () => {
    const h = fixture(); await h.settle(); h.newDraft();
    h.change(h.picker(), 'Old shirt'); await h.advance(250); const old = h.latest('searchVariants');
    h.change(h.picker(), 'New shirt');
    old.ok([prepared('old', 'Obsolete Search Hit')]); await h.settle();
    assert.equal(h.text(h.modal()).includes('Obsolete Search Hit'), false);
    await h.advance(250); const fresh = h.latest('searchVariants');
    fresh.ok([prepared('new', 'Current Search Hit')]); await h.settle();
    assert.ok(h.text(h.modal()).includes('Current Search Hit'));
    h.change(h.picker(), 'Close pending'); await h.advance(250); const closing = h.latest('searchVariants');
    h.close(); h.newDraft();
    closing.fail('Old picker error'); await h.settle();
    assert.equal(h.text(h.modal()).includes('Old picker error'), false);
    h.change(h.picker(), 'Session pending'); await h.advance(250); const sessionRead = h.latest('searchVariants');
    h.setActor({ ...manager, id: 'different-operator' });
    sessionRead.ok([prepared('secret', 'Previous Session Result')]); await h.settle();
    assert.equal(h.text().includes('Previous Session Result'), false);
    assert.equal(h.modal().props.isOpen, false);
    h.unmount();
});

test('lost save freezes edits and retries the exact payload and operation ID with one in-flight request', async () => {
    const h = fixture(); await h.settle(); await h.load();
    h.change(h.batch(), 'Edited physical batch');
    const save = h.button('Save counts', h.modal()).props.onClick;
    const first = h.start(save);
    await h.start(save); assert.equal(h.count('save'), 1);
    const original = h.latest('save');
    original.reject(new Error('Save response lost')); await first; await h.settle();
    assert.equal(h.batch().props.disabled, true);
    const retryButton = h.button(/Retry pending/i, h.modal());
    const second = h.click(retryButton);
    const retry = h.latest('save');
    assert.deepEqual(retry.args, original.args);
    await h.start(retryButton.props.onClick); assert.equal(h.count('save'), 2);
    retry.ok({ draftId: 'draft-a', revision: 4, status: 'DRAFT' }); await h.settle();
    const latest = h.latest('get');
    assert.equal(latest.args.draftId, 'draft-a');
    latest.ok(detail('draft-a', { revision: 4, batchDescription: 'Edited physical batch' }));
    await second; await h.settle();
    assert.equal(Boolean(h.batch().props.disabled), false);
    h.change(h.batch(), 'A distinct edit');
    const third = h.click(h.button('Save counts', h.modal()));
    assert.notEqual(h.latest('save').args.operationId, original.args.operationId);
    assert.equal(h.latest('save').args.expectedRevision, 4);
    assert.equal(h.latest('save').args.batchDescription, 'A distinct edit');
    h.latest('save').fail('Stopped after observing payload'); await third; await h.settle(); h.unmount();
});

test('replaying an old save reconciles the latest cancelled draft before allowing further edits', async () => {
    const h = fixture(); await h.settle(); await h.load();
    const first = h.click(h.button('Save counts', h.modal()));
    h.latest('save').reject(new Error('Lost committed response')); await first; await h.settle();
    const retry = h.click(h.button(/Retry pending/i, h.modal()));
    h.latest('save').ok({ draftId: 'draft-a', revision: 4, status: 'DRAFT' }); await h.settle();
    h.latest('get').ok(detail('draft-a', { revision: 6, status: 'CANCELLED' }));
    await retry; await h.settle();
    assert.equal(h.modal().props.title, 'Cancelled stock items (read only)');
    assert.equal(h.button('Save counts', h.modal(), true), undefined);
    assert.equal(h.batch().props.disabled, true);
    assert.equal(h.count('save'), 2); h.unmount();
});

test('a committed write with a failed latest read stays frozen until an explicit latest-record review', async () => {
    const h = fixture(); await h.settle(); await h.load();
    const write = h.click(h.button('Save counts', h.modal()));
    h.latest('save').ok({ draftId: 'draft-a', revision: 4, status: 'DRAFT' }); await h.settle();
    h.latest('get').fail('Latest revision temporarily unavailable'); await write; await h.settle();
    assert.equal(h.batch().props.disabled, true);
    const ordinarySave = h.button('Save counts', h.modal(), true);
    assert.ok(!ordinarySave || ordinarySave.props.disabled);
    const review = h.click(h.button(/Check latest saved items/i, h.modal()));
    h.latest('get').ok(detail('draft-a', { revision: 7, status: 'CANCELLED' }));
    await review; await h.settle();
    assert.equal(h.modal().props.title, 'Cancelled stock items (read only)');
    assert.equal(h.count('save'), 1); h.unmount();
});

test('lost cancellation retries its captured ID/payload and serializes confirm clicks', async () => {
    const h = fixture(); await h.settle(); await h.load();
    h.click(h.button('Cancel these items', h.modal()));
    const dialog = h.all().find(node => node.type === 'ConfirmDialog');
    assert.equal(dialog.props.isOpen, true);
    const first = h.start(dialog.props.onConfirm); const original = h.latest('cancel');
    await h.start(dialog.props.onConfirm); assert.equal(h.count('cancel'), 1);
    original.reject(new Error('Cancel response lost')); await first; await h.settle();
    const second = h.click(h.button(/Retry pending/i, h.modal()));
    assert.deepEqual(h.latest('cancel').args, original.args);
    h.latest('cancel').ok({ draftId: 'draft-a', revision: 4, status: 'CANCELLED' }); await h.settle();
    h.latest('get').ok(detail('draft-a', { revision: 4, status: 'CANCELLED' }));
    await second; await h.settle();
    assert.equal(h.modal().props.title, 'Cancelled stock items (read only)');
    assert.equal(h.count('save'), 0); h.unmount();
});

test('a definitive initial create rejection permits correcting the preserved form with a fresh operation ID', async () => {
    for (const message of ['Variant 0012345 is inactive.', 'Duplicate variant line in draft.']) {
        const h = fixture(); await h.settle(); h.newDraft();
        h.change(h.batch(), 'Keep this physical batch');
        h.change(h.picker(), 'Shirt'); await h.advance(250);
        h.latest('searchVariants').ok([prepared('stale-variant', 'Stale Shirt')]); await h.settle();
        const hit = h.all(h.modal()).find(node => node.type === 'button' && node.props.onClick
            && h.text(node).replace(/\s+/g, '').includes('[00-stale-variant]'));
        assert.ok(hit); h.click(hit);
        h.change(h.input('Blank'), '7');
        const first = h.click(h.button('Save counts', h.modal())); const rejected = h.latest('create');
        rejected.fail(message); await first; await h.settle();
        assert.equal(h.batch().props.disabled, true);
        assert.equal(h.batch().props.value, 'Keep this physical batch');
        assert.equal(h.input('Blank').props.value, '7');
        h.click(h.button('Edit rejected request', h.modal()));
        assert.equal(Boolean(h.batch().props.disabled), false);
        assert.equal(h.batch().props.value, 'Keep this physical batch');
        assert.equal(h.input('Blank').props.value, '7');
        h.change(h.batch(), 'Corrected physical batch');
        const second = h.click(h.button('Save counts', h.modal())); const corrected = h.latest('create');
        assert.notEqual(corrected.args.operationId, rejected.args.operationId);
        assert.equal(corrected.args.draftId, rejected.args.draftId);
        assert.equal(corrected.args.batchDescription, 'Corrected physical batch');
        assert.deepEqual(corrected.args.lines, rejected.args.lines);
        corrected.reject(new Error('Stopped after observing corrected operation')); await second; await h.settle(); h.unmount();
    }
});

test('an uncertain create stays frozen after a later structured rejection and never offers edit-rejected recovery', async () => {
    for (const firstFailure of ['transport', 'uncertain-envelope']) {
        const h = fixture(); await h.settle(); h.newDraft(); h.change(h.batch(), 'Potentially committed batch');
        const first = h.click(h.button('Save counts', h.modal())); const original = h.latest('create');
        if (firstFailure === 'transport') original.reject(new Error('Response lost after possible commit'));
        else original.fail('HTTP result could not be confirmed', { outcomeUncertain: true });
        await first; await h.settle();
        assert.equal(h.button('Edit rejected request', h.modal(), true), undefined);
        assert.equal(h.batch().props.disabled, true);
        const retry = h.click(h.button('Retry pending save', h.modal()));
        assert.deepEqual(h.latest('create').args, original.args);
        h.latest('create').fail('Variant 0012345 is inactive.'); await retry; await h.settle();
        assert.equal(h.button('Edit rejected request', h.modal(), true), undefined,
            'A later explicit rejection cannot disprove an earlier possible commit');
        assert.equal(h.batch().props.disabled, true);
        assert.equal(h.count('create'), 2); h.unmount();
    }
});

test('observation times display in Asia/Kolkata and unchanged timestamps retain seconds exactly', async () => {
    const h = fixture(); await h.settle(); await h.load();
    assert.equal(new Date('2026-10-10T04:30:37.123Z').getTimezoneOffset(), -330);
    assert.equal(h.input('datetime-local').props.value, '2026-10-10T10:00');
    const save = h.click(h.button('Save counts', h.modal()));
    assert.equal(h.latest('save').args.observedAt, '2026-10-10T04:30:37.123Z');
    h.latest('save').ok({ draftId: 'draft-a', revision: 4, status: 'DRAFT' }); await h.settle();
    h.latest('get').ok(detail('draft-a', { revision: 4 })); await save; await h.settle();
    h.change(h.input('datetime-local'), '2026-10-10T11:15');
    const changed = h.click(h.button('Save counts', h.modal()));
    assert.equal(h.latest('save').args.observedAt, '2026-10-10T05:45:00.000Z');
    h.latest('save').fail('Stopped after timestamp assertion'); await changed; await h.settle(); h.unmount();
});

test('actual picker retains distinct same-name/price identities and blank versus zero without posting controls', async () => {
    const h = fixture(); await h.settle(); h.newDraft(); h.change(h.batch(), 'One physical batch');
    for (const id of ['variant-a', 'variant-b']) {
        h.change(h.picker(), 'Shirt'); await h.advance(250);
        h.latest('searchVariants').ok([prepared('variant-a', 'Same Shirt'), prepared('variant-b', 'Same Shirt')]);
        await h.settle();
        const hit = h.all(h.modal()).find(node => node.type === 'button' && node.props.onClick
            && h.text(node).replace(/\s+/g, '').includes(`[00-${id}]`));
        assert.ok(hit, `Missing distinguishable picker result ${id}`); h.click(hit);
    }
    const quantities = h.all(h.modal()).filter(node => node.type === 'input' && node.props.placeholder === 'Blank');
    assert.equal(quantities.length, 2);
    h.change(quantities[0], '0');
    assert.match(h.text(h.modal()), /Not ready for billing.*Saving counts alone does not change stock/i);
    const controls = h.all().filter(node => ['Button', 'button'].includes(node.type)).map(node => h.text(node).trim());
    assert.equal(controls.some(label => /^(Apply|Activate|Finalize|Import|Retire)\b/i.test(label)), false);
    const write = h.click(h.button('Save counts', h.modal()));
    assert.deepEqual(h.latest('create').args.lines.map(line => [line.variantId, line.countedQuantity]),
        [['variant-a', 0], ['variant-b', null]]);
    assert.notEqual(h.latest('create').args.lines[0].id, h.latest('create').args.lines[1].id);
    h.latest('create').fail('Stopped after draft-only payload assertion'); await write; await h.settle(); h.unmount();
});

test('posted batches hydrate as terminal read-only records and reject callbacks captured from an earlier draft editor', async () => {
    const h = fixture(); await h.settle(); await h.load();
    const oldSave = h.button('Save counts', h.modal()).props.onClick;
    h.close(); await h.load('draft-a', detail('draft-a', { status: 'POSTED', revision: 4 }));
    assert.match(h.modal().props.title, /ready for billing.*read only/);
    assert.match(h.text(h.modal()), /already been added to stock/);
    assert.equal(h.button('Save counts', h.modal(), true), undefined);
    assert.equal(h.button('Cancel these items', h.modal(), true), undefined);
    assert.equal(h.batch().props.disabled, true);
    await h.start(oldSave); await h.settle();
    assert.equal(h.count('save') + h.count('create') + h.count('cancel'), 0);
    h.unmount();
});

test('saved stock items use shop language while preserving their underlying status filters', async () => {
    const h = fixture(); await h.settle();
    assert.match(h.text(), /Saved stock items/);
    assert.match(h.text(), /Not ready for billing/);
    assert.doesNotMatch(h.text(), /Saved count batches|New Count Draft|Active Drafts|Activated \/ Posted|Status & Rev|\br3\b/);
    const options = h.all().filter(node => node.type === 'option');
    assert.match(h.text(options.find(node => node.props.value === 'DRAFT')), /Not ready for billing \(\s*2\s*\)/);
    assert.equal(h.text(options.find(node => node.props.value === 'POSTED')).trim(), 'Ready for billing');
    h.newDraft();
    assert.equal(h.modal().props.title, 'New counted items');
    assert.match(h.text(h.modal()), /Not ready for billing/);
    assert.doesNotMatch(h.text(h.modal()), /Draft|Snapshot|Terminal|Revision/);
    h.unmount();
});

test('a newly prepared batch opens its fresh saved counts and the separate activation action carries the batch ID', async () => {
    const reviews = [];
    const h = fixture({ initialDraftId: 'draft-b', onReviewBatch: id => reviews.push(id) }); await h.settle();
    assert.equal(h.latest('get').args.draftId, 'draft-b');
    h.latest('get').ok(detail('draft-b')); await h.settle();
    assert.equal(h.batch().props.value, 'Batch draft-b');
    h.close(); h.click(h.button('Check labels & stock')); await h.settle();
    assert.deepEqual(reviews, ['draft-a']);
    assert.equal(h.count('save') + h.count('create') + h.count('cancel'), 0);
    h.unmount();
});

test('the saved-count editor can continue directly to labels without closing it to find a hidden list action', async () => {
    const reviews = [];
    const h = fixture({ onReviewBatch: id => reviews.push(id) }); await h.settle(); await h.load();
    h.click(h.button('Continue to inventory', h.modal())); await h.settle();
    assert.deepEqual(reviews, ['draft-a']);
    assert.equal(h.modal().props.isOpen, false);
    assert.equal(h.count('save'), 0); h.unmount();
});

test('continuing to labels saves changed quantities and confirms the saved revision before opening review', async () => {
    const reviews = [];
    const h = fixture({ onReviewBatch: id => reviews.push(id) }); await h.settle(); await h.load();
    h.change(h.input('Blank'), '9');
    const pending = h.click(h.button('Save & continue', h.modal()));
    assert.equal(h.latest('save').args.lines[0].countedQuantity, 9);
    assert.deepEqual(reviews, []);
    h.latest('save').ok({ draftId: 'draft-a', revision: 4, status: 'DRAFT' }); await h.settle();
    assert.deepEqual(reviews, []);
    const updated = detail('draft-a', { revision: 4 }); updated.lines[0].countedQuantity = 9;
    h.latest('get').ok(updated); await pending; await h.settle();
    assert.deepEqual(reviews, ['draft-a']);
    assert.equal(h.modal().props.isOpen, false); h.unmount();
});

test('closing changed counts requires an in-app discard confirmation and Keep editing preserves them', async () => {
    const blocked = [];
    const h = fixture({ onNavigationBlockedChange: value => blocked.push(value) }); await h.settle(); await h.load();
    assert.equal(blocked.at(-1), true);
    h.change(h.input('Blank'), '12'); h.close();
    assert.equal(h.modal().props.isOpen, true);
    let dialog = h.all().find(node => node.type === 'ConfirmDialog' && node.props.isOpen);
    assert.ok(dialog, 'Discard confirmation should be visible');
    assert.match(dialog.props.title, /Unsaved/);
    h.start(dialog.props.onClose); assert.equal(h.input('Blank').props.value, '12');
    h.close(); dialog = h.all().find(node => node.type === 'ConfirmDialog' && node.props.isOpen);
    h.start(dialog.props.onConfirm);
    assert.equal(h.modal().props.isOpen, false);
    assert.equal(blocked.at(-1), false); h.unmount();
});

test('cancelled setup can start fresh counts using the same saved variant and barcode', async () => {
    const h = fixture(); await h.settle(); await h.load('draft-a', detail('draft-a', { status: 'CANCELLED' }));
    h.click(h.button('Create new stock entry', h.modal())); await h.settle();
    assert.equal(h.modal().props.title, 'New counted items');
    assert.match(h.text(h.modal()), /0012345/);
    assert.equal(h.all().find(node => node.type === 'input' && node.props.placeholder === 'Blank').props.value, '');
    assert.equal(h.count('create') + h.count('save'), 0);
    h.unmount();
});
