const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const transpile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const descriptionExports = {};
vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'src/lib/catalogueDescription.ts'), 'utf8')),
    { exports: descriptionExports, module: { exports: descriptionExports } });
const labelTemplateExports = {};
vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'src/lib/labelTemplate.ts'), 'utf8')),
    { exports: labelTemplateExports, module: { exports: labelTemplateExports } });

// Execute the actual component callbacks, not a second implementation of their behavior.
// Every database, IPC, timer and printer dependency below is isolated in memory.
function callback(file, name, bindings = {}) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let initializer;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer;
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(initializer, `${file}: missing ${name}`);
    const context = vm.createContext({
        ...descriptionExports,
        ...labelTemplateExports,
        console: { error() {}, log() {} },
        crypto: webcrypto,
        useCallback: fn => fn,
        useMemo: fn => fn(),
        setTimeout: fn => { fn(); },
        editLoading: false, editError: '',
        ...bindings,
    });
    vm.runInContext(transpile(`globalThis.subject = ${initializer.getText(ast)};`), context);
    return { run: context.subject, context };
}

const productsFile = 'src/pages/Products.tsx';
const labelsFile = 'src/components/ui/StickerPrintModal.tsx';
const posFile = 'src/pages/POS.tsx';
const variant = {
    id: 'saved-variant', barcode: '0012345', sku: 'SH-XL', size: 'XL', brand: 'Crazy Heart',
    fabric: 'Cotton', quality: 'Oxford', collar: 'Spread', pocket: 'Single', styleRef: 'Premium',
    mrp: 700, sellingPrice: 650, isPrepared: false, updatedAt: 'sale-changed-stock-revision',
    product: { id: 'saved-product', name: 'Shirt', updatedAt: 'catalogue-revision' },
};

function editHarness() {
    const pending = [];
    const state = { modal: false, loading: false, error: '', product: null, form: null, tableLoadingChanges: 0 };
    const bindings = {
        user: { id: 'manager' }, saveInFlight: { current: false }, saveRequest: { current: null },
        editRevision: { current: 0 }, editInFlight: { current: null }, categories: [],
        createEmptyVariant: () => ({ id: 'temp-new' }),
        setShowModal: value => { state.modal = value; },
        setEditLoading: value => { state.loading = value; },
        setEditError: value => { state.error = value; },
        setEditingProduct: value => { state.product = value; },
        setFormData: value => { state.form = value; },
        setLoading: () => { state.tableLoadingChanges++; },
        window: { electronAPI: { catalogue: { getProduct: (id, userId) => new Promise((resolve, reject) => pending.push({ id, userId, resolve, reject })) } } },
    };
    return {
        ...callback(productsFile, 'handleEditProduct', bindings), pending, state, bindings,
        reset: callback(productsFile, 'resetForm', bindings).run,
    };
}

test('Products Edit opens immediately without replacing catalogue rows and waits for fresh complete details', async () => {
    const h = editHarness();
    const waiting = h.run({ id: 'p', name: 'Listed Shirt' });
    assert.equal(h.state.modal, true);
    assert.equal(h.state.loading, true);
    assert.equal(h.state.product.name, 'Listed Shirt');
    assert.equal(h.state.form, null);
    assert.equal(h.state.tableLoadingChanges, 0);
    assert.equal(h.pending[0].userId, 'manager');
    h.pending[0].resolve({ success: true, data: { id: 'p', name: 'Fresh Shirt', updatedAt: 'exact-revision', variants: [variant, { ...variant, id: 'second' }] } });
    await waiting;
    assert.equal(h.state.loading, false);
    assert.equal(h.state.product.updatedAt, 'exact-revision');
    assert.equal(h.state.form.name, 'Fresh Shirt');
    assert.equal(h.state.form.variants.length, 2);
    assert.equal(h.state.form.variants[0].barcode, '0012345');
    assert.equal(h.state.tableLoadingChanges, 0);
});

test('Products Edit coalesces repeated clicks and ignores an older response while another product loads', async () => {
    const h = editHarness();
    const first = h.run({ id: 'a', name: 'A' });
    await h.run({ id: 'a', name: 'A' });
    assert.equal(h.pending.length, 1);
    const second = h.run({ id: 'b', name: 'B' });
    h.pending[0].resolve({ success: true, data: { id: 'a', name: 'Old A', variants: [variant] } });
    await first;
    assert.equal(h.state.product.id, 'b');
    assert.equal(h.state.loading, true);
    assert.equal(h.state.form, null);
    h.pending[1].resolve({ success: true, data: { id: 'b', name: 'Fresh B', variants: [variant] } });
    await second;
    assert.equal(h.state.form.name, 'Fresh B');
    assert.equal(h.state.loading, false);
});

