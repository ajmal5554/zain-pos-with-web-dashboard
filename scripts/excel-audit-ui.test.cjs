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
const owner = { id: 'owner', role: 'ADMIN', isActive: true, permManageInventory: true };
const status = (overrides = {}) => ({ imported: false, fileName: null, sheetName: null,
    importedAt: null, fileHash: null, rowCount: 0, countedRows: 0, uncountedRows: 0,
    totalQuantity: 0, ...overrides });
const savedStatus = (overrides = {}) => status({ imported: true, fileName: 'saved-audit.xlsx',
    sheetName: 'Stock Audit', importedAt: '2026-10-14T08:15:00.000Z', fileHash: 'saved-hash',
    rowCount: 2, countedRows: 1, uncountedRows: 1, totalQuantity: 3, ...overrides });
const row = (id, overrides = {}) => ({ id, sourceRow: 3, name: `Shirt ${id}`, barcode: `000${id}`,
    size: 'XL', category: 'Shirts', brand: 'Crazy Heart', mrp: 700, countedQuantity: 3,
    attributes: { fabric: 'Cotton', design: 'Checks' }, lastUpdated: '8 Oct, 7:30 pm', ...overrides });
const listing = (items = [row('700')], overrides = {}) => ({ items, totalMatching: items.length,
    page: 1, pageSize: 50, totalPages: 1, status: savedStatus(), ...overrides });
const preview = (overrides = {}) => ({ token: 'preview-token',
    status: status({ fileName: 'new-audit.xlsx', sheetName: 'Stock Audit', fileHash: 'new-hash',
        rowCount: 2, countedRows: 1, uncountedRows: 1, totalQuantity: 0 }),
    items: [row('zero', { countedQuantity: 0 }), row('blank', { countedQuantity: null })],
    warnings: [], alreadyImported: false, replacesExisting: true, ...overrides });
const workbook = (name = 'new-audit.xlsx', options = {}) => ({ name, size: 8,
    arrayBuffer: () => Promise.resolve(Uint8Array.from([80, 75, 3, 4, 1, 2, 3, 4]).buffer), ...options });

function textOf(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node !== 'object') return String(node);
    return Array.isArray(node) ? node.map(textOf).join(' ') : textOf(node.props?.children);
}

