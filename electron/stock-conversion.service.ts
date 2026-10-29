import crypto from 'crypto';
import type { StockEntryInput, StockEntryResult } from '../src/types/stockEntry';
import { isAuditAttributeKey } from './stock-audit-setup.service';
import { ensureStockDraftSchema, authorizeInventory, areStockMetadataEqual } from './stock-draft.service';
import { normalizeText, formatVariantDescription, areNormalizedStringsEqual } from '../src/lib/catalogueDescription';
import type {
    PrepareAuditStyleInput, PreparedAuditBatch, PostStockBatchInput, PostedStockBatch,
    AdjustTrackedStockInput, TrackedStockAdjustment,
} from '../src/types/stockConversion';

const fields = ['brand', 'fabric', 'quality', 'pattern', 'sleeve', 'fit', 'collar', 'pocket', 'styleRef'] as const;
const ready = new WeakSet<object>();
const pending = new WeakMap<object, Promise<void>>();
const MAX_QUANTITY = 1_000_000_000;

export interface AuditRowStockStatus {
    state: 'PREPARED' | 'POSTED' | 'CANCELLED';
    draftId: string;
    variantId: string;
    productId: string;
}

/** Read-only progress for saved Excel rows; never creates catalogue or stock schema. */
export async function getAuditRowStatuses(prisma: any, rowIds: string[], user: any): Promise<Record<string, AuditRowStockStatus>> {
    authorizeInventory(user);
    if (!Array.isArray(rowIds) || rowIds.length > 20_000) throw new Error('Invalid saved audit row selection.');
    const ids = [...new Set(rowIds.map(id => string(id, 'Audit row ID')))];
    if (!ids.length) return {};
    return prisma.$transaction(async (tx: any) => {
        const tables: any[] = await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('StockAuditRowMapping', 'StockVariantTracking', 'StockEntryLine')");
        if (!tables.some(table => table.name === 'StockAuditRowMapping')) return {};
        const hasTracking = tables.some(table => table.name === 'StockVariantTracking');
        const result: Record<string, AuditRowStockStatus> = {};
        if (tables.some(table => table.name === 'StockEntryLine')) {
            for (let offset = 0; offset < ids.length; offset += 200) {
                const page = ids.slice(offset, offset + 200);
                const entries: any[] = await tx.$queryRawUnsafe('SELECT l.*, pv.productId FROM "StockEntryLine" l JOIN "ProductVariant" pv ON pv.id = l.variantId WHERE l.sourceRowId IN (' + page.map(() => '?').join(',') + ')', ...page);
                for (const row of entries) result[row.sourceRowId] = { state: 'POSTED', draftId: row.batchId, variantId: row.variantId, productId: row.productId };
            }
        }
        for (let offset = 0; offset < ids.length; offset += 200) {
            const page = ids.slice(offset, offset + 200);
            const rows: any[] = await tx.$queryRawUnsafe(`SELECT m.sourceRowId, m.draftId, m.variantId, pv.productId, d.status,
                ${hasTracking ? 'st.variantId' : 'NULL'} AS trackedVariantId,
                (SELECT d2.id FROM "StockCountDraftLine" l2 JOIN "StockCountDraft" d2 ON d2.id = l2.draftId
                    WHERE l2.variantId = m.variantId AND d2.status = 'DRAFT'
                    ORDER BY d2.updatedAt DESC, d2.id DESC LIMIT 1) AS openDraftId,
                (SELECT d3.id FROM "StockCountDraftLine" l3 JOIN "StockCountDraft" d3 ON d3.id = l3.draftId
                    WHERE l3.variantId = m.variantId AND d3.status = 'POSTED'
                    ORDER BY d3.updatedAt DESC, d3.id DESC LIMIT 1) AS postedDraftId
                FROM "StockAuditRowMapping" m
                LEFT JOIN "StockCountDraft" d ON d.id = m.draftId
                LEFT JOIN "ProductVariant" pv ON pv.id = m.variantId
                ${hasTracking ? 'LEFT JOIN "StockVariantTracking" st ON st.variantId = m.variantId' : ''}
                WHERE m.sourceRowId IN (${page.map(() => '?').join(',')})`, ...page);
            for (const row of rows) {
                if (!row.productId || !['DRAFT', 'POSTED', 'CANCELLED'].includes(row.status)) {
                    throw new Error('An existing audit entry is incomplete. Review its saved catalogue and count entry before preparing the row again.');
                }
                const posted = Boolean(row.trackedVariantId) || row.status === 'POSTED';
                const state = posted ? 'POSTED' : row.openDraftId ? 'PREPARED' : row.status === 'CANCELLED' ? 'CANCELLED' : 'PREPARED';
                result[row.sourceRowId] = { state, draftId: posted ? row.postedDraftId || row.draftId : row.openDraftId || row.draftId,
                    variantId: row.variantId, productId: row.productId };
            }
        }
        return result;
    });
}

