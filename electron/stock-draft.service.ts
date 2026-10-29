import crypto from 'crypto';
import { normalizeText, formatVariantDescription, areNormalizedStringsEqual } from '../src/lib/catalogueDescription';
import { ensureCatalogueSchema } from './catalogue.service';

const schemaReady = new WeakSet<object>();
const schemaPending = new WeakMap<object, Promise<void>>();
const snapshotAttributeFields = ['brand', 'fabric', 'quality', 'pattern', 'sleeve', 'fit', 'collar', 'pocket', 'styleRef'] as const;

function garmentAttributes(variant: any): Record<string, string | null> {
    return Object.fromEntries(snapshotAttributeFields.map(field => [field, normalizeText(variant[field]) || null]));
}

function garmentDescription(variant: any): string {
    return normalizeText(variant.formattedDescription) || formatVariantDescription(variant.productName, {
        ...garmentAttributes(variant), size: variant.size, color: variant.color,
    });
}

function isPreparedVariant(variant: any): boolean {
    return Boolean(variant.isPrepared || variant.detailPrepared);
}

function isConversionTarget(variant: any): boolean {
    return isPreparedVariant(variant) || Boolean(variant.isTracked);
}

function captureSnapshot(variant: any) {
    return {
        snapshotProductName: variant.productName,
        snapshotBarcode: variant.barcode,
        snapshotSku: variant.sku,
        snapshotDescription: garmentDescription(variant),
        snapshotSize: variant.size || null,
        snapshotColor: variant.color || null,
        snapshotSellingPrice: variant.sellingPrice === null || variant.sellingPrice === undefined ? null : Number(variant.sellingPrice),
        snapshotAttributes: JSON.stringify(garmentAttributes(variant)),
        snapshotCategoryId: variant.categoryId,
        snapshotTaxRate: Number(variant.taxRate),
        snapshotMrp: Number(variant.mrp),
        snapshotMetadata: variant.metadata ?? null,
    };
}

export interface DraftLineInput {
    id?: string;
    variantId: string;
    countedQuantity?: number | null;
    notes?: string | null;
    sortOrder?: number;
}

export interface CreateDraftInput {
    operationId: string;
    draftId?: string;
    batchDescription: string;
    observedAt?: string | Date | null;
    sourceReference?: string | null;
    notes?: string | null;
    lines?: DraftLineInput[];
}

export interface SaveDraftInput {
    operationId: string;
    draftId: string;
    expectedRevision: number;
    batchDescription: string;
    observedAt?: string | Date | null;
    sourceReference?: string | null;
    notes?: string | null;
    lines: DraftLineInput[];
}

export interface CancelDraftInput {
    operationId: string;
    draftId: string;
    expectedRevision: number;
    reason?: string | null;
}

export interface ListDraftsArgs {
    page?: number;
    pageSize?: number;
    status?: 'ALL' | 'DRAFT' | 'CANCELLED' | 'POSTED';
    search?: string;
}

export function authorizeInventory(user: any) {
    if (!user?.isActive || !(user.role === 'ADMIN' || user.permManageInventory)) {
        throw new Error('Permission Denied: You do not have permission to manage inventory or stock drafts.');
    }
}

/**
 * Additive schema for ST-03A Stock Count Drafts.
 * Uses SQLite raw queries so it operates cleanly across runtime environments
 * without requiring destructive migrations or Prisma regeneration.
 */