// Execute the actual component and renderer service with fake IPC. Native files,
// timers and visual primitives are isolated; no database or saved audit is touched.
function fixture({ desktop = true, user = owner, prepare = false, openSaved = false } = {}) {
    let actor = user, tree, hookIndex = 0, dirty = true, mounted = true, currentKey;
    let hooks = [], effects = [], now = 0, nextTimer = 1;
    const timers = new Map(), calls = [], notices = [], preparations = [], savedItems = [];
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
    const ipc = Object.fromEntries(['status', 'list', 'preview', 'commit'].map(channel => [channel, args =>
        new Promise((resolve, reject) => calls.push({ channel, args,
            ok: data => resolve({ success: true, data }), fail: error => resolve({ success: false, error }), reject }))]));
    const window = { electronAPI: desktop ? { excelAudit: ipc } : {} };
    const service = { exports: {} };
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/services/excel-audit.service.ts'), 'utf8')),
        { exports: service.exports, module: service, window, Error });
    const module = { exports: {} };
    const context = { exports: module.exports, module, window, Date, Error, Uint8Array,
        setTimeout: (callback, delay = 0) => { const id = nextTimer++; timers.set(id, { callback, at: now + delay }); return id; },
        clearTimeout: id => timers.delete(id),
        require: name => {
            if (name === 'react') return { __esModule: true, default: react, ...react };
            if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => `Icon:${String(key)}` });
            if (name.endsWith('/authStore')) return { useAuthStore };
            if (name.endsWith('/excel-audit.service')) return service.exports;
            if (name.endsWith('/Toast')) return { showToast: (...args) => notices.push(args) };
            const component = ['Button', 'Input', 'Modal', 'ConfirmDialog'].find(key => name.endsWith(`/${key}`));
            if (component) return { [component]: component };
            throw new Error(`Unexpected dependency: ${name}`);
        },
    };
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/components/stock/ExcelAuditView.tsx'), 'utf8')), context);
    function cleanupInner() { for (const hook of hooks) hook?.cleanup?.(); hooks = []; effects = []; }
    function expand(node) {
        if (!node || typeof node !== 'object') return node;
        if (Array.isArray(node)) return node.map(expand);
        if (typeof node.type === 'function') return expand(node.type(node.props));
        return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
    }
    function flush() {
        for (let commits = 0; dirty && mounted; commits++) {
            assert.ok(commits < 50, 'UI failed to settle');
            dirty = false; hookIndex = 0;
            let next = module.exports.ExcelAuditView({ onPrepareSelection: prepare ? selection => preparations.push(selection) : undefined,
                onOpenSavedItems: openSaved ? (...args) => savedItems.push(args) : undefined });
            if (typeof next?.type === 'function') {
                const key = next.props?.key;
                if (key !== currentKey) { cleanupInner(); currentKey = key; hookIndex = 0; }
                next = next.type(next.props);
            } else if (hooks.length) { cleanupInner(); currentKey = undefined; }
            tree = expand(next);
            for (const { index, effect } of effects.splice(0)) {
                hooks[index].cleanup?.(); hooks[index].cleanup = effect();
            }
        }
    }
    async function settle() { for (let i = 0; i < 14; i++) { await Promise.resolve(); flush(); } }
    function all(scope = tree, includeHidden = false) {
        const result = [];
        const visit = node => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (!includeHidden && ['Modal', 'ConfirmDialog'].includes(node.type) && !node.props.isOpen) return;
            result.push(node); visit(node.props?.children);
        };
        visit(scope); return result;
    }
    const match = (actual, expected) => expected instanceof RegExp ? expected.test(actual) : actual === expected;
    function control(predicate, label, scope = tree) {
        const node = all(scope).find(predicate); assert.ok(node, `Missing ${label}. Visible: ${textOf(scope)}`); return node;
    }
    const button = (label, scope = tree) => control(n => ['Button', 'button'].includes(n.type) && match(textOf(n).replace(/\s+/g, ' ').trim(), label), `button ${label}`, scope);
    const input = label => control(n => ['input', 'Input'].includes(n.type) && match(n.props['aria-label'] || n.props.type || '', label), `input ${label}`);
    const start = callback => { const result = callback(); flush(); return result; };
    const click = node => { assert.ok(!node.props.disabled, 'Cannot click disabled control'); return start(() => node.props.onClick()); };
    const change = (node, value) => { assert.ok(!node.props.disabled, 'Cannot change disabled control'); return start(() => node.props.onChange({ target: { value, checked: value } })); };
    async function advance(milliseconds) {
        const target = now + milliseconds;
        for (;;) {
            const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at; timers.delete(next[0]); next[1].callback(); await settle();
        }
        now = target; await settle();
    }
    const latest = channel => calls.filter(call => call.channel === channel).at(-1);
    const count = channel => calls.filter(call => call.channel === channel).length;
    flush();
    const h = { calls, notices, preparations, savedItems, settle, start, all, button, input, click, change, advance, latest, count,
        text: (scope = tree) => textOf(scope), modal: () => all().find(node => node.type === 'Modal'),
        dialog: () => all().find(node => node.type === 'ConfirmDialog'),
        setActor: next => { actor = next; dirty = true; flush(); },
        unmount: () => { cleanupInner(); mounted = false; },
        load: async data => { latest('list').ok(data || listing()); await settle(); },
        choose: file => start(() => input('Stock audit workbook').props.onChange({ target: { files: file ? [file] : [] } })),
    };
    h.review = async (file = workbook(), data = preview()) => {
        h.choose(file); h.click(h.button('Review Excel file')); await h.settle();
        h.latest('preview').ok(data); await h.settle();
    };
    return h;
}