test('Resetting Products editor invalidates late success and failure without overwriting a new draft', async () => {
    for (const fail of [false, true]) {
        const h = editHarness();
        const waiting = h.run({ id: 'p', name: 'Old edit' });
        h.reset();
        assert.equal(h.state.loading, false);
        if (fail) h.pending[0].reject(new Error('Old request failed'));
        else h.pending[0].resolve({ success: true, data: { id: 'p', name: 'Old details', variants: [variant] } });
        await waiting;
        assert.equal(h.state.form.name, '');
        assert.equal(h.state.product, null);
        assert.equal(h.state.error, '');
        assert.equal(h.state.tableLoadingChanges, 0);
    }
});

test('Products editor keeps a failed read in the modal and can retry without flashing the catalogue', async () => {
    const h = editHarness();
    const waiting = h.run({ id: 'p', name: 'Shirt' });
    h.pending[0].resolve({ success: false, error: 'Database busy' });
    await waiting;
    assert.equal(h.state.modal, true);
    assert.equal(h.state.loading, false);
    assert.match(h.state.error, /Database busy/);
    const retry = h.run(h.state.product);
    assert.equal(h.state.error, '');
    assert.equal(h.state.loading, true);
    h.pending[1].resolve({ success: true, data: { id: 'p', name: 'Shirt', variants: [variant] } });
    await retry;
    assert.equal(h.state.error, '');
    assert.equal(h.state.form.name, 'Shirt');
    assert.equal(h.state.tableLoadingChanges, 0);
});

test('Products cannot save an editor that is loading or failed to load', async () => {
    for (const status of [{ editLoading: true }, { editError: 'Read failed' }]) {
        const { run } = callback(productsFile, 'executeSaveProduct', {
            ...status, saveInFlight: { current: false },
            setSaving: () => assert.fail('Saving must not start before complete details load'),
        });
        await run();
    }
});

test('Products load handles denied/malformed responses without storing an error object as rows', async () => {
    for (const response of [{ success: false, error: 'Session expired' }, { success: true, data: {} }]) {
        let rows = [], error = '', loading = false;
        const { run } = callback(productsFile, 'loadData', {
            user: { id: 'user' }, searchQuery: '', loadRevision: { current: 0 },
            categoriesLoaded: { current: false }, hasLoadedProducts: { current: false },
            window: { electronAPI: { catalogue: { listProducts: async () => response } } },
            db: { categories: { findMany: async () => [] } },
            setProducts: value => { rows = value; }, setCategories() {},
            setLoadError: value => { error = value; }, setLoading: value => { loading = value; },
        });
        await run();
        assert.ok(Array.isArray(rows));
        assert.match(error, /Session expired|invalid response/);
        assert.equal(loading, false);
    }
});

test('Products ignores a slower old load and supplies caller identity for compatibility', async () => {
    const pending = [];
    let rows;
    const { run, context } = callback(productsFile, 'loadData', {
        user: { id: 'user' }, searchQuery: 'A', loadRevision: { current: 0 },
        categoriesLoaded: { current: false }, hasLoadedProducts: { current: false },
        window: { electronAPI: { catalogue: { listProducts: args => new Promise(resolve => pending.push({ args, resolve })) } } },
        db: { categories: { findMany: async () => [] } },
        setProducts: value => { rows = value; }, setCategories() {}, setLoadError() {}, setLoading() {},
    });
    const oldLoad = run();
    context.searchQuery = 'B';
    const newLoad = run();
    pending[1].resolve({ success: true, data: [{ id: 'B' }] });
    await newLoad;
    pending[0].resolve({ success: true, data: [{ id: 'A' }] });
    await oldLoad;
    assert.equal(rows[0].id, 'B');
    assert.equal(pending[0].args.userId, 'user');
    assert.equal(pending[0].args.summary, true);
});

