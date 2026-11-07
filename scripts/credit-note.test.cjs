const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const tsNode = require('ts-node');

try {
    tsNode.register({ transpileOnly: true });
} catch {}

const creditService = require('../electron/credit-note.service.ts');

class MockDatabase {
    constructor() {
        this.creditNotes = new Map();
        this.redemptions = new Map();
        this.customers = new Map();
        this.customer = {
            findFirst: async ({ where }) => {
                if (where?.phone) {
                    return Array.from(this.customers.values()).find(c => c.phone === where.phone) || null;
                }
                return null;
            },
            create: async ({ data }) => {
                this.customers.set(data.id, data);
                return data;
            },
            update: async ({ where, data }) => {
                const c = this.customers.get(where.id);
                if (c) Object.assign(c, data);
                return c;
            }
        };
    }

    async $executeRawUnsafe(sql, ...params) {
        if (sql.startsWith('CREATE TABLE') || sql.startsWith('CREATE INDEX')) {
            return;
        }
        if (sql.includes('INSERT INTO CreditNote (')) {
            const [id, code, customerName, customerPhone, originalInvoiceId, originalBillNo, amountPaise, remainingPaise, reason, createdBy, createdAt, updatedAt] = params;
            this.creditNotes.set(id, {
                id, code, customerName, customerPhone, originalInvoiceId, originalBillNo,
                amountPaise, remainingPaise, reason, status: 'ACTIVE', createdBy, createdAt, updatedAt
            });
            return;
        }
        if (sql.includes('UPDATE CreditNote SET remainingPaise = ?')) {
            const [remainingPaise, status, updatedAt, id] = params;
            const cn = this.creditNotes.get(id);
            if (cn) {
                cn.remainingPaise = remainingPaise;
                cn.status = status;
                cn.updatedAt = updatedAt;
            }
            return;
        }
        if (sql.includes('UPDATE CreditNote SET status = \'CANCELLED\'')) {
            const [reason, updatedAt, id] = params;
            const cn = this.creditNotes.get(id);
            if (cn) {
                cn.status = 'CANCELLED';
                cn.reason = reason;
                cn.updatedAt = updatedAt;
            }
            return;
        }
        if (sql.includes('INSERT INTO CreditNoteRedemption')) {
            const [id, creditNoteId, saleId, billNo, amountPaise, createdBy, createdAt] = params;
            this.redemptions.set(id, { id, creditNoteId, saleId, billNo, amountPaise, createdBy, createdAt });
            return;
        }
        if (sql.includes('remainingPaise = remainingPaise + ?')) {
            const [amountPaise, updatedAt, id] = params;
            const cn = this.creditNotes.get(id);
            if (cn) {
                cn.remainingPaise += amountPaise;
                cn.status = 'ACTIVE';
                cn.updatedAt = updatedAt;
            }
            return;
        }
        if (sql.includes('DELETE FROM CreditNoteRedemption WHERE id = ?')) {
            const [id] = params;
            this.redemptions.delete(id);
            return;
        }
    }

    async $queryRawUnsafe(sql, ...params) {
        if (sql.includes('SELECT code FROM CreditNote')) {
            return Array.from(this.creditNotes.values());
        }
        if (sql.includes('WHERE code = ?') || sql.includes('WHERE id = ?')) {
            const query = (params[0] || '').toLowerCase();
            return Array.from(this.creditNotes.values()).filter(c => (c.code || '').toLowerCase() === query || (c.id || '').toLowerCase() === query);
        }
        if (sql.includes('WHERE customerPhone = ?')) {
            const phone = params[0];
            return Array.from(this.creditNotes.values()).filter(c => c.customerPhone === phone && c.status === 'ACTIVE' && c.remainingPaise > 0);
        }
        if (sql.includes('FROM CreditNoteRedemption WHERE creditNoteId = ?')) {
            const cnId = params[0];
            return Array.from(this.redemptions.values()).filter(r => r.creditNoteId === cnId);
        }
        if (sql.includes('FROM CreditNoteRedemption WHERE saleId = ?')) {
            const saleId = params[0];
            return Array.from(this.redemptions.values()).filter(r => r.saleId === saleId);
        }
        if (sql.includes('FROM CreditNoteRedemption WHERE creditNoteId IN')) {
            const ids = new Set(params);
            return Array.from(this.redemptions.values()).filter(r => ids.has(r.creditNoteId));
        }
        if (sql.includes('FROM CreditNote WHERE 1=1')) {
            return Array.from(this.creditNotes.values());
        }
        return [];
    }
}