test('Excel preview sends workbook bytes, shows source metadata, null vs zero counts, and requires explicit confirmation', async () => {
    const h = fixture(); await h.load();
    await h.review(workbook(), preview({ status: preview().status && { ...preview().status, rowCount: 25 } }));
    assert.equal(h.latest('preview').args.fileName, 'new-audit.xlsx');
    assert.deepEqual(Array.from(h.latest('preview').args.bytes), [80, 75, 3, 4, 1, 2, 3, 4]);
    assert.equal(h.count('commit'), 0);
    assert.match(h.text(h.modal()), /first 2 of 25 rows/);
    assert.match(h.text(h.modal()), /Price \/ MRP/);
    assert.match(h.text(h.modal()), /Not counted/);
    assert.match(h.text(h.modal()), /8 Oct, 7:30 pm/);
    const countCells = h.all(h.modal()).filter(node => node.type === 'td' && node.props.className.includes('font-semibold')).map(h.text);
    assert.deepEqual(countCells, ['0', 'Not counted']);
    h.click(h.button('Replace saved audit', h.modal()));
    assert.equal(h.count('commit'), 0);
    assert.match(h.dialog().props.message, /whole previous uploaded audit will be replaced/);
    assert.match(h.dialog().props.message, /count drafts will not change/);
    h.unmount();
});

test('canceling preview or confirmation never commits, including captured callbacks from the closed preview', async () => {
    const h = fixture(); await h.load(); await h.review();
    const oldAsk = h.button('Replace saved audit', h.modal()).props.onClick;
    h.click(h.button('Replace saved audit', h.modal()));
    const oldCommit = h.dialog().props.onConfirm;
    h.start(h.dialog().props.onClose);
    await h.start(oldCommit); await h.settle();
    assert.equal(h.count('commit'), 0);
    h.click(h.button('Cancel preview', h.modal()));
    await h.start(oldAsk); await h.start(oldCommit); await h.settle();
    assert.equal(h.count('commit'), 0);
    assert.equal(h.modal(), undefined);
    assert.match(h.text(), /Shirt 700/);
    h.unmount();
});

test('the exact already imported workbook cannot be committed again', async () => {
    const h = fixture(); await h.load(); await h.review(workbook(), preview({ alreadyImported: true }));
    assert.match(h.text(h.modal()), /exact workbook is already uploaded/);
    const importButton = h.button('Replace saved audit', h.modal());
    assert.equal(importButton.props.disabled, true);
    await h.start(importButton.props.onClick); await h.settle();
    assert.equal(h.count('commit'), 0);
    assert.equal(h.dialog(), undefined);
    h.unmount();
});

test('invalid extensions, empty files and files above 10 MB are rejected before reading or IPC', async () => {
    const h = fixture(); await h.load();
    for (const file of [workbook('audit.csv'), workbook('audit.xlsx', { size: 0 }), workbook('audit.xls', { size: 10 * 1024 * 1024 + 1 })]) {
        let reads = 0;
        file.arrayBuffer = () => { reads++; return Promise.resolve(new ArrayBuffer(8)); };
        h.choose(file);
        assert.equal(h.button('Review Excel file').props.disabled, true);
        await h.start(h.button('Review Excel file').props.onClick); await h.settle();
        assert.equal(reads, 0);
    }
    assert.equal(h.count('preview'), 0);
    assert.equal(h.count('commit'), 0);
    assert.match(h.text(), /Shirt 700/);
    h.unmount();
});

test('failed workbook preview retains the saved audit and supports reviewing the same file again', async () => {
    const h = fixture(); await h.load();
    h.choose(workbook()); h.click(h.button('Review Excel file')); await h.settle();
    h.latest('preview').fail('Count column is missing'); await h.settle();
    assert.match(h.text(), /Count column is missing/);
    assert.match(h.text(), /Shirt 700/);
    assert.equal(h.button('Review Excel file').props.disabled, false);
    h.click(h.button('Review Excel file')); await h.settle();
    h.latest('preview').ok(preview()); await h.settle();
    assert.ok(h.modal());
    assert.equal(h.count('preview'), 2);
    assert.equal(h.count('commit'), 0);
    h.unmount();
});

test('old file reads and old preview responses cannot replace a newer selected workbook', async () => {
    for (const phase of ['read', 'preview']) {
        const h = fixture(); await h.load();
        let releaseRead;
        const first = workbook('old.xlsx', phase === 'read' ? { arrayBuffer: () => new Promise(resolve => { releaseRead = resolve; }) } : {});
        h.choose(first); h.click(h.button('Review Excel file')); await h.settle();
        const oldPreview = h.latest('preview');
        h.choose(workbook('new.xlsx')); h.click(h.button('Review Excel file')); await h.settle();
        h.latest('preview').ok(preview({ token: 'new-token', status: { ...preview().status, fileName: 'new.xlsx' } })); await h.settle();
        if (phase === 'read') releaseRead(new ArrayBuffer(8));
        else oldPreview.ok(preview({ token: 'old-token', status: { ...preview().status, fileName: 'old.xlsx' } }));
        await h.settle();
        assert.match(h.text(h.modal()), /new.xlsx/);
        assert.equal(h.text(h.modal()).includes('old.xlsx'), false);
        if (phase === 'read') assert.equal(h.count('preview'), 1);
        h.unmount();
    }
});

