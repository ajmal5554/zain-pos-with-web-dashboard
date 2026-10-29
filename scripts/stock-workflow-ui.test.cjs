const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');
const test = (name, run) => nodeTest(name, { timeout: 8000 }, run);
const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const owner = { id: 'owner', role: 'ADMIN', isActive: true, permManageInventory: true, permManageProducts: true, permPrintSticker: true };
const variant = { id: 'variant-a', productId: 'product-a', name: 'Shirt 700', barcode: '100001', sku: '100001', size: 'XL', scope: 'TRACKED', stock: 5, mrp: 700, attributes: { fabric: 'Cotton' } };
const selection = { fileHash: 'hash-a', rows: [{ id: 'row-a', name: 'Shirt 700', sourceRow: 2, size: 'XL', mrp: 700, countedQuantity: 2, attributes: { fabric: 'Cotton' } }] };
const detail = (overrides = {}) => ({ id: 'batch-a', status: 'DRAFT', revision: 3, batchDescription: 'Held rack section',
    lines: [{ id: 'line-a', variantId: 'variant-a', countedQuantity: 2, catalogueStatus: 'OK', snapshot: { productName: 'Shirt 700', size: 'XL', barcode: '100001', description: 'Cotton · Checks' }, currentLiveDetails: { isPrepared: true, isTracked: false } }], ...overrides });
const inventory = (stock = 5) => ({ items: [{ id: 'variant-a', variants: [{ ...variant, stock }] }] });
const textOf = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(textOf).join(' ') : textOf(node.props?.children);

