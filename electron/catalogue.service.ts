import crypto from 'crypto';
import { normalizeText, formatVariantDescription, areNormalizedStringsEqual } from '../src/lib/catalogueDescription';
export { normalizeText, formatVariantDescription } from '../src/lib/catalogueDescription';

const garmentFields = ['brand', 'fabric', 'quality', 'pattern', 'sleeve', 'fit', 'collar', 'pocket', 'styleRef'] as const;
const schemaReady = new WeakSet<object>();
const schemaPending = new WeakMap<object, Promise<void>>();
export interface GarmentDetailsInput {
    isPrepared?: boolean;
    brand?: string | null; fabric?: string | null; quality?: string | null;
    pattern?: string | null; sleeve?: string | null; fit?: string | null;
    collar?: string | null; pocket?: string | null; styleRef?: string | null;
    metadata?: unknown;
}
export interface VariantInput extends GarmentDetailsInput {
    id?: string; barcodeDraftId?: string; sku?: string; barcode?: string;
    size?: string | null; color?: string | null;
    mrp: number; sellingPrice: number; costPrice?: number; minStock?: number; isActive?: boolean;
}
export interface SaveProductInput {
    requestId: string; id?: string; name: string; categoryId: string;
    hsn?: string | null; taxRate?: number; updatedAt?: string | Date; variants: VariantInput[];
}
function authorizeManage(user: any) {
    if (!user?.isActive || !(user.role === 'ADMIN' || user.permManageProducts)) throw new Error('Permission Denied: You do not have permission to manage products.');
}
function canViewCost(user: any) {
    return Boolean(user?.isActive && (user.role === 'ADMIN' || user.permViewCostPrice));
}