test('failed commit retains the saved rows, retries the same preview token, and blocks double submission', async () => {
    const h = fixture(); await h.load(); await h.review();
    h.click(h.button('Replace saved audit', h.modal()));
    const first = h.start(h.dialog().props.onConfirm);
    await h.start(h.dialog().props.onConfirm);
    assert.equal(h.count('commit'), 1);
    h.latest('commit').fail('Disk is busy'); await first; await h.settle();
    assert.match(h.text(), /Shirt 700/);
    assert.match(h.dialog().props.message, /Disk is busy/);
    assert.equal(h.dialog().props.confirmText, 'Retry import');
    assert.equal(h.notices.length, 0);
    const retry = h.start(h.dialog().props.onConfirm);
    assert.equal(h.latest('commit').args.token, 'preview-token');
    h.latest('commit').ok(savedStatus({ fileName: 'new-audit.xlsx', fileHash: 'new-hash' }));
    await retry; await h.settle();
    assert.equal(h.modal(), undefined);
    assert.equal(h.button('Review Excel file').props.disabled, true);
    h.latest('list').ok(listing([row('new', { name: 'New audit shirt' })], { status: savedStatus({ fileName: 'new-audit.xlsx' }) })); await h.settle();
    assert.match(h.text(), /New audit shirt/);
    assert.equal(h.text().includes('Shirt 700'), false);
    assert.match(h.notices.at(-1)[0], /Shop stock has not been changed/);
    h.unmount();
});

test('successful import invalidates a pending old list and resets to page one without the old search', async () => {
    const h = fixture(); await h.load();
    h.change(h.input('Search Excel audit'), 'Old'); await h.advance(300);
    const oldList = h.latest('list');
    await h.review(); h.click(h.button('Replace saved audit', h.modal()));
    const commit = h.start(h.dialog().props.onConfirm);
    h.latest('commit').ok(savedStatus({ fileHash: 'new-hash' })); await commit; await h.settle();
    const fresh = h.latest('list');
    assert.equal(fresh.args.page, 1);
    assert.equal(fresh.args.search, '');
    fresh.ok(listing([row('fresh', { name: 'Fresh imported shirt' })])); await h.settle();
    oldList.ok(listing([row('stale', { name: 'Old stale list' })])); await h.settle();
    assert.match(h.text(), /Fresh imported shirt/);
    assert.equal(h.text().includes('Old stale list'), false);
    h.unmount();
});

test('list failures preserve stale rows, retry succeeds, and no background timer refreshes the audit', async () => {
    const h = fixture(); await h.load();
    await h.advance(60000);
    assert.equal(h.count('list'), 1);
    h.click(h.button('Reload saved audit'));
    h.latest('list').fail('Saved file unavailable'); await h.settle();
    assert.match(h.text(), /Shirt 700/);
    assert.match(h.text(), /last loaded results/);
    h.click(h.button('Retry loading audit'));
    h.latest('list').ok(listing([row('recovered', { name: 'Recovered audit' })])); await h.settle();
    assert.match(h.text(), /Recovered audit/);
    assert.equal(h.text().includes('Saved file unavailable'), false);
    h.unmount();
});

test('search and pagination discard superseded results and keep the requested page on reload', async () => {
    const h = fixture(); await h.load(listing(undefined, { totalMatching: 110, totalPages: 3 }));
    h.click(h.all().find(node => node.props['aria-label'] === 'Next Excel audit page'));
    h.latest('list').ok(listing([row('p2')], { page: 2, totalMatching: 110, totalPages: 3 })); await h.settle();
    h.click(h.button('Reload saved audit'));
    const old = h.latest('list'); assert.equal(old.args.page, 2);
    h.change(h.input('Search Excel audit'), 'Cotton'); await h.advance(300);
    const current = h.latest('list'); assert.equal(current.args.page, 1); assert.equal(current.args.search, 'Cotton');
    current.ok(listing([row('current', { name: 'Current cotton result' })])); await h.settle();
    old.ok(listing([row('old', { name: 'Old page result' })], { page: 2 })); await h.settle();
    assert.match(h.text(), /Current cotton result/);
    assert.equal(h.text().includes('Old page result'), false);
    h.unmount();
});

