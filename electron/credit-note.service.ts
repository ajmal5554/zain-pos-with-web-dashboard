import * as crypto from 'node:crypto';
import type {
    CreditNoteRecord,
    CreditNoteRedemptionRecord,
    IssueCreditNoteInput,
    CreditNoteQuery,
    CreditNoteRedemptionInput
} from '../src/types/creditNote';

const ready = new WeakSet<object>();
const pending = new WeakMap<object, Promise<void>>();

export async function initCreditNoteSchema(db: any) {
    if (ready.has(db)) return;
    if (pending.has(db)) return pending.get(db);

    const work = (async () => {
        const sqls = [
            `CREATE TABLE IF NOT EXISTS CreditNote (
                id TEXT PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                customerName TEXT,
                customerPhone TEXT,
                originalInvoiceId TEXT,
                originalBillNo TEXT,
                amountPaise INTEGER NOT NULL CHECK(amountPaise > 0),
                remainingPaise INTEGER NOT NULL CHECK(remainingPaise >= 0),
                reason TEXT,
                status TEXT NOT NULL,
                createdBy TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            )`,
            `CREATE INDEX IF NOT EXISTS CreditNote_phone_idx ON CreditNote(customerPhone)`,
            `CREATE INDEX IF NOT EXISTS CreditNote_code_idx ON CreditNote(code)`,
            `CREATE INDEX IF NOT EXISTS CreditNote_status_idx ON CreditNote(status)`,
            `CREATE TABLE IF NOT EXISTS CreditNoteRedemption (
                id TEXT PRIMARY KEY,
                creditNoteId TEXT NOT NULL REFERENCES CreditNote(id),
                saleId TEXT NOT NULL,
                billNo TEXT NOT NULL,
                amountPaise INTEGER NOT NULL CHECK(amountPaise > 0),
                createdBy TEXT NOT NULL,
                createdAt TEXT NOT NULL
            )`,
            `CREATE INDEX IF NOT EXISTS CreditNoteRedemption_cn_idx ON CreditNoteRedemption(creditNoteId)`,
            `CREATE INDEX IF NOT EXISTS CreditNoteRedemption_sale_idx ON CreditNoteRedemption(saleId)`
        ];
        for (const sql of sqls) {
            await db.$executeRawUnsafe(sql);
        }
        ready.add(db);
    })();

    pending.set(db, work);
    try {
        await work;
    } finally {
        pending.delete(db);
    }
}

