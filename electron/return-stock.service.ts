import { getInventoryWorkspace } from './inventory-workspace.service';
import { enrichCatalogueVariants } from './catalogue.service';
import { formatVariantDescription } from '../src/lib/catalogueDescription';
import type { ReturnStockChoice, ReturnStockOptions, ReturnStockRoute } from '../src/types/returnStock';

const MAX_QUANTITY = 1_000_000_000;

function authorize(user: any) {
    if (!user?.isActive || !(user.role === 'ADMIN' || user.permEditSales)) throw new Error('Permission denied: returning items requires sale editing permission.');
}
async function trackingState(tx: any): Promise<{ ids: Set<string>; active: boolean }> {
    const exists = await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='StockVariantTracking'");
    if (!exists.length) return { ids: new Set(), active: false };
    const columns: any[] = await tx.$queryRawUnsafe('PRAGMA table_info("StockVariantTracking")');
    if (!columns.some(column => column.name === 'variantId' && Number(column.pk) === 1)
        || columns.filter(column => Number(column.pk) > 0).length !== 1
        || !columns.some(column => column.name === 'activatedAt' && Number(column.notnull) === 1)) throw new Error('Stock tracking state needs repair before returning an item.');
    const rows: any[] = await tx.$queryRawUnsafe('SELECT st."variantId", st."activatedAt", pv."id" AS "existingVariantId" FROM "StockVariantTracking" st LEFT JOIN "ProductVariant" pv ON pv.id = st.variantId');
    if (rows.some(row => typeof row.variantId !== 'string' || !row.variantId.trim() || row.variantId.length > 2000 || !row.existingVariantId
        || typeof row.activatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.activatedAt)
        || !Number.isFinite(Date.parse(row.activatedAt)) || new Date(row.activatedAt).toISOString() !== row.activatedAt)
        || new Set(rows.map(row => row.variantId)).size !== rows.length) throw new Error('Stock tracking state needs repair before returning an item.');
    return { ids: new Set(rows.map(row => row.variantId)), active: rows.length > 0 };
}
function id(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 2000 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('A valid returned item is required.');
    return value;
}

/** Read-only lookup. Candidates are explicit tracked variants in the original category. */
export async function getReturnStockOptions(prisma: any, input: { sourceVariantId: string; search?: string }, user: any): Promise<ReturnStockOptions> {
    authorize(user);
    if (input?.search !== undefined && (typeof input.search !== 'string' || input.search.length > 200 || /[\u0000-\u001f\u007f]/.test(input.search))) throw new Error('Invalid returned stock search.');
    const source = await prisma.productVariant.findUnique({ where: { id: id(input?.sourceVariantId) }, include: { product: true } });
    if (!source) throw new Error('Original returned item no longer exists.');
    const state = await trackingState(prisma), sourceTracked = state.ids.has(source.id);
    if (!state.active || sourceTracked) return { sourceTracked, requiresChoice: false, items: [] };
    const result = await getInventoryWorkspace(prisma, { scope: 'TRACKED', groupBy: 'SIZE', categoryId: source.product.categoryId, search: input.search, pageSize: 100 });
    if (!result.success) throw new Error(result.error);
    return {
        sourceTracked, requiresChoice: true,
        items: result.data.items.flatMap(group => group.variants.filter(variant => Number.isSafeInteger(variant.stock) && variant.stock >= 0 && variant.stock < MAX_QUANTITY).map(variant => ({ id: variant.id, barcode: variant.barcode, name: variant.name,
            description: formatVariantDescription(variant.name, { ...variant.attributes, size: variant.size }), stock: variant.stock }))),
    };
}

