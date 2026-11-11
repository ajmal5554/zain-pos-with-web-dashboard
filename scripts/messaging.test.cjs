const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');
const { createRequire } = require('node:module');

function loadTsModule(filePath) {
    const source = fs.readFileSync(filePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
    }).outputText;
    const mod = { exports: {} };
    const sourceRequire = createRequire(filePath);
    const localRequire = (name) => {
        if (name.startsWith('.')) {
            const absolute = path.resolve(path.dirname(filePath), name);
            const tsPath = absolute.endsWith('.ts') ? absolute : `${absolute}.ts`;
            if (fs.existsSync(tsPath)) return loadTsModule(tsPath);
        }
        return sourceRequire(name);
    };
    new Function('require', 'exports', 'module', compiled)(localRequire, mod.exports, mod);
    return mod.exports;
}

const messagingService = loadTsModule(path.resolve(__dirname, '../electron/messaging.service.ts'));

class MockDb {
    constructor() {
        this.creditNotes = new Map();
        this.customers = new Map();
        this.messageLogs = [];
        this.settings = new Map();
        this.setting = {
            findUnique: async ({ where }) => {
                const value = this.settings.get(where.key);
                return value !== undefined ? { key: where.key, value } : null;
            },
        };
    }

    async $queryRawUnsafe(sql, ...params) {
        if (sql.includes('FROM CreditNote')) {
            const phone = params[0];
            return Array.from(this.creditNotes.values()).filter(cn =>
                cn.status === 'ACTIVE' &&
                cn.remainingPaise > 0 &&
                (cn.customerPhone === phone || cn.customerPhone?.endsWith(phone) || phone?.endsWith(cn.customerPhone))
            );
        }
        if (sql.includes('FROM Customer')) {
            const phone = params[0];
            const found = Array.from(this.customers.values()).find(c =>
                c.phone === phone || c.phone?.endsWith(phone) || phone?.endsWith(c.phone)
            );
            return found ? [found] : [];
        }
        if (sql.includes('FROM MessageLog')) {
            if (sql.includes('waMessageId IS NOT NULL')) {
                return this.messageLogs.filter(m => m.waMessageId && ['SENT', 'DELIVERED'].includes(m.status));
            }
            return [...this.messageLogs].reverse();
        }
        return [];
    }

    async $executeRawUnsafe(sql, ...params) {
        if (sql.includes('INSERT INTO MessageLog')) {
            const [id, saleId, billNo, customerName, customerPhone, channel, provider, status, fallback, fallbackReason, messageText, error, createdAt, waMessageId] = params;
            this.messageLogs.push({
                id, saleId, billNo, customerName, customerPhone, channel, provider, status, fallback: Boolean(fallback), fallbackReason, messageText, error, createdAt, waMessageId: waMessageId || null
            });
            return;
        }
        if (sql.includes('UPDATE MessageLog SET status = ?, error = ? WHERE id = ?')) {
            const [status, error, id] = params;
            const target = this.messageLogs.find(m => m.id === id);
            if (target) {
                target.status = status;
                target.error = error;
            }
            return;
        }
        if (sql.includes('UPDATE Customer SET hasWhatsApp = ?')) {
            const [hasWa, phone] = params;
            for (const c of this.customers.values()) {
                if (c.phone === phone || c.phone?.endsWith(phone) || phone?.endsWith(c.phone)) {
                    c.hasWhatsApp = hasWa;
                }
            }
            return;
        }
    }
}

test('phone number normalization handles 10-digit, 91 prefix, and international formats', () => {
    const norm1 = messagingService.normalizePhoneNumber('9876543210', '91');
    assert.equal(norm1.tenDigit, '9876543210');
    assert.equal(norm1.international, '919876543210');
    assert.equal(norm1.waFormat, '919876543210');
    assert.equal(norm1.e164, '+919876543210');

    const norm2 = messagingService.normalizePhoneNumber('+91 98765-43210', '91');
    assert.equal(norm2.tenDigit, '9876543210');
    assert.equal(norm2.waFormat, '919876543210');

    const norm3 = messagingService.normalizePhoneNumber('09876543210', '91');
    assert.equal(norm3.tenDigit, '9876543210');
});