async function getNextCreditNoteCode(tx: any): Promise<string> {
    const rows: any[] = await tx.$queryRawUnsafe(
        `SELECT code FROM CreditNote WHERE code LIKE 'CN-%' ORDER BY createdAt DESC LIMIT 100`
    );
    let maxNum = 1000;
    for (const r of rows) {
        const match = (r.code || '').match(/^CN-(\d+)$/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    }
    return `CN-${maxNum + 1}`;
}

function mapCreditNoteRow(row: any, redemptions?: CreditNoteRedemptionRecord[]): CreditNoteRecord {
    const amountPaise = typeof row.amountPaise === 'bigint' ? Number(row.amountPaise) : Number(row.amountPaise || 0);
    const remainingPaise = typeof row.remainingPaise === 'bigint' ? Number(row.remainingPaise) : Number(row.remainingPaise || 0);
    return {
        id: row.id,
        code: row.code,
        customerName: row.customerName || null,
        customerPhone: row.customerPhone || null,
        originalInvoiceId: row.originalInvoiceId || null,
        originalBillNo: row.originalBillNo || null,
        amountPaise,
        remainingPaise,
        amount: Math.round(amountPaise) / 100,
        remainingAmount: Math.round(remainingPaise) / 100,
        reason: row.reason || null,
        status: row.status,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        redemptions
    };
}

function mapRedemptionRow(row: any): CreditNoteRedemptionRecord {
    const amountPaise = typeof row.amountPaise === 'bigint' ? Number(row.amountPaise) : Number(row.amountPaise || 0);
    return {
        id: row.id,
        creditNoteId: row.creditNoteId,
        saleId: row.saleId,
        billNo: row.billNo,
        amountPaise,
        amount: Math.round(amountPaise) / 100,
        createdBy: row.createdBy,
        createdAt: row.createdAt
    };
}

export async function issueCreditNote(
    db: any,
    input: IssueCreditNoteInput,
    user: any
): Promise<CreditNoteRecord> {
    await initCreditNoteSchema(db);
    const rawAmount = Number(input.amount);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
        throw new Error('Credit Note amount must be greater than zero.');
    }
    const amountPaise = Math.round(rawAmount * 100);
    const nowIso = new Date().toISOString();
    const id = crypto.randomUUID();
    const code = await getNextCreditNoteCode(db);

    const custName = (input.customerName || '').trim() || null;
    const custPhone = (input.customerPhone || '').trim() || null;
    const reason = (input.reason || '').trim() || 'Store credit issued';
    const creator = user?.id || user?.username || 'SYSTEM';

    // Auto-create or sync customer profile if phone is provided and customer table is accessible
    if (db.customer && typeof db.customer.findFirst === 'function' && custPhone) {
        try {
            const cleanPhone = custPhone.replace(/\D/g, '').slice(-10);
            if (cleanPhone) {
                const existing = await db.customer.findFirst({ where: { phone: cleanPhone } });
                if (!existing) {
                    await db.customer.create({
                        data: {
                            id: crypto.randomUUID ? crypto.randomUUID() : `cust_${Date.now()}`,
                            name: custName || `Customer ${cleanPhone}`,
                            phone: cleanPhone,
                            createdAt: new Date(),
                            updatedAt: new Date()
                        }
                    });
                } else if (custName && existing.name.startsWith('Customer ') && custName !== existing.name) {
                    await db.customer.update({
                        where: { id: existing.id },
                        data: { name: custName, updatedAt: new Date() }
                    });
                }
            }
        } catch (custErr) {
            console.warn('Customer upsert check during credit note issue non-fatal:', custErr);
        }
    }

    await db.$executeRawUnsafe(
        `INSERT INTO CreditNote (id, code, customerName, customerPhone, originalInvoiceId, originalBillNo, amountPaise, remainingPaise, reason, status, createdBy, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
        id,
        code,
        custName,
        custPhone,
        input.originalInvoiceId || null,
        input.originalBillNo || null,
        amountPaise,
        amountPaise,
        reason,
        creator,
        nowIso,
        nowIso
    );

    return {
        id,
        code,
        customerName: custName,
        customerPhone: custPhone,
        originalInvoiceId: input.originalInvoiceId || null,
        originalBillNo: input.originalBillNo || null,
        amountPaise,
        remainingPaise: amountPaise,
        amount: amountPaise / 100,
        remainingAmount: amountPaise / 100,
        reason,
        status: 'ACTIVE',
        createdBy: creator,
        createdAt: nowIso,
        updatedAt: nowIso,
        redemptions: []
    };
}

export async function listCreditNotes(db: any, query: CreditNoteQuery = {}): Promise<CreditNoteRecord[]> {
    await initCreditNoteSchema(db);
    let sql = `SELECT * FROM CreditNote WHERE 1=1`;
    const params: any[] = [];

    if (query.status && query.status !== 'ALL') {
        sql += ` AND status = ?`;
        params.push(query.status);
    }

    if (query.customerPhone) {
        sql += ` AND customerPhone = ?`;
        params.push(query.customerPhone.trim());
    }

    if (query.search && query.search.trim()) {
        const searchPattern = `%${query.search.trim()}%`;
        sql += ` AND (code LIKE ? OR customerName LIKE ? OR customerPhone LIKE ? OR originalBillNo LIKE ?)`;
        params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    sql += ` ORDER BY createdAt DESC`;

    const rows: any[] = await db.$queryRawUnsafe(sql, ...params);
    const redemptionsMap = new Map<string, CreditNoteRedemptionRecord[]>();

    if (rows.length > 0) {
        const ids = rows.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');
        const redRows: any[] = await db.$queryRawUnsafe(
            `SELECT * FROM CreditNoteRedemption WHERE creditNoteId IN (${placeholders}) ORDER BY createdAt DESC`,
            ...ids
        );
        for (const redRow of redRows) {
            const item = mapRedemptionRow(redRow);
            if (!redemptionsMap.has(item.creditNoteId)) {
                redemptionsMap.set(item.creditNoteId, []);
            }
            redemptionsMap.get(item.creditNoteId)!.push(item);
        }
    }

    return rows.map(row => mapCreditNoteRow(row, redemptionsMap.get(row.id) || []));
}

export async function getCreditNoteByCode(db: any, codeOrId: string): Promise<CreditNoteRecord | null> {
    await initCreditNoteSchema(db);
    const clean = (codeOrId || '').trim();
    if (!clean) return null;

    const rows: any[] = await db.$queryRawUnsafe(
        `SELECT * FROM CreditNote WHERE code = ? COLLATE NOCASE OR id = ? LIMIT 1`,
        clean,
        clean
    );

    if (rows.length === 0) return null;
    const cnRow = rows[0];

    const redRows: any[] = await db.$queryRawUnsafe(
        `SELECT * FROM CreditNoteRedemption WHERE creditNoteId = ? ORDER BY createdAt DESC`,
        cnRow.id
    );

    return mapCreditNoteRow(cnRow, redRows.map(mapRedemptionRow));
}

export async function getActiveCreditsForCustomer(
    db: any,
    phone: string
): Promise<{ creditNotes: CreditNoteRecord[]; totalAvailable: number }> {
    await initCreditNoteSchema(db);
    const cleanPhone = (phone || '').trim();
    if (!cleanPhone) {
        return { creditNotes: [], totalAvailable: 0 };
    }

    const rows: any[] = await db.$queryRawUnsafe(
        `SELECT * FROM CreditNote WHERE customerPhone = ? AND status = 'ACTIVE' AND remainingPaise > 0 ORDER BY createdAt ASC`,
        cleanPhone
    );

    const creditNotes = rows.map(r => mapCreditNoteRow(r));
    const totalPaise = creditNotes.reduce((sum, cn) => sum + cn.remainingPaise, 0);

    return {
        creditNotes,
        totalAvailable: totalPaise / 100
    };
}

export async function redeemCreditNotes(
    tx: any,
    redemptions: CreditNoteRedemptionInput[],
    saleId: string,
    billNo: string,
    user: any
) {
    await initCreditNoteSchema(tx);
    const nowIso = new Date().toISOString();
    const userId = user?.id || user?.username || 'SYSTEM';

    for (const r of redemptions) {
        let cn: any = null;
        if (r.creditNoteId) {
            const rows: any[] = await tx.$queryRawUnsafe(`SELECT * FROM CreditNote WHERE id = ?`, r.creditNoteId);
            if (rows.length > 0) cn = rows[0];
        } else if (r.code) {
            const rows: any[] = await tx.$queryRawUnsafe(`SELECT * FROM CreditNote WHERE code = ? COLLATE NOCASE`, r.code.trim());
            if (rows.length > 0) cn = rows[0];
        }

        if (!cn) {
            throw new Error(`Credit Note ${r.code || r.creditNoteId} not found.`);
        }

        if (cn.status !== 'ACTIVE') {
            throw new Error(`Credit Note ${cn.code} is ${cn.status.toLowerCase()} and cannot be used.`);
        }

        const redeemPaise = Math.round(Number(r.amount) * 100);
        if (redeemPaise <= 0) {
            throw new Error(`Redemption amount for ${cn.code} must be greater than zero.`);
        }

        const currentRemaining = typeof cn.remainingPaise === 'bigint' ? Number(cn.remainingPaise) : Number(cn.remainingPaise);
        if (redeemPaise > currentRemaining) {
            throw new Error(`Credit Note ${cn.code} only has ₹${(currentRemaining / 100).toFixed(2)} available.`);
        }

        const newRemaining = currentRemaining - redeemPaise;
        const newStatus = newRemaining === 0 ? 'EXHAUSTED' : 'ACTIVE';

        await tx.$executeRawUnsafe(
            `UPDATE CreditNote SET remainingPaise = ?, status = ?, updatedAt = ? WHERE id = ?`,
            newRemaining,
            newStatus,
            nowIso,
            cn.id
        );

        await tx.$executeRawUnsafe(
            `INSERT INTO CreditNoteRedemption (id, creditNoteId, saleId, billNo, amountPaise, createdBy, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            crypto.randomUUID(),
            cn.id,
            saleId,
            billNo,
            redeemPaise,
            userId,
            nowIso
        );
    }
}