function string(value: unknown, label: string, maximum = 200): string {
    if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} is required and must be valid text.`);
    return value.trim();
}
function optionalText(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    return normalizeText(string(value, 'Audit attribute', 2000)) || null;
}
function quantity(value: unknown, label: string, allowZero = false): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_QUANTITY) {
        throw new Error(`${label} must be a ${allowZero ? 'non-negative' : 'positive'} whole piece quantity.`);
    }
    return value;
}
function price(value: unknown, label: string, max = 1_000_000_000): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error(`${label} must be a finite non-negative value.`);
    return value;
}
function canonical(value: any): any {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
    return value;
}
function hash(value: unknown): string { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function attrs(value: any): Record<string, string | null> { return Object.fromEntries(fields.map(field => [field, normalizeText(value[field]) || null])); }
function userName(user: any): string { return normalizeText(user.name || user.username || user.id); }

/** Only additive sidecars; no existing catalogue rows are marked as tracked by this migration. */
export async function ensureStockConversionSchema(prisma: any): Promise<void> {
    if (ready.has(prisma)) return;
    if (pending.has(prisma)) return pending.get(prisma)!;
    const work = (async () => {
        await ensureStockDraftSchema(prisma);
        await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "StockBatchPosting" (
            "operationId" TEXT NOT NULL PRIMARY KEY, "action" TEXT NOT NULL, "userId" TEXT NOT NULL,
            "payloadHash" TEXT NOT NULL, "draftId" TEXT, "resultJson" TEXT NOT NULL,
            "createdAt" TEXT NOT NULL
        )`);
        await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "StockAuditRowMapping" (
            "sourceRowId" TEXT NOT NULL PRIMARY KEY, "fileHash" TEXT NOT NULL, "fileName" TEXT NOT NULL,
            "variantId" TEXT NOT NULL, "draftId" TEXT NOT NULL, "sourceQuantity" INTEGER,
            "createdAt" TEXT NOT NULL,
            FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id"),
            FOREIGN KEY ("draftId") REFERENCES "StockCountDraft" ("id")
        )`);
        await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "StockAuditRowMapping_draftId_idx" ON "StockAuditRowMapping" ("draftId")');
        for (const [table, required] of [
            ['StockVariantTracking', ['variantId', 'activatedAt']],
            ['StockBatchPosting', ['operationId', 'action', 'userId', 'payloadHash', 'draftId', 'resultJson', 'createdAt']],
            ['StockAuditRowMapping', ['sourceRowId', 'fileHash', 'fileName', 'variantId', 'draftId', 'sourceQuantity', 'createdAt']],
        ] as const) {
            const columns: any[] = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
            if (required.some(name => !columns.some(column => column.name === name))
                || !columns.some(column => column.name === required[0] && Number(column.pk) === 1)
                || columns.filter(column => Number(column.pk) > 0).length !== 1) throw new Error('Stock conversion schema is incomplete. Repair the app before posting stock.');
        }
        ready.add(prisma);
    })();
    pending.set(prisma, work);
    try { await work; } finally { pending.delete(prisma); }
}

async function lock(tx: any) {
    // A single SQLite writer lock coordinates catalogue codes, counts, activation and adjustments.
    await tx.$executeRawUnsafe('UPDATE "CatalogueWriteLock" SET "token" = "token" WHERE "id" = 1');
    const columns: any[] = await tx.$queryRawUnsafe('PRAGMA table_info("StockVariantTracking")');
    if (!columns.some(column => column.name === 'variantId' && Number(column.pk) === 1)
        || columns.filter(column => Number(column.pk) > 0).length !== 1
        || !columns.some(column => column.name === 'activatedAt' && Number(column.notnull) === 1)) throw new Error('Stock tracking schema is incomplete. Repair the app before changing stock.');
}
async function replay(tx: any, operationId: string, action: string, payloadHash: string, user: any): Promise<any | null> {
    const rows: any[] = await tx.$queryRawUnsafe('SELECT * FROM "StockBatchPosting" WHERE "operationId" = ?', operationId);
    if (!rows.length) return null;
    if (rows[0].action !== action || rows[0].payloadHash !== payloadHash || rows[0].userId !== user.id) throw new Error('Operation ID was already used for different content or another operator. Start a new operation.');
    return JSON.parse(rows[0].resultJson);
}
async function record(tx: any, operationId: string, action: string, payloadHash: string, user: any, result: unknown, draftId: string | null, now: Date) {
    await tx.$executeRawUnsafe('INSERT INTO "StockBatchPosting" ("operationId", "action", "userId", "payloadHash", "draftId", "resultJson", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
        operationId, action, user.id, payloadHash, draftId, JSON.stringify(result), now.toISOString());
}
async function shortCode(tx: any, originalCodes: Set<string>): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt++) {
        const barcode = String(crypto.randomInt(100000, 1000000));
        if (originalCodes.has(barcode)) continue;
        const existing: any[] = await tx.$queryRawUnsafe('SELECT "id" FROM "ProductVariant" WHERE "barcode" = ? OR "sku" IN (?, ?) UNION ALL SELECT "draftId" FROM "CatalogueBarcodeReservation" WHERE "barcode" = ? LIMIT 1', barcode, `ST-${barcode}`, barcode, barcode);
        if (!existing.length) return barcode;
    }
    throw new Error('Could not assign a short unique barcode. Retry preparing this style.');
}

/** Direct stock entry. Display names are never catalogue identities or merge keys. */
export async function saveStockEntry(prisma: any, input: StockEntryInput, user: any, sourceBarcodes: string[] = []): Promise<StockEntryResult> {
    authorizeInventory(user);
    if (!input) throw new Error('Stock entry is required.');
    const operationId = string(input.operationId, 'Operation ID');
    const batchName = string(input.batchName, 'Batch name');
    const fileHash = input.fileHash ? string(input.fileHash, 'File identity', 64) : null;
    if (fileHash && !/^[a-f0-9]{64}$/.test(fileHash)) throw new Error('Invalid workbook identity. Upload the workbook again.');
    if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 1000) throw new Error('Save between 1 and 1,000 stock rows at a time.');
    const sourceIds = new Set<string>();
    const rows = input.rows.map(row => {
        const sourceRowId = fileHash ? string(row.sourceRowId, 'Source row ID') : null;
        if (sourceRowId && sourceIds.has(sourceRowId)) throw new Error('A workbook row cannot be imported twice.');
        if (sourceRowId) sourceIds.add(sourceRowId);
        if (!row.attributes || typeof row.attributes !== 'object' || Array.isArray(row.attributes)) throw new Error('Item attributes must be valid.');
        const attributes: Record<string, string | null> = {};
        if (Object.keys(row.attributes).length > 40) throw new Error('Too many item attributes.');
        for (const [key, value] of Object.entries(row.attributes)) {
            if (!isAuditAttributeKey(key)) throw new Error(`Unsupported attribute: ${key}`);
            attributes[key] = optionalText(value);
        }
        const attributeLabels: Record<string, string> = {};
        if (row.attributeLabels) {
            if (typeof row.attributeLabels !== 'object' || Array.isArray(row.attributeLabels) || Object.keys(row.attributeLabels).length > 40) throw new Error('Invalid attribute labels.');
            for (const [key, value] of Object.entries(row.attributeLabels)) {
                if (!isAuditAttributeKey(key)) throw new Error('Invalid attribute label.');
                attributeLabels[key] = string(value, 'Attribute label', 100);
            }
        }
        const mrp = price(row.mrp, 'MRP');
        if (!mrp) throw new Error('MRP must be greater than zero.');
        return { sourceRowId, name: string(row.name, 'Item name'), category: string(row.category, 'Category'),
            brand: optionalText(row.brand), size: optionalText(row.size), mrp,
            quantity: quantity(row.quantity, 'Stock count', true), attributes, ...(Object.keys(attributeLabels).length ? { attributeLabels } : {}) };
    });
    const mergeMatching = input.mergeMatching === true && !fileHash;
    const payloadHash = hash({ batchName, fileHash, rows, ...(mergeMatching ? { mergeMatching: true } : {}) });
    await ensureStockConversionSchema(prisma);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "StockEntryBatch" (
        "id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "fileHash" TEXT,
        "createdBy" TEXT NOT NULL, "createdAt" TEXT NOT NULL)`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "StockEntryLine" (
        "variantId" TEXT PRIMARY KEY NOT NULL, "batchId" TEXT NOT NULL,
        "sourceRowId" TEXT UNIQUE, "initialQuantity" INTEGER NOT NULL,
        FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id"),
        FOREIGN KEY ("batchId") REFERENCES "StockEntryBatch"("id"))`);
    return prisma.$transaction(async (tx: any) => {
        await lock(tx);
        const prior = await replay(tx, operationId, 'DIRECT_ENTRY', payloadHash, user);
        if (prior) return prior;
        const prepared = new Map<string, any>();
        for (const row of rows) if (row.sourceRowId) {
            const existing = await tx.$queryRawUnsafe('SELECT "variantId" FROM "StockEntryLine" WHERE "sourceRowId" = ?', row.sourceRowId);
            if (existing.length) throw new Error('Some Excel rows were already saved. Edit their counts in Inventory instead of importing them again.');
            const mapped = await tx.$queryRawUnsafe('SELECT pv.*, m.draftId, gd.isPrepared AS detailPrepared, st.variantId AS tracked FROM "StockAuditRowMapping" m JOIN "ProductVariant" pv ON pv.id = m.variantId LEFT JOIN "ProductVariantGarmentDetail" gd ON gd.variantId = pv.id LEFT JOIN "StockVariantTracking" st ON st.variantId = pv.id WHERE m.sourceRowId = ?', row.sourceRowId);
            if (mapped.length) {
                const item = mapped[0];
                if (item.tracked || !item.isActive || !(item.isPrepared || item.detailPrepared) || item.stock !== 0) throw new Error('This workbook item is already live or has changed. Edit its stock in Inventory.');
                prepared.set(row.sourceRowId, item);
            }
        }
        const batchId = crypto.randomUUID(), now = new Date();
        await tx.$executeRawUnsafe('INSERT INTO "StockEntryBatch" ("id", "name", "fileHash", "createdBy", "createdAt") VALUES (?, ?, ?, ?, ?)', batchId, batchName, fileHash, user.id, now.toISOString());
        const categories: any[] = await tx.category.findMany({ select: { id: true, name: true } });
        const items: StockEntryResult['items'] = [];
        const candidates: any[] = mergeMatching ? await tx.$queryRawUnsafe(`SELECT pv.*, p.categoryId, gd.metadata, ${fields.map(field => `gd."${field}"`).join(',')}
            FROM "ProductVariant" pv JOIN "Product" p ON p.id=pv.productId JOIN "ProductVariantGarmentDetail" gd ON gd.variantId=pv.id
            JOIN "StockVariantTracking" st ON st.variantId=pv.id WHERE pv.isActive=1 AND p.isActive=1 AND pv.isPrepared=0 AND gd.isPrepared=0 LIMIT 20001`) : [];
        if (candidates.length > 20000) throw new Error('Too many stock items to match safely.');
        const identity = (categoryId: string, brand: unknown, size: unknown, mrp: number, attributes: Record<string, any>) => hash({ categoryId, brand: normalizeText(brand as any).toLowerCase(), size: normalizeText(size as any).toLowerCase(), mrp,
            attributes: Object.fromEntries(Object.entries(attributes).filter(([key, value]) => key !== 'brand' && isAuditAttributeKey(key) && typeof value === 'string' && value.trim()).map(([key, value]) => [key, normalizeText(value).toLowerCase()])) });
        const candidateIdentity = (candidate: any) => {
            let metadata: any = {}; try { metadata = JSON.parse(candidate.metadata || '{}'); } catch { return null; }
            const attributes = { ...metadata };
            for (const field of fields) attributes[field] = candidate[field];
            attributes.color = candidate.color || attributes.color;
            return identity(candidate.categoryId, candidate.brand, candidate.size, candidate.mrp, attributes);
        };
        const styleProducts = new Map<string, any>();
        for (const row of rows) {
            const matches = categories.filter(category => areNormalizedStringsEqual(category.name, row.category));
            if (matches.length > 1) throw new Error(`Category ${row.category} is ambiguous. Correct it before saving.`);
            let category = matches[0];
            if (!category) { category = await tx.category.create({ data: { name: row.category } }); categories.push(category); }
            if (mergeMatching) {
                const key = identity(category.id, row.brand, row.size, row.mrp, row.attributes);
                const matches = candidates.filter(candidate => candidateIdentity(candidate) === key);
                if (matches.length > 1) throw new Error('Multiple barcodes have these exact attributes. Use Inventory to select the intended barcode instead.');
                if (matches.length) {
                    const match = matches[0], stock = quantity(match.stock + row.quantity, 'Resulting stock', true);
                    styleProducts.set(identity(category.id, row.brand, null, row.mrp, row.attributes), { id: match.productId });
                    await tx.productVariant.update({ where: { id: match.id }, data: { stock, isSynced: false, updatedAt: now } });
                    await tx.inventoryMovement.create({ data: { variantId: match.id, type: 'RECEIPT', quantity: row.quantity, reason: `Rack audit: ${batchName}`, reference: batchId, createdBy: user.id, createdAt: now, isSynced: false } });
                    match.stock = stock;
                    items.push({ variantId: match.id, barcode: match.barcode, stock });
                    continue;
                }
            }
            const previous = row.sourceRowId ? prepared.get(row.sourceRowId) : null;
            // Reuse identities from the earlier unfinished setup, rather than
            // leaving hidden duplicates or forcing the old wizard on the user.
            const productData = { name: row.name, categoryId: category.id, taxRate: 5, isActive: true, isSynced: false, updatedAt: now };
            const styleKey = identity(category.id, row.brand, null, row.mrp, row.attributes);
            const product = mergeMatching && styleProducts.has(styleKey) ? styleProducts.get(styleKey)
                : await tx.product.create({ data: { ...productData, createdAt: now } });
            if (mergeMatching) styleProducts.set(styleKey, product);
            const variantId = previous?.id || crypto.randomUUID(), barcode = previous?.barcode || await shortCode(tx, new Set(sourceBarcodes));
            const details: Record<string, string | null> = { ...attrs(row.attributes), brand: row.brand };
            const variantData = { productId: product.id, sku: previous?.sku || `ST-${barcode}`, barcode,
                size: row.size, color: row.attributes.color ?? null, mrp: row.mrp, sellingPrice: row.mrp,
                costPrice: previous?.costPrice || 0, stock: row.quantity, minStock: 5, isActive: true, isSynced: false, updatedAt: now };
            if (previous) {
                await tx.productVariant.update({ where: { id: variantId }, data: variantData });
                await tx.$executeRawUnsafe('UPDATE "ProductVariant" SET "isPrepared" = 0 WHERE "id" = ?', variantId);
                await tx.$executeRawUnsafe('DELETE FROM "ProductVariantGarmentDetail" WHERE "variantId" = ?', variantId);
            } else await tx.productVariant.create({ data: { ...variantData, id: variantId, createdAt: now } });
            await tx.$executeRawUnsafe('INSERT INTO "ProductVariantGarmentDetail" ("variantId", "isPrepared", ' + fields.map(field => `"${field}"`).join(',') + ', "formattedDescription", "metadata", "createdAt", "updatedAt") VALUES (' + Array(15).fill('?').join(',') + ')',
                variantId, 0, ...fields.map(field => details[field]), formatVariantDescription(row.name, { ...details, size: row.size }),
                JSON.stringify({ ...row.attributes, attributeLabels: row.attributeLabels, source: fileHash ? 'excel-stock' : 'manual-stock', batchId, batchName }), now.toISOString(), now.toISOString());
            await tx.$executeRawUnsafe('INSERT INTO "StockVariantTracking" ("variantId", "activatedAt") VALUES (?, ?)', variantId, now.toISOString());
            await tx.$executeRawUnsafe('INSERT INTO "StockEntryLine" ("variantId", "batchId", "sourceRowId", "initialQuantity") VALUES (?, ?, ?, ?)', variantId, batchId, row.sourceRowId, row.quantity);
            await tx.inventoryMovement.create({ data: { variantId, type: 'RECEIPT', quantity: row.quantity, reason: `Stock entry: ${batchName}`, reference: batchId, createdBy: user.id, createdAt: now, isSynced: false } });
            items.push({ variantId, barcode, stock: row.quantity });
            if (mergeMatching) candidates.push({ ...variantData, id: variantId, categoryId: category.id, ...details, metadata: JSON.stringify(row.attributes) });
        }
        const result = { batchId, batchName, totalPieces: rows.reduce((sum, row) => sum + row.quantity, 0), items };
        await tx.auditLog.create({ data: { action: 'STOCK_ENTRY_SAVED', userId: user.id, details: JSON.stringify(result), createdAt: now } });
        await record(tx, operationId, 'DIRECT_ENTRY', payloadHash, user, result, null, now);
        return result;
    }, { timeout: 30000 });
}

/** Main supplies validated inbox rows, never renderer-provided catalogue or live stock values. */
export async function prepareAuditStyle(prisma: any, input: PrepareAuditStyleInput, user: any): Promise<PreparedAuditBatch> {
    authorizeInventory(user);
    if (!(user.role === 'ADMIN' || user.permManageProducts)) throw new Error('Permission Denied: Preparing an audit style also requires permission to manage products.');
    if (!input || input.styleConfirmed !== true) throw new Error('Confirm that the selected sizes are one physical style before preparing it.');
    const operationId = string(input.operationId, 'Operation ID'), fileHash = string(input.fileHash, 'Audit file hash', 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(fileHash)) throw new Error('The audit file identity is invalid. Refresh the saved Excel audit.');
    const fileName = string(input.fileName, 'Audit file name', 260), productName = normalizeText(string(input.productName, 'Reviewed product name'));
    if (typeof input.categoryId !== 'string') throw new Error('Choose a reviewed category or enter a new category name.');
    const categoryId = input.categoryId.trim() ? string(input.categoryId, 'Reviewed category') : null;
    const categoryName = input.categoryName === undefined || input.categoryName === null || input.categoryName === ''
        ? null : normalizeText(string(input.categoryName, 'Reviewed category name'));
    if (Boolean(categoryId) === Boolean(categoryName)) throw new Error('Choose one existing category or enter one new category name.');
    const taxRate = price(input.taxRate, 'Reviewed tax rate', 100);
    if (!Array.isArray(input.rowIds) || !Array.isArray(input.rows) || !input.rowIds.length || input.rowIds.length > 100 || input.rows.length !== input.rowIds.length) throw new Error('Select between 1 and 100 saved audit rows for one confirmed style.');
    const rowIds = input.rowIds.map(id => string(id, 'Audit row ID'));
    if (new Set(rowIds).size !== rowIds.length) throw new Error('An audit row cannot be selected twice.');
    const byId = new Map(input.rows.map(row => [row.id, row]));
    if (byId.size !== rowIds.length || rowIds.some(id => !byId.has(id))) throw new Error('The saved audit rows changed. Refresh and select the style again.');
    const sizes = new Set<string>();
    let identityHash: string | null = null;
    const rows = rowIds.map(id => {
        const row = byId.get(id)!;
        const size = optionalText(row.size), brand = optionalText(row.brand), category = optionalText(row.category);
        // Accessories and one-size garments can legitimately have no size. A
        // single row is still one identified variant; multiple blank sizes must
        // never be guessed to represent the same physical style.
        if (!size && rowIds.length > 1) throw new Error('When preparing multiple rows together, every selected row needs a distinct reviewed size. Prepare a no-size item as its own row.');
        const sizeKey = size?.toLowerCase() ?? '';
        if (sizes.has(sizeKey)) throw new Error('Selected sizes must be distinct. Do not merge separate audited rows just because their names or prices match.');
        sizes.add(sizeKey);
        if (!row.attributes || typeof row.attributes !== 'object' || Array.isArray(row.attributes) || Object.keys(row.attributes).length > 40) throw new Error('Invalid saved audit attributes. Refresh the Excel audit.');
        const attributes: Record<string, string | null> = {};
        for (const [key, value] of Object.entries(row.attributes)) {
            if (!/^[a-zA-Z][a-zA-Z0-9]{0,49}$/.test(key)) throw new Error('Invalid saved audit attribute name.');
            attributes[key] = optionalText(value);
        }
        const mrp = price(row.mrp, 'Audit MRP');
        const countedQuantity = row.countedQuantity === null ? null : quantity(row.countedQuantity, 'Audit count', true);
        if (countedQuantity === 0) throw new Error(`Audit row ${id} has zero counted pieces. Select rows with physical pieces to relabel, or leave an unfinished count blank.`);
        const comparable = { category: category?.toLowerCase() ?? null, brand: brand?.toLowerCase() ?? null, mrp,
            attributes: Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== null).map(([key, value]) => [key, value!.toLowerCase()])) };
        const currentHash = hash(comparable);
        if (identityHash && identityHash !== currentHash) throw new Error('Selected rows differ in category, brand, attributes or MRP. Prepare each physical style separately.');
        identityHash = currentHash;
        return { id, size, brand, category, attributes, mrp, countedQuantity, originalBarcode: optionalText(row.barcode) };
    });
    const payloadHash = hash({ operationId, fileHash, fileName, productName, categoryId, categoryName, taxRate, rows, styleConfirmed: true });
    await ensureStockConversionSchema(prisma);
    return prisma.$transaction(async (tx: any) => {
        await lock(tx);
        const prior = await replay(tx, operationId, 'PREPARE', payloadHash, user);
        if (prior) return prior;
        const mapped: any[] = await tx.$queryRawUnsafe('SELECT "sourceRowId", "draftId" FROM "StockAuditRowMapping" WHERE "sourceRowId" IN (' + rowIds.map(() => '?').join(',') + ') LIMIT 1', ...rowIds);
        if (mapped.length) throw new Error(`Audit row ${mapped[0].sourceRowId} is already prepared. Open existing batch ${mapped[0].draftId}; do not count those pieces again.`);
        let reviewedCategoryId = categoryId;
        if (reviewedCategoryId) {
            if (!await tx.category.findUnique({ where: { id: reviewedCategoryId } })) throw new Error('Reviewed category no longer exists. Choose an existing category.');
        } else {
            // The operator explicitly reviewed this name. Reuse an equivalent
            // category to avoid duplicates such as "Kidswear" / " kidswear ".
            const categories: any[] = await tx.category.findMany({ select: { id: true, name: true } });
            const matches = categories.filter(category => areNormalizedStringsEqual(category.name, categoryName));
            if (matches.length > 1) throw new Error('More than one existing category matches this name. Choose the intended category from the list.');
            reviewedCategoryId = matches[0]?.id ?? (await tx.category.create({ data: { name: categoryName! } })).id;
        }
        const now = new Date(), draftId = crypto.randomUUID();
        const product = await tx.product.create({ data: { name: productName, categoryId: reviewedCategoryId, taxRate, isActive: true, isSynced: false, createdAt: now, updatedAt: now } });
        await tx.$executeRawUnsafe(`INSERT INTO "StockCountDraft" ("id", "operationKind", "status", "batchDescription", "sourceReference", "notes", "revision", "createdBy", "createdByName", "updatedBy", "updatedByName", "createdAt", "updatedAt") VALUES (?, 'CONVERSION_ADDITION', 'DRAFT', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
            draftId, productName, `Excel ${fileName}; SHA256 ${fileHash}`, 'Audit observations only. Hold the physical pieces, apply labels and recheck quantities before posting.', user.id, userName(user), user.id, userName(user), now.toISOString(), now.toISOString());
        const variantIds: string[] = [];
        const originalCodes = new Set(rows.flatMap(row => row.originalBarcode ? [row.originalBarcode] : []));
        for (const [index, row] of rows.entries()) {
            const variantId = crypto.randomUUID(), barcode = await shortCode(tx, originalCodes), sku = `ST-${barcode}`;
            const details: Record<string, string | null> = { ...attrs(row.attributes), brand: row.brand };
            const color = row.attributes.color ?? null;
            const description = formatVariantDescription(productName, { ...details, size: row.size, color });
            const metadata = JSON.stringify({ ...row.attributes, source: 'excel-audit', sourceRowId: row.id, fileHash, originalBarcode: row.originalBarcode, attributes: row.attributes });
            await tx.productVariant.create({ data: { id: variantId, productId: product.id, sku, barcode, size: row.size, color, mrp: row.mrp, sellingPrice: row.mrp, costPrice: 0, stock: 0, minStock: 5, isActive: true, isSynced: false, createdAt: now, updatedAt: now } });
            await tx.$executeRawUnsafe('UPDATE "ProductVariant" SET "isPrepared" = 1 WHERE "id" = ?', variantId);
            await tx.$executeRawUnsafe('INSERT INTO "ProductVariantGarmentDetail" ("variantId", "isPrepared", ' + fields.map(field => `"${field}"`).join(',') + ', "formattedDescription", "metadata", "createdAt", "updatedAt") VALUES (' + Array(15).fill('?').join(',') + ')',
                variantId, 1, ...fields.map(field => details[field]), description, metadata, now.toISOString(), now.toISOString());
            await tx.$executeRawUnsafe(`INSERT INTO "StockCountDraftLine" ("id", "draftId", "variantId", "countedQuantity", "sortOrder", "snapshotProductName", "snapshotBarcode", "snapshotSku", "snapshotDescription", "snapshotSize", "snapshotColor", "snapshotSellingPrice", "snapshotAttributes", "snapshotCategoryId", "snapshotTaxRate", "snapshotMrp", "snapshotMetadata", "createdAt", "updatedAt") VALUES (${Array(19).fill('?').join(',')})`,
                crypto.randomUUID(), draftId, variantId, row.countedQuantity, index, productName, barcode, sku, description, row.size, color, row.mrp, JSON.stringify(details), reviewedCategoryId, taxRate, row.mrp, metadata, now.toISOString(), now.toISOString());
            await tx.$executeRawUnsafe('INSERT INTO "StockAuditRowMapping" ("sourceRowId", "fileHash", "fileName", "variantId", "draftId", "sourceQuantity", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)', row.id, fileHash, fileName, variantId, draftId, row.countedQuantity, now.toISOString());
            variantIds.push(variantId);
        }
        const result = { productId: product.id, draftId, variantIds, sourceRowIds: rowIds };
        await tx.auditLog.create({ data: { action: 'STOCK_AUDIT_PREPARED', userId: user.id, details: JSON.stringify({ draftId, productId: product.id, sourceRowIds: rowIds, fileHash }), createdAt: now } });
        await record(tx, operationId, 'PREPARE', payloadHash, user, result, draftId, now);
        return result;
    }, { timeout: 15000 });
}

