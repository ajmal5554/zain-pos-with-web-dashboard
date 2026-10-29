const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), modules = new Map();
function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const exports = {}; modules.set(relative, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, relative + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText,
        { module: { exports }, exports, require: name => name.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), name))) : require(name) });
    return exports;
}
const template = load('src/lib/labelTemplate');
const copy = value => JSON.parse(JSON.stringify(value));
function designerCallback(name, bindings) {
    const file = 'src/components/settings/LabelDesigner.tsx';
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let initializer;
    const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer; ts.forEachChild(node, visit); }; visit(ast);
    assert.ok(initializer);
    const context = vm.createContext({ ...template, ...bindings });
    vm.runInContext(ts.transpileModule('globalThis.run = ' + initializer.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, context);
    return context.run;
}

test('designer loads the saved calibration and restores only the missing code; failed reads block replacement', async () => {
    const state = {}, baseline = { current: {} }, requestId = { current: 0 };
    const old = JSON.stringify(copy(template.DEFAULT_LABEL_LAYOUT).filter(block => block.type !== 'product_code'));
    let failing = false;
    const run = designerCallback('loadLayout', { requestId, user: { id: 'owner' }, baseline,
        setLoading: value => { state.loading = value; }, setLoadError: value => { state.error = value; }, setBlocks: value => { state.blocks = value; }, setStickConfig: value => { state.config = value; }, setShopDetails() {}, setSelectedId() {},
        window: { electronAPI: { settings: { get: async ({ key }) => failing ? { success: false, error: 'Read unavailable' } : { success: true, data: key === 'LABEL_LAYOUT' ? old : key === 'STICKER_PRINT_CONFIG' ? JSON.stringify({ width: 40, height: 26, contentScale: 70 }) : null } } } },
    });
    await run(); assert.equal(state.blocks[3].type, 'product_code'); assert.equal(state.config.width, 40); assert.equal(state.config.contentScale, 70); assert.equal(baseline.current.expectedLayout, old);
    const blocks = state.blocks; failing = true; await run(); assert.match(state.error, /Read unavailable/); assert.equal(state.blocks, blocks); assert.equal(state.loading, false);
});

test('designer saves both values through the atomic endpoint and does not save during failed loading', async () => {
    const calls = [], notices = [], baseline = { current: { expectedLayout: 'old-layout', expectedConfig: 'old-config' } };
    const bindings = { allowed: true, loading: false, loadError: '', savingRef: { current: false }, blocks: copy(template.DEFAULT_LABEL_LAYOUT), stickConfig: copy(template.DEFAULT_STICKER_CONFIG), baseline, setSaving() {}, showToast: (...args) => notices.push(args),
        window: { electronAPI: { settings: { saveLabelTemplate: async input => { calls.push(input); return { success: true, data: { layoutValue: 'new-layout', configValue: 'new-config' } }; } } } } };
    await designerCallback('handleSave', bindings)();
    assert.equal(calls.length, 1); assert.equal(calls[0].blocks[3].type, 'product_code'); assert.equal(calls[0].expectedConfig, 'old-config'); assert.equal(baseline.current.expectedLayout, 'new-layout');
    await designerCallback('handleSave', { ...bindings, loadError: 'Could not read settings' })(); assert.equal(calls.length, 1); assert.equal(notices[0][1], 'success');
});

test('the original code block is restored beneath the barcode without changing saved typography or calibration', () => {
    const original = copy(template.DEFAULT_LABEL_LAYOUT); original[2].styles.height = 45;
    const four = original.filter(block => block.type !== 'product_code');
    const restored = template.restoreLegacyLabelCode(four);
    assert.equal(restored[3].type, 'product_code'); assert.equal(restored[2].type, 'barcode');
    assert.equal(restored[2].styles.height, 45); assert.equal(four.length, 4);
    const oldLiteral = copy(original); oldLiteral[3].type = 'text'; oldLiteral[3].content = '4649350';
    const migrated = template.restoreLegacyLabelCode(oldLiteral);
    assert.equal(migrated[3].type, 'product_code'); assert.equal(migrated[3].content, undefined);
    const custom = [{ id: 'custom', type: 'text', content: 'My label', visible: true, styles: { fontSize: 9 } }];
    assert.equal(template.restoreLegacyLabelCode(custom)[0].content, 'My label');
    assert.equal(template.validateStickerConfig({ width: 40, height: 26, contentScale: 70 }).width, 40);
});

