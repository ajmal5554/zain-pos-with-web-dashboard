export interface TrackedStockChange { variantId: string; quantity: number; }

export class TrackedStockError extends Error {
    readonly code: 'INVALID_QUANTITY' | 'STOCK_UNAVAILABLE' | 'INSUFFICIENT_STOCK';
    constructor(code: TrackedStockError['code'], message: string) {
        super(message);
        this.name = 'TrackedStockError';
        this.code = code;
    }
}

const unavailable = () => new TrackedStockError('STOCK_UNAVAILABLE', 'Tracked stock could not be verified. Please retry the sale after checking stock.');

/** Must run inside the same write transaction as the eventual stock mutations.
 * Positive quantities consume stock; negatives represent valid returns/restocks.
 * Only explicitly activated variants are limited. Legacy balances remain unchanged. */
export async function assertTrackedStockAvailable(tx: any, changes: TrackedStockChange[]): Promise<void> {
    try {
        if (!Array.isArray(changes) || changes.length > 5_000) throw new TrackedStockError('INVALID_QUANTITY', 'Sale quantities must be whole numbers.');
        const outgoing = new Map<string, number>();
        for (const change of changes) {
            if (!change || typeof change.variantId !== 'string' || !change.variantId.trim()
                || change.variantId.length > 256 || !Number.isSafeInteger(change.quantity)) {
                throw new TrackedStockError('INVALID_QUANTITY', 'Sale quantities must be whole numbers for valid items.');
            }
            const total = (outgoing.get(change.variantId) ?? 0) + change.quantity;
            if (!Number.isSafeInteger(total)) throw new TrackedStockError('INVALID_QUANTITY', 'The requested sale quantity is too large.');
            outgoing.set(change.variantId, total);
        }
        const ids = [...outgoing].filter(([, quantity]) => quantity > 0).map(([id]) => id);
        if (!ids.length) return;
        const tables: any[] = await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", 'StockVariantTracking');
        if (!tables.length) return;
        const columns: any[] = await tx.$queryRawUnsafe('PRAGMA table_info("StockVariantTracking")');
        if (!columns.some(column => column.name === 'variantId' && Number(column.pk) === 1)
            || !columns.some(column => column.name === 'activatedAt')) throw unavailable();
        for (let offset = 0; offset < ids.length; offset += 200) {
            const batch = ids.slice(offset, offset + 200);
            const records: any[] = await tx.$queryRawUnsafe('SELECT "variantId", "activatedAt" FROM "StockVariantTracking" WHERE "variantId" IN ('
                + batch.map(() => '?').join(',') + ')', ...batch);
            if (!records.length) continue;
            const tracked = records.map(record => record.variantId);
            if (tracked.some(id => typeof id !== 'string') || new Set(tracked).size !== tracked.length
                || records.some(record => !record.activatedAt || !Number.isFinite(new Date(record.activatedAt).getTime()))) throw unavailable();

            // Obtain SQLite's writer lock before reading balances. Concurrent sales or
            // activation either serialize or fail/rollback; they cannot both consume
            // a stale read. The activation timestamp itself is never changed.
            const locked = await tx.$executeRawUnsafe('UPDATE "StockVariantTracking" SET "activatedAt" = "activatedAt" WHERE "variantId" IN ('
                + tracked.map(() => '?').join(',') + ')', ...tracked);
            if (Number(locked) !== tracked.length) throw unavailable();
            const rows: any[] = await tx.$queryRawUnsafe('SELECT pv.id, pv.stock, pv.barcode, pv.size, p.name AS productName '
                + 'FROM "ProductVariant" pv JOIN "Product" p ON p.id = pv.productId '
                + 'JOIN "StockVariantTracking" st ON st.variantId = pv.id WHERE pv.id IN (' + tracked.map(() => '?').join(',') + ')', ...tracked);
            if (rows.length !== tracked.length || new Set(rows.map(row => row.id)).size !== tracked.length) throw unavailable();
            for (const row of rows) {
                const stock = typeof row.stock === 'number' || typeof row.stock === 'bigint' ? Number(row.stock) : NaN;
                if (!Number.isSafeInteger(stock) || !outgoing.has(row.id)) throw unavailable();
                const needed = outgoing.get(row.id)!;
                if (stock < needed) {
                    const label = String(row.productName || 'Item').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
                    const detail = String(row.size || row.barcode || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
                    throw new TrackedStockError('INSUFFICIENT_STOCK', `Not enough tracked stock for ${label}${detail ? ` (${detail})` : ''}. Available: ${stock}; required: ${needed}.`);
                }
            }
        }
    } catch (error) {
        if (error instanceof TrackedStockError) throw error;
        throw unavailable();
    }
}
