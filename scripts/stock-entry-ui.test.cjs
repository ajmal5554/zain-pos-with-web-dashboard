const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
function fixture(mode = 'MANUAL', componentName = 'StockEntryView', extraProps = {}) {
    let tree, index = 0, dirty = true;
    const hooks = [], effects = [], requests = [], saved = [], blocked = [];
    const react = { Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }),
        useState(initial) { const i = index++; hooks[i] ||= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, value => { const next = typeof value === 'function' ? value(hooks[i].value) : value; if (!Object.is(next, hooks[i].value)) { hooks[i].value = next; dirty = true; } }]; },
        useRef(initial) { const i = index++; hooks[i] ||= { value: { current: initial } }; return hooks[i].value; },
        useEffect(effect, deps) { const i = index++; if (!hooks[i] || !deps || deps.some((v, j) => !Object.is(v, hooks[i].deps[j]))) { hooks[i] = { deps }; effects.push(effect); } },
    };
    const call = (channel, input) => new Promise((resolve, reject) => requests.push({ channel, input, resolve, reject }));
    const user = { id: 'owner', role: 'ADMIN', isActive: true };
    const onBlockedChange = value => blocked.push(value);
    const module = { exports: {} };
    const storage = new Map();
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, `src/components/stock/${componentName}.tsx`), 'utf8')), {
        module, exports: module.exports, crypto: webcrypto, Date, Uint8Array, Error, structuredClone,
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        require: name => {
            if (name === 'react') return { __esModule: true, default: react, ...react };
            if (name.endsWith('/authStore')) return { useAuthStore: { getState: () => ({ user }) } };
            if (name.endsWith('/Toast')) return { showToast() {} };
            if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => key });
            if (name.endsWith('/stockAuditSetup')) {
                const setupModule = { exports: {} };
                vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/types/stockAuditSetup.ts'), 'utf8')), { module: setupModule, exports: setupModule.exports });
                return setupModule.exports;
            }
            if (name.endsWith('/stock-audit-setup.service')) return { stockAuditSetupService: { get: () => call('setupGet'), save: input => call('setupSave', input) } };
            if (name.endsWith('/stock-conversion.service')) return { stockConversionService: { saveEntry: input => call('save', input), adjust: input => call('adjust', input) } };
            if (name.endsWith('/excel-audit.service')) return { excelAuditService: Object.fromEntries(['preview', 'commit', 'list'].map(key => [key, input => call(key, input)])) };
            for (const component of ['Button', 'Input', 'ConfirmDialog', 'Modal', 'AuditSetupModal']) if (name.endsWith('/' + component)) return { [component]: component };
            throw new Error(name);
        },
    });
    const render = () => { for (let count = 0; dirty; count++) { assert.ok(count < 30); dirty = false; index = 0; tree = module.exports[componentName]({ mode, onBlockedChange, onSaved: value => saved.push(value || true), onInventoryChanged: () => saved.push(true), ...extraProps }); effects.splice(0).forEach(effect => effect()); } };
    const all = () => { const nodes = []; const visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); if (['ConfirmDialog', 'Modal'].includes(node.type) && !node.props.isOpen) return; nodes.push(node); visit(node.props?.children); }; visit(tree); return nodes; };
    const find = predicate => { const node = all().find(predicate); assert.ok(node, text(tree)); return node; };
    const act = fn => { const result = fn(); render(); return result; };
    const settle = async () => { for (let i = 0; i < 16; i++) { await Promise.resolve(); render(); } };
    const change = (field, value) => act(() => find(node => node.type === 'input' && node.props['aria-label']?.startsWith(field + ' ')).props.onChange({ target: { value } }));
    const button = name => find(node => node.type === 'Button' && text(node).trim() === name);
    render(); return { all, find, act, settle, change, button, requests, saved, blocked, latest: channel => requests.filter(request => request.channel === channel).at(-1) };
}

test('manual entry saves the reviewed readable name, attributes, quantity and named batch directly', async () => {
    const f = fixture();
    for (const [field, value] of Object.entries({ Category: 'Shirts', Brand: 'Crazy Heart', Size: 'XL', Mrp: '700', Quantity: '15', Name: 'Crazy Heart Plain - XL' })) f.change(field, value);
    f.act(() => f.find(node => node.type === 'Input' && node.props.label.startsWith('Batch name')).props.onChange({ target: { value: 'Rack 1' } }));
    f.act(() => f.button('Attributes').props.onClick());
    f.act(() => f.find(node => node.type === 'Input' && node.props.label === 'Fabric').props.onChange({ target: { value: 'Cotton' } }));
    assert.equal(f.blocked.at(-1), true);
    f.act(() => f.button('Save stock to inventory').props.onClick());
    const save = f.act(() => f.find(node => node.type === 'ConfirmDialog').props.onConfirm());
    const request = f.latest('save');
    assert.equal(request.input.batchName, 'Rack 1');
    assert.equal(request.input.rows[0].quantity, 15); assert.equal(request.input.rows[0].name, 'Crazy Heart Plain - XL');
    assert.equal(request.input.rows[0].attributes.fabric, 'Cotton');
    request.resolve({ totalPieces: 15, batchName: 'Rack 1' }); await save; await f.settle();
    assert.equal(f.saved.length, 1);
});