export async function ensureStockDraftSchema(prisma: any): Promise<void> {
    if (schemaReady.has(prisma)) return;
    const pending = schemaPending.get(prisma);
    if (pending) return pending;

    const work = (async () => {
        // Ensure catalogue schema (ProductVariant isPrepared column and sidecars) is present first
        await ensureCatalogueSchema(prisma);

        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "StockCountDraft" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "operationKind" TEXT NOT NULL DEFAULT 'CONVERSION_ADDITION',
                "status" TEXT NOT NULL DEFAULT 'DRAFT',
                "batchDescription" TEXT NOT NULL,
                "sourceReference" TEXT,
                "notes" TEXT,
                "observedAt" DATETIME,
                "revision" INTEGER NOT NULL DEFAULT 1,
                "createdBy" TEXT NOT NULL,
                "createdByName" TEXT,
                "updatedBy" TEXT NOT NULL,
                "updatedByName" TEXT,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "StockCountDraftLine" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "draftId" TEXT NOT NULL,
                "variantId" TEXT NOT NULL,
                "countedQuantity" INTEGER,
                "notes" TEXT,
                "sortOrder" INTEGER NOT NULL DEFAULT 0,
                "snapshotProductName" TEXT NOT NULL,
                "snapshotBarcode" TEXT NOT NULL,
                "snapshotSku" TEXT NOT NULL,
                "snapshotDescription" TEXT,
                "snapshotSize" TEXT,
                "snapshotColor" TEXT,
                "snapshotSellingPrice" REAL,
                "snapshotAttributes" TEXT,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY ("draftId") REFERENCES "StockCountDraft" ("id") ON DELETE CASCADE,
                FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id"),
                UNIQUE("draftId", "variantId")
            )
        `);

        // Older ST-03A drafts keep their original snapshots. Unknown historical
        // structured attributes remain null instead of being backfilled from today's catalogue.
        const lineColumns: any[] = await prisma.$queryRawUnsafe('PRAGMA table_info("StockCountDraftLine")');
        if (!lineColumns.some(column => column.name === 'snapshotAttributes')) {
            try {
                await prisma.$executeRawUnsafe('ALTER TABLE "StockCountDraftLine" ADD COLUMN "snapshotAttributes" TEXT');
            } catch (error) {
                const freshColumns: any[] = await prisma.$queryRawUnsafe('PRAGMA table_info("StockCountDraftLine")');
                if (!freshColumns.some(column => column.name === 'snapshotAttributes')) throw error;
            }
        }

        for (const [name, type] of [['snapshotCategoryId', 'TEXT'], ['snapshotTaxRate', 'REAL'], ['snapshotMrp', 'REAL'], ['snapshotMetadata', 'TEXT']]) {
            if (!lineColumns.some(column => column.name === name)) {
                try { await prisma.$executeRawUnsafe(`ALTER TABLE "StockCountDraftLine" ADD COLUMN "${name}" ${type}`); }
                catch (error) {
                    const fresh: any[] = await prisma.$queryRawUnsafe('PRAGMA table_info("StockCountDraftLine")');
                    if (!fresh.some(column => column.name === name)) throw error;
                }
            }
        }
        // Explicit tracking is separate from old catalogue quantities. Existing rows are never backfilled.
        await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "StockVariantTracking" (
            "variantId" TEXT NOT NULL PRIMARY KEY, "activatedAt" TEXT NOT NULL,
            FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE CASCADE
        )`);

        await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "StockCountDraft_status_idx" ON "StockCountDraft"("status")
        `);

        await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "StockCountDraftLine_draftId_idx" ON "StockCountDraftLine"("draftId")
        `);

        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "StockDraftOperation" (
                "operationId" TEXT NOT NULL PRIMARY KEY,
                "draftId" TEXT NOT NULL,
                "action" TEXT NOT NULL,
                "payloadHash" TEXT NOT NULL,
                "resultJson" TEXT NOT NULL,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "StockDraftWriteLock" (
                "id" INTEGER NOT NULL PRIMARY KEY,
                "token" INTEGER NOT NULL DEFAULT 0
            )
        `);
        await prisma.$executeRawUnsafe(`
            INSERT OR IGNORE INTO "StockDraftWriteLock" ("id", "token") VALUES (1, 0)
        `);

        schemaReady.add(prisma);
    })();

    schemaPending.set(prisma, work);
    try {
        await work;
    } finally {
        schemaPending.delete(prisma);
    }
}

async function draftWriteLock(tx: any) {
    await tx.$executeRawUnsafe('UPDATE "StockDraftWriteLock" SET "token" = "token" WHERE "id" = 1');
}

function canonical(value: any): any {
    if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .filter((k) => value[k] !== undefined)
                .map((k) => [k, canonical(value[k])])
        );
    }
    return value;
}

function computePayloadHash(payload: any): string {
    return crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}

/** JSON object key order is serialization detail, not a change of garment identity. */
export function areStockMetadataEqual(left: unknown, right: unknown): boolean {
    const comparable = (value: unknown) => {
        if (value === undefined || value === null) return null;
        if (typeof value !== 'string') return canonical(value);
        try { return canonical(JSON.parse(value)); } catch { return value; }
    };
    return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

/**
 * Validates non-negative whole count quantity.
 * Null/undefined is treated as uncounted (valid incomplete draft).
 * Whole integers >= 0 are valid counts (0 is explicit zero, not uncounted).
 * Rejects negative, fractional, NaN, non-finite.
 */
function validateCountedQuantity(qty: unknown, lineLabel: string): number | null {
    if (qty === null || qty === undefined || qty === '') {
        return null;
    }
    const num = Number(qty);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
        throw new Error(
            `${lineLabel}: Count must be a non-negative whole piece quantity (or left blank for uncounted).`
        );
    }
    return num;
}

/**
 * Search prepared variants for the draft picker.
 * Includes prepared variants and explicitly tracked targets for another held conversion batch. Masks costPrice.
 */
export async function searchPreparedVariants(prisma: any, args: { search?: string; limit?: number } = {}, user: any) {
    authorizeInventory(user);
    await ensureStockDraftSchema(prisma);

    const limit = Math.min(Math.max(1, Number(args.limit) || 30), 100);
    const search = normalizeText(args.search);

    const tokens = search ? search.split(/\s+/).filter(Boolean) : [];
    let sql = `
        SELECT pv.id, pv.sku, pv.barcode, pv.size, pv.color, pv.sellingPrice, pv.stock, pv.isActive,
               COALESCE(pv.isPrepared, 0) AS isPrepared,
               COALESCE(gd.isPrepared, 0) AS detailPrepared,
               CASE WHEN st.variantId IS NULL THEN 0 ELSE 1 END AS isTracked,
               p.id AS productId, p.name AS productName, p.isActive AS productActive, p.categoryId, p.taxRate, pv.mrp,
                       CASE WHEN st.variantId IS NULL THEN 0 ELSE 1 END AS isTracked,
               c.name AS categoryName,
               gd.brand, gd.fabric, gd.quality, gd.pattern, gd.sleeve, gd.fit, gd.collar, gd.pocket, gd.styleRef,
               gd.formattedDescription
        FROM "ProductVariant" pv
        JOIN "Product" p ON p.id = pv.productId
        LEFT JOIN "Category" c ON c.id = p.categoryId
        LEFT JOIN "ProductVariantGarmentDetail" gd ON gd.variantId = pv.id
        LEFT JOIN "StockVariantTracking" st ON st.variantId = pv.id
        WHERE (COALESCE(pv.isPrepared, 0) <> 0 OR COALESCE(gd.isPrepared, 0) <> 0 OR st.variantId IS NOT NULL)
          AND pv.isActive = 1
          AND p.isActive = 1
    `;
    const params: any[] = [];

    if (tokens.length > 0) {
        for (const token of tokens) {
            sql += ` AND (
                pv.barcode LIKE ? OR
                pv.sku LIKE ? OR
                p.name LIKE ? OR
                COALESCE(gd.brand, '') LIKE ? OR
                COALESCE(gd.quality, '') LIKE ? OR
                COALESCE(gd.styleRef, '') LIKE ? OR
                COALESCE(gd.formattedDescription, '') LIKE ?
            )`;
            const pattern = `%${token}%`;
            params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
        }
    }

    sql += ` ORDER BY p.name ASC, pv.sku ASC, pv.id ASC LIMIT ?`;
    params.push(limit);

    const rows: any[] = await prisma.$queryRawUnsafe(sql, ...params);

    return rows.map((r) => {
        const desc = garmentDescription(r);
        return {
            id: r.id,
            sku: r.sku,
            barcode: r.barcode,
            size: r.size,
            color: r.color,
            sellingPrice: r.sellingPrice,
            stock: r.stock,
            isPrepared: isPreparedVariant(r),
            isTracked: Boolean(r.isTracked),
            productId: r.productId,
            productName: r.productName,
            categoryName: r.categoryName,
            formattedDescription: desc,
            // Strictly NO costPrice
        };
    });
}

/**
 * List stock count drafts with pagination and stats.
 */
export async function listDrafts(prisma: any, args: ListDraftsArgs = {}, user: any) {
    authorizeInventory(user);
    if (args.status && !['ALL', 'DRAFT', 'CANCELLED', 'POSTED'].includes(args.status)) throw new Error('Invalid stock draft status filter.');
    await ensureStockDraftSchema(prisma);

    const requestedPage = Math.max(1, Math.floor(Number(args.page) || 1));
    const pageSize = Math.min(Math.max(1, Math.floor(Number(args.pageSize) || 20)), 100);

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (args.status && args.status !== 'ALL') {
        whereClause += ' AND d.status = ?';
        params.push(args.status);
    }

    const search = normalizeText(args.search);
    if (search) {
        whereClause += ' AND (d.batchDescription LIKE ? OR COALESCE(d.sourceReference, "") LIKE ? OR COALESCE(d.notes, "") LIKE ?)';
        const pattern = `%${search}%`;
        params.push(pattern, pattern, pattern);
    }

    const countSql = `SELECT COUNT(*) AS total FROM "StockCountDraft" d ${whereClause}`;
    const countRows: any[] = await prisma.$queryRawUnsafe(countSql, ...params);
    const totalMatching = Number(countRows[0]?.total || 0);

    const totalPages = Math.ceil(totalMatching / pageSize) || 1;
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * pageSize;

    const selectSql = `
        SELECT d.id, d.operationKind, d.status, d.batchDescription, d.sourceReference, d.notes,
               d.observedAt, d.revision, d.createdBy, d.createdByName, d.updatedBy, d.updatedByName,
               d.createdAt, d.updatedAt,
               (SELECT COUNT(*) FROM "StockCountDraftLine" l WHERE l.draftId = d.id) AS totalLines,
               (SELECT COUNT(*) FROM "StockCountDraftLine" l WHERE l.draftId = d.id AND l.countedQuantity IS NOT NULL) AS countedLines,
               (SELECT COALESCE(SUM(l.countedQuantity), 0) FROM "StockCountDraftLine" l WHERE l.draftId = d.id AND l.countedQuantity IS NOT NULL) AS totalCountedPieces
        FROM "StockCountDraft" d
        ${whereClause}
        ORDER BY d.updatedAt DESC, d.id DESC
        LIMIT ? OFFSET ?
    `;
    const rows: any[] = await prisma.$queryRawUnsafe(selectSql, ...params, pageSize, offset);

    // Also get overall counts of drafts
    const statsRows: any[] = await prisma.$queryRawUnsafe(`
        SELECT
            COUNT(*) AS totalDrafts,
            SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS activeDraftCount,
            SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelledDraftCount,
            SUM(CASE WHEN status = 'POSTED' THEN 1 ELSE 0 END) AS postedDraftCount
        FROM "StockCountDraft"
    `);

    return {
        items: rows.map((r) => ({
            id: r.id,
            operationKind: r.operationKind,
            status: r.status,
            batchDescription: r.batchDescription,
            sourceReference: r.sourceReference,
            notes: r.notes,
            observedAt: r.observedAt ? new Date(r.observedAt).toISOString() : null,
            revision: Number(r.revision),
            createdBy: r.createdBy,
            createdByName: r.createdByName || r.createdBy,
            updatedBy: r.updatedBy,
            updatedByName: r.updatedByName || r.updatedBy,
            createdAt: new Date(r.createdAt).toISOString(),
            updatedAt: new Date(r.updatedAt).toISOString(),
            totalLines: Number(r.totalLines || 0),
            countedLines: Number(r.countedLines || 0),
            totalCountedPieces: Number(r.totalCountedPieces || 0),
        })),
        totalMatching,
        page,
        pageSize,
        totalPages,
        stats: {
            totalDrafts: Number(statsRows[0]?.totalDrafts || 0),
            activeDraftCount: Number(statsRows[0]?.activeDraftCount || 0),
            cancelledDraftCount: Number(statsRows[0]?.cancelledDraftCount || 0),
            postedDraftCount: Number(statsRows[0]?.postedDraftCount || 0),
        },
    };
}

/**
 * Retrieve a specific draft by ID with full line snapshots and current live catalogue comparison.
 * Never silently substitutes a variant: flags differences or unavailability for review.
 */
export async function getDraft(prisma: any, args: { draftId: string }, user: any) {
    authorizeInventory(user);
    if (!args?.draftId || typeof args.draftId !== 'string') {
        throw new Error('Draft ID is required.');
    }
    await ensureStockDraftSchema(prisma);

    const draftRows: any[] = await prisma.$queryRawUnsafe(
        'SELECT * FROM "StockCountDraft" WHERE "id" = ?',
        args.draftId
    );
    if (!draftRows.length) {
        throw new Error(`Stock count draft not found: ${args.draftId}`);
    }
    const draft = draftRows[0];

    const lines: any[] = await prisma.$queryRawUnsafe(
        'SELECT * FROM "StockCountDraftLine" WHERE "draftId" = ? ORDER BY "sortOrder" ASC, "createdAt" ASC, "id" ASC',
        args.draftId
    );

    // Fetch live catalogue data for each referenced variant to compare with snapshot
    const variantIds = lines.map((l) => l.variantId);
    let liveVariantMap = new Map<string, any>();
    if (variantIds.length > 0) {
        const placeholders = variantIds.map(() => '?').join(',');
        const liveRows: any[] = await prisma.$queryRawUnsafe(`
            SELECT pv.id, pv.sku, pv.barcode, pv.size, pv.color, pv.sellingPrice, pv.stock, pv.isActive,
                   COALESCE(pv.isPrepared, 0) AS isPrepared,
                   COALESCE(gd.isPrepared, 0) AS detailPrepared,
                   p.name AS productName, p.isActive AS productActive, p.categoryId, p.taxRate, pv.mrp,
                       CASE WHEN st.variantId IS NULL THEN 0 ELSE 1 END AS isTracked,
                   gd.brand, gd.fabric, gd.quality, gd.pattern, gd.sleeve, gd.fit, gd.collar, gd.pocket, gd.styleRef,
                   gd.formattedDescription, gd.metadata
            FROM "ProductVariant" pv
            JOIN "Product" p ON p.id = pv.productId
            LEFT JOIN "ProductVariantGarmentDetail" gd ON gd.variantId = pv.id
            LEFT JOIN "StockVariantTracking" st ON st.variantId = pv.id
            WHERE pv.id IN (${placeholders})
        `, ...variantIds);

        for (const row of liveRows) {
            liveVariantMap.set(row.id, row);
        }
    }

    const formattedLines = lines.map((l) => {
        const live = liveVariantMap.get(l.variantId);
        let catalogueStatus: 'OK' | 'CHANGED' | 'UNAVAILABLE' = 'OK';
        let statusMessage = '';

        if (!live || !live.isActive || !live.productActive) {
            catalogueStatus = 'UNAVAILABLE';
            statusMessage = 'Referenced variant is deactivated or unavailable in catalogue.';
        } else {
            const currentDesc = garmentDescription(live);
            const changedName = !areNormalizedStringsEqual(l.snapshotProductName, live.productName);
            const changedBarcode = l.snapshotBarcode !== live.barcode;
            const changedSku = l.snapshotSku !== live.sku;
            const diffs: string[] = [];
            if (changedName) diffs.push(`Name changed: "${live.productName}"`);
            if (changedBarcode) diffs.push(`Barcode changed: "${live.barcode}"`);
            if (changedSku) diffs.push(`SKU changed: "${live.sku}"`);
            if (!areNormalizedStringsEqual(l.snapshotDescription || l.snapshotProductName, currentDesc)) diffs.push('Garment description changed');
            if (!areNormalizedStringsEqual(l.snapshotSize, live.size)) diffs.push(`Size changed: "${live.size || 'Not recorded'}"`);
            if (!areNormalizedStringsEqual(l.snapshotColor, live.color)) diffs.push('Recorded colour changed');
            const savedPrice = l.snapshotSellingPrice === null ? null : Number(l.snapshotSellingPrice);
            const livePrice = live.sellingPrice === null || live.sellingPrice === undefined ? null : Number(live.sellingPrice);
            if (savedPrice !== livePrice) diffs.push('Selling price changed');
            if (!isConversionTarget(live)) diffs.push('Preparation status changed: item is neither prepared nor explicitly tracked');
            if (l.snapshotCategoryId === null || l.snapshotTaxRate === null || l.snapshotMrp === null || !l.snapshotAttributes) {
                diffs.push('Older saved entry lacks reviewed category, tax or MRP checkpoints; create a fresh entry before activating');
            } else if (l.snapshotCategoryId !== live.categoryId || Number(l.snapshotTaxRate) !== Number(live.taxRate) || Number(l.snapshotMrp) !== Number(live.mrp)) diffs.push('Reviewed category, tax or MRP changed');
            if (!areStockMetadataEqual(l.snapshotMetadata, live.metadata)) diffs.push('Recorded audit attributes changed');
            if (l.snapshotAttributes !== null && l.snapshotAttributes !== undefined) {
                try {
                    const savedAttributes = JSON.parse(l.snapshotAttributes);
                    if (!savedAttributes || typeof savedAttributes !== 'object' || Array.isArray(savedAttributes)) throw new Error('Invalid attribute snapshot');
                    for (const field of snapshotAttributeFields) {
                        if (!areNormalizedStringsEqual(savedAttributes[field], live[field])) diffs.push(`${field === 'styleRef' ? 'Style/model reference' : field.charAt(0).toUpperCase() + field.slice(1)} changed`);
                    }
                } catch {
                    diffs.push('Saved attribute snapshot requires review');
                }
            }

            if (diffs.length > 0) {
                catalogueStatus = 'CHANGED';
                statusMessage = diffs.join(', ');
            }
        }

        return {
            id: l.id,
            draftId: l.draftId,
            variantId: l.variantId,
            countedQuantity: l.countedQuantity === null ? null : Number(l.countedQuantity),
            notes: l.notes || '',
            sortOrder: Number(l.sortOrder || 0),
            snapshot: {
                productName: l.snapshotProductName,
                barcode: l.snapshotBarcode,
                sku: l.snapshotSku,
                description: l.snapshotDescription || l.snapshotProductName,
                size: l.snapshotSize || null,
                color: l.snapshotColor || null,
                sellingPrice: l.snapshotSellingPrice !== null ? Number(l.snapshotSellingPrice) : null,
            },
            catalogueStatus,
            statusMessage,
            currentLiveDetails: live
                ? {
                      productName: live.productName,
                      barcode: live.barcode,
                      sku: live.sku,
                      formattedDescription: garmentDescription(live),
                      size: live.size,
                      color: live.color,
                      attributes: garmentAttributes(live),
                      sellingPrice: live.sellingPrice,
                      isPrepared: isPreparedVariant(live),
                      isTracked: Boolean(live.isTracked),
                  }
                : null,
        };
    });

    const totalCountedPieces = formattedLines.reduce((sum, l) => (l.countedQuantity !== null ? sum + l.countedQuantity : sum), 0);
    const uncountedLines = formattedLines.filter((l) => l.countedQuantity === null).length;

    return {
        id: draft.id,
        operationKind: draft.operationKind,
        status: draft.status,
        batchDescription: draft.batchDescription,
        sourceReference: draft.sourceReference || '',
        notes: draft.notes || '',
        observedAt: draft.observedAt ? new Date(draft.observedAt).toISOString() : null,
        revision: Number(draft.revision),
        createdBy: draft.createdBy,
        createdByName: draft.createdByName || draft.createdBy,
        updatedBy: draft.updatedBy,
        updatedByName: draft.updatedByName || draft.updatedBy,
        createdAt: new Date(draft.createdAt).toISOString(),
        updatedAt: new Date(draft.updatedAt).toISOString(),
        totalLines: formattedLines.length,
        totalCountedPieces,
        uncountedLines,
        lines: formattedLines,
    };
}

/**
 * Creates a new durable stock-count draft.
 * Atomic with writeLock and durable operation replay.
 */
export async function createDraft(prisma: any, input: CreateDraftInput, user: any) {
    authorizeInventory(user);
    if (!input || typeof input.operationId !== 'string' || !input.operationId.trim()) {
        throw new Error('A stable operation ID is required for durable draft creation.');
    }
    const batchDescription = normalizeText(input.batchDescription);
    if (!batchDescription) {
        throw new Error('Batch description is required (e.g. rack section or batch being counted).');
    }

    const {
        userId: _u,
        requestingUserId: _r,
        sessionToken: _s,
        authToken: _a,
        sessionId: _sid,
        ...normalizedPayload
    } = input as CreateDraftInput & Record<string, unknown>;

    const payloadHash = computePayloadHash(normalizedPayload);
    await ensureStockDraftSchema(prisma);

    return await prisma.$transaction(async (tx: any) => {
        await draftWriteLock(tx);

        // Check for replay of existing operation ID
        const existingOps: any[] = await tx.$queryRawUnsafe(
            'SELECT * FROM "StockDraftOperation" WHERE "operationId" = ?',
            input.operationId
        );
        if (existingOps.length) {
            const op = existingOps[0];
            if (op.payloadHash !== payloadHash) {
                throw new Error('Operation ID was already used for a different draft payload. Use a new operation ID.');
            }
            return JSON.parse(op.resultJson);
        }

        const draftId = input.draftId?.trim() || crypto.randomUUID();
        const now = new Date();

        let observedAt: Date | null = null;
        if (input.observedAt) {
            const d = new Date(input.observedAt);
            if (!Number.isNaN(d.getTime())) observedAt = d;
        }

        const sourceReference = normalizeText(input.sourceReference) || null;
        const notes = normalizeText(input.notes) || null;
        const creatorName = user.name || user.username || user.id;

        // Process lines if provided
        const linesInput = input.lines || [];
        const variantIdSet = new Set<string>();
        const processedLines: any[] = [];

        if (linesInput.length > 0) {
            const variantIds = linesInput.map((l) => l.variantId);
            const placeholders = variantIds.map(() => '?').join(',');

            // Verify variants exist and are in preparation
            const variantRows: any[] = await tx.$queryRawUnsafe(`
                SELECT pv.id, pv.sku, pv.barcode, pv.size, pv.color, pv.sellingPrice, pv.stock, pv.isActive,
                       COALESCE(pv.isPrepared, 0) AS isPrepared,
                       COALESCE(gd.isPrepared, 0) AS detailPrepared,
                       p.name AS productName, p.isActive AS productActive, p.categoryId, p.taxRate, pv.mrp,
                       CASE WHEN st.variantId IS NULL THEN 0 ELSE 1 END AS isTracked,
                       gd.brand, gd.fabric, gd.quality, gd.pattern, gd.sleeve, gd.fit, gd.collar, gd.pocket, gd.styleRef,
                       gd.formattedDescription, gd.metadata
                FROM "ProductVariant" pv
                JOIN "Product" p ON p.id = pv.productId
                LEFT JOIN "ProductVariantGarmentDetail" gd ON gd.variantId = pv.id
                LEFT JOIN "StockVariantTracking" st ON st.variantId = pv.id
                WHERE pv.id IN (${placeholders})
            `, ...variantIds);

            const variantMap = new Map<string, any>();
            for (const row of variantRows) {
                variantMap.set(row.id, row);
            }

            for (let idx = 0; idx < linesInput.length; idx++) {
                const line = linesInput[idx];
                if (!line.variantId || typeof line.variantId !== 'string') {
                    throw new Error(`Line ${idx + 1}: Real variant ID is required.`);
                }
                if (variantIdSet.has(line.variantId)) {
                    throw new Error(`Duplicate variant line in draft: variant ID ${line.variantId} cannot be added multiple times. Edit the existing line quantity instead.`);
                }
                variantIdSet.add(line.variantId);

                const v = variantMap.get(line.variantId);
                if (!v) {
                    throw new Error(`Variant not found: ${line.variantId}. Adding an identified line requires a real saved variant.`);
                }
                if (!v.isActive || !v.productActive) {
                    throw new Error(`Variant ${v.barcode} is inactive. Inactive catalogue items cannot be added to a new draft.`);
                }
                if (!isConversionTarget(v)) {
                    throw new Error(`Variant ${v.barcode} is neither in preparation nor explicitly tracked. Stock-count drafts require a prepared or tracked target.`);
                }

                const countedQuantity = validateCountedQuantity(line.countedQuantity, `Line ${idx + 1} (${v.barcode})`);
                const lineNotes = normalizeText(line.notes) || null;
                processedLines.push({
                    id: line.id?.trim() || crypto.randomUUID(),
                    draftId,
                    variantId: v.id,
                    countedQuantity,
                    notes: lineNotes,
                    sortOrder: line.sortOrder !== undefined ? Number(line.sortOrder) : idx,
                    ...captureSnapshot(v),
                });
            }
        }

        // Insert draft header
        await tx.$executeRawUnsafe(`
            INSERT INTO "StockCountDraft" (
                "id", "operationKind", "status", "batchDescription", "sourceReference", "notes",
                "observedAt", "revision", "createdBy", "createdByName", "updatedBy", "updatedByName",
                "createdAt", "updatedAt"
            ) VALUES (?, 'CONVERSION_ADDITION', 'DRAFT', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
        `,
            draftId,
            batchDescription,
            sourceReference,
            notes,
            observedAt ? observedAt.toISOString() : null,
            user.id,
            creatorName,
            user.id,
            creatorName,
            now.toISOString(),
            now.toISOString()
        );

        // Insert draft lines
        for (const pl of processedLines) {
            await tx.$executeRawUnsafe(`
                INSERT INTO "StockCountDraftLine" (
                    "id", "draftId", "variantId", "countedQuantity", "notes", "sortOrder",
                    "snapshotProductName", "snapshotBarcode", "snapshotSku", "snapshotDescription",
                    "snapshotSize", "snapshotColor", "snapshotSellingPrice", "snapshotAttributes",
                    "snapshotCategoryId", "snapshotTaxRate", "snapshotMrp", "snapshotMetadata", "createdAt", "updatedAt"
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
                pl.id,
                pl.draftId,
                pl.variantId,
                pl.countedQuantity,
                pl.notes,
                pl.sortOrder,
                pl.snapshotProductName,
                pl.snapshotBarcode,
                pl.snapshotSku,
                pl.snapshotDescription,
                pl.snapshotSize,
                pl.snapshotColor,
                pl.snapshotSellingPrice,
                pl.snapshotAttributes,
                pl.snapshotCategoryId, pl.snapshotTaxRate, pl.snapshotMrp, pl.snapshotMetadata,
                now.toISOString(),
                now.toISOString()
            );
        }

        const result = {
            success: true,
            message: 'Draft was saved successfully.',
            draftId,
            revision: 1,
            status: 'DRAFT',
            totalLines: processedLines.length,
        };

        // Record operation replay record
        await tx.$executeRawUnsafe(`
            INSERT INTO "StockDraftOperation" ("operationId", "draftId", "action", "payloadHash", "resultJson", "createdAt")
            VALUES (?, ?, 'CREATE', ?, ?, ?)
        `, input.operationId, draftId, payloadHash, JSON.stringify(result), now.toISOString());

        return result;
    }, { timeout: 15000 });
}