function fixture(kind, customProps = {}) {
    let actor = owner, tree, cursor = 0, dirty = true, mounted = true;
    const hooks = [], effects = [], calls = [], notices = [], closed = [], completed = [];
    const react = { Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }),
        useState(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[index].value, value => { if (!mounted) return; const next = typeof value === 'function' ? value(hooks[index].value) : value; if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; } }]; },
        useRef(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: { current: initial } }; return hooks[index].value; },
        useEffect(effect, deps) { const index = cursor++, previous = hooks[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) { hooks[index] = { deps, cleanup: previous?.cleanup }; effects.push({ index, effect }); } },
    };
    const useAuthStore = Object.assign(() => ({ user: actor }), { getState: () => ({ user: actor }) });
    const request = (channel, args) => new Promise((resolve, reject) => calls.push({ channel, args, ok: data => resolve({ success: true, data }), fail: error => resolve({ success: false, error }), reject }));
    const window = { electronAPI: { stockConversion: Object.fromEntries(['prepare', 'postBatch', 'adjust'].map(channel => [channel, args => request(channel, args)])), stockDraft: { get: args => request('getDraft', args) }, stock: { getInventory: args => request('inventory', args) }, catalogue: { listVariants: args => request('variant', args) } } };
    const service = relativeFile => {
        const module = { exports: {} };
        vm.runInNewContext(compile(fs.readFileSync(path.join(root, relativeFile), 'utf8')), { exports: module.exports, module, window, Error,
            require: name => { if (name.endsWith('/authStore')) return { useAuthStore }; throw new Error(`Unexpected service dependency ${name}`); } });
        return module.exports;
    };
    const services = { '/stock-conversion.service': service('src/services/stock-conversion.service.ts'), '/stock-draft.service': service('src/services/stock-draft.service.ts'), '/inventory-workspace.service': service('src/services/inventory-workspace.service.ts') };
    const db = { categories: { findMany: args => request('categories', args).then(result => { if (!result.success) throw new Error(result.error); return result.data; }) }, productVariants: { findUnique: args => request('variant', args).then(result => { if (!result.success) throw new Error(result.error); return result.data; }) } };
    const names = { prepare: 'PrepareAuditStyleModal', review: 'ReviewStockBatchModal', adjust: 'TrackedStockAdjustmentModal', workflow: 'AuditRelabellingView' };
    const module = { exports: {} };
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, `src/components/stock/${names[kind]}.tsx`), 'utf8')), { exports: module.exports, module, window, Error, Date, crypto: webcrypto,
        require: name => {
            if (name === 'react') return { __esModule: true, default: react, ...react };
            if (name.endsWith('/authStore')) return { useAuthStore };
            if (name.endsWith('/db')) return { db };
            if (name.endsWith('/Toast')) return { showToast: (...args) => notices.push(args) };
            for (const [suffix, value] of Object.entries(services)) if (name.endsWith(suffix)) return value;
            const component = ['Button', 'Input', 'Modal', 'ConfirmDialog', 'StickerPrintModal', 'ExcelAuditView', 'CountDraftsView', 'InventoryWorkspaceView', 'PrepareAuditStyleModal', 'ReviewStockBatchModal'].find(key => name.endsWith(`/${key}`));
            if (component) return { [component]: component };
            throw new Error(`Unexpected component dependency ${name}`);
        },
    });
    const props = { selection, draftId: 'batch-a', variant, onClose: () => closed.push(true), onPrepared: id => completed.push(id), onPosted: () => completed.push('posted'), onAdjusted: () => completed.push('adjusted'), onInventoryChanged: () => completed.push('inventory'), ...customProps };
    function expand(node) {
        if (Array.isArray(node)) return node.map(expand);
        if (!node || typeof node !== 'object') return node;
        if (typeof node.type === 'function') return expand(node.type(node.props));
        return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
    }
    function flush() { for (let count = 0; dirty && mounted; count++) { assert.ok(count < 40, 'Component did not settle'); dirty = false; cursor = 0; tree = expand(module.exports[names[kind]](props)); for (const { index, effect } of effects.splice(0)) { hooks[index].cleanup?.(); hooks[index].cleanup = effect(); } } }
    async function settle() { for (let i = 0; i < 14; i++) { await Promise.resolve(); flush(); } }
    function all(scope = tree) { const result = []; const visit = (node, disabled = false) => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(value => visit(value, disabled)); if (['Modal', 'ConfirmDialog'].includes(node.type) && !node.props.isOpen) return; node.inheritedDisabled = disabled; result.push(node); visit(node.props?.children, disabled || node.type === 'fieldset' && node.props.disabled); }; visit(scope); return result; }
    const text = (scope = tree) => textOf(scope).replace(/\s+/g, ' ').trim();
    const find = (predicate, label) => { const value = all().find(predicate); assert.ok(value, `Missing ${label}: ${text()}`); return value; };
    const button = label => find(node => node.type === 'Button' && text(node) === label, label);
    const input = label => find(node => node.type === 'Input' && node.props.label === label, label);
    const start = fn => { const result = fn(); flush(); return result; };
    const change = (node, value) => start(() => node.props.onChange({ target: { value, checked: value } }));
    const click = node => { assert.ok(!node.props.disabled && !node.inheritedDisabled, `Disabled ${text(node)}`); return start(() => node.props.onClick()); };
    flush();
    return { calls, notices, closed, completed, all, text, find, button, input, start, change, click, settle,
        latest: channel => calls.filter(call => call.channel === channel).at(-1), count: channel => calls.filter(call => call.channel === channel).length,
        dialog: () => all().find(node => node.type === 'ConfirmDialog'),
        check: index => change(all().filter(node => node.type === 'input' && node.props.type === 'checkbox')[index], true),
        setActor: next => { actor = next; dirty = true; flush(); },
        unmount: () => { mounted = false; hooks.forEach(hook => hook?.cleanup?.()); },
    };
}

