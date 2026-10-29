import crypto from 'node:crypto';
import {purchaseTax,purchaseHsn} from './purchase-tax.service';
import {prepareStockCosts,recordPurchaseCost} from './stock-cost.service';
import { ensureStockConversionSchema } from './stock-conversion.service';
import type { PurchaseInput, PurchasePaymentInput, PurchaseRecord } from '../src/types/purchases';

// Purchase costs are immutable receipt snapshots, independent of today's catalogue price.
export function authorize(user: any) {
    if (!user?.id || !user.isActive || !(user.role === 'ADMIN' || (user.permManageInventory && user.permViewCostPrice))) {
        throw new Error('Purchases require inventory and cost-price permissions.');
    }
}
export function text(value: unknown, label: string, max = 200): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new Error(`${label} is required.`);
    return value.trim();
}
export function money(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000_000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw new Error('Enter valid amounts with at most two decimal places.');
    return Math.round(value * 100);
}
export function mode(value: string): string {
    if (!['UPI', 'BANK', 'CASH_DRAWER', 'PERSONAL_CASH'].includes(value)) throw new Error('Choose a valid payment source.');
    return value;
}
export function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
const schemaReady = new WeakSet<object>();
const schemaPending = new WeakMap<object, Promise<void>>();
export async function ensurePurchaseSchema(db: any) {
    if (schemaReady.has(db)) return;
    if (schemaPending.has(db)) return schemaPending.get(db);
    const work = (async () => {
        await ensureStockConversionSchema(db);
        for (const sql of [
            `CREATE TABLE IF NOT EXISTS PurchaseInvoice (id TEXT PRIMARY KEY, supplier TEXT NOT NULL, supplierKey TEXT NOT NULL, invoiceNumber TEXT NOT NULL, invoiceKey TEXT NOT NULL, invoiceDate TEXT NOT NULL, batchName TEXT NOT NULL, discountPaise INTEGER NOT NULL, chargesPaise INTEGER NOT NULL, totalPaise INTEGER NOT NULL, createdBy TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(supplierKey, invoiceKey))`,
            `CREATE TABLE IF NOT EXISTS PurchaseReceiptLine (id TEXT PRIMARY KEY, purchaseId TEXT NOT NULL REFERENCES PurchaseInvoice(id), variantId TEXT NOT NULL REFERENCES ProductVariant(id), sourceVariantId TEXT NOT NULL, name TEXT NOT NULL, barcode TEXT NOT NULL, size TEXT, description TEXT, quantity INTEGER NOT NULL, unitCostPaise INTEGER NOT NULL, landedTotalPaise INTEGER NOT NULL, sellingPricePaise INTEGER NOT NULL, mrpPaise INTEGER NOT NULL)`,
            `CREATE TABLE IF NOT EXISTS PurchasePayment (id TEXT PRIMARY KEY, purchaseId TEXT NOT NULL REFERENCES PurchaseInvoice(id), amountPaise INTEGER NOT NULL, mode TEXT NOT NULL, drawerTxId TEXT UNIQUE, createdBy TEXT NOT NULL, createdAt TEXT NOT NULL)`,
            `CREATE TABLE IF NOT EXISTS PurchaseOperation (id TEXT PRIMARY KEY, userId TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL)`,
            `CREATE TABLE IF NOT EXISTS PurchasePaymentReason (paymentId TEXT PRIMARY KEY REFERENCES PurchasePayment(id), reason TEXT NOT NULL)`,
            `CREATE TABLE IF NOT EXISTS PurchaseAdjustment (id TEXT PRIMARY KEY, purchaseId TEXT NOT NULL REFERENCES PurchaseInvoice(id), kind TEXT NOT NULL, reason TEXT NOT NULL, creditPaise INTEGER NOT NULL, replacementJson TEXT, supplier TEXT, invoiceNumber TEXT, invoiceDate TEXT, batchName TEXT, createdBy TEXT NOT NULL, createdAt TEXT NOT NULL)`,
            `CREATE TABLE IF NOT EXISTS PurchaseAdjustmentLine (adjustmentId TEXT NOT NULL REFERENCES PurchaseAdjustment(id), lineId TEXT NOT NULL REFERENCES PurchaseReceiptLine(id), quantity INTEGER NOT NULL, PRIMARY KEY(adjustmentId,lineId))`,
            `CREATE INDEX IF NOT EXISTS PurchaseAdjustment_purchase_idx ON PurchaseAdjustment(purchaseId)`,
            `CREATE INDEX IF NOT EXISTS PurchaseReceiptLine_purchase_idx ON PurchaseReceiptLine(purchaseId)`,
            `CREATE INDEX IF NOT EXISTS PurchasePayment_purchase_idx ON PurchasePayment(purchaseId)`,
            `CREATE TABLE IF NOT EXISTS PurchaseTaxInvoice (purchaseId TEXT PRIMARY KEY REFERENCES PurchaseInvoice(id),payload TEXT NOT NULL)`,
            `CREATE TABLE IF NOT EXISTS PurchaseTaxLine (lineId TEXT PRIMARY KEY REFERENCES PurchaseReceiptLine(id),hsn TEXT NOT NULL)`,
        ]) await db.$executeRawUnsafe(sql);
        schemaReady.add(db);
    })();
    schemaPending.set(db, work);
    try { await work; } finally { schemaPending.delete(db); }
}
export async function replay(tx: any, id: string, hash: string, user: any) {
    const rows = await tx.$queryRawUnsafe('SELECT * FROM PurchaseOperation WHERE id=?', id);
    if (!rows.length) return null;
    if (rows[0].userId !== user.id || rows[0].hash !== hash) throw new Error('This operation was already used for different content.');
    return JSON.parse(rows[0].result);
}
export async function record(tx: any, id: string, hash: string, user: any, result: unknown) {
    await tx.$executeRawUnsafe('INSERT INTO PurchaseOperation VALUES (?, ?, ?, ?)', id, user.id, hash, JSON.stringify(result));
}
export async function payment(tx: any, purchaseId: string, amount: number, method: string, user: any, now: string, direction = 1, reason: string | null = null) {
    if (!amount) return;
    let drawerTxId: string | null = null;
    if (method === 'CASH_DRAWER') {
        if (user.role !== 'ADMIN' && !user.permManageCashDrawer) throw new Error('Cash register permission is required for drawer payments.');
        const tables = await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('CashRegister','CashDrawerTx')");
        if (tables.length !== 2) throw new Error('Open today’s cash register before paying from the drawer.');
        const registers = await tx.$queryRawUnsafe("SELECT id FROM CashRegister WHERE status='OPEN' AND date=? ORDER BY openedAt DESC", today());
        if (registers.length !== 1) throw new Error('Open today’s cash register before paying from the drawer.');
        drawerTxId = crypto.randomUUID();
        const invoices = await tx.$queryRawUnsafe('SELECT supplier, invoiceNumber FROM PurchaseInvoice WHERE id=?', purchaseId);
        await tx.$executeRawUnsafe('INSERT INTO CashDrawerTx (id, registerId, type, category, amount, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)', drawerTxId, registers[0].id, direction === 1 ? 'CASH_OUT' : 'CASH_IN', direction === 1 ? 'SUPPLIER_PAYMENT' : 'SUPPLIER_REFUND', amount / 100, `Supplier ${direction === 1 ? 'payment' : 'refund'} · ${invoices[0].supplier} · Invoice ${invoices[0].invoiceNumber}`, now);
    }
    const paymentId = crypto.randomUUID();
    await tx.$executeRawUnsafe('INSERT INTO PurchasePayment VALUES (?, ?, ?, ?, ?, ?, ?)', paymentId, purchaseId, amount * direction, method, drawerTxId, user.id, now);
    if (reason) await tx.$executeRawUnsafe('INSERT INTO PurchasePaymentReason VALUES (?, ?)',paymentId,reason);
}
async function shortCode(tx: any) {
    for (let i = 0; i < 100; i++) {
        const code = String(crypto.randomInt(100000, 1000000));
        const used = await tx.$queryRawUnsafe('SELECT id FROM ProductVariant WHERE barcode=? OR sku IN (?, ?) UNION ALL SELECT draftId FROM CatalogueBarcodeReservation WHERE barcode=?', code, code, `ST-${code}`, code);
        if (!used.length) return code;
    }
    throw new Error('Could not allocate a barcode. Retry.');
}
export async function receivePurchase(db: any, input: PurchaseInput, user: any) {
    authorize(user);
    const operationId = text(input?.operationId, 'Operation ID');
    const supplier = text(input.supplier, 'Supplier'), invoiceNumber = text(input.invoiceNumber, 'Invoice number');
    const batchName = text(input.batchName, 'Batch name');
    const date = text(input.invoiceDate, 'Invoice date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today()) throw new Error('Choose a valid invoice date, no later than today.');
    if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 100) throw new Error('Add between 1 and 100 purchase items.');
    const lines = input.lines.map(row => {
        if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 1_000_000) throw new Error('Purchase quantity must be a positive whole number.');
        const item = { variantId: text(row.variantId, 'Item'), quantity: row.quantity, cost: money(row.unitCost), price: money(row.sellingPrice), mrp: money(row.mrp), expectedPrice: money(row.expectedSellingPrice), expectedMrp: money(row.expectedMrp) };
        if (!item.cost || !item.price || item.mrp < item.price) throw new Error('Cost and selling price must be positive; selling price cannot exceed MRP.');
        const hsn=purchaseHsn(row.hsn);
        return {...item,...(hsn?{hsn}:{})};
    });
    if (new Set(lines.map(row => row.variantId)).size !== lines.length) throw new Error('Combine duplicate item rows into one quantity.');
    const subtotal = lines.reduce((sum, row) => sum + row.cost * row.quantity, 0);
    const discount = money(input.discount), charges = money(input.charges), paid = money(input.paid);
    const tax=purchaseTax(input.tax,subtotal-discount+charges);
    const total = subtotal - discount + charges + (tax?tax.totalTaxPaise+tax.roundOffPaise:0);
    if (!Number.isSafeInteger(subtotal) || total > 10_000_000_000 || discount > subtotal || total <= 0 || paid > total) throw new Error('Check the purchase discount, charges and payment amount.');
    const method = mode(input.paymentMode);
    const body = { supplier, invoiceNumber, date, batchName, discount, charges, paid, method, lines,...(tax?{tax}:{}) };
    const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    await ensurePurchaseSchema(db);
    return db.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe('UPDATE CatalogueWriteLock SET token=token WHERE id=1');
        const prior = await replay(tx, operationId, hash, user); if (prior) return prior;
        const existing = await tx.$queryRawUnsafe('SELECT id FROM PurchaseInvoice WHERE supplierKey=? AND invoiceKey=?', supplier.toLowerCase(), invoiceNumber.toLowerCase());
        if (existing.length) throw new Error('This supplier invoice is already recorded. Open it in Purchase history.');
        const id = crypto.randomUUID(), now = new Date().toISOString();
        await tx.$executeRawUnsafe('INSERT INTO PurchaseInvoice VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, supplier, supplier.toLowerCase(), invoiceNumber, invoiceNumber.toLowerCase(), date, batchName, discount, charges, total, user.id, now);
        if(tax)await tx.$executeRawUnsafe('INSERT INTO PurchaseTaxInvoice VALUES (?, ?)',id,JSON.stringify(tax));
        let accumulated = 0, allocated = 0;
        const codes: string[] = [];
        for (const row of lines) {
            const found = await tx.$queryRawUnsafe(`SELECT v.*, p.name, p.isActive AS productActive, gd.formattedDescription FROM ProductVariant v JOIN Product p ON p.id=v.productId JOIN StockVariantTracking st ON st.variantId=v.id LEFT JOIN ProductVariantGarmentDetail gd ON gd.variantId=v.id WHERE v.id=?`, row.variantId);
            const source = found[0];
            if (!source || !source.isActive || !source.productActive || source.isPrepared) throw new Error('Select an active audited item. Generic and unfinished items cannot receive purchases.');
            if (money(source.sellingPrice) !== row.expectedPrice || money(source.mrp) !== row.expectedMrp) throw new Error('An item price changed while entering this purchase. Remove and select it again.');
            let variantId = source.id, barcode = source.barcode;
            if (row.price !== row.expectedPrice || row.mrp !== row.expectedMrp) {
                barcode = await shortCode(tx); variantId = crypto.randomUUID();
                await tx.productVariant.create({ data: { id: variantId, productId: source.productId, sku: `ST-${barcode}`, barcode, size: source.size, color: source.color, mrp: row.mrp / 100, sellingPrice: row.price / 100, costPrice: 0, stock: 0, minStock: source.minStock, isActive: true, isSynced: false, createdAt: new Date(now), updatedAt: new Date(now) } });
                await tx.$executeRawUnsafe(`INSERT INTO ProductVariantGarmentDetail (variantId, isPrepared, brand, fabric, quality, pattern, sleeve, fit, collar, pocket, styleRef, formattedDescription, metadata, createdAt, updatedAt) SELECT ?, 0, brand, fabric, quality, pattern, sleeve, fit, collar, pocket, styleRef, formattedDescription, metadata, ?, ? FROM ProductVariantGarmentDetail WHERE variantId=?`, variantId, now, now, source.id);
                await tx.$executeRawUnsafe('INSERT INTO StockVariantTracking (variantId, activatedAt) VALUES (?, ?)', variantId, now);
            }
            const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
            if (!Number.isSafeInteger(variant.stock + row.quantity) || variant.stock + row.quantity > 1_000_000_000) throw new Error('Resulting stock is too large.');
            await prepareStockCosts(tx,[variantId]);
            await tx.productVariant.update({ where: { id: variantId }, data: { stock: { increment: row.quantity }, isSynced: false } });
            await tx.inventoryMovement.create({ data: { variantId, type: 'RECEIPT', quantity: row.quantity, reason: `Purchase: ${supplier} / ${invoiceNumber} · ${batchName}`, reference: id, createdBy: user.id, createdAt: new Date(now), isSynced: false } });
            accumulated += row.cost * row.quantity;
            const nextAllocation = Math.round(accumulated / subtotal * (total-subtotal));
            const landedTotal = row.cost * row.quantity + nextAllocation - allocated; allocated = nextAllocation;
            const receiptLineId=crypto.randomUUID();
            await tx.$executeRawUnsafe('INSERT INTO PurchaseReceiptLine VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', receiptLineId, id, variantId, source.id, source.name, barcode, source.size, source.formattedDescription ?? null, row.quantity, row.cost, landedTotal, row.price, row.mrp);
            if(row.hsn)await tx.$executeRawUnsafe('INSERT INTO PurchaseTaxLine VALUES (?, ?)',receiptLineId,row.hsn);
            await recordPurchaseCost(tx,receiptLineId,variantId,row.quantity,landedTotal);
            codes.push(barcode);
        }
        await payment(tx, id, paid, method, user, now);
        const result = { id, barcodes: codes, totalPaise: total };
        await record(tx, operationId, hash, user, result);
        return result;
    }, { timeout: 20000 });
}
export async function payPurchase(db: any, input: PurchasePaymentInput, user: any) {
    authorize(user);
    const operationId = text(input?.operationId, 'Operation ID'), purchaseId = text(input.purchaseId, 'Purchase');
    const amount = money(input.amount), method = mode(input.mode);
    if (!amount) throw new Error('Enter a positive payment amount.');
    const hash = crypto.createHash('sha256').update(JSON.stringify({ purchaseId, amount, method })).digest('hex');
    await ensurePurchaseSchema(db);
    return db.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe('UPDATE CatalogueWriteLock SET token=token WHERE id=1');
        const prior = await replay(tx, operationId, hash, user); if (prior) return prior;
        const state = await readPurchaseState(tx, purchaseId);
        if (state.status === 'CANCELLED' || amount > state.duePaise) throw new Error('Payment exceeds the remaining invoice balance. Refresh the invoice.');
        await payment(tx, purchaseId, amount, method, user, new Date().toISOString());
        const result = { id: purchaseId }; await record(tx, operationId, hash, user, result); return result;
    });
}
const currentInvoices = `WITH current AS (
    SELECT i.id, COALESCE(r.supplier,i.supplier) AS supplier, COALESCE(r.invoiceNumber,i.invoiceNumber) AS invoiceNumber,
    COALESCE(r.invoiceDate,i.invoiceDate) AS invoiceDate, COALESCE(r.batchName,i.batchName) AS batchName, i.createdAt,
    i.totalPaise-COALESCE((SELECT SUM(creditPaise) FROM PurchaseAdjustment WHERE purchaseId=i.id),0) AS totalPaise,
    COALESCE((SELECT SUM(amountPaise) FROM PurchasePayment WHERE purchaseId=i.id),0) AS paidPaise,
    CASE WHEN EXISTS(SELECT 1 FROM PurchaseAdjustment WHERE purchaseId=i.id AND kind='CANCEL') THEN 'CANCELLED' ELSE 'ACTIVE' END AS status
    FROM PurchaseInvoice i LEFT JOIN PurchaseAdjustment r ON r.id=(SELECT id FROM PurchaseAdjustment WHERE purchaseId=i.id AND kind='CORRECTION' ORDER BY rowid DESC LIMIT 1))`;