function checkSnapshot(line: any, variant: any): void {
    if (line.snapshotCategoryId === null || line.snapshotTaxRate === null || line.snapshotMrp === null || !line.snapshotAttributes) throw new Error('This older draft lacks a reviewed category, tax or MRP checkpoint. Create a new reviewed batch; the old evidence has been preserved.');
    let saved: any;
    try { saved = JSON.parse(line.snapshotAttributes); } catch { throw new Error('The draft identity snapshot is invalid. Create a new reviewed batch.'); }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('The draft identity snapshot is invalid.');
    const differences = !areNormalizedStringsEqual(line.snapshotProductName, variant.productName)
        || line.snapshotBarcode !== variant.barcode || line.snapshotSku !== variant.sku
        || !areNormalizedStringsEqual(line.snapshotSize, variant.size) || !areNormalizedStringsEqual(line.snapshotColor, variant.color)
        || Number(line.snapshotSellingPrice) !== Number(variant.sellingPrice) || Number(line.snapshotMrp) !== Number(variant.mrp)
        || line.snapshotCategoryId !== variant.categoryId || Number(line.snapshotTaxRate) !== Number(variant.taxRate)
        || fields.some(field => !areNormalizedStringsEqual(saved[field], variant[field]))
        || !areStockMetadataEqual(line.snapshotMetadata, variant.metadata);
    if (differences) throw new Error(`Catalogue identity changed for barcode ${line.snapshotBarcode}. Review the item and create a fresh batch before posting.`);
}

