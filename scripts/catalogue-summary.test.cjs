const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'electron/catalogue.service.ts');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'listProducts');
assert.ok(declaration, 'catalogue.service.ts must export listProducts');

const functionText = declaration.getText(source).replace(/^export\s+/, '');
const compiled = ts.transpileModule(`globalThis.subject = ${functionText};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function harness(products) {
    const calls = [];
    const context = vm.createContext({
        ensureCatalogueSchema: async () => { calls.push(['ensure']); },
        enrichCatalogueVariants: async (_prisma, variants, user) => {
            calls.push(['enrich', variants.length, user?.id]);
            return variants.map(variant => ({ ...variant, formattedDescription: `${variant.product.name} ${variant.size || ''}`.trim(), isPrepared: false }));
        },
        console,
    });
    vm.runInContext(compiled, context);

    const prisma = {
        product: {
            findMany: async args => {
                calls.push(['findMany', args]);
                return products;
            },
        },
        $queryRawUnsafe: async (sql, ...parameters) => {
            calls.push(['sql', sql, parameters]);
            if (sql.includes('COUNT(*)')) {
                return products.map(product => ({ productId: product.id, variantCount: product.variantCount, totalStock: product.dbStock }));
            }
            return products.filter(product => product.dbPrepared).map(product => ({ productId: product.id, hasPreparedVariant: 1 }));
        },
    };
    return { run: context.subject, prisma, calls };
}

test('Products summary fetches one display variant and returns aggregate stock and preparation state', async () => {
    const products = [{
        id: 'p1', name: 'Crazy Heart Checks', category: { name: 'Shirts' }, categoryId: 'shirts', taxRate: 5,
        variantCount: 3, dbStock: 14, dbPrepared: true,
        variants: [{ id: 'v1', productId: 'p1', barcode: '001234', sku: 'sku-1', size: 'L', mrp: 700, sellingPrice: 650, stock: 4, isActive: true }],
    }];
    const h = harness(products);
    const result = await h.run(h.prisma, { summary: true, where: { isActive: true } }, { id: 'manager' });

    assert.equal(result.length, 1);
    assert.equal(result[0].variants.length, 1);
    assert.equal(result[0].variants[0].barcode, '001234');
    assert.equal(result[0].variantCount, 3);
    assert.equal(result[0].totalStock, 14);
    assert.equal(result[0].hasPreparedVariant, true);
    const find = h.calls.find(call => call[0] === 'findMany')[1];
    assert.equal(find.include.variants.take, 1);
    assert.equal(find.include.variants.select.costPrice, undefined);
    assert.equal(h.calls.filter(call => call[0] === 'sql').length, 2);
    assert.deepEqual(h.calls.find(call => call[0] === 'enrich').slice(1), [1, 'manager']);
});

test('Products summary returns an empty result without running aggregate queries for an empty catalogue', async () => {
    const h = harness([]);
    const result = await h.run(h.prisma, { summary: true }, { id: 'manager' });

    assert.equal(result.length, 0);
    assert.equal(h.calls.filter(call => call[0] === 'sql').length, 0);
    assert.equal(h.calls.some(call => call[0] === 'enrich'), false);
});

test('normal catalogue calls still return all variants for the product editor', async () => {
    const product = {
        id: 'p1', name: 'Shirt', category: { name: 'Shirts' }, variants: [
            { id: 'v1', productId: 'p1', barcode: '001234', size: 'M' },
            { id: 'v2', productId: 'p1', barcode: '005678', size: 'L' },
        ],
    };
    const h = harness([product]);
    const result = await h.run(h.prisma, {}, { id: 'manager' });

    assert.equal(result[0].variants.length, 2);
    assert.equal(result[0].variants[1].barcode, '005678');
    const find = h.calls.find(call => call[0] === 'findMany')[1];
    assert.equal(find.include.variants, true);
    assert.equal(h.calls.some(call => call[0] === 'sql'), false);
});