test('Excel upload stays a single view and unfinished items remain recoverable without nested tabs', async () => {
    const h = fixture('workflow');
    assert.equal(h.all().filter(node => node.type === 'ExcelAuditView').length, 1);
    assert.equal(h.all().filter(node => node.type === 'CountDraftsView' || node.type === 'InventoryWorkspaceView').length, 0);
    assert.equal(h.all().filter(node => node.props?.role === 'tab' || typeof node.props?.['aria-pressed'] === 'boolean').length, 0);
    assert.doesNotMatch(h.text(), /Audit & relabelling|Prepared items|Saved batches/);
    h.click(h.button('Continue unfinished items'));
    const unfinished = h.find(node => node.type === 'CountDraftsView', 'unfinished items');
    assert.equal(unfinished.props.initialDraftId, null);
    assert.equal(typeof unfinished.props.onReviewBatch, 'function');
    assert.equal(h.all().filter(node => node.type === 'ExcelAuditView').length, 0);
    h.click(h.button('Back to Excel upload'));
    assert.equal(h.all().filter(node => node.type === 'CountDraftsView').length, 0);
    assert.equal(h.all().filter(node => node.type === 'ExcelAuditView').length, 1);
    h.click(h.button('Continue unfinished items'));
    assert.equal(h.find(node => node.type === 'CountDraftsView', 'recovered unfinished items').props.initialDraftId, null);
    h.unmount();
});

test('preparing selected Excel items opens their saved counts directly and ready stock returns to the inbox', async () => {
    const h = fixture('workflow');
    const excel = h.find(node => node.type === 'ExcelAuditView', 'Excel upload');
    h.start(() => excel.props.onPrepareSelection(selection));
    const prepare = h.find(node => node.type === 'PrepareAuditStyleModal', 'item preparation');
    assert.equal(prepare.props.selection, selection);
    h.start(() => prepare.props.onPrepared('saved-item-123'));
    assert.equal(h.all().filter(node => node.type === 'PrepareAuditStyleModal').length, 0);
    const saved = h.find(node => node.type === 'CountDraftsView', 'saved counts');
    assert.equal(saved.props.initialDraftId, 'saved-item-123');
    h.start(() => saved.props.onReviewBatch('saved-item-123'));
    const review = h.find(node => node.type === 'ReviewStockBatchModal', 'stock and label check');
    assert.equal(review.props.draftId, 'saved-item-123');
    h.start(review.props.onPosted);
    assert.deepEqual(h.completed, ['inventory']);
    assert.equal(h.all().filter(node => node.type === 'ReviewStockBatchModal' || node.type === 'CountDraftsView').length, 0);
    assert.equal(h.all().filter(node => node.type === 'ExcelAuditView').length, 1);
    h.click(h.button('Continue unfinished items'));
    assert.equal(h.find(node => node.type === 'CountDraftsView', 'unfinished list').props.initialDraftId, null);
    h.unmount();
});

test('Excel preparation respects product access while existing unfinished items remain available to inventory staff', async () => {
    const h = fixture('workflow');
    h.setActor({ id: 'staff', role: 'CASHIER', isActive: true, permManageInventory: true, permManageProducts: false });
    assert.equal(h.find(node => node.type === 'ExcelAuditView', 'Excel upload').props.onPrepareSelection, undefined);
    h.click(h.button('Continue unfinished items'));
    assert.equal(h.find(node => node.type === 'CountDraftsView', 'unfinished items').props.canManageProducts, false);
    for (const actor of [null, { id: 'disabled', role: 'ADMIN', isActive: false }, { id: 'cashier', role: 'CASHIER', isActive: true, permManageInventory: false }]) {
        h.setActor(actor);
        assert.equal(h.all().filter(node => ['ExcelAuditView', 'CountDraftsView', 'PrepareAuditStyleModal', 'ReviewStockBatchModal'].includes(node.type)).length, 0);
    }
    h.unmount();
});

test('style preparation requires explicit name/category/physical-style confirmation and sends only selected saved row IDs', async () => {
    const h = fixture('prepare'); h.latest('categories').ok([{ id: 'shirts', name: 'Shirts' }]); await h.settle();
    assert.equal(h.button('Create new barcodes').props.disabled, true);
    h.change(h.input('Readable product name'), 'Shirt 700');
    h.change(h.find(node => node.type === 'select', 'category'), 'shirts');
    assert.equal(h.button('Create new barcodes').props.disabled, true);
    h.check(0); h.click(h.button('Create new barcodes'));
    const payload = h.latest('prepare').args;
    assert.deepEqual(Array.from(payload.rowIds), ['row-a']);
    assert.equal(payload.fileHash, 'hash-a'); assert.equal(payload.productName, 'Shirt 700');
    assert.equal(payload.categoryId, 'shirts'); assert.equal(payload.styleConfirmed, true);
    assert.equal(payload.rows, undefined);
    h.latest('prepare').ok({ draftId: 'new-batch' }); await h.settle();
    assert.deepEqual(h.completed, ['new-batch']);
    h.unmount();
});