export async function listPurchases(db: any, input: any, user: any) {
    authorize(user); await ensurePurchaseSchema(db);
    const page = Math.max(1, Math.min(100000, Math.floor(Number(input?.page) || 1)));
    const search = typeof input?.search === 'string' ? input.search.trim().slice(0, 200) : '';
    return db.$transaction(async (tx: any) => {
        const where = 'WHERE instr(lower(supplier || char(32) || invoiceNumber || char(32) || batchName), lower(?))>0';
        const count = await tx.$queryRawUnsafe(`${currentInvoices} SELECT COUNT(*) AS n FROM current ${where}`, search);
        const totals = await tx.$queryRawUnsafe(`${currentInvoices} SELECT COALESCE(SUM(totalPaise),0) AS totalPaise, COALESCE(SUM(paidPaise),0) AS paidPaise, COALESCE(SUM(MAX(totalPaise-paidPaise,0)),0) AS duePaise, COALESCE(SUM(MAX(paidPaise-totalPaise,0)),0) AS creditDuePaise FROM current ${where}`, search);
        const rows = await tx.$queryRawUnsafe(`${currentInvoices} SELECT * FROM current ${where} ORDER BY invoiceDate DESC, createdAt DESC, id DESC LIMIT 50 OFFSET ?`, search, (page - 1) * 50);
        return { items: rows.map((r: any): PurchaseRecord => ({ id: r.id, supplier: r.supplier, invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate, batchName: r.batchName, totalPaise: Number(r.totalPaise), paidPaise: Number(r.paidPaise), duePaise: Math.max(0,Number(r.totalPaise)-Number(r.paidPaise)), creditDuePaise: Math.max(0,Number(r.paidPaise)-Number(r.totalPaise)), status:r.status, createdAt: r.createdAt })), total: Number(count[0].n), page,
            totals: { totalPaise:Number(totals[0].totalPaise), paidPaise:Number(totals[0].paidPaise), duePaise:Number(totals[0].duePaise), creditDuePaise:Number(totals[0].creditDuePaise) } };
    });
}
const numeric = (row: any): any => Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='bigint'?Number(value):value]));
/** Immutable original plus chronological corrections and returns, all in the caller's transaction. */
export async function readPurchaseState(tx: any, id: string): Promise<any> {
    const invoices = await tx.$queryRawUnsafe('SELECT * FROM PurchaseInvoice WHERE id=?', id);
    if (!invoices.length) throw new Error('Purchase not found.');
    const original = numeric(invoices[0]);
    const taxes=await tx.$queryRawUnsafe('SELECT payload FROM PurchaseTaxInvoice WHERE purchaseId=?',id);
    if(taxes.length)original.tax=JSON.parse(taxes[0].payload);
    const originals = (await tx.$queryRawUnsafe('SELECT * FROM PurchaseReceiptLine WHERE purchaseId=? ORDER BY rowid',id)).map(numeric);
    const hsnRows=await tx.$queryRawUnsafe('SELECT t.* FROM PurchaseTaxLine t JOIN PurchaseReceiptLine l ON l.id=t.lineId WHERE l.purchaseId=?',id);
    for(const line of originals){const code=hsnRows.find((r:any)=>r.lineId===line.id);if(code)line.hsn=code.hsn;}
    const adjustments = (await tx.$queryRawUnsafe('SELECT a.*,u.name AS createdByName FROM PurchaseAdjustment a LEFT JOIN User u ON u.id=a.createdBy WHERE a.purchaseId=? ORDER BY a.rowid',id)).map(numeric);
    const changes = (await tx.$queryRawUnsafe('SELECT l.* FROM PurchaseAdjustmentLine l JOIN PurchaseAdjustment a ON a.id=l.adjustmentId WHERE a.purchaseId=?',id)).map(numeric);
    for (const adjustment of adjustments) adjustment.lines=changes.filter((change:any)=>change.adjustmentId===adjustment.id).map((change:any)=>{
        const line=originals.find((original:any)=>original.id===change.lineId);
        return {lineId:change.lineId,quantity:change.quantity,name:line?.name,barcode:line?.barcode};
    });
    const payments = (await tx.$queryRawUnsafe('SELECT p.*, r.reason FROM PurchasePayment p LEFT JOIN PurchasePaymentReason r ON r.paymentId=p.id WHERE p.purchaseId=? ORDER BY p.createdAt,p.id',id)).map(numeric);
    let effective = {...original}, lines = originals.map((line:any)=>({...line}));
    for (const adjustment of adjustments) if (adjustment.kind==='CORRECTION') {
        const replacement=JSON.parse(adjustment.replacementJson);
        effective={...effective,...replacement.header}; lines=replacement.lines;
    }
    const hasCostLots=(await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='StockCostLot'")).length>0;
    for (const line of lines) {
        line.returnedQuantity=changes.filter((change:any)=>change.lineId===line.id).reduce((sum:number,change:any)=>sum+change.quantity,0);
        const variant=await tx.productVariant.findUnique({where:{id:line.variantId},select:{stock:true}});
        line.stock=variant?.stock ?? 0;
        const costLot=hasCostLots?await tx.$queryRawUnsafe('SELECT remainingQuantity FROM StockCostLot WHERE id=?',`purchase:${line.id}`):[];
        line.batchQuantityAvailable=costLot.length?Number(costLot[0].remainingQuantity):null;
    }
    const totalPaise=original.totalPaise-adjustments.reduce((sum:number,a:any)=>sum+a.creditPaise,0);
    const paidPaise=payments.reduce((sum:number,p:any)=>sum+p.amountPaise,0);
    return {...effective,totalPaise,paidPaise,duePaise:Math.max(0,totalPaise-paidPaise),creditDuePaise:Math.max(0,paidPaise-totalPaise),
        status:adjustments.some((a:any)=>a.kind==='CANCEL')?'CANCELLED':'ACTIVE',revision:adjustments.length,
        original:{...original,lines:originals},lines,payments,adjustments};
}
export async function purchaseDetail(db: any, input: any, user: any) {
    authorize(user); await ensurePurchaseSchema(db); const id=text(input?.id,'Purchase');
    return db.$transaction((tx:any)=>readPurchaseState(tx,id));
}
export async function purchaseItems(db: any, input: any, user: any) {
    authorize(user); await ensurePurchaseSchema(db);
    const search = typeof input?.search === 'string' ? input.search.trim().slice(0, 200) : '';
    if (!search) return [];
    return db.$queryRawUnsafe(`SELECT v.id, p.name, v.barcode, v.size, v.sellingPrice, v.mrp, v.stock, gd.formattedDescription AS description FROM ProductVariant v JOIN Product p ON p.id=v.productId JOIN StockVariantTracking st ON st.variantId=v.id LEFT JOIN ProductVariantGarmentDetail gd ON gd.variantId=v.id WHERE v.isActive=1 AND p.isActive=1 AND v.isPrepared=0 AND instr(lower(p.name || ' ' || v.barcode || ' ' || COALESCE(v.size,'') || ' ' || COALESCE(gd.formattedDescription,'')),lower(?))>0 ORDER BY p.name, v.barcode LIMIT 30`, search);
}