export async function postStockBatch(prisma: any, input: PostStockBatchInput, user: any): Promise<PostedStockBatch> {
    authorizeInventory(user);
    if (!input || input.held !== true || input.labelsApplied !== true || input.countsChecked !== true) throw new Error('Confirm the pieces are held, labels applied and quantities checked before posting.');
    const operationId = string(input.operationId, 'Operation ID'), draftId = string(input.draftId, 'Draft ID');
    const expectedRevision = quantity(input.expectedRevision, 'Expected draft revision');
    const payloadHash = hash({ operationId, draftId, expectedRevision, held: true, labelsApplied: true, countsChecked: true });
    await ensureStockConversionSchema(prisma);
    return prisma.$transaction(async (tx: any) => {
        await lock(tx);
        const prior = await replay(tx, operationId, 'POST', payloadHash, user);
        if (prior) return prior;
        const drafts: any[] = await tx.$queryRawUnsafe('SELECT * FROM "StockCountDraft" WHERE "id" = ?', draftId);
        const draft = drafts[0];
        if (!draft) throw new Error('Stock count batch was not found.');
        if (draft.status !== 'DRAFT') throw new Error('This batch is already posted or cancelled. It cannot change stock again.');
        if (draft.operationKind !== 'CONVERSION_ADDITION') throw new Error('This draft is not a conversion addition batch.');
        if (Number(draft.revision) !== expectedRevision) throw new Error('Stale batch revision. Reload and check the saved quantities before posting.');
        const lines: any[] = await tx.$queryRawUnsafe('SELECT * FROM "StockCountDraftLine" WHERE "draftId" = ? ORDER BY "sortOrder", "id"', draftId);
        if (!lines.length || lines.length > 1000) throw new Error('The conversion batch must contain between 1 and 1,000 item lines.');
        const now = new Date(), items: PostedStockBatch['items'] = [];
        for (const line of lines) {
            const addedQuantity = quantity(line.countedQuantity, `Count for ${line.snapshotBarcode}`);
            const variants: any[] = await tx.$queryRawUnsafe(`SELECT pv.*, p.name AS productName, p.isActive AS productActive, p.categoryId, p.taxRate,
                gd.isPrepared AS detailPrepared, ${fields.map(field => `gd."${field}"`).join(',')}, gd.metadata,
                st.activatedAt FROM "ProductVariant" pv JOIN "Product" p ON p.id = pv.productId
                LEFT JOIN "ProductVariantGarmentDetail" gd ON gd.variantId = pv.id
                LEFT JOIN "StockVariantTracking" st ON st.variantId = pv.id WHERE pv.id = ?`, line.variantId);
            const variant = variants[0];
            if (!variant || !variant.isActive || !variant.productActive) throw new Error('A batch item is inactive or missing. Reload the catalogue before posting.');
            checkSnapshot(line, variant);
            const prepared = Boolean(variant.isPrepared || variant.detailPrepared), tracked = variant.activatedAt !== null;
            if (tracked && (typeof variant.activatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(variant.activatedAt)
                || !Number.isFinite(Date.parse(variant.activatedAt)) || new Date(variant.activatedAt).toISOString() !== variant.activatedAt)) throw new Error('Item tracking activation is invalid. Repair the item before posting.');
            if (!prepared && !tracked) throw new Error('Legacy items cannot be activated from count drafts. Prepare an identified style first.');
            if (prepared && tracked) throw new Error('Item preparation and tracking state conflict. Repair the item before posting.');
            const before = quantity(Number(variant.stock), 'Current stock', true);
            if (prepared && before !== 0) throw new Error('Prepared stock must still be zero. Review the item before activating it.');
            const stock = quantity(before + addedQuantity, 'Resulting stock');
            await tx.productVariant.update({ where: { id: variant.id }, data: { stock, isSynced: false, updatedAt: now } });
            await tx.$executeRawUnsafe('UPDATE "ProductVariant" SET "isPrepared" = 0 WHERE "id" = ?', variant.id);
            await tx.$executeRawUnsafe('UPDATE "ProductVariantGarmentDetail" SET "isPrepared" = 0, "updatedAt" = ? WHERE "variantId" = ?', now.toISOString(), variant.id);
            if (!tracked) await tx.$executeRawUnsafe('INSERT INTO "StockVariantTracking" ("variantId", "activatedAt") VALUES (?, ?)', variant.id, now.toISOString());
            await tx.inventoryMovement.create({ data: { variantId: variant.id, type: 'CONVERSION', quantity: addedQuantity,
                reason: 'Held and relabelled audit pieces added to tracked stock', reference: draftId, createdBy: user.id, isSynced: false, createdAt: now } });
            items.push({ variantId: variant.id, addedQuantity, stock });
        }
        const changed = await tx.$executeRawUnsafe('UPDATE "StockCountDraft" SET "status" = \'POSTED\', "revision" = "revision" + 1, "updatedBy" = ?, "updatedByName" = ?, "updatedAt" = ? WHERE "id" = ? AND "status" = \'DRAFT\' AND "revision" = ?', user.id, userName(user), now.toISOString(), draftId, expectedRevision);
        if (changed !== 1) throw new Error('Stale batch revision. Reload before posting.');
        const result: PostedStockBatch = { draftId, status: 'POSTED', postedAt: now.toISOString(), totalPieces: items.reduce((sum, item) => sum + item.addedQuantity, 0), items };
        await tx.auditLog.create({ data: { action: 'STOCK_BATCH_POSTED', userId: user.id, details: JSON.stringify({ ...result, operationId }), createdAt: now } });
        await record(tx, operationId, 'POST', payloadHash, user, result, draftId, now);
        return result;
    }, { timeout: 15000 });
}