/** The financial source remains unchanged. This resolves exactly one physical stock destination. */
export async function resolveReturnStockRoutes(tx: any, entries: Array<{ sourceVariantId: string; quantity: number; choice?: ReturnStockChoice }>, user: any): Promise<Map<string, ReturnStockRoute>> {
    authorize(user);
    if (!Array.isArray(entries) || !entries.length || entries.length > 1000) throw new Error('Select between 1 and 1,000 returned items.');
    const state = await trackingState(tx), routes = new Map<string, ReturnStockRoute>();
    const targets = new Map<string, { stock: number; quantity: number; tracked: boolean }>();
    for (const entry of entries) {
        const sourceId = id(entry?.sourceVariantId);
        if (routes.has(sourceId) || !Number.isSafeInteger(entry.quantity) || entry.quantity <= 0 || entry.quantity > MAX_QUANTITY) throw new Error('Returned stock quantities must be positive whole pieces without duplicate items.');
        const rawSource = await tx.productVariant.findUnique({ where: { id: sourceId }, include: { product: true } });
        if (!rawSource) throw new Error('Original returned item no longer exists.');
        const [source] = await enrichCatalogueVariants(tx, [rawSource]);
        const choice = entry.choice;
        if (!choice && state.active && !state.ids.has(sourceId)) throw new Error('Identify the returned garment: choose its new barcode, keep its old label, or hold it outside saleable stock.');
        if (choice && (choice.confirmed !== true || !['ORIGINAL', 'TRACKED', 'HOLD'].includes(choice.disposition))) throw new Error('Confirm the physical stock destination for the returned garment.');
        const disposition = choice?.disposition ?? 'ORIGINAL';
        let targetVariantId: string | null = sourceId, reason: string | null = null, targetStock = source.stock;
        if (disposition === 'HOLD') {
            targetVariantId = null;
            if (typeof choice?.reason !== 'string' || !choice.reason.trim() || choice.reason.length > 500 || /[\u0000-\u001f\u007f]/.test(choice.reason)) throw new Error('Explain why the returned item is held outside saleable stock.');
            reason = choice.reason.trim();
        } else if (disposition === 'TRACKED') {
            const targetId = id(choice?.targetVariantId);
            if (state.ids.has(sourceId) && targetId !== sourceId) throw new Error('A tracked return belongs to its original stock variant. Hold damaged or unidentified pieces separately.');
            const rawTarget = await tx.productVariant.findUnique({ where: { id: targetId }, include: { product: true } });
            const [target] = rawTarget ? await enrichCatalogueVariants(tx, [rawTarget]) : [];
            if (!target || !state.ids.has(targetId) || target.isPrepared || !target.isActive || !target.product?.isActive || target.product.categoryId !== source.product.categoryId) throw new Error('Choose an active tracked item in the original garment category.');
            targetVariantId = targetId;
            targetStock = target.stock;
        } else if (source.isPrepared || !source.isActive || !source.product?.isActive) {
            throw new Error('The original barcode is inactive or prepared. Identify a tracked item or hold the return.');
        }
        if (targetVariantId) {
            const previous = targets.get(targetVariantId), tracked = state.ids.has(targetVariantId);
            const combined = (previous?.quantity ?? 0) + entry.quantity;
            const minimum = tracked ? 0 : -2_147_483_648, maximum = tracked ? MAX_QUANTITY : 2_147_483_647;
            if (!Number.isSafeInteger(targetStock) || targetStock < minimum || targetStock > maximum
                || !Number.isSafeInteger(targetStock + combined) || targetStock + combined > maximum) throw new Error('Returned stock balance is invalid or would exceed its supported limit. Repair or hold the item before restocking.');
            targets.set(targetVariantId, { stock: targetStock, quantity: combined, tracked });
        }
        routes.set(sourceId, { sourceVariantId: sourceId, targetVariantId, quantity: entry.quantity, disposition, reason });
    }
    return routes;
}

/** Written inside the same transaction as the refund/exchange and its single restock. */
export async function recordReturnStockRoutes(tx: any, routes: Map<string, ReturnStockRoute>, reference: string, kind: 'REFUND' | 'EXCHANGE', user: any, now: Date) {
    authorize(user);
    id(reference);
    if (!['REFUND', 'EXCHANGE'].includes(kind) || !routes || typeof routes.values !== 'function' || routes.size < 1 || routes.size > 1000
        || !now || !Number.isFinite(now.getTime())) throw new Error('Invalid return stock audit details.');
    for (const route of routes.values()) await tx.auditLog.create({ data: {
        action: 'RETURN_STOCK_ROUTE', userId: user.id, createdAt: now,
        details: JSON.stringify({ kind, reference, ...route }),
    } });
}
