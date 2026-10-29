import { enrichCatalogueVariants } from './catalogue.service';
import type {
    InventoryGroup, InventoryQuery, InventoryScope, InventoryVariant, InventoryWorkspaceResponse,
} from '../src/types/inventoryWorkspace';

const MAX_VARIANTS = 20_000;
const MAX_FACETS = 200;
const ATTRIBUTES = [
    'brand', 'fabric', 'quality', 'pattern', 'sleeve', 'fit', 'collar', 'pocket', 'styleRef',
    'color', 'subtype', 'border', 'design', 'style', 'material', 'length', 'waist', 'packSize',
    'gender', 'ageGroup', 'model', 'unit', 'productCode', 'batchName',
] as const;
const SCOPES = new Set(['TRACKED', 'PREPARED', 'LEGACY']);
const GROUPINGS = new Set(['STYLE', 'SIZE']);
const BALANCES = new Set(['ALL', 'POSITIVE', 'ZERO', 'NEGATIVE']);
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN');
const compare = (left: string, right: string) => left.localeCompare(right, 'en-IN', { numeric: true, sensitivity: 'base' })
    || left.localeCompare(right, 'en-IN');

function text(value: unknown, required = false): string | null {
    if (value === null || value === undefined) {
        if (required) throw new Error('Invalid inventory identity.');
        return null;
    }
    if (typeof value !== 'string' || value.length > 2_000 || /[\u0000-\u001f]/.test(value)) throw new Error('Invalid inventory text.');
    const result = value.trim().replace(/\s+/g, ' ');
    if (required && !result) throw new Error('Invalid inventory identity.');
    return result || null;
}

function numeric(value: unknown, integer: boolean, allowNegative = false): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || integer && !Number.isSafeInteger(value)
        || !allowNegative && value < 0) throw new Error('Invalid inventory number.');
    return value;
}

function identity(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 2_000 || /[\u0000-\u001f]/.test(value)) {
        throw new Error('Invalid inventory identity.');
    }
    // IDs and scannable codes must not be rewritten by human-label normalization.
    return value;
}

function filterValue(value: unknown): string | null {
    if (value === undefined || value === null || value === '' || value === 'ALL') return null;
    if (typeof value !== 'string' || value.length > 512) throw new Error('Invalid inventory filter.');
    return value.trim() || null;
}

function facetValues(values: Array<string | null>): string[] {
    const unique = new Map<string, string>();
    for (const value of values) if (value && !unique.has(normalized(value))) unique.set(normalized(value), value);
    return [...unique.values()].sort(compare).slice(0, MAX_FACETS);
}

async function trackedIds(tx: any, ids: string[]): Promise<Set<string>> {
    const tables: any[] = await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", 'StockVariantTracking');
    if (!tables.length) return new Set();
    const columns: any[] = await tx.$queryRawUnsafe('PRAGMA table_info("StockVariantTracking")');
    if (!columns.some(column => column.name === 'variantId' && Number(column.pk) === 1)
        || !columns.some(column => column.name === 'activatedAt')) throw new Error('Tracking state is incomplete.');
    const result = new Set<string>();
    for (let index = 0; index < ids.length; index += 200) {
        const batch = ids.slice(index, index + 200);
        const records: any[] = await tx.$queryRawUnsafe('SELECT "variantId", "activatedAt" FROM "StockVariantTracking" WHERE "variantId" IN ('
            + batch.map(() => '?').join(',') + ')', ...batch);
        for (const record of records) {
            if (typeof record.variantId !== 'string' || result.has(record.variantId)
                || !record.activatedAt || !Number.isFinite(new Date(record.activatedAt).getTime())) {
                throw new Error('Tracking state is invalid.');
            }
            result.add(record.variantId);
        }
    }
    return result;
}