test('invalid template imports and calibration are rejected, and overflowing content is detectable', () => {
    for (const bad of [[], [{ ...copy(template.DEFAULT_LABEL_LAYOUT[0]), type: 'script' }], [copy(template.DEFAULT_LABEL_LAYOUT[0]), copy(template.DEFAULT_LABEL_LAYOUT[0])], [{ ...copy(template.DEFAULT_LABEL_LAYOUT[0]), styles: { fontSize: NaN } }]]) assert.throws(() => template.validateLabelLayout(bad));
    for (const bad of [{ width: 0 }, { height: -1 }, { perRow: 1.5 }, { gapX: -2 }, { contentScale: Infinity }]) assert.throws(() => template.validateStickerConfig(bad));
    const config = copy(template.DEFAULT_STICKER_CONFIG);
    assert.equal(template.labelOverflow(template.DEFAULT_LABEL_LAYOUT, config), true);
    const fit = Math.floor((config.height - 2) * 96 / 25.4 / template.labelContentHeight(template.DEFAULT_LABEL_LAYOUT) * 100);
    assert.equal(template.labelOverflow(template.DEFAULT_LABEL_LAYOUT, { ...config, contentScale: fit }), false);
});

test('layout and calibration save atomically, replay safely and reject stale or unauthorized writes', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zain-label-template-'));
    const { PrismaClient } = require(path.join(root, 'prisma/generated/client'));
    const db = new PrismaClient({ datasources: { db: { url: 'file:' + path.join(directory, 'labels.db').replaceAll('\\', '/') } } });
    try {
        const sql = execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'prisma/generated/client/schema.prisma'), '--script'], { encoding: 'utf8', cwd: root });
        for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
        const user = await db.user.create({ data: { username: 'label-test-owner', password: 'fixture-only', name: 'Test', role: 'ADMIN', isActive: true } });
        const service = load('electron/label-template.service');
        const input = { blocks: copy(template.DEFAULT_LABEL_LAYOUT), config: copy(template.DEFAULT_STICKER_CONFIG), expectedLayout: null, expectedConfig: null };
        const broken = { $transaction: run => db.$transaction(tx => run({ $executeRawUnsafe: tx.$executeRawUnsafe.bind(tx), setting: { findUnique: tx.setting.findUnique.bind(tx.setting), upsert: args => args.where.key === 'STICKER_PRINT_CONFIG' ? Promise.reject(new Error('Injected config failure')) : tx.setting.upsert(args) }, auditLog: tx.auditLog })) };
        await assert.rejects(service.saveLabelTemplate(broken, input, user), /Injected/);
        assert.equal(await db.setting.count(), 0);
        const result = await service.saveLabelTemplate(db, input, user);
        assert.equal((await service.saveLabelTemplate(db, input, user)).layoutValue, result.layoutValue);
        assert.equal(await db.auditLog.count(), 1);
        assert.equal(JSON.parse(result.layoutValue)[3].type, 'product_code');
        await db.setting.update({ where: { key: 'STICKER_PRINT_CONFIG' }, data: { value: JSON.stringify({ ...input.config, width: 40 }) } });
        await assert.rejects(service.saveLabelTemplate(db, input, user), /another window/);
        await assert.rejects(service.saveLabelTemplate(db, input, { ...user, role: 'CASHIER', permEditSettings: false }), /Permission denied/);
    } finally {
        await db.$disconnect();
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('zain-label-template-'));
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
