import crypto from 'crypto';
import { authorizeInventory } from './stock-draft.service';
import { defaultAuditCategory, DEFAULT_AUDIT_CATEGORIES } from '../src/types/stockAuditSetup';
import type { StockAuditSetup, SaveAuditSetupInput } from '../src/types/stockAuditSetup';

const clean = (value: unknown, limit = 100): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Enter valid setup text.');
    return value.trim().replace(/\s+/g, ' ');
};
const list = (value: unknown, max = 200): string[] => {
    if (!Array.isArray(value) || value.length > max) throw new Error('Too many setup options.');
    const result = value.map(item => clean(item));
    if (new Set(result.map(item => item.toLowerCase())).size !== result.length) throw new Error('Setup options must not repeat.');
    return result;
};
const builtin = new Set(['brand', 'fabric', 'quality', 'pattern', 'sleeve', 'fit', 'collar', 'pocket', 'styleRef', 'color', 'subtype', 'border', 'design', 'style', 'material', 'length', 'waist', 'packSize', 'gender', 'ageGroup', 'model', 'unit', 'productCode']);
export const isAuditAttributeKey = (key: string) => builtin.has(key) || /^custom_[a-z][a-z0-9_]{0,63}$/.test(key);
function validate(categories: SaveAuditSetupInput['categories']) {
    if (!Array.isArray(categories) || !categories.length || categories.length > 100) throw new Error('Keep between 1 and 100 categories.');
    const names = new Set();
    return categories.map(category => {
        const name = clean(category.name);
        if (names.has(name.toLowerCase())) throw new Error('Category names must not repeat.'); names.add(name.toLowerCase());
        if (!Array.isArray(category.groups) || category.groups.length > 40 || !Array.isArray(category.scales) || category.scales.length > 20) throw new Error('Too many attribute types or size scales.');
        const keys = new Set(), labels = new Set();
        const groups = category.groups.map(group => {
            const key = clean(group.key), label = clean(group.label);
            if (!isAuditAttributeKey(key) || key === 'brand' || keys.has(key) || labels.has(label.toLowerCase())) throw new Error('Attribute types need distinct valid keys and labels.');
            keys.add(key); labels.add(label.toLowerCase());
            return { key, label, options: list(group.options) };
        });
        const scales = category.scales.map(scale => ({ name: clean(scale.name), sizes: list(scale.sizes, 100) }));
        if (new Set(scales.map(scale => scale.name.toLowerCase())).size !== scales.length || scales.some(scale => !scale.sizes.length)) throw new Error('Each size scale needs a unique name and at least one size.');
        return { name, brands: list(category.brands, 500), groups, scales };
    });
}
async function exists(tx: any, name: string) { return (await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name=?", name)).length > 0; }
export async function getStockAuditSetup(prisma: any, user: any): Promise<StockAuditSetup> {
    authorizeInventory(user);
    return prisma.$transaction(async (tx: any) => {
        let setup: StockAuditSetup;
        const saved = await exists(tx, 'StockAuditSetup') ? await tx.$queryRawUnsafe('SELECT * FROM "StockAuditSetup" WHERE id=1') : [];
        if (saved.length) setup = { revision: saved[0].revision, categories: validate(JSON.parse(saved[0].json)) };
        else setup = { revision: 0, categories: DEFAULT_AUDIT_CATEGORIES.map(defaultAuditCategory) };
        // Existing catalogue categories and attribute values remain available as suggestions.
        const categories = await tx.category.findMany({ select: { name: true } });
        for (const category of categories) if (!setup.categories.some(item => item.name.toLowerCase() === category.name.trim().toLowerCase())) setup.categories.push(defaultAuditCategory(category.name));
        if (await exists(tx, 'ProductVariantGarmentDetail')) {
            const rows = await tx.$queryRawUnsafe('SELECT gd.*, pv.mrp, pv.stock, c.name AS categoryName FROM "ProductVariantGarmentDetail" gd JOIN "ProductVariant" pv ON pv.id=gd.variantId JOIN "Product" p ON p.id=pv.productId JOIN "Category" c ON c.id=p.categoryId WHERE pv.isActive=1 AND p.isActive=1 LIMIT 20001');
            if (rows.length > 20000) throw new Error('Catalogue is too large to load audit suggestions.');
            for (const row of rows) {
                const category = setup.categories.find(item => item.name.toLowerCase() === row.categoryName.trim().toLowerCase());
                if (!category) continue;
                category.popularPrices ||= [];
                if (row.stock > 0 && row.mrp > 0) {
                    const existingPrice = category.popularPrices.find(item => item.price === row.mrp);
                    if (existingPrice) existingPrice.pieces += row.stock;
                    else category.popularPrices.push({ price: row.mrp, pieces: row.stock });
                }
                const add = (values: string[], value: unknown) => { if (typeof value === 'string' && value.trim() && value.length <= 100 && !values.some(item => item.toLowerCase() === value.trim().toLowerCase()) && values.length < 200) values.push(value.trim()); };
                add(category.brands, row.brand);
                let metadata: any = {}; try { metadata = JSON.parse(row.metadata || '{}'); } catch { /* Suggestions never repair item data. */ }
                for (const group of category.groups) add(group.options, row[group.key] || metadata[group.key]);
            }
            for (const category of setup.categories) category.popularPrices = category.popularPrices?.sort((a, b) => b.pieces - a.pieces || a.price - b.price).slice(0, 8);
        }
        return setup;
    });
}
export async function saveStockAuditSetup(prisma: any, input: SaveAuditSetupInput, user: any): Promise<StockAuditSetup> {
    authorizeInventory(user);
    const operationId = clean(input?.operationId), categories = validate(input?.categories);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error('Reload setup before saving.');
    const json = JSON.stringify(categories), hash = crypto.createHash('sha256').update(JSON.stringify({ json, revision: input.expectedRevision })).digest('hex');
    await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "StockAuditSetup" (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, json TEXT NOT NULL)');
    await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "StockAuditSetupOperation" (id TEXT PRIMARY KEY, userId TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL)');
    return prisma.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe('INSERT OR IGNORE INTO "StockAuditSetup" (id,revision,json) VALUES (1,0,?)', JSON.stringify(DEFAULT_AUDIT_CATEGORIES.map(defaultAuditCategory)));
        await tx.$executeRawUnsafe('UPDATE "StockAuditSetup" SET revision=revision WHERE id=1');
        const previous = await tx.$queryRawUnsafe('SELECT * FROM "StockAuditSetupOperation" WHERE id=?', operationId);
        if (previous.length) {
            if (previous[0].userId !== user.id || previous[0].hash !== hash) throw new Error('Setup request was already used for another change.');
            return JSON.parse(previous[0].result);
        }
        const changed = await tx.$executeRawUnsafe('UPDATE "StockAuditSetup" SET revision=revision+1,json=? WHERE id=1 AND revision=?', json, input.expectedRevision);
        if (changed !== 1) throw new Error('Setup changed in another window. Reload before saving.');
        const existing = await tx.category.findMany({ select: { name: true } });
        for (const category of categories) if (!existing.some((item: any) => item.name.trim().toLowerCase() === category.name.toLowerCase())) {
            await tx.category.create({ data: { name: category.name } }); existing.push({ name: category.name });
        }
        const result = { revision: input.expectedRevision + 1, categories };
        await tx.$executeRawUnsafe('INSERT INTO "StockAuditSetupOperation" (id,userId,hash,result) VALUES (?,?,?,?)', operationId, user.id, hash, JSON.stringify(result));
        await tx.auditLog.create({ data: { userId: user.id, action: 'STOCK_AUDIT_SETUP_CHANGED', details: JSON.stringify({ revision: result.revision, categories: categories.length }) } });
        return result;
    });
}