test('Products reserves codes through the backend, excludes drafts and never regenerates saved codes', async () => {
    const requests = [];
    const form = { variants: [{ id: 'temp-a', barcode: '1002' }, { id: 'temp-b', barcode: '' }, variant] };
    const { run, context } = callback(productsFile, 'generateSequentialBarcode', {
        user: { id: 'user' }, formData: form, barcodeRequests: { current: new Set() },
        setGeneratingCodes() {}, showToast() {},
        setFormData: update => { context.formData = update(context.formData); },
        window: { electronAPI: { catalogue: { generateBarcode: async args => {
            requests.push(args); return { success: true, data: { barcode: '1003' } };
        } } } },
    });
    await run('temp-b');
    await run(variant.id);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].draftId, 'temp-b');
    assert.ok(requests[0].excludeCodes.includes('1002'));
    assert.ok(requests[0].excludeCodes.includes('0012345'));
    assert.equal(context.formData.variants[1].barcode, '1003');
    assert.equal(context.formData.variants[2].barcode, '0012345');
});

test('Products retries the same payload with one request ID and omits stock, activation and hidden costs', async () => {
    const payloads = [];
    const { run, context } = callback(productsFile, 'executeSaveProduct', {
        user: { id: 'manager', role: 'CASHIER', permViewCostPrice: false },
        editingProduct: null, saveInFlight: { current: false }, saveRequest: { current: null },
        formData: { name: 'Shirt', categoryId: 'shirts', taxRate: 5, hsn: '', variants: [{ ...variant, id: 'temp-a', stock: 99, isPrepared: false }] },
        toNumber: value => Number(value) || 0,
        setSaving() {}, showToast() {}, setShowModal() {}, resetForm() {}, loadData() {},
        window: { electronAPI: { catalogue: { saveProduct: async payload => {
            payloads.push(payload); return { success: false, error: 'Response lost; retry' };
        } } } },
    });
    await run(); await run();
    assert.equal(payloads[0].requestId, payloads[1].requestId);
    assert.equal(payloads[0].userId, 'manager');
    assert.equal(payloads[0].variants[0].barcodeDraftId, 'temp-a');
    for (const key of ['stock', 'isPrepared', 'costPrice']) assert.equal(key in payloads[0].variants[0], false);
    context.formData.name = 'Changed Shirt';
    await run();
    assert.notEqual(payloads[1].requestId, payloads[2].requestId);
});

test('Products omits readonly assigned codes exactly and sends explicit HSN clearing with its edit revision', async () => {
    let payload;
    const { run } = callback(productsFile, 'executeSaveProduct', {
        user: { id: 'admin', role: 'ADMIN' },
        editingProduct: variant.product, saveInFlight: { current: false }, saveRequest: { current: null },
        formData: { name: 'Shirt', categoryId: 'shirts', taxRate: 5, hsn: '', variants: [{ ...variant, sku: 'SH  001' }] },
        toNumber: value => Number(value) || 0,
        setSaving() {}, showToast() {}, setShowModal() {}, resetForm() {}, loadData() {},
        window: { electronAPI: { catalogue: { saveProduct: async value => {
            payload = value; return { success: false, error: 'Stopped before writes' };
        } } } },
    });
    await run();
    assert.equal('sku' in payload.variants[0], false);
    assert.equal('barcode' in payload.variants[0], false);
    assert.equal(payload.hsn, null);
    assert.equal(payload.updatedAt, 'catalogue-revision');
});

test('Products refuses printing drafts and callers without sticker permission', async () => {
    let reads = 0, opened = false;
    const { run, context } = callback(productsFile, 'handlePrintLabel', {
        user: { id: 'user' }, canPrintLabels: true, showToast() {},
        window: { electronAPI: { catalogue: { getProduct: async () => {
            reads++; return { success: true, data: { ...variant.product, variants: [variant] } };
        } } } },
        setSelectedVariant() {}, setSelectedProduct() {}, setShowStickerModal: value => { opened = value; },
    });
    await run({ id: 'temp-a' }, variant.product);
    assert.equal(reads, 0);
    context.canPrintLabels = false;
    await run(variant, variant.product);
    assert.equal(reads, 0);
    context.canPrintLabels = true;
    await run(variant, variant.product);
    assert.equal(reads, 1); assert.equal(opened, true);
});