export async function adjustTrackedStock(prisma: any, input: AdjustTrackedStockInput, user: any): Promise<TrackedStockAdjustment> {
    authorizeInventory(user);
    if (!input) throw new Error('Stock adjustment details are required.');
    const operationId = string(input.operationId, 'Operation ID'), variantId = string(input.variantId, 'Variant ID');
    if (!['RECEIPT', 'DAMAGE', 'RECOUNT'].includes(input.kind)) throw new Error('Choose receipt, damage or recount.');
    const amount = quantity(input.quantity, 'Adjustment quantity', input.kind === 'RECOUNT'), reason = string(input.reason, 'Adjustment reason', 2000);
    const expectedStock = input.kind === 'RECOUNT' ? quantity(input.expectedStock, 'Expected current stock', true) : undefined;
    const payloadHash = hash({ operationId, variantId, kind: input.kind, quantity: amount, expectedStock, reason });
    await ensureStockConversionSchema(prisma);
    return prisma.$transaction(async (tx: any) => {
        await lock(tx);
        const prior = await replay(tx, operationId, 'ADJUST', payloadHash, user);
        if (prior) return prior;
        const rows: any[] = await tx.$queryRawUnsafe('SELECT pv.*, p.isActive AS productActive, gd.isPrepared AS detailPrepared, st.activatedAt FROM "ProductVariant" pv JOIN "Product" p ON p.id = pv.productId LEFT JOIN "ProductVariantGarmentDetail" gd ON gd.variantId = pv.id JOIN "StockVariantTracking" st ON st.variantId = pv.id WHERE pv.id = ?', variantId);
        const variant = rows[0];
        if (!variant || !variant.isActive || !variant.productActive || variant.isPrepared || variant.detailPrepared) throw new Error('Stock adjustments require an active, explicitly tracked item. Legacy and prepared items cannot be adjusted here.');
        if (typeof variant.activatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(variant.activatedAt)
            || !Number.isFinite(Date.parse(variant.activatedAt)) || new Date(variant.activatedAt).toISOString() !== variant.activatedAt) throw new Error('Item tracking activation is invalid. Repair the item before adjusting stock.');
        const before = quantity(Number(variant.stock), 'Current stock', true);
        if (input.kind === 'RECOUNT' && before !== expectedStock) throw new Error('Stock changed since the recount was opened. Reload and count again before saving.');
        const delta = input.kind === 'RECOUNT' ? amount - before : input.kind === 'DAMAGE' ? -amount : amount;
        const stock = quantity(before + delta, 'Resulting stock', true), now = new Date();
        await tx.productVariant.update({ where: { id: variantId }, data: { stock, isSynced: false, updatedAt: now } });
        await tx.inventoryMovement.create({ data: { variantId, type: input.kind, quantity: delta, reason, reference: operationId, createdBy: user.id, createdAt: now, isSynced: false } });
        const result = { variantId, stock, delta, operationId };
        await tx.auditLog.create({ data: { action: 'TRACKED_STOCK_ADJUSTED', userId: user.id, details: JSON.stringify({ ...result, kind: input.kind, previousStock: before, reason }), createdAt: now } });
        await record(tx, operationId, 'ADJUST', payloadHash, user, result, null, now);
        return result;
    }, { timeout: 15000 });
}