/** Additive sidecars do not depend on regenerated Prisma models. Failures block writes. */
export async function ensureCatalogueSchema(prisma: any): Promise<void> {
    if (schemaReady.has(prisma)) return;
    const pending = schemaPending.get(prisma);
    if (pending) return pending;
    const work = (async () => {
        const columns: any[] = await prisma.$queryRawUnsafe('PRAGMA table_info("ProductVariant")');
        if (!columns.length) throw new Error('Catalogue schema unavailable: ProductVariant table is missing.');
        if (!columns.some(c => c.name === 'isPrepared')) {
            try {
                await prisma.$executeRawUnsafe('ALTER TABLE "ProductVariant" ADD COLUMN "isPrepared" INTEGER NOT NULL DEFAULT 0');
            } catch (error) {
                const fresh: any[] = await prisma.$queryRawUnsafe('PRAGMA table_info("ProductVariant")');
                if (!fresh.some(c => c.name === 'isPrepared')) throw error;
            }
        }
        await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "ProductVariantGarmentDetail" (' +
            '"variantId" TEXT NOT NULL PRIMARY KEY, "isPrepared" INTEGER NOT NULL DEFAULT 0,' +
            '"brand" TEXT, "fabric" TEXT, "quality" TEXT, "pattern" TEXT, "sleeve" TEXT, "fit" TEXT,' +
            '"collar" TEXT, "pocket" TEXT, "styleRef" TEXT, "formattedDescription" TEXT, "metadata" TEXT,' +
            '"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
            'FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE)');
        const detailColumns: any[] = await prisma.$queryRawUnsafe('PRAGMA table_info("ProductVariantGarmentDetail")');
        for (const name of ['variantId', 'isPrepared', ...garmentFields, 'formattedDescription', 'metadata', 'createdAt', 'updatedAt']) {
            if (!detailColumns.some(c => c.name === name)) throw new Error('Catalogue schema incomplete: garment detail ' + name + ' is missing.');
        }
        await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ProductVariantGarmentDetail_isPrepared_idx" ON "ProductVariantGarmentDetail"("isPrepared")');
        await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "CatalogueSaveRequest" (' +
            '"requestId" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "payloadHash" TEXT NOT NULL,' +
            '"productId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
        await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "CatalogueBarcodeReservation" (' +
            '"draftId" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "barcode" TEXT NOT NULL UNIQUE,' +
            '"variantId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
        await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "CatalogueWriteLock" ("id" INTEGER NOT NULL PRIMARY KEY, "token" INTEGER NOT NULL DEFAULT 0)');
        await prisma.$executeRawUnsafe('INSERT OR IGNORE INTO "CatalogueWriteLock" ("id", "token") VALUES (1, 0)');
        schemaReady.add(prisma);
    })();
    schemaPending.set(prisma, work);
    try { await work; } finally { schemaPending.delete(prisma); }
}
async function preparationSchema(tx: any) {
    const tables: any[] = await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ProductVariant', 'ProductVariantGarmentDetail')");
    if (!tables.some(t => t.name === 'ProductVariant')) throw new Error('Catalogue preparation state cannot be verified.');
    const columns: any[] = await tx.$queryRawUnsafe('PRAGMA table_info("ProductVariant")');
    const hasColumn = columns.some(c => c.name === 'isPrepared');
    const hasDetails = tables.some(t => t.name === 'ProductVariantGarmentDetail');
    // Only an untouched legacy schema safely has no preparation state.
    if (!hasColumn && !hasDetails) return false;
    if (!hasColumn || !hasDetails) throw new Error('Catalogue preparation schema is incomplete; billing is blocked until repaired.');
    return true;
}
/** Read failures propagate rather than treating an unknown state as saleable. */
export async function checkAnyVariantPrepared(tx: any, variantIds: string[]): Promise<boolean> {
    if (!variantIds?.length) return false;
    if (!(await preparationSchema(tx))) return false;
    for (let i = 0; i < variantIds.length; i += 200) {
        const ids = variantIds.slice(i, i + 200);
        const rows: any[] = await tx.$queryRawUnsafe('SELECT pv.id FROM "ProductVariant" pv ' +
            'LEFT JOIN "ProductVariantGarmentDetail" gd ON gd.variantId = pv.id WHERE pv.id IN (' + ids.map(() => '?').join(',') + ')' +
            ' AND (COALESCE(pv.isPrepared, 0) <> 0 OR COALESCE(gd.isPrepared, 0) <> 0) LIMIT 1', ...ids);
        if (rows.length) return true;
    }
    return false;
}
export async function checkBarcode(prisma: any, barcode: string, excludeVariantId?: string) {
    const code = String(barcode || '').trim();
    if (!code) return { exists: false };
    const rows: any[] = await prisma.$queryRawUnsafe('SELECT pv.id AS variantId, pv.barcode, pv.isActive, p.name AS productName, p.id AS productId ' +
        'FROM "ProductVariant" pv JOIN "Product" p ON p.id = pv.productId WHERE pv.barcode = ? ' +
        (excludeVariantId ? 'AND pv.id <> ? ' : '') + 'LIMIT 1', ...[code, ...(excludeVariantId ? [excludeVariantId] : [])]);
    return rows.length ? { exists: true, ...rows[0], isActive: Boolean(rows[0].isActive) } : { exists: false };
}
async function writeLock(tx: any) {
    // Acquire SQLite's writer lock before reading a revision or claiming a code.
    await tx.$executeRawUnsafe('UPDATE "CatalogueWriteLock" SET "token" = "token" WHERE "id" = 1');
}
export async function reserveBarcode(prisma: any, args: { draftId: string; excludeCodes?: string[] }, user: any) {
    authorizeManage(user);
    if (!args?.draftId || typeof args.draftId !== 'string' || args.draftId.length > 200) throw new Error('A stable barcode draft ID is required.');
    await ensureCatalogueSchema(prisma);
    return prisma.$transaction(async (tx: any) => {
        await writeLock(tx);
        const prior: any[] = await tx.$queryRawUnsafe('SELECT * FROM "CatalogueBarcodeReservation" WHERE "draftId" = ?', args.draftId);
        if (prior.length) {
            if (prior[0].userId !== user.id) throw new Error('This barcode draft belongs to another operator.');
            return { barcode: prior[0].barcode };
        }
        const excluded = new Set((args.excludeCodes || []).map(String));
        for (let attempt = 0; attempt < 20; attempt++) {
            const barcode = '9' + crypto.randomInt(10000000000, 100000000000);
            if (excluded.has(barcode) || (await checkBarcode(tx, barcode)).exists) continue;
            const reserved: any[] = await tx.$queryRawUnsafe('SELECT 1 FROM "CatalogueBarcodeReservation" WHERE "barcode" = ?', barcode);
            if (reserved.length) continue;
            await tx.$executeRawUnsafe('INSERT INTO "CatalogueBarcodeReservation" ("draftId", "userId", "barcode") VALUES (?, ?, ?)', args.draftId, user.id, barcode);
            return { barcode };
        }
        throw new Error('Could not reserve a unique barcode. Please retry.');
    }, { timeout: 15000 });
}
function canonical(value: any): any {
    if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
    return value;
}
function validatePrice(value: unknown, label: string) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(label + ' must be a finite non-negative number.');
    return value;
}
/** Quantity and conversion activation are deliberately absent from renderer writes. */
export async function saveProduct(prisma: any, input: SaveProductInput, user: any) {
    authorizeManage(user);
    if (!input || typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId.length > 200) throw new Error('A stable save request ID is required.');
    const name = normalizeText(input.name);
    if (!name) throw new Error('Product name is required.');
    if (!input.categoryId) throw new Error('Category is required.');
    if (!Array.isArray(input.variants) || !input.variants.length) throw new Error('Product must have at least one variant.');
    const forbidden = ['stock', 'isTracked', 'trackingState', 'trackingStatus', 'trackingActive', 'conversionState', 'inventoryMovements', 'movements'];
    for (const payload of [input, ...input.variants]) {
        if (forbidden.some(field => Object.prototype.hasOwnProperty.call(payload, field))) throw new Error('Catalogue saves cannot write stock or tracking activation.');
    }
    const barcodeSet = new Set<string>();
    const idSet = new Set<string>();
    for (const v of input.variants) {
        validatePrice(v.mrp, 'MRP'); validatePrice(v.sellingPrice, 'Selling price');
        if (v.minStock !== undefined && (!Number.isInteger(v.minStock) || v.minStock < 0)) throw new Error('Minimum stock must be a non-negative whole number.');
        if (v.id) {
            if (idSet.has(v.id)) throw new Error('Duplicate variant IDs in save.');
            idSet.add(v.id);
        }
        if (v.barcode !== undefined) {
            const code = String(v.barcode).trim();
            if (code && barcodeSet.has(code)) throw new Error('Duplicate barcodes found within your variants.');
            if (code) barcodeSet.add(code);
        }
    }
    const { userId: _userId, requestingUserId: _requestingUserId, sessionToken: _sessionToken,
        authToken: _authToken, sessionId: _sessionId, ...operation } = input as SaveProductInput & Record<string, unknown>;
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(canonical(operation))).digest('hex');
    await ensureCatalogueSchema(prisma);
    const productId = await prisma.$transaction(async (tx: any) => {
        await writeLock(tx);
        const requests: any[] = await tx.$queryRawUnsafe('SELECT * FROM "CatalogueSaveRequest" WHERE "requestId" = ?', input.requestId);
        if (requests.length) {
            if (requests[0].userId !== user.id || requests[0].payloadHash !== payloadHash) throw new Error('Save request ID was already used for different data. Start a new save request.');
            return requests[0].productId;
        }
        const existing = input.id ? await tx.product.findUnique({ where: { id: input.id }, include: { variants: true } }) : null;
        if (input.id && !existing) throw new Error('Product not found: ' + input.id);
        const serverTime = existing ? new Date(existing.updatedAt).getTime() : 0;
        const now = new Date(Math.max(Date.now(), serverTime + 1));
        if (existing && (!input.updatedAt || !Number.isFinite(new Date(input.updatedAt).getTime()) || new Date(input.updatedAt).getTime() !== serverTime)) {
            throw new Error('Stale edit: this product was modified by another session. Please reload and try again.');
        }
        if (existing && (!areNormalizedStringsEqual(name, existing.name) || input.categoryId !== existing.categoryId)) {
            const ids = existing.variants.map((v: any) => v.id);
            const referenced = await tx.saleItem.count({ where: { variantId: { in: ids } } }) > 0 ||
                await tx.inventoryMovement.count({ where: { variantId: { in: ids } } }) > 0;
            if (referenced) throw new Error('This product has history. A different garment identity requires a new prepared product.');
        }
        const data = {
            name, categoryId: input.categoryId,
            hsn: input.hsn === undefined ? (existing?.hsn ?? null) : (normalizeText(input.hsn) || null),
            taxRate: input.taxRate === undefined ? (existing?.taxRate ?? 5) : validatePrice(input.taxRate, 'Tax rate'),
            isSynced: false, updatedAt: now,
        };
        let id = input.id;
        if (existing) {
            const changed = await tx.product.updateMany({ where: { id, updatedAt: new Date(input.updatedAt!) }, data });
            if (changed.count !== 1) throw new Error('Stale edit: this product was modified by another session. Please reload and try again.');
        } else {
            id = (await tx.product.create({ data: { ...data, isActive: true, createdAt: now } })).id;
        }
        const byId = new Map<string, any>((existing?.variants || []).map((v: any) => [v.id, v]));
        const enriched = existing ? await enrichCatalogueVariants(tx, existing.variants, user) : [];
        const detailById = new Map<string, any>(enriched.map((v: any) => [v.id, v]));
        for (const v of input.variants) {
            const old = v.id ? byId.get(v.id) : undefined;
            if (v.id && !v.id.startsWith('temp-') && !old) {
                if (await tx.productVariant.findUnique({ where: { id: v.id }, select: { id: true } })) throw new Error('Variant does not belong to this product.');
            }
            const variantId = old?.id || (v.id && !v.id.startsWith('temp-') ? v.id : crypto.randomUUID());
            const oldDetails = detailById.get(variantId) || {};
            const prepared = old ? Boolean(oldDetails.isPrepared) : true;
            if (v.isPrepared !== undefined && (typeof v.isPrepared !== 'boolean' || v.isPrepared !== prepared)) throw new Error('Catalogue saves cannot change preparation state or activate conversion.');
            const barcode = v.barcode === undefined ? (old?.barcode || '') : String(v.barcode).trim();
            if (!barcode) throw new Error('Each variant needs a barcode before saving.');
            if (old?.barcode && barcode !== old.barcode) throw new Error('Assigned barcodes cannot be replaced or recycled. Create a new variant.');
            if (old?.sku && v.sku !== undefined && !areNormalizedStringsEqual(v.sku, old.sku)) throw new Error('Assigned SKUs cannot be replaced or recycled. Create a new variant.');
            if ((await checkBarcode(tx, barcode, old?.id)).exists) throw new Error('The code "' + barcode + '" is already assigned. Please use a unique barcode.');
            const reservations: any[] = await tx.$queryRawUnsafe('SELECT * FROM "CatalogueBarcodeReservation" WHERE "barcode" = ?', barcode);
            if (reservations.length) {
                const reservation = reservations[0];
                const draftId = v.barcodeDraftId || v.id;
                if (reservation.variantId !== variantId && (reservation.userId !== user.id || reservation.draftId !== draftId || reservation.variantId)) throw new Error('This barcode is reserved by another draft.');
                await tx.$executeRawUnsafe('UPDATE "CatalogueBarcodeReservation" SET "variantId" = ? WHERE "draftId" = ?', variantId, reservation.draftId);
            }
            const attributes: any = {};
            for (const field of garmentFields) attributes[field] = v[field] === undefined ? (oldDetails[field] ?? null) : (normalizeText(v[field]) || null);
            const size = v.size === undefined ? (old?.size ?? null) : (normalizeText(v.size) || null);
            const color = v.color === undefined ? (old?.color ?? null) : (normalizeText(v.color) || null);
            if (old) {
                const referenced = await tx.saleItem.count({ where: { variantId } }) > 0 || await tx.inventoryMovement.count({ where: { variantId } }) > 0;
                const identityChanged = !areNormalizedStringsEqual(size, old.size) || !areNormalizedStringsEqual(color, old.color) ||
                    garmentFields.some(field => !areNormalizedStringsEqual(attributes[field], oldDetails[field]));
                if (referenced && identityChanged) throw new Error('This variant has history. A different garment identity requires a new prepared variant.');
            }
            const variantData: any = {
                sku: old?.sku || (v.sku === undefined ? 'SKU-' + crypto.randomUUID() : (String(v.sku).trim() || 'SKU-' + crypto.randomUUID())),
                barcode, size, color, mrp: v.mrp, sellingPrice: v.sellingPrice,
                minStock: v.minStock === undefined ? (old?.minStock ?? 5) : v.minStock,
                isActive: v.isActive === undefined ? (old?.isActive ?? true) : v.isActive,
                isSynced: false, updatedAt: now,
            };
            // Hidden costs and live quantities are never assigned on an existing row.
            if (canViewCost(user) && v.costPrice !== undefined) variantData.costPrice = validatePrice(v.costPrice, 'Cost price');
            if (old) await tx.productVariant.update({ where: { id: variantId }, data: variantData });
            else await tx.productVariant.create({ data: { ...variantData, id: variantId, productId: id, costPrice: variantData.costPrice ?? 0, createdAt: now } });
            await tx.$executeRawUnsafe('UPDATE "ProductVariant" SET "isPrepared" = ? WHERE "id" = ?', prepared ? 1 : 0, variantId);
            let metadata: string | null = oldDetails.metadataRaw ?? null;
            if (v.metadata !== undefined) metadata = v.metadata === null ? null : JSON.stringify(v.metadata);
            await tx.$executeRawUnsafe('INSERT INTO "ProductVariantGarmentDetail" ("variantId", "isPrepared", ' +
                garmentFields.map(f => '"' + f + '"').join(',') + ', "formattedDescription", "metadata", "updatedAt") VALUES (' +
                Array.from({ length: garmentFields.length + 5 }, () => '?').join(',') + ') ' +
                'ON CONFLICT("variantId") DO UPDATE SET "isPrepared" = excluded."isPrepared", ' +
                garmentFields.map(f => '"' + f + '" = excluded."' + f + '"').join(',') +
                ', "formattedDescription" = excluded."formattedDescription", "metadata" = excluded."metadata", "updatedAt" = excluded."updatedAt"',
                variantId, prepared ? 1 : 0, ...garmentFields.map(f => attributes[f]),
                formatVariantDescription(name, { ...attributes, size, color }), metadata, now);
        }
        await tx.$executeRawUnsafe('INSERT INTO "CatalogueSaveRequest" ("requestId", "userId", "payloadHash", "productId") VALUES (?, ?, ?, ?)', input.requestId, user.id, payloadHash, id);
        return id;
    }, { timeout: 15000 });
    return getProduct(prisma, productId, user);
}
/** No schema writes: safe inside an existing transaction or authenticated sync serialization. */
export async function enrichCatalogueVariants(prisma: any, variants: any[], user?: any) {
    if (!variants.length) return [];
    const hasPreparation = await preparationSchema(prisma);
    const details = new Map<string, any>();
    const flags = new Map<string, boolean>();
    if (hasPreparation) {
        for (let i = 0; i < variants.length; i += 200) {
            const ids = variants.slice(i, i + 200).map(v => v.id);
            const placeholders = ids.map(() => '?').join(',');
            const rows: any[] = await prisma.$queryRawUnsafe('SELECT * FROM "ProductVariantGarmentDetail" WHERE "variantId" IN (' + placeholders + ')', ...ids);
            for (const row of rows) details.set(row.variantId, row);
            const states: any[] = await prisma.$queryRawUnsafe('SELECT "id", "isPrepared" FROM "ProductVariant" WHERE "id" IN (' + placeholders + ')', ...ids);
            for (const state of states) flags.set(state.id, Boolean(state.isPrepared));
        }
    }
    return variants.map(v => {
        const detail = details.get(v.id) || {};
        const attributes = Object.fromEntries(garmentFields.map(f => [f, detail[f] ?? null]));
        let metadata: unknown = null;
        if (detail.metadata) { try { metadata = JSON.parse(detail.metadata); } catch { metadata = detail.metadata; } }
        return {
            ...v, ...attributes, isPrepared: Boolean(flags.get(v.id) || detail.isPrepared),
            formattedDescription: formatVariantDescription(v.product?.name || '', { ...attributes, size: v.size, color: v.color }),
            metadata, metadataRaw: detail.metadata ?? null,
            costPrice: user === undefined || canViewCost(user) ? v.costPrice : null,
        };
    });
}
export async function getProduct(prisma: any, id: string, user: any) {
    await ensureCatalogueSchema(prisma);
    const product = await prisma.product.findUnique({ where: { id }, include: { category: true, variants: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } });
    if (!product) return null;
    const variants = await enrichCatalogueVariants(prisma, product.variants.map((v: any) => ({ ...v, product: { name: product.name } })), user);
    return { ...product, variants: variants.map(({ product: _product, ...v }: any) => v) };
}
export async function listProducts(prisma: any, args: any = {}, user: any) {
    await ensureCatalogueSchema(prisma);
    if (args.summary === true) {
        const products = await prisma.product.findMany({
            where: args.where || { isActive: true },
            include: {
                category: true,
                variants: {
                    take: 1,
                    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                    select: {
                        id: true, productId: true, sku: true, barcode: true, size: true, color: true,
                        mrp: true, sellingPrice: true, stock: true, minStock: true, isActive: true,
                        createdAt: true, updatedAt: true,
                    },
                },
            },
            orderBy: args.orderBy || [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: args.take,
            skip: args.skip,
        });
        if (!products.length) return [];

        const productIds = products.map((product: any) => product.id);
        const chunks: string[][] = [];
        for (let i = 0; i < productIds.length; i += 500) chunks.push(productIds.slice(i, i + 500));
        const stockQueries = chunks.map((ids) => prisma.$queryRawUnsafe(
            'SELECT "productId", COUNT(*) AS "variantCount", COALESCE(SUM("stock"), 0) AS "totalStock" ' +
            'FROM "ProductVariant" WHERE "productId" IN (' + ids.map(() => '?').join(',') + ') GROUP BY "productId"',
            ...ids,
        ));
        const preparationQueries = chunks.map((ids) => prisma.$queryRawUnsafe(
            'SELECT pv."productId", MAX(CASE WHEN COALESCE(pv."isPrepared", 0) <> 0 OR COALESCE(gd."isPrepared", 0) <> 0 ' +
            'THEN 1 ELSE 0 END) AS "hasPreparedVariant" FROM "ProductVariant" pv ' +
            'LEFT JOIN "ProductVariantGarmentDetail" gd ON gd."variantId" = pv."id" ' +
            'WHERE pv."productId" IN (' + ids.map(() => '?').join(',') + ') GROUP BY pv."productId"',
            ...ids,
        ));
        const primaryVariants = products.flatMap((product: any) =>
            product.variants.map((variant: any) => ({ ...variant, product: { name: product.name } })),
        );
        const [enrichedVariants, stockRows, preparationRows] = await Promise.all([
            enrichCatalogueVariants(prisma, primaryVariants, user),
            Promise.all(stockQueries),
            Promise.all(preparationQueries),
        ]);
        const byVariantId = new Map<string, any>(enrichedVariants.map(({ product: _product, ...variant }: any) => [variant.id, variant]));
        const stockByProductId = new Map<string, any>(stockRows.flat().map((row: any) => [row.productId, row]));
        const preparationByProductId = new Map<string, any>(preparationRows.flat().map((row: any) => [row.productId, row]));

        return products.map((product: any) => {
            const stock = stockByProductId.get(product.id);
            const preparation = preparationByProductId.get(product.id);
            return {
                ...product,
                variants: product.variants.map((variant: any) => byVariantId.get(variant.id)),
                variantCount: Number(stock?.variantCount || 0),
                totalStock: Number(stock?.totalStock || 0),
                hasPreparedVariant: Boolean(Number(preparation?.hasPreparedVariant || 0)),
            };
        });
    }

    const products = await prisma.product.findMany({
        where: args.where || { isActive: true }, include: { category: true, variants: args.variantsWhere ? { where: args.variantsWhere } : true },
        orderBy: args.orderBy || [{ updatedAt: 'desc' }, { id: 'asc' }], take: args.take, skip: args.skip,
    });
    const variants = await enrichCatalogueVariants(prisma, products.flatMap((p: any) => p.variants.map((v: any) => ({ ...v, product: { name: p.name } }))), user);
    const byId = new Map<string, any>(variants.map(({ product: _product, ...v }: any) => [v.id, v]));
    return products.map((p: any) => ({ ...p, variants: p.variants.map((v: any) => byId.get(v.id)) }));
}
export async function listVariants(prisma: any, args: any = {}, user: any) {
    await ensureCatalogueSchema(prisma);
    const variants = await prisma.productVariant.findMany({
        where: args.where || { isActive: true, product: { isActive: true } }, include: { product: { include: { category: true } } },
        orderBy: args.orderBy || [{ createdAt: 'asc' }, { id: 'asc' }], take: args.take, skip: args.skip,
    });
    return enrichCatalogueVariants(prisma, variants, user);
}