test('WhatsApp invoice message formatting includes items, payment, and active store credit details', () => {
    const payload = {
        billNo: '1042',
        date: new Date('2026-11-04T12:00:00Z'),
        customerName: 'Rahul Kumar',
        customerPhone: '9876543210',
        items: [
            { name: 'Formal Linen Shirt', variantInfo: 'Size 40, White', quantity: 1, sellingPrice: 1299, total: 1299 },
            { name: 'Cotton Chino', variantInfo: 'Size 32', quantity: 1, sellingPrice: 1499, total: 1499 },
        ],
        subtotal: 2798,
        discount: 200,
        grandTotal: 2598,
        paymentMethod: 'CASH',
        paidAmount: 2600,
        changeAmount: 2,
        appliedStoreCredit: [{ code: 'CN-1001', amount: 500 }],
        activeStoreCreditBalance: 350,
        activeStoreCreditCodes: ['CN-1002'],
        shopName: 'ZAIN GENTS PALACE',
        shopPhone: '9037106449',
        shopAddress: 'CHIRAMMAL TOWER, NILESHWAR',
        gstin: '32PVGPS0686J1ZV',
    };

    const text = messagingService.buildInvoiceMessageWhatsApp(payload);
    assert.match(text, /TAX INVOICE #1042/);
    assert.match(text, /Rahul Kumar/);
    assert.match(text, /Formal Linen Shirt/);
    assert.match(text, /GRAND TOTAL: ₹2598\.00/);
    assert.match(text, /Store Credit Redeemed: ₹500\.00/);
    assert.match(text, /STORE CREDIT BALANCE: ₹350\.00/);
    assert.match(text, /CN-1002/);
});

test('SMS invoice message is compact and includes store credit balance when present', () => {
    const payload = {
        billNo: '1042',
        customerPhone: '9876543210',
        items: [
            { name: 'Shirt', quantity: 2, sellingPrice: 1000, total: 2000 },
        ],
        subtotal: 2000,
        grandTotal: 2000,
        paymentMethod: 'UPI',
        activeStoreCreditBalance: 450,
        activeStoreCreditCodes: ['CN-555'],
        shopName: 'ZAIN GENTS PALACE',
        shopPhone: '9037106449',
    };

    const sms = messagingService.buildInvoiceMessageSMS(payload);
    assert.match(sms, /Inv #1042 for Rs\.2000\.00/);
    assert.match(sms, /Avail Store Credit: Rs\.450\.00 \(Code: CN-555\)/);
    assert.match(sms, /Ph: 9037106449/);
    assert.ok(sms.length <= 250, 'SMS message is kept within reasonable SMS length');
});

test('direct mode generates valid wa.me and sms links with store credit parameters', async () => {
    const db = new MockDb();
    const payload = {
        billNo: '1088',
        customerPhone: '9876543210',
        customerName: 'Samir',
        items: [{ name: 'Jeans', quantity: 1, sellingPrice: 1500, total: 1500 }],
        subtotal: 1500,
        grandTotal: 1500,
        paymentMethod: 'CASH',
        activeStoreCreditBalance: 200,
        activeStoreCreditCodes: ['CN-99'],
        shopName: 'ZAIN GENTS PALACE',
    };

    const res = await messagingService.sendInvoiceMessage(db, payload, {
        enabled: true,
        autoSend: false,
        defaultChannel: 'WHATSAPP_FIRST',
        includeStoreCredit: true,
        includeShopDetails: true,
        defaultCountryCode: '91',
        whatsappProvider: 'DIRECT',
        smsProvider: 'DIRECT',
    });

    assert.equal(res.success, true);
    assert.equal(res.channel, 'WHATSAPP');
    assert.ok(res.directUrl.startsWith('https://wa.me/919876543210?text='));
    assert.match(decodeURIComponent(res.directUrl), /TAX INVOICE #1088/);
    assert.match(decodeURIComponent(res.directUrl), /CN-99/);
    assert.equal(db.messageLogs.length, 1);
});

test('when customer does NOT have a WhatsApp account, service routes directly to SMS fallback and logs it', async () => {
    const db = new MockDb();
    db.customers.set('c1', {
        id: 'c1',
        name: 'Manoj',
        phone: '9876500000',
        hasWhatsApp: 0, // Customer has no WhatsApp account
    });

    const payload = {
        billNo: '1099',
        customerPhone: '9876500000',
        customerName: 'Manoj',
        customerHasWhatsApp: false, // explicitly flagged or fetched from DB
        items: [{ name: 'Kurta', quantity: 1, sellingPrice: 900, total: 900 }],
        subtotal: 900,
        grandTotal: 900,
        paymentMethod: 'CASH',
        shopName: 'ZAIN GENTS PALACE',
    };

    const res = await messagingService.sendInvoiceMessage(db, payload, {
        enabled: true,
        autoSend: false,
        defaultChannel: 'WHATSAPP_FIRST',
        includeStoreCredit: true,
        includeShopDetails: true,
        defaultCountryCode: '91',
        whatsappProvider: 'DIRECT',
        smsProvider: 'DIRECT',
    });

    assert.equal(res.success, true);
    assert.equal(res.channel, 'SMS');
    assert.equal(res.fallback, true);
    assert.match(res.fallbackReason, /does not have a WhatsApp account/);
    assert.ok(res.directUrl.startsWith('sms:9876500000?body='));

    // Check message log
    const log = db.messageLogs[db.messageLogs.length - 1];
    assert.equal(log.channel, 'SMS');
    assert.equal(log.fallback, true);
    assert.match(log.messageText, /Inv #1099/);
});

test('store credit voucher message formats correctly for WhatsApp and SMS', () => {
    const payload = {
        customerName: 'Ashok',
        customerPhone: '9988776655',
        code: 'CN-2045',
        amount: 850,
        remainingAmount: 850,
        reason: 'Exchange price difference',
        totalActiveBalance: 850,
        shopName: 'ZAIN GENTS PALACE',
        shopPhone: '9037106449',
    };

    const wa = messagingService.buildStoreCreditMessageWhatsApp(payload);
    assert.match(wa, /CN-2045/);
    assert.match(wa, /₹850\.00/);
    assert.match(wa, /Exchange price difference/);

    const sms = messagingService.buildStoreCreditMessageSMS(payload);
    assert.match(sms, /CN-2045/);
    assert.match(sms, /Rs\.850\.00/);
});

test('sendCampaignMessages sanitizes multi-line template params, records waMessageId, and syncs webhook failure status', async () => {
    const axios = require('axios');
    const origPost = axios.post;
    const postedUrls = [];
    const postedBodies = [];

    axios.post = async (url, body) => {
        postedUrls.push(url);
        postedBodies.push(body);
        if (url.includes('graph.facebook.com')) {
            return { data: { messages: [{ id: 'wamid.test_campaign_123' }] } };
        }
        if (url.endsWith('/api/whatsapp/dispatches/register')) {
            return { data: { success: true, registered: 1 } };
        }
        if (url.endsWith('/api/whatsapp/dispatches/statuses')) {
            return {
                data: {
                    success: true,
                    data: [
                        {
                            waMessageId: 'wamid.test_campaign_123',
                            status: 'FAILED',
                            errorCode: 131049,
                            errorTitle: 'Ecosystem frequency limit',
                            errorDetails: 'Meta Marketing Frequency Limit: blocked for recipient',
                        },
                    ],
                },
            };
        }
        return { data: {} };
    };

    try {
        const db = new MockDb();
        db.settings.set('CLOUD_API_URL', 'https://cloud.example.com');
        db.settings.set('CLOUD_SYNC_SECRET', 'test-secret');

        const result = await messagingService.sendCampaignMessages(
            db,
            {
                campaignName: 'Print Drop',
                templateName: 'new_stock_arrival',
                languageCode: 'en_US',
                headerMediaId: 'media-id-1',
                templateParams: [
                    'Print Shirts',
                    'Pure cotton\n\tin 4 colors    with collar',
                    'M, L, XL',
                    '999',
                ],
                recipients: [{ id: 'r1', name: 'Ajmal', phone: '7907814523' }],
            },
            {
                enabled: true,
                autoSend: false,
                defaultChannel: 'WHATSAPP_FIRST',
                includeStoreCredit: true,
                includeShopDetails: true,
                defaultCountryCode: '91',
                whatsappProvider: 'META_API',
                metaPhoneNumberId: '1446804745184600',
                metaAccessToken: 'fake-token',
                smsProvider: 'DIRECT',
            }
        );

        assert.equal(result.sent, 1);
        assert.equal(result.failed, 0);
        assert.equal(result.dispatches[0].waMessageId, 'wamid.test_campaign_123');

        const metaReq = postedBodies[0];
        const bodyComp = metaReq.template.components.find(c => c.type === 'body');
        assert.equal(bodyComp.parameters[2].text, 'Pure cotton in 4 colors   with collar');

        assert.equal(db.messageLogs[0].waMessageId, 'wamid.test_campaign_123');
        assert.equal(db.messageLogs[0].status, 'SENT');

        const syncRes = await messagingService.syncCloudDeliveryStatuses(db);
        assert.equal(syncRes.updated, 1);
        assert.equal(syncRes.failedCount, 1);
        assert.match(db.messageLogs[0].status, /FAILED/);
        assert.match(db.messageLogs[0].error, /#131049/);
    } finally {
        axios.post = origPost;
    }
});