test('Excel rows become editable stock, saved rows skip, and an uncertain save retries the same request', async () => {
    const f = fixture('EXCEL');
    f.act(() => f.find(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [{ name: 'audit.xlsx', size: 100, arrayBuffer: async () => new ArrayBuffer(4) }], value: 'audit.xlsx' } }));
    await f.settle(); f.latest('preview').resolve({ token: 'token' }); await f.settle();
    f.latest('commit').resolve({ fileHash: 'a'.repeat(64) }); await f.settle();
    f.latest('list').resolve({ totalPages: 1, status: { fileHash: 'a'.repeat(64) }, items: [
        { id: 'new', category: 'Shirts', brand: 'Crazy Heart', size: 'XL', mrp: 700, countedQuantity: 15, attributes: { fabric: 'Cotton' } },
        { id: 'saved', stockStatus: 'POSTED' },
    ] }); await f.settle();
    f.change('Quantity', '12'); f.change('Name', 'Crazy Heart Plain - XL');
    f.act(() => f.button('Save stock to inventory').props.onClick());
    const firstSave = f.act(() => f.find(node => node.type === 'ConfirmDialog').props.onConfirm());
    const first = f.latest('save'); assert.equal(first.input.rows.length, 1); assert.equal(first.input.rows[0].quantity, 12); assert.equal(first.input.rows[0].sourceRowId, 'new');
    first.reject(new Error('Connection lost')); await firstSave; await f.settle();
    assert.equal(f.button('Discard entry').props.disabled, true);
    f.act(() => f.button('Retry same save').props.onClick());
    const retry = f.latest('save'); assert.equal(retry.input, first.input);
    retry.resolve({ totalPieces: 12, batchName: 'audit' }); await f.settle();
    assert.equal(f.saved.length, 1);
});

test('blank count blocks saving and shirt fields do not appear for Mundu', () => {
    const f = fixture(); f.change('Category', 'Mundu'); f.change('Mrp', '480');
    assert.equal(f.button('Save stock to inventory').props.disabled, true);
    f.act(() => f.button('Attributes').props.onClick());
    assert.ok(f.all().some(node => node.type === 'Input' && node.props.label === 'Border'));
    assert.equal(f.all().some(node => node.type === 'Input' && node.props.label === 'Collar'), false);
    f.change('Quantity', '0'); assert.equal(f.button('Save stock to inventory').props.disabled, false);
});

const rackSetup = () => ({ revision: 1, categories: [
    { name: 'Shirts', brands: ['Crazy Heart'], groups: [{ key: 'fabric', label: 'Fabric', options: ['Cotton', 'Linen'] }, { key: 'collar', label: 'Collar', options: ['Regular Collar'] }], scales: [{ name: 'Standard', sizes: ['L', 'XL'] }] },
    { name: 'Mundu', brands: [], groups: [{ key: 'border', label: 'Border', options: ['Gold Kasavu'] }], scales: [{ name: 'Mundu', sizes: ['Single', 'Double'] }] },
] });
const clickChip = (f, value) => f.act(() => f.find(node => node.type === 'button' && text(node) === value).props.onClick());
const changeInput = (f, label, value) => f.act(() => f.find(node => node.type === 'Input' && node.props.label === label).props.onChange({ target: { value } }));

test('purchase catalogue setup creates selected sizes at zero without adding delivery stock', async () => {
    const f = fixture('MANUAL', 'RackAuditView');
    f.latest('setupGet').resolve(rackSetup()); await f.settle();
    clickChip(f, 'Shirts'); clickChip(f, 'Crazy Heart'); clickChip(f, 'Cotton');
    changeInput(f, 'MRP price (₹)', '700');
    f.act(() => f.find(n => n.props['aria-label'] === 'Create item codes only').props.onChange({ target: { checked: true } }));
    assert.equal(f.button('Create item codes with zero stock').props.disabled, true);
    f.act(() => f.find(n => n.props['aria-label'] === 'Create size XL').props.onClick());
    f.act(() => f.button('Create item codes with zero stock').props.onClick());
    const saving = f.act(() => f.find(n => n.type === 'ConfirmDialog').props.onConfirm());
    const request = f.latest('save'); assert.equal(request.input.rows.length, 1);
    assert.equal(request.input.rows[0].size, 'XL'); assert.equal(request.input.rows[0].quantity, 0);
    request.resolve({totalPieces:0,batchName:'Catalogue setup'}); await saving; await f.settle();
    assert.equal(f.saved.length, 1);
});