test('inactive and unauthorized users cannot load or upload, while active inventory staff can', async () => {
    for (const user of [null, { ...owner, isActive: false }, { ...owner, role: 'CASHIER', permManageInventory: false }]) {
        const h = fixture({ user }); await h.settle();
        assert.match(h.text(), /need inventory access/);
        assert.equal(h.calls.length, 0);
        h.unmount();
    }
    const h = fixture({ user: { ...owner, role: 'CASHIER' } }); await h.load();
    assert.equal(h.input('Stock audit workbook').props.disabled, false);
    h.unmount();
});

test('desktop-only fallback does not fake an upload or issue IPC', async () => {
    const h = fixture({ desktop: false }); await h.settle();
    assert.match(h.text(), /desktop POS app/);
    assert.equal(h.calls.length, 0);
    assert.equal(h.all().some(node => node.props.type === 'file'), false);
    h.unmount();
});

test('preview completing after unmount or access loss never opens a modal or posts a notification', async () => {
    for (const reason of ['unmount', 'access']) {
        const h = fixture(); await h.load();
        h.choose(workbook()); h.click(h.button('Review Excel file')); await h.settle();
        const pending = h.latest('preview');
        if (reason === 'unmount') h.unmount(); else h.setActor({ ...owner, role: 'CASHIER', permManageInventory: false });
        pending.ok(preview()); await h.settle();
        assert.equal(h.notices.length, 0);
        assert.equal(h.count('commit'), 0);
        if (reason === 'access') { assert.equal(h.modal(), undefined); h.unmount(); }
    }
});

test('user change invalidates old list and commit completions without clearing the new user data', async () => {
    const h = fixture(); const previousList = h.latest('list');
    h.setActor({ ...owner, id: 'second-owner' });
    await h.load(listing([row('second', { name: 'Second owner audit' })]));
    previousList.ok(listing([row('previous', { name: 'Previous owner audit' })])); await h.settle();
    assert.match(h.text(), /Second owner audit/);
    assert.equal(h.text().includes('Previous owner audit'), false);
    await h.review(); h.click(h.button('Replace saved audit', h.modal()));
    const pendingCommit = h.start(h.dialog().props.onConfirm);
    const previousCommit = h.latest('commit');
    h.setActor({ ...owner, id: 'third-owner' });
    await h.load(listing([row('third', { name: 'Third owner audit' })]));
    previousCommit.ok(savedStatus({ fileName: 'Previous commit.xlsx' })); await pendingCommit; await h.settle();
    assert.match(h.text(), /Third owner audit/);
    assert.equal(h.text().includes('Previous commit.xlsx'), false);
    assert.equal(h.notices.length, 0);
    h.unmount();
});

test('a failed initial saved-audit read still allows uploading a replacement preview', async () => {
    const h = fixture(); h.latest('list').fail('Saved audit file is corrupt. Import a replacement workbook.'); await h.settle();
    await h.review();
    assert.ok(h.modal());
    assert.equal(h.button('Replace saved audit', h.modal()).props.disabled, false);
    assert.equal(h.count('commit'), 0);
    h.unmount();
});