test('audited brand and pattern suggest a readable style name while size stays separate and the owner can rename it', async () => {
    const selected = { fileHash: 'crazy-heart-file', rows: [{ ...selection.rows[0], id: 'crazy-heart-xl', brand: 'Crazy Heart', size: 'XL', attributes: { fabric: 'Cotton', pattern: 'Checks' } }] };
    const h = fixture('prepare', { selection: selected });
    assert.equal(h.input('Readable product name').props.value, 'Crazy Heart Checks');
    assert.doesNotMatch(h.input('Readable product name').props.value, /XL/);
    assert.match(h.text(), /XL/);
    h.latest('categories').ok([{ id: 'shirts', name: 'Shirts' }]); await h.settle();
    h.change(h.input('Readable product name'), 'Crazy Heart Cotton Checks');
    h.change(h.find(node => node.type === 'select', 'category'), 'shirts'); h.check(0);
    h.click(h.button('Create new barcodes'));
    const payload = h.latest('prepare').args;
    assert.equal(payload.productName, 'Crazy Heart Cotton Checks');
    assert.equal(payload.fileHash, 'crazy-heart-file');
    assert.deepEqual(Array.from(payload.rowIds), ['crazy-heart-xl']);
    assert.equal(payload.categoryId, 'shirts'); assert.equal(payload.styleConfirmed, true);
    assert.equal(payload.rows, undefined);
    h.latest('prepare').ok({ draftId: 'crazy-heart-stock' }); await h.settle();
    assert.deepEqual(h.completed, ['crazy-heart-stock']);
    h.unmount();
});

test('style preparation retry preserves operation ID; changed details create a new request and session loss blocks completion', async () => {
    const h = fixture('prepare'); h.latest('categories').ok([{ id: 'shirts', name: 'Shirts' }]); await h.settle();
    h.change(h.input('Readable product name'), 'Shirt 700'); h.change(h.find(node => node.type === 'select', 'category'), 'shirts'); h.check(0);
    h.click(h.button('Create new barcodes')); const first = h.latest('prepare').args;
    h.latest('prepare').fail('Busy'); await h.settle();
    h.click(h.button('Retry')); assert.equal(h.latest('prepare').args.operationId, first.operationId);
    h.latest('prepare').fail('Busy'); await h.settle();
    h.change(h.input('Readable product name'), 'Shirt Cotton'); h.click(h.button('Create new barcodes'));
    assert.notEqual(h.latest('prepare').args.operationId, first.operationId);
    h.setActor(null); h.latest('prepare').ok({ draftId: 'old-batch' }); await h.settle();
    assert.equal(h.completed.length, 0); assert.equal(h.notices.length, 0); h.unmount();
});

test('an audit category missing from Products can be reviewed and created from the stock form', async () => {
    const selected = { ...selection, rows: [{ ...selection.rows[0], category: 'Accessories', brand: 'Sample', size: null }] };
    const h = fixture('prepare', { selection: selected });
    h.latest('categories').ok([{ id: 'shirts', name: 'Shirts' }]); await h.settle();
    assert.equal(h.find(node => node.type === 'select', 'category').props.value, '__NEW__');
    assert.equal(h.input('New category name').props.value, 'Accessories');
    h.check(0); h.click(h.button('Create new barcodes'));
    assert.equal(h.latest('prepare').args.categoryId, '');
    assert.equal(h.latest('prepare').args.categoryName, 'Accessories');
    h.latest('prepare').ok({ draftId: 'accessories-entry' }); await h.settle();
    assert.deepEqual(h.completed, ['accessories-entry']); h.unmount();
});