test('rack audit selects category attributes, counts multiple sizes, retains style and clears only saved counts', async () => {
    const f = fixture('MANUAL', 'RackAuditView');
    f.latest('setupGet').resolve(rackSetup()); await f.settle();
    clickChip(f, 'Shirts'); clickChip(f, 'Crazy Heart'); clickChip(f, 'Cotton'); clickChip(f, 'Regular Collar');
    f.act(() => f.find(node => node.props['aria-label'] === 'Increase XL').props.onClick());
    f.act(() => f.find(node => node.props['aria-label'] === 'Count L').props.onChange({ target: { value: '2' } }));
    changeInput(f, 'MRP price (₹)', '700');
    clickChip(f, 'Mundu');
    assert.ok(f.all().some(node => node.props.role === 'alert' && text(node).includes('clear its counts')));
    f.act(() => f.button('Save 3 pieces to inventory').props.onClick());
    const saving = f.act(() => f.find(node => node.type === 'ConfirmDialog').props.onConfirm());
    const request = f.latest('save');
    assert.equal(request.input.mergeMatching, true); assert.equal(request.input.rows.length, 2);
    assert.equal(request.input.rows[0].attributes.fabric, 'Cotton');
    assert.equal(request.input.rows[0].attributes.collar, 'Regular Collar');
    assert.equal(request.input.rows[0].category, 'Shirts');
    request.resolve({ totalPieces: 3 }); await saving; await f.settle();
    assert.equal(f.saved.length, 1); assert.equal(f.blocked.at(-1), false);
    assert.equal(f.find(node => node.type === 'Input' && node.props.label === 'MRP price (₹)').props.value, '700');
    assert.equal(f.find(node => node.props['aria-label'] === 'Count L').props.value, '');
    clickChip(f, 'Mundu');
    assert.equal(f.all().some(node => node.type === 'button' && text(node) === 'Regular Collar'), false);
    assert.ok(f.all().some(node => node.type === 'button' && text(node) === 'Gold Kasavu'));
});

test('adding an attribute option persists setup and immediately selects the new value', async () => {
    const f = fixture('MANUAL', 'RackAuditView'); f.latest('setupGet').resolve(rackSetup()); await f.settle(); clickChip(f, 'Shirts');
    clickChip(f, '+ Add');
    changeInput(f, 'Name', 'Corduroy');
    f.act(() => f.button('Add').props.onClick());
    const request = f.latest('setupSave');
    assert.equal(request.input.categories[0].groups[0].options.at(-1), 'Corduroy');
    request.resolve({ revision: 2, categories: request.input.categories }); await f.settle();
    assert.ok(f.all().some(node => node.type === 'button' && text(node) === 'Corduroy' && node.props['aria-pressed']));
});

test('setup editor creates categories and custom attribute types with stable keys', async () => {
    const f = fixture('MANUAL', 'AuditSetupModal', { setup: rackSetup(), selected: 'Shirts', onClose() {} });
    changeInput(f, 'New category', 'Belts'); f.act(() => f.button('Add category').props.onClick());
    changeInput(f, 'New attribute type', 'Buckle Type'); f.act(() => f.button('Add attribute type').props.onClick());
    f.act(() => f.button('Save setup').props.onClick());
    const request = f.latest('setupSave');
    const category = request.input.categories.find(item => item.name === 'Belts');
    assert.ok(category); assert.ok(category.groups.some(group => group.label === 'Buckle Type' && /^custom_buckle_type_/.test(group.key)));
    request.resolve({ revision: 2, categories: request.input.categories }); await f.settle(); assert.equal(f.saved.length, 1);
});

test('quick inventory correction is guarded against a stale balance and retries an uncertain request unchanged', async () => {
    const f = fixture('MANUAL', 'QuickStockCount', { variant: { id: 'variant', barcode: '100001', stock: 5 }, disabled: false, onChanged: () => {} });
    f.act(() => f.find(node => node.props['aria-label'] === 'Increase stock 100001').props.onClick());
    const first = f.latest('adjust'); assert.equal(first.input.expectedStock, 5); assert.equal(first.input.quantity, 6);
    first.reject(new Error('Lost reply')); await f.settle();
    f.act(() => f.find(node => node.type === 'button' && text(node) === 'Retry same count correction').props.onClick());
    const retry = f.latest('adjust'); assert.equal(retry.input, first.input);
    retry.resolve({ stock: 6 }); await f.settle();
});