test('physical style selection uses saved row IDs across pages, blocks zero counts, and resets on a replaced source file', async () => {
    const h = fixture({ prepare: true });
    await h.load(listing([row('a', { sourceRow: 2 }), row('zero', { sourceRow: 3, countedQuantity: 0 })], { totalMatching: 60, totalPages: 2 }));
    const select = sourceRow => h.all().find(node => node.type === 'input' && node.props['aria-label']?.startsWith(`Select audit row ${sourceRow}:`));
    assert.equal(select(3).props.disabled, true);
    h.change(select(2), true);
    h.click(h.all().find(node => node.props['aria-label'] === 'Next Excel audit page'));
    await h.load(listing([row('b', { sourceRow: 4, countedQuantity: null })], { page: 2, totalMatching: 60, totalPages: 2 }));
    h.change(select(4), true); h.click(h.button('Add stock items'));
    assert.deepEqual(Array.from(h.preparations[0].rows, item => item.id), ['a', 'b']);
    assert.equal(h.preparations[0].fileHash, 'saved-hash');
    assert.equal(h.count('commit'), 0);
    const stalePrepare = h.button('Add stock items').props.onClick;
    h.click(h.button('Reload saved audit'));
    await h.load(listing([row('new')], { status: savedStatus({ fileHash: 'replacement-hash' }) }));
    assert.equal(h.button('Add stock items').props.disabled, true);
    await h.start(stalePrepare);
    assert.equal(h.preparations.length, 1);
    h.unmount();
});

for (const outcome of ['pending', 'failure']) test(`captured row and preparation actions cannot use ${outcome} audit results`, async () => {
    const h = fixture({ prepare: true }); await h.load();
    const checkbox = h.all().find(node => node.type === 'input' && node.props.type === 'checkbox');
    h.change(checkbox, true);
    const prepare = h.button('Add stock items').props.onClick;
    const oldSelect = checkbox.props.onChange;
    h.click(h.button('Clear selection'));
    h.click(h.button('Reload saved audit'));
    if (outcome === 'failure') { h.latest('list').fail('Cannot read saved audit'); await h.settle(); }
    h.start(() => oldSelect({ target: { checked: true } }));
    h.start(prepare);
    assert.equal(h.preparations.length, 0);
    assert.match(h.text(), /0\s+selected/);
    h.unmount();
});

test('saved Excel rows show their stage, cannot create duplicate items, and resume their original saved item', async () => {
    const h = fixture({ prepare: true, openSaved: true });
    await h.load(listing([
        row('prepared', { stockStatus: 'PREPARED', stockDraftId: 'draft-a', stockVariantId: 'variant-a' }),
        row('posted', { stockStatus: 'POSTED', stockDraftId: 'draft-b', stockVariantId: 'variant-b' }),
        row('cancelled', { stockStatus: 'CANCELLED', stockDraftId: 'draft-c', stockVariantId: 'variant-c' }),
        row('new'),
    ]));
    const rows = h.all().filter(node => node.type === 'tr').slice(1);
    const controls = rows.map(node => h.all(node).find(child => child.type === 'input'));
    assert.deepEqual(controls.map(control => control.props.disabled), [true, true, true, false]);
    assert.match(h.text(), /Added to inventory/); assert.match(h.text(), /Setup cancelled/);
    h.click(h.button('Continue setup'));
    assert.deepEqual(h.savedItems[0], ['draft-a', 'variant-a', 'PREPARED']);
    const oldResume = h.button('Continue setup').props.onClick;
    h.click(h.button('Reload saved audit'));
    h.start(oldResume);
    assert.equal(h.savedItems.length, 1);
    h.unmount();
});

test('refresh drops selected rows that have already become saved stock items', async () => {
    const h = fixture({ prepare: true }); await h.load();
    h.change(h.all().find(node => node.type === 'input' && node.props.type === 'checkbox'), true);
    const oldPrepare = h.button('Add stock items').props.onClick;
    h.click(h.button('Reload saved audit'));
    await h.load(listing([row('700', { stockStatus: 'PREPARED', stockDraftId: 'draft-a' })]));
    assert.equal(h.button('Add stock items').props.disabled, true);
    h.start(oldPrepare);
    assert.equal(h.preparations.length, 0);
    assert.match(h.text(), /0\s+selected/);
    h.unmount();
});

test('audit selection explains and enforces the maximum reviewed style size before sending it', async () => {
    const h = fixture({ prepare: true });
    const rows = Array.from({ length: 101 }, (_, index) => row(`piece-${index}`, { sourceRow: index + 2 }));
    await h.load(listing(rows));
    for (const checkbox of h.all().filter(node => node.type === 'input' && node.props.type === 'checkbox')) h.change(checkbox, true);
    h.click(h.button('Add stock items'));
    assert.equal(h.preparations[0].rows.length, 100);
    assert.match(h.notices.at(-1)[0], /100/);
    h.unmount();
});