function publicVariant(variant: any, tracked: Set<string>): InventoryVariant {
    const product = variant.product;
    const metadata = variant.metadata && typeof variant.metadata === 'object' && !Array.isArray(variant.metadata)
        ? variant.metadata : {};
    const attributes: Record<string, string | null> = {};
    for (const key of ATTRIBUTES) {
        let value = variant[key];
        if (value === undefined || value === null || value === '') value = metadata[key];
        if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') value = String(value);
        if (typeof value === 'string') attributes[key] = text(value);
    }
    for (const [key, value] of Object.entries(metadata)) {
        if (/^custom_[a-z][a-z0-9_]{0,63}$/.test(key) && typeof value === 'string') attributes[key] = text(value);
    }
    const updatedAt = new Date(variant.updatedAt);
    if (!Number.isFinite(updatedAt.getTime())) throw new Error('Invalid inventory date.');
    return {
        id: identity(variant.id), productId: identity(product?.id), name: text(product?.name, true)!,
        categoryId: identity(product?.category?.id), category: text(product?.category?.name, true)!,
        sku: identity(variant.sku), barcode: identity(variant.barcode), size: text(variant.size),
        stock: numeric(variant.stock, true, true), minStock: numeric(variant.minStock, true),
        mrp: numeric(variant.mrp, false), sellingPrice: numeric(variant.sellingPrice, false),
        scope: variant.isPrepared ? 'PREPARED' : tracked.has(variant.id) ? 'TRACKED' : 'LEGACY',
        updatedAt: updatedAt.toISOString(), attributes,
        ...(metadata.attributeLabels && typeof metadata.attributeLabels === 'object' && !Array.isArray(metadata.attributeLabels)
            ? { attributeLabels: Object.fromEntries(Object.entries(metadata.attributeLabels).filter(([key, value]) => key in attributes && typeof value === 'string' && value.length <= 100).map(([key, value]) => [key, text(value)!])) } : {}),
    };
}

/** Read-only inventory workspace. No migration, stock edit, or activation occurs here. */
export async function getInventoryWorkspace(prisma: any, args: InventoryQuery = {}): Promise<
    { success: true; data: InventoryWorkspaceResponse } | { success: false; error: string }