/**
 * Saves modifications to an existing draft.
 * Validates revision (optimistic locking), ensures status is not CANCELLED,
 * validates quantities, preserves original line snapshots, and updates header revision.
 */
export async function saveDraft(prisma: any, input: SaveDraftInput, user: any) {
    authorizeInventory(user);
    if (!input || typeof input.operationId !== 'string' || !input.operationId.trim()) {
        throw new Error('A stable operation ID is required for saving draft.');
    }
    if (!input.draftId || typeof input.draftId !== 'string') {
        throw new Error('Draft ID is required.');
    }
    if (typeof input.expectedRevision !== 'number' || !Number.isInteger(input.expectedRevision)) {
        throw new Error('Draft expectedRevision is required for concurrency control.');
    }
    const batchDescription = normalizeText(input.batchDescription);
    if (!batchDescription) {
        throw new Error('Batch description is required.');
    }

    const {
        userId: _u,
        requestingUserId: _r,
        sessionToken: _s,
        authToken: _a,
        sessionId: _sid,
        ...normalizedPayload
    } = input as SaveDraftInput & Record<string, unknown>;

    const payloadHash = computePayloadHash(normalizedPayload);
    await ensureStockDraftSchema(prisma);

    return await prisma.$transaction(async (tx: any) => {
        await draftWriteLock(tx);

        // Check for replay of existing operation ID
        const existingOps: any[] = await tx.$queryRawUnsafe(
            'SELECT * FROM "StockDraftOperation" WHERE "operationId" = ?',
            input.operationId
        );
        if (existingOps.length) {
            const op = existingOps[0];
            if (op.payloadHash !== payloadHash) {
                throw new Error('Operation ID was already used for different draft content. Start a new save operation.');
            }
            return JSON.parse(op.resultJson);
        }

        // Fetch draft
        const draftRows: any[] = await tx.$queryRawUnsafe(
            'SELECT * FROM "StockCountDraft" WHERE "id" = ?',
            input.draftId
        );
        if (!draftRows.length) {
            throw new Error(`Draft not found: ${input.draftId}`);
        }
        const draft = draftRows[0];

        // Terminal check: Cancelled drafts cannot be edited or revived
        if (draft.status === 'CANCELLED') throw new Error('Cancelled drafts cannot be edited or revived. Cancellation is terminal.');
        if (draft.status !== 'DRAFT') throw new Error('Posted drafts cannot be edited or revived. Start a new batch.');

        // Revision check: Competing edits detection
        if (Number(draft.revision) !== input.expectedRevision) {
            throw new Error('Stale edit: this draft was modified by another operator. Please reload and review the latest changes.');
        }

        const now = new Date();
        const nextRevision = Number(draft.revision) + 1;
        const editorName = user.name || user.username || user.id;

        let observedAt: Date | null = null;
        if (input.observedAt) {
            const d = new Date(input.observedAt);
            if (!Number.isNaN(d.getTime())) observedAt = d;
        }

        const sourceReference = normalizeText(input.sourceReference) || null;
        const notes = normalizeText(input.notes) || null;

        // Process and validate lines
        const existingLines: any[] = await tx.$queryRawUnsafe(
            'SELECT * FROM "StockCountDraftLine" WHERE "draftId" = ?', input.draftId
        );
        const existingLineById = new Map<string, any>(existingLines.map(line => [line.id, line]));
        const existingLineByVariant = new Map<string, any>(existingLines.map(line => [line.variantId, line]));
        const linesInput = input.lines || [];
        const variantIdSet = new Set<string>();
        const processedLines: any[] = [];

        if (linesInput.length > 0) {
            const variantIds = linesInput.map((l) => l.variantId);
            const placeholders = variantIds.map(() => '?').join(',');

            const variantRows: any[] = await tx.$queryRawUnsafe(`
                SELECT pv.id, pv.sku, pv.barcode, pv.size, pv.color, pv.sellingPrice, pv.stock, pv.isActive,
                       COALESCE(pv.isPrepared, 0) AS isPrepared,
                       COALESCE(gd.isPrepared, 0) AS detailPrepared,
                       p.name AS productName, p.isActive AS productActive, p.categoryId, p.taxRate, pv.mrp,
                       CASE WHEN st.variantId IS NULL THEN 0 ELSE 1 END AS isTracked,
                       gd.brand, gd.fabric, gd.quality, gd.pattern, gd.sleeve, gd.fit, gd.collar, gd.pocket, gd.styleRef,
                       gd.formattedDescription, gd.metadata
                FROM "ProductVariant" pv
                JOIN "Product" p ON p.id = pv.productId
                LEFT JOIN "ProductVariantGarmentDetail" gd ON gd.variantId = pv.id
                LEFT JOIN "StockVariantTracking" st ON st.variantId = pv.id
                WHERE pv.id IN (${placeholders})
            `, ...variantIds);

            const variantMap = new Map<string, any>();
            for (const row of variantRows) {
                variantMap.set(row.id, row);
            }

            for (let idx = 0; idx < linesInput.length; idx++) {
                const line = linesInput[idx];
                if (!line.variantId || typeof line.variantId !== 'string') {
                    throw new Error(`Line ${idx + 1}: Real variant ID is required.`);
                }
                if (variantIdSet.has(line.variantId)) {
                    throw new Error(`Duplicate variant line: variant ID ${line.variantId} cannot be added multiple times. Edit the batch quantity on the existing line.`);
                }
                variantIdSet.add(line.variantId);

                if (line.id !== undefined && (typeof line.id !== 'string' || !line.id.trim())) {
                    throw new Error(`Line ${idx + 1}: A supplied line ID must be a non-empty string.`);
                }
                const suppliedId = line.id?.trim();
                const lineWithId = suppliedId ? existingLineById.get(suppliedId) : undefined;
                if (lineWithId && lineWithId.variantId !== line.variantId) {
                    throw new Error('An existing draft line cannot be reassigned to another variant. Remove it and add a new line.');
                }
                const existingLine = existingLineByVariant.get(line.variantId);
                if (existingLine && suppliedId && suppliedId !== existingLine.id) {
                    throw new Error('An existing draft line ID cannot be replaced. Reload the draft before saving.');
                }
                const v = variantMap.get(line.variantId);
                if (!existingLine && !v) {
                    throw new Error(`Variant not found: ${line.variantId}. Adding an identified line requires a real saved variant.`);
                }
                if (!existingLine && (!v.isActive || !v.productActive)) {
                    throw new Error(`Variant ${v.barcode} is inactive. Inactive catalogue items cannot be added to a draft.`);
                }
                if (!existingLine && !isConversionTarget(v)) {
                    throw new Error(`Variant ${v.barcode} is neither in preparation nor explicitly tracked. Stock-count drafts require a prepared or tracked target.`);
                }

                const countedQuantity = validateCountedQuantity(line.countedQuantity, `Line ${idx + 1} (${existingLine ? existingLine.snapshotBarcode : v.barcode})`);
                const lineNotes = normalizeText(line.notes) || null;
                const snapshot = existingLine ? {
                    snapshotProductName: existingLine.snapshotProductName,
                    snapshotBarcode: existingLine.snapshotBarcode,
                    snapshotSku: existingLine.snapshotSku,
                    snapshotDescription: existingLine.snapshotDescription,
                    snapshotSize: existingLine.snapshotSize,
                    snapshotColor: existingLine.snapshotColor,
                    snapshotSellingPrice: existingLine.snapshotSellingPrice,
                    snapshotAttributes: existingLine.snapshotAttributes,
                    snapshotCategoryId: existingLine.snapshotCategoryId,
                    snapshotTaxRate: existingLine.snapshotTaxRate,
                    snapshotMrp: existingLine.snapshotMrp,
                    snapshotMetadata: existingLine.snapshotMetadata,
                } : captureSnapshot(v);

                processedLines.push({
                    id: existingLine?.id || suppliedId || crypto.randomUUID(),
                    draftId: input.draftId,
                    variantId: line.variantId,
                    countedQuantity,
                    notes: lineNotes,
                    sortOrder: line.sortOrder !== undefined ? Number(line.sortOrder) : idx,
                    createdAt: existingLine ? new Date(existingLine.createdAt).toISOString() : now.toISOString(),
                    ...snapshot,
                });
            }
        }

        // Update draft header with optimistic check on revision
        const updateResult = await tx.$executeRawUnsafe(`
            UPDATE "StockCountDraft"
            SET "batchDescription" = ?,
                "sourceReference" = ?,
                "notes" = ?,
                "observedAt" = ?,
                "revision" = ?,
                "updatedBy" = ?,
                "updatedByName" = ?,
                "updatedAt" = ?
            WHERE "id" = ? AND "revision" = ? AND "status" = 'DRAFT'
        `,
            batchDescription,
            sourceReference,
            notes,
            observedAt ? observedAt.toISOString() : null,
            nextRevision,
            user.id,
            editorName,
            now.toISOString(),
            input.draftId,
            input.expectedRevision
        );

        if (updateResult !== 1) {
            throw new Error('Stale edit: draft was modified or cancelled concurrently. Please reload.');
        }

        // Delete old lines and insert new lines atomically
        await tx.$executeRawUnsafe('DELETE FROM "StockCountDraftLine" WHERE "draftId" = ?', input.draftId);

        for (const pl of processedLines) {
            await tx.$executeRawUnsafe(`
                INSERT INTO "StockCountDraftLine" (
                    "id", "draftId", "variantId", "countedQuantity", "notes", "sortOrder",
                    "snapshotProductName", "snapshotBarcode", "snapshotSku", "snapshotDescription",
                    "snapshotSize", "snapshotColor", "snapshotSellingPrice", "snapshotAttributes",
                    "snapshotCategoryId", "snapshotTaxRate", "snapshotMrp", "snapshotMetadata", "createdAt", "updatedAt"
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
                pl.id,
                pl.draftId,
                pl.variantId,
                pl.countedQuantity,
                pl.notes,
                pl.sortOrder,
                pl.snapshotProductName,
                pl.snapshotBarcode,
                pl.snapshotSku,
                pl.snapshotDescription,
                pl.snapshotSize,
                pl.snapshotColor,
                pl.snapshotSellingPrice,
                pl.snapshotAttributes,
                pl.snapshotCategoryId, pl.snapshotTaxRate, pl.snapshotMrp, pl.snapshotMetadata,
                pl.createdAt,
                now.toISOString()
            );
        }

        const result = {
            success: true,
            message: 'Draft was saved successfully.',
            draftId: input.draftId,
            revision: nextRevision,
            status: 'DRAFT',
            totalLines: processedLines.length,
        };

        // Record operation replay record
        await tx.$executeRawUnsafe(`
            INSERT INTO "StockDraftOperation" ("operationId", "draftId", "action", "payloadHash", "resultJson", "createdAt")
            VALUES (?, ?, 'SAVE', ?, ?, ?)
        `, input.operationId, input.draftId, payloadHash, JSON.stringify(result), now.toISOString());

        return result;
    }, { timeout: 15000 });
}

/**
 * Cancels a draft terminally.
 * Preserves the draft and lines for audit evidence.
 * Prevents revival or duplicate cancellation.
 */
export async function cancelDraft(prisma: any, input: CancelDraftInput, user: any) {
    authorizeInventory(user);
    if (!input || typeof input.operationId !== 'string' || !input.operationId.trim()) {
        throw new Error('A stable operation ID is required for cancelling draft.');
    }
    if (!input.draftId || typeof input.draftId !== 'string') {
        throw new Error('Draft ID is required.');
    }
    if (typeof input.expectedRevision !== 'number' || !Number.isInteger(input.expectedRevision)) {
        throw new Error('Draft expectedRevision is required for cancellation.');
    }

    const {
        userId: _u,
        requestingUserId: _r,
        sessionToken: _s,
        authToken: _a,
        sessionId: _sid,
        ...normalizedPayload
    } = input as CancelDraftInput & Record<string, unknown>;

    const payloadHash = computePayloadHash(normalizedPayload);
    await ensureStockDraftSchema(prisma);

    return await prisma.$transaction(async (tx: any) => {
        await draftWriteLock(tx);

        // Check for replay of existing operation ID
        const existingOps: any[] = await tx.$queryRawUnsafe(
            'SELECT * FROM "StockDraftOperation" WHERE "operationId" = ?',
            input.operationId
        );
        if (existingOps.length) {
            const op = existingOps[0];
            if (op.payloadHash !== payloadHash) {
                throw new Error('Operation ID was already used for a different cancellation request.');
            }
            return JSON.parse(op.resultJson);
        }

        // Fetch draft
        const draftRows: any[] = await tx.$queryRawUnsafe(
            'SELECT * FROM "StockCountDraft" WHERE "id" = ?',
            input.draftId
        );
        if (!draftRows.length) {
            throw new Error(`Draft not found: ${input.draftId}`);
        }
        const draft = draftRows[0];

        if (draft.status !== 'DRAFT') {
            throw new Error('Draft is already cancelled or posted. Terminal batches cannot be cancelled.');
        }

        if (Number(draft.revision) !== input.expectedRevision) {
            throw new Error('Stale edit: draft was modified by another operator. Please reload before cancelling.');
        }

        const now = new Date();
        const nextRevision = Number(draft.revision) + 1;
        const editorName = user.name || user.username || user.id;

        const updateResult = await tx.$executeRawUnsafe(`
            UPDATE "StockCountDraft"
            SET "status" = 'CANCELLED',
                "revision" = ?,
                "updatedBy" = ?,
                "updatedByName" = ?,
                "updatedAt" = ?
            WHERE "id" = ? AND "revision" = ? AND "status" = 'DRAFT'
        `,
            nextRevision,
            user.id,
            editorName,
            now.toISOString(),
            input.draftId,
            input.expectedRevision
        );

        if (updateResult !== 1) {
            throw new Error('Stale edit: draft state changed concurrently. Please reload.');
        }

        const result = {
            success: true,
            message: 'Draft was cancelled.',
            draftId: input.draftId,
            revision: nextRevision,
            status: 'CANCELLED',
        };

        // Record operation replay record
        await tx.$executeRawUnsafe(`
            INSERT INTO "StockDraftOperation" ("operationId", "draftId", "action", "payloadHash", "resultJson", "createdAt")
            VALUES (?, ?, 'CANCEL', ?, ?, ?)
        `, input.operationId, input.draftId, payloadHash, JSON.stringify(result), now.toISOString());

        return result;
    }, { timeout: 15000 });
}