function labelHarness(overrides = {}) {
    const jobs = [], notices = [];
    let reads = 0;
    const subject = callback(labelsFile, 'handlePrint', {
        quantity: 5, canPrintLabels: true, printing: { current: false }, setIsPrinting() {},
        settingsLoading: false, settingsError: '',
        config: { width: 32, height: 18, perRow: 2, gapX: 2, marginLeft: 2, marginTop: 0, contentScale: 75, rowDelayMs: 300 },
        product: variant.product, variant,
        layout: [
            { visible: true, type: 'product_name', styles: {} },
            { visible: true, type: 'product_code', styles: {} },
        ],
        shopSettings: { shopName: 'Shop' },
        formatIndianCurrency: value => `Rs.${value}`,
        createBarcodeSvgMarkup: () => '<svg />',
        db: { settings: { findUnique: async () => { reads++; return null; } } },
        showToast: (...args) => notices.push(args),
        window: { electronAPI: { print: { label: async data => { jobs.push(data); return { success: true }; } } } },
        ...overrides,
    });
    return { ...subject, jobs, notices, reads: () => reads };
}

test('Labels reject blank, fractional, nonpositive and excessive copy counts before printer access', async () => {
    for (const quantity of ['', 0, -1, 1.5, 101, Infinity]) {
        const harness = labelHarness({ quantity });
        await harness.run();
        assert.equal(harness.jobs.length, 0);
        assert.equal(harness.reads(), 0);
        assert.match(harness.notices[0][0], /whole number.*1 to 100/);
    }
});

test('Labels restore the compact product name, preserve code strings, escape HTML and print exactly five copies', async () => {
    const harness = labelHarness({ product: { ...variant.product, name: 'Shirt </title><script>bad()</script>' } });
    await harness.run();
    assert.equal(harness.jobs.length, 3);
    const html = harness.jobs.map(job => job.html).join('');
    assert.equal((html.match(/class="sticker"/g) || []).length, 5);
    assert.ok(html.includes('0012345'));
    assert.ok(html.includes('Shirt &lt;/title&gt;&lt;script&gt;bad()&lt;/script&gt;'));
    assert.equal(html.includes('Collar: Spread'), false);
    assert.equal(html.includes('Pocket: Single'), false);
    assert.equal(html.includes('white-space: normal; word-break: break-word'), false);
    assert.ok(html.includes('&lt;/title&gt;&lt;script&gt;'));
    assert.equal(html.includes('<script>bad()'), false);
    assert.equal(harness.jobs[0].expectedUpdatedAt, 'catalogue-revision');
    assert.equal(harness.jobs[0].barcode, '0012345');
    assert.equal(harness.context.printing.current, false);
    assert.equal(variant.isPrepared, false);
});

test('Labels serialize repeated clicks and stop on a truthful printer failure', async () => {
    let release, calls = 0;
    const harness = labelHarness({ window: { electronAPI: { print: { label: () => {
        calls++;
        return new Promise(resolve => { release = resolve; });
    } } } } });
    const first = harness.run();
    await new Promise(resolve => setImmediate(resolve));
    await harness.run();
    assert.equal(calls, 1);
    release({ success: false, error: 'Printer offline' });
    await first;
    assert.equal(calls, 1);
    assert.match(harness.notices[0][0], /Printer offline/);
    assert.equal(harness.context.printing.current, false);
});

test('Labels deny drafts, unauthorized printing and invalid calibration without printer access', async () => {
    for (const overrides of [
        { variant: { ...variant, id: 'temp-a' } },
        { canPrintLabels: false },
        { config: { perRow: 0 } },
        { settingsLoading: true },
        { settingsError: 'Saved layout could not load' },
    ]) {
        const harness = labelHarness(overrides);
        await harness.run();
        assert.equal(harness.jobs.length, 0);
        assert.equal(harness.reads(), 0);
    }
});

test('Labels report saved settings load failures and retry the actual loader before enabling printing', async () => {
    let loading, error, layout, config;
    const customLayout = [{ id: 'custom-name', type: 'product_name', visible: true, styles: { fontSize: 9 } }];
    let failing = true;
    const { run } = callback(labelsFile, 'loadSettings', {
        settingsLoadId: { current: 0 },
        DEFAULT_LABEL_LAYOUT: labelTemplateExports.DEFAULT_LABEL_LAYOUT,
        DEFAULT_PRINT_CONFIG: labelTemplateExports.DEFAULT_STICKER_CONFIG,
        db: { settings: { findUnique: async args => {
            if (failing) throw new Error('Settings unavailable');
            if (args.where.key === 'LABEL_LAYOUT') return { value: JSON.stringify(customLayout) };
            if (args.where.key === 'STICKER_PRINT_CONFIG') return { value: JSON.stringify({ width: 40 }) };
            return null;
        } } },
        setSettingsLoading: value => { loading = value; }, setSettingsError: value => { error = value; },
        setLayout: value => { layout = value; }, setShopSettings() {}, setConfig: value => { config = value; },
    });
    const initialLoad = run();
    assert.equal(loading, true);
    await initialLoad;
    assert.equal(loading, false);
    assert.match(error, /Settings unavailable/);
    assert.equal(layout, undefined);
    failing = false;
    await run();
    assert.equal(loading, false);
    assert.equal(error, '');
    assert.equal(layout[0].styles.fontSize, 9);
    assert.equal(config.width, 40);
    assert.equal(config.height, 18);
});