export async function cancelCreditNote(db: any, id: string, reason: string, user: any) {
    await initCreditNoteSchema(db);
    const rows: any[] = await db.$queryRawUnsafe(`SELECT * FROM CreditNote WHERE id = ?`, id);
    if (rows.length === 0) {
        throw new Error('Credit Note not found.');
    }
    const cn = rows[0];
    if (cn.status === 'CANCELLED') {
        throw new Error('Credit Note is already cancelled.');
    }

    const amountPaise = typeof cn.amountPaise === 'bigint' ? Number(cn.amountPaise) : Number(cn.amountPaise);
    const remainingPaise = typeof cn.remainingPaise === 'bigint' ? Number(cn.remainingPaise) : Number(cn.remainingPaise);

    if (remainingPaise < amountPaise) {
        throw new Error('Partially or fully redeemed Credit Notes cannot be cancelled.');
    }

    const nowIso = new Date().toISOString();
    const updatedReason = cn.reason ? `${cn.reason} [CANCELLED: ${reason || 'Mistake'}]` : `[CANCELLED: ${reason || 'Mistake'}]`;

    await db.$executeRawUnsafe(
        `UPDATE CreditNote SET status = 'CANCELLED', reason = ?, updatedAt = ? WHERE id = ?`,
        updatedReason,
        nowIso,
        id
    );

    return { success: true };
}

export async function restoreRedemptionsForSale(tx: any, saleId: string) {
    await initCreditNoteSchema(tx);
    const redRows: any[] = await tx.$queryRawUnsafe(
        `SELECT * FROM CreditNoteRedemption WHERE saleId = ?`,
        saleId
    );

    const nowIso = new Date().toISOString();
    for (const red of redRows) {
        const amountPaise = typeof red.amountPaise === 'bigint' ? Number(red.amountPaise) : Number(red.amountPaise);
        await tx.$executeRawUnsafe(
            `UPDATE CreditNote 
             SET remainingPaise = remainingPaise + ?, 
                 status = 'ACTIVE', 
                 updatedAt = ? 
             WHERE id = ?`,
            amountPaise,
            nowIso,
            red.creditNoteId
        );
        await tx.$executeRawUnsafe(`DELETE FROM CreditNoteRedemption WHERE id = ?`, red.id);
    }
}