test('an uncertain stock receipt freezes edits and reload and retries the original operation', async () => {
    const h = fixture('adjust'); h.latest('inventory').ok(inventory(7)); await h.settle();
    h.change(h.input('Number of pieces'), '2'); h.change(h.input('Reason'), 'Received checked items');
    const oldEdit = h.input('Number of pieces').props.onChange;
    h.click(h.button('Review adjustment'));
    const saving = h.start(h.dialog().props.onConfirm), operationId = h.latest('adjust').args.operationId;
    h.latest('adjust').reject(new Error('Connection lost')); await saving; await h.settle();
    assert.equal(h.button('Reload stock').props.disabled, true);
    assert.equal(h.button('Cancel').props.disabled, true);
    await h.start(() => oldEdit({ target: { value: '20' } }));
    assert.equal(h.input('Number of pieces').props.value, '2');
    const retry = h.start(h.dialog().props.onConfirm);
    assert.equal(h.latest('adjust').args.operationId, operationId); assert.equal(h.latest('adjust').args.quantity, 2);
    h.latest('adjust').ok({ stock: 9 }); await retry; await h.settle();
    assert.deepEqual(h.completed, ['adjusted']); h.unmount();
});

test('adding stock loads saved counts and requires one physical confirmation covering counts and labels', async () => {
    const h = fixture('review'); assert.equal(h.latest('getDraft').args.draftId, 'batch-a');
    h.latest('getDraft').ok(detail()); await h.settle();
    assert.equal(h.find(node => node.type === 'Modal', 'stock and label check').props.title, 'Add stock to inventory');
    assert.doesNotMatch(h.text(), /Revision|\bDRAFT\b|\bPOSTED\b|snapshot|activate/i);
    assert.equal(h.button('Add to inventory').props.disabled, true);
    assert.equal(h.all().filter(node => node.type === 'input' && node.props.type === 'checkbox').length, 1);
    h.check(0); h.click(h.button('Add to inventory')); assert.equal(h.count('postBatch'), 0);
    const captured = h.dialog().props.onConfirm; h.start(h.dialog().props.onClose); await h.start(captured);
    assert.equal(h.count('postBatch'), 0);
    h.click(h.button('Add to inventory')); const post = h.start(h.dialog().props.onConfirm);
    const args = h.latest('postBatch').args;
    assert.equal(args.expectedRevision, 3); assert.equal(args.held && args.labelsApplied && args.countsChecked, true);
    h.latest('postBatch').ok({ status: 'POSTED' }); await post; await h.settle();
    assert.deepEqual(h.completed, ['posted']); h.unmount();
});

test('invalid counts, changed catalogue and posted batches never enable another activation', async () => {
    for (const change of [line => { line.countedQuantity = null; }, line => { line.countedQuantity = 0; }, line => { line.catalogueStatus = 'CHANGED'; }]) {
        const h = fixture('review'); const value = detail(); change(value.lines[0]); h.latest('getDraft').ok(value); await h.settle();
        h.check(0); assert.equal(h.button('Add to inventory').props.disabled, true);
        assert.equal(h.count('postBatch'), 0); h.unmount();
    }
    const h = fixture('review'); h.latest('getDraft').ok(detail({ status: 'POSTED' })); await h.settle();
    assert.match(h.text(), /already in inventory/);
    assert.equal(h.all().some(node => node.type === 'Button' && h.text(node) === 'Add to inventory'), false);
    h.unmount();
});

test('activation retry preserves its captured ID and serializes confirmations; reload resets physical checks', async () => {
    const h = fixture('review'); h.latest('getDraft').ok(detail()); await h.settle(); h.check(0); h.click(h.button('Add to inventory'));
    const first = h.start(h.dialog().props.onConfirm); const id = h.latest('postBatch').args.operationId;
    await h.start(h.dialog().props.onConfirm); assert.equal(h.count('postBatch'), 1);
    h.latest('postBatch').fail('Response lost'); await first; await h.settle();
    const retry = h.start(h.dialog().props.onConfirm); assert.equal(h.latest('postBatch').args.operationId, id);
    h.latest('postBatch').fail('Response lost'); await retry; await h.settle();
    h.start(h.dialog().props.onClose); h.click(h.button('Reload items'));
    h.latest('getDraft').ok(detail({ revision: 4 })); await h.settle();
    assert.equal(h.button('Add to inventory').props.disabled, true); h.unmount();
});