test('POS consumes enriched variants, rejects prepared selection and snapshots structured identity', async () => {
    const prepared = { ...variant, isPrepared: true };
    let loaded, item;
    const notices = [];
    const loader = callback(posFile, 'loadProducts', {
        user: { id: 'cashier' },
        window: { electronAPI: { catalogue: { listVariants: async () => ({ success: true, data: [prepared] }) } } },
        setProducts: value => { loaded = value; }, showNotification: (...args) => notices.push(args),
    });
    await loader.run();
    assert.equal(loaded[0].isPrepared, true);
    const selector = callback(posFile, 'handleProductClick', {
        user: { role: 'CASHIER', permAddItem: true },
        showNotification: (...args) => notices.push(args), addItem: value => { item = value; },
        markAsChanged() {}, barcodeInputRef: { current: { focus() {} } },
    });
    selector.run(loaded[0]);
    assert.equal(item, undefined);
    assert.match(notices[0][0], /conversion pending/);
    selector.run(variant);
    assert.ok(item.productName.includes('Oxford'));
    assert.ok(item.productName.includes('Ref: Premium'));
    assert.equal(item.variantInfo, '');
});

test('POS scanning rejects prepared codes before adding an item and keeps leading-zero strings', async () => {
    let item;
    const notices = [];
    const { run, context } = callback(posFile, 'handleBarcodeSubmit', {
        barcode: '0012345', items: [], user: { role: 'CASHIER', permAddItem: true },
        barcodeMap: new Map([['0012345', { ...variant, isPrepared: true }]]),
        showNotification: (...args) => notices.push(args), addItem: value => { item = value; },
        setBarcode() {}, markAsChanged() {}, handleCheckout() {}, barcodeInputRef: { current: { focus() {} } },
    });
    await run({ preventDefault() {} });
    assert.equal(item, undefined);
    assert.match(notices[0][0], /conversion pending/);
    context.barcodeMap.set('0012345', variant);
    await run({ preventDefault() {} });
    assert.equal(item.barcode, '0012345');
    assert.ok(item.productName.includes('Oxford'));
});

test('Replacement picker searches structured identity and blocks prepared selection', () => {
    const prepared = { ...variant, isPrepared: true };
    const search = callback('src/components/sales/ReplacementProductPicker.tsx', 'filteredProducts', {
        products: [prepared], searchQuery: 'crazy oxford premium',
    });
    assert.equal(search.run.length, 1);
    let selected = false;
    const selector = callback('src/components/sales/ReplacementProductPicker.tsx', 'handleSelect', {
        onSelectProduct: () => { selected = true; }, showToast() {},
        setSearchQuery() {}, setIsOpen() {}, setHighlightedIndex() {}, inputRef: { current: { focus() {} } },
    });
    selector.run(prepared);
    assert.equal(selected, false);
    selector.run(variant);
    assert.equal(selected, true);
});

test('Sales replacement callback separately rejects prepared variants and creates rich new snapshots', () => {
    let replacements = [];
    const selector = callback('src/pages/Sales.tsx', 'handleAddReplacementProduct', {
        showToast() {}, setExchangeNewItems: update => { replacements = update(replacements); },
    });
    selector.run({ ...variant, isPrepared: true });
    assert.equal(replacements.length, 0);
    selector.run(variant);
    assert.ok(replacements[0].productName.includes('Crazy Heart'));
    assert.ok(replacements[0].productName.includes('Oxford'));
});

test('Garment fields keep trouser and unrecognized categories out of a shirt-specific form', () => {
    assert.equal(descriptionExports.getCategoryGarmentFields('Trousers').optional.includes('collar'), false);
    assert.equal(descriptionExports.getCategoryGarmentFields('Accessories').optional.includes('sleeve'), false);
    assert.equal(descriptionExports.getCategoryGarmentFields('Shirts').optional.includes('sleeve'), true);
});