> {
    try {
        const scope = args.scope ?? 'TRACKED';
        const groupBy = args.groupBy ?? 'STYLE';
        const balance = args.balanceFilter ?? 'ALL';
        if (!SCOPES.has(scope) || !GROUPINGS.has(groupBy) || !BALANCES.has(balance)) throw new Error('Invalid inventory query.');
        const pageSize = Math.max(1, Math.min(100, Math.floor(Number(args.pageSize) || 25)));
        const requestedPage = Math.max(1, Math.floor(Number(args.page) || 1));
        const filters = {
            categoryId: filterValue(args.categoryId), brand: filterValue(args.brand), size: filterValue(args.size),
            fabric: filterValue(args.fabric), pattern: filterValue(args.pattern), quality: filterValue(args.quality),
        };
        const search = filterValue(args.search)?.slice(0, 200) ?? '';
        const attributeFilters: Record<string, string> = {};
        if (args.attributes !== undefined) {
            if (!args.attributes || typeof args.attributes !== 'object' || Array.isArray(args.attributes) || Object.keys(args.attributes).length > 40) throw new Error('Invalid attribute filters.');
            for (const [key, value] of Object.entries(args.attributes)) {
                if (!(ATTRIBUTES as readonly string[]).includes(key) && !/^custom_[a-z][a-z0-9_]{0,63}$/.test(key)) throw new Error('Invalid attribute filter.');
                const selected = filterValue(value); if (selected) attributeFilters[key] = selected;
            }
        }
        const tokens = normalized(search).split(/\s+/).filter(Boolean);
        const allRows: InventoryVariant[] = await prisma.$transaction(async (tx: any) => {
            const variants: any[] = await tx.productVariant.findMany({
                where: { isActive: true, product: { isActive: true } },
                select: {
                    id: true, sku: true, barcode: true, size: true, color: true, stock: true, minStock: true,
                    mrp: true, sellingPrice: true, updatedAt: true,
                    product: { select: { id: true, name: true, category: { select: { id: true, name: true } } } },
                },
                orderBy: [{ product: { name: 'asc' } }, { id: 'asc' }], take: MAX_VARIANTS + 1,
            });
            if (variants.length > MAX_VARIANTS) throw new Error('Inventory workspace limit reached.');
            const enriched = await enrichCatalogueVariants(tx, variants, { isActive: true, permViewCostPrice: false });
            const tracked = await trackedIds(tx, variants.map(variant => variant.id));
            return enriched.map((variant: any) => publicVariant(variant, tracked));
        });
        const scopedRows = allRows.filter(row => row.scope === scope);
        const categories = new Map<string, string>();
        for (const row of scopedRows) categories.set(row.categoryId, row.category);
        const facets = {
            categories: [...categories].map(([id, name]) => ({ id, name })).sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id)).slice(0, MAX_FACETS),
            brands: facetValues(scopedRows.map(row => row.attributes.brand ?? null)),
            sizes: facetValues(scopedRows.map(row => row.size)),
            fabrics: facetValues(scopedRows.map(row => row.attributes.fabric ?? null)),
            patterns: facetValues(scopedRows.map(row => row.attributes.pattern ?? null)),
            qualities: facetValues(scopedRows.map(row => row.attributes.quality ?? null)),
            attributes: [...new Set(scopedRows.flatMap(row => Object.keys(row.attributes)))].filter(key => !['brand', 'fabric', 'pattern', 'quality', 'batchName'].includes(key))
                .sort().map(key => ({ key, values: facetValues(scopedRows.map(row => row.attributes[key] || null)) })).filter(item => item.values.length > 0),
        };
        const rows = scopedRows.filter(row => {
            if (Object.entries(attributeFilters).some(([key, value]) => normalized(row.attributes[key] || '') !== normalized(value))) return false;
            if (filters.categoryId && row.categoryId !== filters.categoryId) return false;
            if (filters.size && normalized(row.size ?? '') !== normalized(filters.size)) return false;
            for (const key of ['brand', 'fabric', 'pattern', 'quality'] as const) {
                if (filters[key] && normalized(row.attributes[key] ?? '') !== normalized(filters[key]!)) return false;
            }
            if (balance === 'POSITIVE' && row.stock <= 0 || balance === 'ZERO' && row.stock !== 0 || balance === 'NEGATIVE' && row.stock >= 0) return false;
            const haystack = normalized([row.id, row.productId, row.name, row.category, row.sku, row.barcode, row.size ?? '',
                String(row.mrp), String(row.sellingPrice), ...Object.values(row.attributes).filter((value): value is string => value !== null)].join(' '));
            return tokens.every(token => haystack.includes(token));
        }).sort((left, right) => compare(left.name, right.name) || compare(left.productId, right.productId)
            || compare(left.size ?? '', right.size ?? '') || compare(left.sku, right.sku) || compare(left.id, right.id));
        const groups = new Map<string, InventoryGroup>();
        for (const row of rows) {
            const id = groupBy === 'STYLE' ? row.productId : row.id;
            let group = groups.get(id);
            if (!group) {
                group = { id, name: row.name, category: row.category, variants: [], quantity: 0, mrpValue: scope === 'TRACKED' ? 0 : null };
                groups.set(id, group);
            }
            group.variants.push(row);
            group.quantity += row.stock;
            if (group.mrpValue !== null) group.mrpValue += row.stock * row.mrp;
        }
        const allGroups = [...groups.values()];
        for (const group of allGroups) if (group.mrpValue !== null) group.mrpValue = Math.round(group.mrpValue * 100) / 100;
        const totalPages = Math.max(1, Math.ceil(allGroups.length / pageSize));
        const page = Math.min(requestedPage, totalPages);
        const totalValue = scope === 'TRACKED' ? rows.reduce((sum, row) => sum + row.stock * row.mrp, 0) : null;
        return {
            success: true,
            data: {
                scope, groupBy, items: allGroups.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalPages,
                totalMatching: allGroups.length,
                stats: {
                    styleCount: new Set(rows.map(row => row.productId)).size, variantCount: rows.length,
                    quantity: rows.reduce((sum, row) => sum + row.stock, 0),
                    mrpValue: totalValue === null ? null : Math.round(totalValue * 100) / 100,
                    categoryCount: new Set(rows.map(row => row.categoryId)).size,
                }, facets,
            },
        };
    } catch {
        return { success: false, error: 'Inventory could not be loaded completely. Check the catalogue and stock tracking records, then try again.' };
    }
}