test('label printing loads the saved variant barcode and does not tick labels-applied automatically', async () => {
    const h = fixture('review'); h.latest('getDraft').ok(detail()); await h.settle(); h.click(h.button('Print labels'));
    assert.equal(h.latest('variant').args.where.id, 'variant-a');
    h.latest('variant').ok([{ ...variant, fabric: 'Cotton', pattern: 'Checks', product: { id: 'product-a', name: 'Shirt 700' } }]); await h.settle();
    const printer = h.all().find(node => node.type === 'StickerPrintModal'); assert.ok(printer);
    assert.equal(printer.props.variant.barcode, '100001');
    assert.equal(printer.props.variant.fabric, 'Cotton');
    assert.equal(h.all().filter(node => node.type === 'input' && node.props.type === 'checkbox')[0].props.checked, false);
    assert.equal(h.count('postBatch'), 0); h.unmount();
});

test('tracked recount uses a fresh balance, requires a reason, and retries the same operation after a lost response', async () => {
    const h = fixture('adjust'); assert.equal(h.latest('inventory').args.scope, 'TRACKED');
    h.latest('inventory').ok(inventory(7)); await h.settle();
    h.change(h.find(node => node.type === 'select', 'kind'), 'RECOUNT');
    h.change(h.input('Actual total pieces counted'), '0'); assert.equal(h.button('Review adjustment').props.disabled, true);
    h.change(h.input('Reason'), 'Physical count corrected'); h.click(h.button('Review adjustment'));
    const first = h.start(h.dialog().props.onConfirm); const args = h.latest('adjust').args;
    assert.equal(args.expectedStock, 7); assert.equal(args.quantity, 0); assert.equal(args.kind, 'RECOUNT');
    h.latest('adjust').fail('Response lost'); await first; await h.settle();
    const retry = h.start(h.dialog().props.onConfirm); assert.equal(h.latest('adjust').args.operationId, args.operationId);
    h.latest('adjust').ok({ stock: 0 }); await retry; await h.settle();
    assert.deepEqual(h.completed, ['adjusted']); h.unmount();
});

test('receipt and damage validation prevent zero, fractional and oversize removals; cancellation blocks a captured confirmation', async () => {
    const h = fixture('adjust'); h.latest('inventory').ok(inventory(5)); await h.settle(); h.change(h.input('Reason'), 'Damaged piece');
    for (const amount of ['0', '1.5']) { h.change(h.input('Number of pieces'), amount); assert.equal(h.button('Review adjustment').props.disabled, true); }
    h.change(h.find(node => node.type === 'select', 'kind'), 'DAMAGE'); h.change(h.input('Number of pieces'), '6'); assert.equal(h.button('Review adjustment').props.disabled, true);
    h.change(h.input('Number of pieces'), '1'); h.click(h.button('Review adjustment')); const confirm = h.dialog().props.onConfirm;
    h.start(h.dialog().props.onClose); await h.start(confirm); assert.equal(h.count('adjust'), 0);
    h.unmount();
});

test('unmounted or signed-out batch reads cannot expose activation controls or complete adjustments', async () => {
    const h = fixture('review'); const pending = h.latest('getDraft'); h.unmount(); pending.ok(detail()); await h.settle(); assert.equal(h.count('postBatch'), 0);
    const adjust = fixture('adjust'); adjust.latest('inventory').ok(inventory()); await adjust.settle(); adjust.change(adjust.input('Number of pieces'), '1'); adjust.change(adjust.input('Reason'), 'New pieces'); adjust.click(adjust.button('Review adjustment'));
    const post = adjust.start(adjust.dialog().props.onConfirm); adjust.setActor(null); adjust.latest('adjust').ok({ stock: 6 }); await post; await adjust.settle();
    assert.equal(adjust.completed.length, 0); assert.equal(adjust.notices.length, 0); adjust.unmount();
});