test('issue Credit Note generates sequential CN code and correct paise values', async () => {
    const db = new MockDatabase();
    const user = { id: 'u1', username: 'admin' };

    const cn1 = await creditService.issueCreditNote(db, {
        customerName: 'Rahul',
        customerPhone: '9876543210',
        amount: 600,
        reason: 'Return shirt'
    }, user);

    assert.equal(cn1.code, 'CN-1001');
    assert.equal(cn1.amount, 600);
    assert.equal(cn1.remainingAmount, 600);
    assert.equal(cn1.amountPaise, 60000);
    assert.equal(cn1.remainingPaise, 60000);
    assert.equal(cn1.status, 'ACTIVE');

    const cn2 = await creditService.issueCreditNote(db, {
        customerName: 'Sneha',
        customerPhone: '9876543211',
        amount: 450.50,
        reason: 'Defective piece'
    }, user);

    assert.equal(cn2.code, 'CN-1002');
    assert.equal(cn2.amount, 450.50);
    assert.equal(cn2.amountPaise, 45050);
});

test('query active credits for customer phone', async () => {
    const db = new MockDatabase();
    const user = { id: 'u1' };

    await creditService.issueCreditNote(db, {
        customerName: 'Rahul',
        customerPhone: '9876543210',
        amount: 600
    }, user);

    await creditService.issueCreditNote(db, {
        customerName: 'Rahul',
        customerPhone: '9876543210',
        amount: 200
    }, user);

    const result = await creditService.getActiveCreditsForCustomer(db, '9876543210');
    assert.equal(result.creditNotes.length, 2);
    assert.equal(result.totalAvailable, 800);
});

test('partial and full redemption reduces remaining balance and updates status', async () => {
    const db = new MockDatabase();
    const user = { id: 'u1' };

    const cn = await creditService.issueCreditNote(db, {
        customerName: 'Rahul',
        customerPhone: '9876543210',
        amount: 600
    }, user);

    // Redeem partial ₹400 on Bill #101
    await creditService.redeemCreditNotes(db, [{
        creditNoteId: cn.id,
        amount: 400
    }], 'sale-1', '101', user);

    const updated1 = await creditService.getCreditNoteByCode(db, 'CN-1001');
    assert.equal(updated1.remainingAmount, 200);
    assert.equal(updated1.status, 'ACTIVE');
    assert.equal(updated1.redemptions.length, 1);
    assert.equal(updated1.redemptions[0].amount, 400);

    // Redeem remaining ₹200 on Bill #102
    await creditService.redeemCreditNotes(db, [{
        creditNoteId: cn.id,
        amount: 200
    }], 'sale-2', '102', user);

    const updated2 = await creditService.getCreditNoteByCode(db, 'CN-1001');
    assert.equal(updated2.remainingAmount, 0);
    assert.equal(updated2.status, 'EXHAUSTED');
    assert.equal(updated2.redemptions.length, 2);
});

test('voiding a sale restores redeemed credit amount back to customer credit note', async () => {
    const db = new MockDatabase();
    const user = { id: 'u1' };

    const cn = await creditService.issueCreditNote(db, {
        customerName: 'Rahul',
        customerPhone: '9876543210',
        amount: 600
    }, user);

    // Redeem full ₹600 on sale-1
    await creditService.redeemCreditNotes(db, [{
        creditNoteId: cn.id,
        amount: 600
    }], 'sale-1', '101', user);

    const afterRedeem = await creditService.getCreditNoteByCode(db, 'CN-1001');
    assert.equal(afterRedeem.status, 'EXHAUSTED');

    // Void sale-1
    await creditService.restoreRedemptionsForSale(db, 'sale-1');

    const afterRestore = await creditService.getCreditNoteByCode(db, 'CN-1001');
    assert.equal(afterRestore.remainingAmount, 600);
    assert.equal(afterRestore.status, 'ACTIVE');
    assert.equal(afterRestore.redemptions.length, 0);
});

test('issuing credit note creates or updates customer profile', async () => {
    const db = new MockDatabase();
    const user = { id: 'u1' };

    const cn = await creditService.issueCreditNote(db, {
        customerName: 'Aarav Sharma',
        customerPhone: '9845012345',
        amount: 500,
        reason: 'Refund for Bill #20261030-001'
    }, user);

    assert.equal(cn.customerName, 'Aarav Sharma');
    assert.equal(cn.customerPhone, '9845012345');

    // Customer profile in customer table
    const cust = await db.customer.findFirst({ where: { phone: '9845012345' } });
    assert.ok(cust);
    assert.equal(cust.name, 'Aarav Sharma');
    assert.equal(cust.phone, '9845012345');
});
