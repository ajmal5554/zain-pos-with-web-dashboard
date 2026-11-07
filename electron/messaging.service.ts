import axios from 'axios';
import * as crypto from 'node:crypto';
import type {
    MessagingConfig,
    InvoiceMessagePayload,
    StoreCreditMessagePayload,
    MessageResult,
    MessageLogRecord,
    MessagingChannel,
} from '../src/types/messaging';
import {
    DEFAULT_MESSAGING_CONFIG,
    normalizePhoneNumber,
    formatReadableDate,
    buildInvoiceMessageWhatsApp,
    buildInvoiceMessageSMS,
    buildStoreCreditMessageWhatsApp,
    buildStoreCreditMessageSMS,
} from '../src/lib/messagingFormat';

export {
    DEFAULT_MESSAGING_CONFIG,
    normalizePhoneNumber,
    formatReadableDate,
    buildInvoiceMessageWhatsApp,
    buildInvoiceMessageSMS,
    buildStoreCreditMessageWhatsApp,
    buildStoreCreditMessageSMS,
};

export class NoWhatsAppAccountError extends Error {
    constructor(message: string = 'Recipient does not have a registered WhatsApp account') {
        super(message);
        this.name = 'NoWhatsAppAccountError';
    }
}

/**
 * Send via Meta WhatsApp Cloud API (supports both Templates and free-form Text)
 */
async function sendViaMetaWhatsApp(
    phone: string,
    text: string,
    config: MessagingConfig,
    templateOptions?: { templateName?: string; parameters?: string[] }
): Promise<string> {
    if (!config.metaPhoneNumberId || !config.metaAccessToken) {
        throw new Error('Meta WhatsApp Cloud API credentials missing (PhoneNumberId or AccessToken).');
    }

    const { waFormat } = normalizePhoneNumber(phone, config.defaultCountryCode);
    const url = `https://graph.facebook.com/v19.0/${config.metaPhoneNumberId}/messages`;

    const templateName = templateOptions?.templateName || config.metaTemplateName;
    const isTemplate = Boolean(templateName && templateName.toLowerCase() !== 'none');

    let bodyPayload: any;
    if (isTemplate) {
        let langCode = (config.metaLanguageCode || 'en').trim();
        if (/^english$/i.test(langCode)) langCode = 'en';
        else if (/^english\s*\(?us\)?$/i.test(langCode)) langCode = 'en_US';
        else if (/^english\s*\(?uk\)?$/i.test(langCode) || /^english\s*\(?gb\)?$/i.test(langCode)) langCode = 'en_GB';

        const templateObj: any = {
            name: templateName,
            language: { code: langCode },
        };
        const params = templateOptions?.parameters;
        if (params && params.length > 0 && templateName !== 'hello_world') {
            templateObj.components = [
                {
                    type: 'body',
                    parameters: params.map((p) => ({ type: 'text', text: String(p) })),
                },
            ];
        }
        bodyPayload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: waFormat,
            type: 'template',
            template: templateObj,
        };
    } else {
        bodyPayload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: waFormat,
            type: 'text',
            text: { preview_url: false, body: text },
        };
    }

    try {
        const res = await axios.post(url, bodyPayload, {
            headers: {
                'Authorization': `Bearer ${config.metaAccessToken}`,
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        });

        return res.data?.messages?.[0]?.id || 'meta-sent';
    } catch (err: any) {
        const respData = err.response?.data;
        const errObj = respData?.error || {};
        const code = errObj.code;
        const msg = String(errObj.message || err.message || '').toLowerCase();

        // Error code 131026: Undeliverable / Recipient is not a valid WhatsApp user
        if (code === 131026 || msg.includes('not a valid whatsapp user') || msg.includes('not on whatsapp') || msg.includes('undeliverable')) {
            throw new NoWhatsAppAccountError(`Meta API: Phone ${waFormat} is not registered on WhatsApp (code ${code})`);
        }

        // Error code 131047: Re-engagement window (outside 24 hours)
        if (code === 131047) {
            throw new Error(`Meta API: Customer has not messaged business in 24 hours. A registered Meta template (e.g. tax_invoice) must be used.`);
        }

        throw new Error(errObj.message || err.message || 'Meta WhatsApp API request failed');
    }
}

/**
 * Send via Twilio (WhatsApp or SMS)
 */
async function sendViaTwilio(
    phone: string,
    text: string,
    channel: MessagingChannel,
    config: MessagingConfig
): Promise<string> {
    if (!config.twilioAccountSid || !config.twilioAuthToken) {
        throw new Error('Twilio credentials missing (Account SID or Auth Token).');
    }

    const { e164 } = normalizePhoneNumber(phone, config.defaultCountryCode);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`;

    const fromNumber = channel === 'WHATSAPP'
        ? (config.twilioWhatsappFrom || 'whatsapp:+14155238886')
        : (config.twilioSmsFrom || '');
    const toNumber = channel === 'WHATSAPP' ? `whatsapp:${e164}` : e164;

    if (!fromNumber) {
        throw new Error(`Twilio From Number missing for ${channel}`);
    }

    const params = new URLSearchParams();
    params.append('From', fromNumber);
    params.append('To', toNumber);
    params.append('Body', text);

    const authHeader = `Basic ${Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64')}`;

    try {
        const res = await axios.post(url, params.toString(), {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 10000,
        });

        return res.data?.sid || 'twilio-sent';
    } catch (err: any) {
        const respData = err.response?.data;
        const twilioCode = respData?.code;
        const twilioMsg = String(respData?.message || err.message || '').toLowerCase();

        // Twilio Error 63007: Channel could not find the user (Not a WhatsApp user)
        // Twilio Error 63016 / 21614: Not registered
        if (
            channel === 'WHATSAPP' &&
            (twilioCode === 63007 || twilioCode === 63016 || twilioCode === 21614 || twilioMsg.includes('not a whatsapp user') || twilioMsg.includes('channel could not find'))
        ) {
            throw new NoWhatsAppAccountError(`Twilio: ${toNumber} does not have a WhatsApp account (code ${twilioCode})`);
        }

        throw new Error(respData?.message || err.message || 'Twilio message dispatch failed');
    }
}

/**
 * Send via Fast2SMS (popular Indian transactional SMS gateway)
 */
async function sendViaFast2SMS(phone: string, text: string, config: MessagingConfig): Promise<string> {
    if (!config.fast2smsApiKey) {
        throw new Error('Fast2SMS API key missing in settings.');
    }

    const { tenDigit } = normalizePhoneNumber(phone, config.defaultCountryCode);
    const url = 'https://www.fast2sms.com/dev/bulkV2';

    try {
        const res = await axios.post(
            url,
            {
                route: 'v3',
                sender_id: config.fast2smsSenderId || 'FTWSMS',
                message: text,
                language: 'english',
                flash: 0,
                numbers: tenDigit,
            },
            {
                headers: {
                    'authorization': config.fast2smsApiKey,
                    'Content-Type': 'application/json',
                },
                timeout: 10000,
            }
        );

        if (res.data?.return === true) {
            return res.data?.request_id || 'fast2sms-sent';
        } else {
            throw new Error(res.data?.message || 'Fast2SMS returned error');
        }
    } catch (err: any) {
        const errMsg = err.response?.data?.message || err.message || 'Fast2SMS dispatch failed';
        throw new Error(`Fast2SMS Error: ${errMsg}`);
    }
}

/**
 * Send via Custom HTTP endpoint
 */
async function sendViaCustomHttp(
    phone: string,
    text: string,
    channel: MessagingChannel,
    config: MessagingConfig
): Promise<string> {
    const isWa = channel === 'WHATSAPP';
    const targetUrlTemplate = isWa ? config.customWhatsappUrl : config.customSmsUrl;
    const method = (isWa ? config.customWhatsappMethod : config.customSmsMethod) || 'GET';
    const headersJson = isWa ? config.customWhatsappHeadersJson : config.customSmsHeadersJson;
    const bodyJson = isWa ? config.customWhatsappBodyJson : config.customSmsBodyJson;

    if (!targetUrlTemplate) {
        throw new Error(`Custom HTTP ${channel} endpoint URL is not configured.`);
    }

    const norm = normalizePhoneNumber(phone, config.defaultCountryCode);
    const encode = encodeURIComponent;

    const resolvedUrl = targetUrlTemplate
        .replace(/\{phone\}/g, encode(norm.digits))
        .replace(/\{tenDigit\}/g, encode(norm.tenDigit))
        .replace(/\{international\}/g, encode(norm.international))
        .replace(/\{e164\}/g, encode(norm.e164))
        .replace(/\{message\}/g, encode(text));

    let headers: Record<string, string> = {};
    if (headersJson) {
        try {
            headers = JSON.parse(headersJson);
        } catch {
            console.warn('Invalid JSON in custom HTTP headers config');
        }
    }

    let bodyData: any = undefined;
    if (bodyJson && method === 'POST') {
        const resolvedBodyStr = bodyJson
            .replace(/\{phone\}/g, norm.digits)
            .replace(/\{tenDigit\}/g, norm.tenDigit)
            .replace(/\{international\}/g, norm.international)
            .replace(/\{e164\}/g, norm.e164)
            .replace(/\{message\}/g, text);
        try {
            bodyData = JSON.parse(resolvedBodyStr);
        } catch {
            bodyData = resolvedBodyStr;
        }
    }

    try {
        const res = await axios({
            url: resolvedUrl,
            method,
            headers,
            data: bodyData,
            timeout: 10000,
        });

        // Check if custom response explicitly indicates recipient has no WhatsApp
        const resStr = JSON.stringify(res.data || '').toLowerCase();
        if (isWa && (resStr.includes('no_whatsapp') || resStr.includes('not_on_whatsapp') || resStr.includes('invalid_user'))) {
            throw new NoWhatsAppAccountError(`Custom Gateway: Phone is not on WhatsApp`);
        }

        return `custom-${method.toLowerCase()}-sent`;
    } catch (err: any) {
        if (err instanceof NoWhatsAppAccountError) throw err;
        throw new Error(`Custom HTTP ${channel} dispatch error: ${err.message}`);
    }
}

/**
 * Send an SMS message using the configured SMS provider
 */
async function sendSmsViaProvider(phone: string, text: string, config: MessagingConfig): Promise<{ provider: string; messageId?: string; directUrl?: string }> {
    const { tenDigit } = normalizePhoneNumber(phone, config.defaultCountryCode);

    switch (config.smsProvider) {
        case 'FAST2SMS': {
            const messageId = await sendViaFast2SMS(phone, text, config);
            return { provider: 'Fast2SMS', messageId };
        }
        case 'TWILIO': {
            const messageId = await sendViaTwilio(phone, text, 'SMS', config);
            return { provider: 'Twilio SMS', messageId };
        }
        case 'CUSTOM_HTTP': {
            const messageId = await sendViaCustomHttp(phone, text, 'SMS', config);
            return { provider: 'Custom HTTP SMS', messageId };
        }
        case 'DIRECT':
        default: {
            // Direct SMS intent protocol
            const directUrl = `sms:${tenDigit}?body=${encodeURIComponent(text)}`;
            return { provider: 'Direct (Device SMS)', directUrl };
        }
    }
}

/**
 * Send a WhatsApp message using the configured WhatsApp provider
 */
async function sendWhatsAppViaProvider(
    phone: string,
    text: string,
    config: MessagingConfig,
    templateOptions?: { templateName?: string; parameters?: string[] }
): Promise<{ provider: string; messageId?: string; directUrl?: string }> {
    const norm = normalizePhoneNumber(phone, config.defaultCountryCode);

    switch (config.whatsappProvider) {
        case 'META_API': {
            const messageId = await sendViaMetaWhatsApp(phone, text, config, templateOptions);
            return { provider: 'WhatsApp Cloud API', messageId };
        }
        case 'TWILIO': {
            const messageId = await sendViaTwilio(phone, text, 'WHATSAPP', config);
            return { provider: 'Twilio WhatsApp', messageId };
        }
        case 'CUSTOM_HTTP': {
            const messageId = await sendViaCustomHttp(phone, text, 'WHATSAPP', config);
            return { provider: 'Custom WhatsApp API', messageId };
        }
        case 'DIRECT':
        default: {
            // WhatsApp Web / Universal deep link
            const directUrl = `https://wa.me/${norm.waFormat}?text=${encodeURIComponent(text)}`;
            return { provider: 'Direct (WhatsApp Web)', directUrl };
        }
    }
}

/**
 * Fetch active credit notes and total available balance for a customer phone from SQLite
 */
export async function getCustomerStoreCredits(db: any, phone: string): Promise<{ totalAvailable: number; codes: string[]; creditNotes: any[] }> {
    if (!db || !phone) return { totalAvailable: 0, codes: [], creditNotes: [] };

    try {
        const norm = normalizePhoneNumber(phone);
        // Search by both clean 10-digit and full digits to match any phone format recorded
        const rows: any[] = await db.$queryRawUnsafe(
            `SELECT * FROM CreditNote 
             WHERE (customerPhone = ? OR customerPhone = ? OR customerPhone LIKE ?) 
               AND status = 'ACTIVE' 
               AND remainingPaise > 0 
             ORDER BY createdAt ASC`,
            norm.digits,
            norm.tenDigit,
            `%${norm.tenDigit}`
        );

        if (!rows || rows.length === 0) {
            return { totalAvailable: 0, codes: [], creditNotes: [] };
        }

        const codes = rows.map(r => r.code).filter(Boolean);
        const totalPaise = rows.reduce((sum, r) => sum + (Number(r.remainingPaise) || 0), 0);
        return {
            totalAvailable: totalPaise / 100,
            codes,
            creditNotes: rows,
        };
    } catch (err) {
        console.warn('Error fetching customer store credits in messaging service:', err);
        return { totalAvailable: 0, codes: [], creditNotes: [] };
    }
}

/**
 * Check whether a customer has WhatsApp registered or marked in SQLite
 */
export async function checkCustomerHasWhatsApp(db: any, phone: string): Promise<boolean | null> {
    if (!db || !phone) return null;
    try {
        const norm = normalizePhoneNumber(phone);
        const rows: any[] = await db.$queryRawUnsafe(
            `SELECT hasWhatsApp FROM Customer WHERE phone = ? OR phone = ? OR phone LIKE ? LIMIT 1`,
            norm.digits,
            norm.tenDigit,
            `%${norm.tenDigit}`
        );
        if (rows && rows.length > 0 && rows[0].hasWhatsApp !== null && rows[0].hasWhatsApp !== undefined) {
            return Boolean(rows[0].hasWhatsApp);
        }
    } catch {
        // Table or column might not be loaded yet
    }
    return null;
}

/**
 * Record message dispatch in SQLite MessageLog table
 */
export async function logMessage(db: any, entry: {
    saleId?: string | null;
    billNo?: string | null;
    customerName?: string | null;
    customerPhone: string;
    channel: string;
    provider: string;
    status: 'SENT' | 'FAILED' | 'OPENED';
    fallback: boolean;
    fallbackReason?: string | null;
    messageText: string;
    error?: string | null;
}): Promise<void> {
    if (!db) return;
    try {
        const id = crypto.randomUUID ? crypto.randomUUID() : ('msg-' + Date.now() + '-' + Math.random().toString(36).slice(2));
        await db.$executeRawUnsafe(
            `INSERT INTO MessageLog (id, saleId, billNo, customerName, customerPhone, channel, provider, status, fallback, fallbackReason, messageText, error, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            id,
            entry.saleId || null,
            entry.billNo ? String(entry.billNo) : null,
            entry.customerName || null,
            entry.customerPhone,
            entry.channel,
            entry.provider,
            entry.status,
            entry.fallback ? 1 : 0,
            entry.fallbackReason || null,
            entry.messageText,
            entry.error || null,
            new Date().toISOString()
        );
    } catch (err) {
        console.warn('Failed to insert into MessageLog:', err);
    }
}

/**
 * Update Customer table with WhatsApp presence status
 */
export async function updateCustomerWhatsAppStatus(db: any, phone: string, hasWhatsApp: boolean): Promise<void> {
    if (!db || !phone) return;
    try {
        const norm = normalizePhoneNumber(phone);
        await db.$executeRawUnsafe(
            `UPDATE Customer SET hasWhatsApp = ? WHERE phone = ? OR phone = ? OR phone LIKE ?`,
            hasWhatsApp ? 1 : 0,
            norm.digits,
            norm.tenDigit,
            `%${norm.tenDigit}`
        );
    } catch (err) {
        console.warn('Could not update customer hasWhatsApp flag:', err);
    }
}

/**
 * Main dispatcher: Send invoice message to customer with smart WhatsApp -> SMS fallback
 */
export async function sendInvoiceMessage(
    db: any,
    payload: InvoiceMessagePayload,
    config: MessagingConfig = DEFAULT_MESSAGING_CONFIG
): Promise<MessageResult> {
    if (!payload.customerPhone || !payload.customerPhone.trim()) {
        return {
            success: false,
            channel: 'WHATSAPP',
            fallback: false,
            recipientPhone: '',
            messageText: '',
            provider: 'None',
            error: 'Customer phone number is missing.'
        };
    }

    // Auto-enrich payload with active store credits if not explicitly provided
    if (config.includeStoreCredit && (payload.activeStoreCreditBalance === undefined || payload.activeStoreCreditBalance === null)) {
        const creditData = await getCustomerStoreCredits(db, payload.customerPhone);
        payload.activeStoreCreditBalance = creditData.totalAvailable;
        payload.activeStoreCreditCodes = creditData.codes;
    }

    // Check customer database for previously marked hasWhatsApp status
    let customerHasWhatsApp = payload.customerHasWhatsApp;
    if (customerHasWhatsApp === undefined || customerHasWhatsApp === null) {
        const dbStatus = await checkCustomerHasWhatsApp(db, payload.customerPhone);
        if (dbStatus !== null) {
            customerHasWhatsApp = dbStatus;
        }
    }

    const waText = buildInvoiceMessageWhatsApp(payload);
    const smsText = buildInvoiceMessageSMS(payload);

    // Determine target channel
    let targetChannel: MessagingChannel = 'WHATSAPP';
    if (payload.forceChannel) {
        targetChannel = payload.forceChannel;
    } else if (customerHasWhatsApp === false) {
        // Customer does not have a WhatsApp account -> Directly use SMS!
        targetChannel = 'SMS';
    } else if (config.defaultChannel === 'SMS_ONLY') {
        targetChannel = 'SMS';
    }

    // If channel is SMS directly
    if (targetChannel === 'SMS') {
        try {
            const smsRes = await sendSmsViaProvider(payload.customerPhone, smsText, config);
            const isFallback = customerHasWhatsApp === false;
            const fallbackReason = isFallback ? 'Customer does not have a WhatsApp account (routed directly to SMS)' : undefined;

            await logMessage(db, {
                saleId: payload.saleId,
                billNo: String(payload.billNo),
                customerName: payload.customerName,
                customerPhone: payload.customerPhone,
                channel: 'SMS',
                provider: smsRes.provider,
                status: 'SENT',
                fallback: isFallback,
                fallbackReason,
                messageText: smsText,
            });

            return {
                success: true,
                channel: 'SMS',
                fallback: isFallback,
                fallbackReason,
                recipientPhone: payload.customerPhone,
                messageText: smsText,
                directUrl: smsRes.directUrl,
                provider: smsRes.provider,
                messageId: smsRes.messageId,
                loggedAt: new Date().toISOString(),
            };
        } catch (smsErr: any) {
            await logMessage(db, {
                saleId: payload.saleId,
                billNo: String(payload.billNo),
                customerName: payload.customerName,
                customerPhone: payload.customerPhone,
                channel: 'SMS',
                provider: config.smsProvider,
                status: 'FAILED',
                fallback: false,
                messageText: smsText,
                error: smsErr.message,
            });

            return {
                success: false,
                channel: 'SMS',
                fallback: false,
                recipientPhone: payload.customerPhone,
                messageText: smsText,
                provider: config.smsProvider,
                error: smsErr.message || 'SMS delivery failed.',
            };
        }
    }

    // Primary Channel is WhatsApp
    try {
        const itemsSummary = (payload.items || [])
            .map((it, idx) => `${idx + 1}. ${it.name}${it.variantInfo ? ` (${it.variantInfo})` : ''} x ${it.quantity} = ₹${it.total.toFixed(2)}`)
            .join(' | ') || '1 item';

        const templateParams: string[] = [
            String(payload.billNo),
            formatReadableDate(payload.date || new Date()),
            payload.customerName || 'Walk-in Customer',
            itemsSummary,
            payload.subtotal.toFixed(2),
            (payload.discount || 0).toFixed(2),
            payload.grandTotal.toFixed(2),
            (payload.paymentMethod || 'CASH').toUpperCase(),
        ];

        const waRes = await sendWhatsAppViaProvider(payload.customerPhone, waText, config, {
            templateName: config.metaTemplateName || 'tax_invoice',
            parameters: templateParams,
        });

        await logMessage(db, {
            saleId: payload.saleId,
            billNo: String(payload.billNo),
            customerName: payload.customerName,
            customerPhone: payload.customerPhone,
            channel: 'WHATSAPP',
            provider: waRes.provider,
            status: 'SENT',
            fallback: false,
            messageText: waText,
        });

        // Mark that customer has a valid WhatsApp account
        await updateCustomerWhatsAppStatus(db, payload.customerPhone, true);

        return {
            success: true,
            channel: 'WHATSAPP',
            fallback: false,
            recipientPhone: payload.customerPhone,
            messageText: waText,
            directUrl: waRes.directUrl,
            provider: waRes.provider,
            messageId: waRes.messageId,
            loggedAt: new Date().toISOString(),
        };
    } catch (waErr: any) {
        console.warn('WhatsApp delivery error:', waErr.message);

        // Detect if error is because customer does NOT have a WhatsApp account
        const isNoWhatsApp = waErr instanceof NoWhatsAppAccountError ||
            (waErr.message && /not.*registered|not.*on.*whatsapp|undeliverable|invalid.*whatsapp/i.test(waErr.message));

        if (isNoWhatsApp) {
            console.log(`[Messaging] Customer ${payload.customerPhone} has no WhatsApp. Falling back to SMS...`);

            // Persist that this customer does not have WhatsApp
            await updateCustomerWhatsAppStatus(db, payload.customerPhone, false);

            // Trigger SMS fallback immediately
            try {
                const smsRes = await sendSmsViaProvider(payload.customerPhone, smsText, config);
                const fallbackReason = 'Recipient has no WhatsApp account; delivered via SMS fallback';

                await logMessage(db, {
                    saleId: payload.saleId,
                    billNo: String(payload.billNo),
                    customerName: payload.customerName,
                    customerPhone: payload.customerPhone,
                    channel: 'SMS',
                    provider: smsRes.provider,
                    status: 'SENT',
                    fallback: true,
                    fallbackReason,
                    messageText: smsText,
                });

                return {
                    success: true,
                    channel: 'SMS',
                    fallback: true,
                    fallbackReason,
                    recipientPhone: payload.customerPhone,
                    messageText: smsText,
                    directUrl: smsRes.directUrl,
                    provider: smsRes.provider,
                    messageId: smsRes.messageId,
                    loggedAt: new Date().toISOString(),
                };
            } catch (fallbackErr: any) {
                await logMessage(db, {
                    saleId: payload.saleId,
                    billNo: String(payload.billNo),
                    customerName: payload.customerName,
                    customerPhone: payload.customerPhone,
                    channel: 'SMS',
                    provider: config.smsProvider,
                    status: 'FAILED',
                    fallback: true,
                    fallbackReason: 'WhatsApp account not found; SMS fallback attempted but failed',
                    messageText: smsText,
                    error: fallbackErr.message,
                });

                return {
                    success: false,
                    channel: 'SMS',
                    fallback: true,
                    fallbackReason: 'WhatsApp account not found; SMS fallback failed',
                    recipientPhone: payload.customerPhone,
                    messageText: smsText,
                    provider: config.smsProvider,
                    error: `WhatsApp failed (no account). SMS fallback also failed: ${fallbackErr.message}`,
                };
            }
        }

        // WhatsApp failure for non-account reason (e.g. gateway network error)
        // Check if config allows SMS fallback on any WhatsApp failure
        if (config.defaultChannel === 'WHATSAPP_FIRST') {
            try {
                console.log(`[Messaging] WhatsApp gateway failed (${waErr.message}). Attempting SMS fallback...`);
                const smsRes = await sendSmsViaProvider(payload.customerPhone, smsText, config);
                const fallbackReason = `WhatsApp gateway unavailable (${waErr.message}); delivered via SMS`;

                await logMessage(db, {
                    saleId: payload.saleId,
                    billNo: String(payload.billNo),
                    customerName: payload.customerName,
                    customerPhone: payload.customerPhone,
                    channel: 'SMS',
                    provider: smsRes.provider,
                    status: 'SENT',
                    fallback: true,
                    fallbackReason,
                    messageText: smsText,
                });

                return {
                    success: true,
                    channel: 'SMS',
                    fallback: true,
                    fallbackReason,
                    recipientPhone: payload.customerPhone,
                    messageText: smsText,
                    directUrl: smsRes.directUrl,
                    provider: smsRes.provider,
                    messageId: smsRes.messageId,
                    loggedAt: new Date().toISOString(),
                };
            } catch (smsFallbackErr: any) {
                // Return original failure
            }
        }

        await logMessage(db, {
            saleId: payload.saleId,
            billNo: String(payload.billNo),
            customerName: payload.customerName,
            customerPhone: payload.customerPhone,
            channel: 'WHATSAPP',
            provider: config.whatsappProvider,
            status: 'FAILED',
            fallback: false,
            messageText: waText,
            error: waErr.message,
        });

        return {
            success: false,
            channel: 'WHATSAPP',
            fallback: false,
            recipientPhone: payload.customerPhone,
            messageText: waText,
            provider: config.whatsappProvider,
            error: waErr.message,
        };
    }
}

/**
 * Dispatch Store Credit voucher message to customer
 */
export async function sendStoreCreditMessage(
    db: any,
    payload: StoreCreditMessagePayload,
    config: MessagingConfig = DEFAULT_MESSAGING_CONFIG
): Promise<MessageResult> {
    if (!payload.customerPhone || !payload.customerPhone.trim()) {
        return {
            success: false,
            channel: 'WHATSAPP',
            fallback: false,
            recipientPhone: '',
            messageText: '',
            provider: 'None',
            error: 'Customer phone number is required.'
        };
    }

    let customerHasWhatsApp = payload.customerHasWhatsApp;
    if (customerHasWhatsApp === undefined || customerHasWhatsApp === null) {
        const dbStatus = await checkCustomerHasWhatsApp(db, payload.customerPhone);
        if (dbStatus !== null) customerHasWhatsApp = dbStatus;
    }

    const waText = buildStoreCreditMessageWhatsApp(payload);
    const smsText = buildStoreCreditMessageSMS(payload);

    let targetChannel: MessagingChannel = payload.forceChannel || (customerHasWhatsApp === false ? 'SMS' : (config.defaultChannel === 'SMS_ONLY' ? 'SMS' : 'WHATSAPP'));

    if (targetChannel === 'SMS') {
        try {
            const smsRes = await sendSmsViaProvider(payload.customerPhone, smsText, config);
            const isFallback = customerHasWhatsApp === false;
            await logMessage(db, {
                billNo: payload.code,
                customerName: payload.customerName,
                customerPhone: payload.customerPhone,
                channel: 'SMS',
                provider: smsRes.provider,
                status: 'SENT',
                fallback: isFallback,
                fallbackReason: isFallback ? 'Customer marked as not having WhatsApp' : null,
                messageText: smsText,
            });

            return {
                success: true,
                channel: 'SMS',
                fallback: isFallback,
                recipientPhone: payload.customerPhone,
                messageText: smsText,
                directUrl: smsRes.directUrl,
                provider: smsRes.provider,
                messageId: smsRes.messageId,
                loggedAt: new Date().toISOString(),
            };
        } catch (smsErr: any) {
            return {
                success: false,
                channel: 'SMS',
                fallback: false,
                recipientPhone: payload.customerPhone,
                messageText: smsText,
                provider: config.smsProvider,
                error: smsErr.message,
            };
        }
    }

    // Try WhatsApp
    try {
        const waRes = await sendWhatsAppViaProvider(payload.customerPhone, waText, config);
        await logMessage(db, {
            billNo: payload.code,
            customerName: payload.customerName,
            customerPhone: payload.customerPhone,
            channel: 'WHATSAPP',
            provider: waRes.provider,
            status: 'SENT',
            fallback: false,
            messageText: waText,
        });

        return {
            success: true,
            channel: 'WHATSAPP',
            fallback: false,
            recipientPhone: payload.customerPhone,
            messageText: waText,
            directUrl: waRes.directUrl,
            provider: waRes.provider,
            messageId: waRes.messageId,
            loggedAt: new Date().toISOString(),
        };
    } catch (waErr: any) {
        const isNoWhatsApp = waErr instanceof NoWhatsAppAccountError ||
            (waErr.message && /not.*registered|not.*on.*whatsapp|undeliverable|invalid.*whatsapp/i.test(waErr.message));

        if (isNoWhatsApp) {
            await updateCustomerWhatsAppStatus(db, payload.customerPhone, false);
            try {
                const smsRes = await sendSmsViaProvider(payload.customerPhone, smsText, config);
                return {
                    success: true,
                    channel: 'SMS',
                    fallback: true,
                    fallbackReason: 'Customer does not have a WhatsApp account; delivered via SMS',
                    recipientPhone: payload.customerPhone,
                    messageText: smsText,
                    directUrl: smsRes.directUrl,
                    provider: smsRes.provider,
                    messageId: smsRes.messageId,
                    loggedAt: new Date().toISOString(),
                };
            } catch (fallbackErr: any) {
                return {
                    success: false,
                    channel: 'SMS',
                    fallback: true,
                    recipientPhone: payload.customerPhone,
                    messageText: smsText,
                    provider: config.smsProvider,
                    error: `WhatsApp failed (no account). SMS fallback error: ${fallbackErr.message}`,
                };
            }
        }

        return {
            success: false,
            channel: 'WHATSAPP',
            fallback: false,
            recipientPhone: payload.customerPhone,
            messageText: waText,
            provider: config.whatsappProvider,
            error: waErr.message,
        };
    }
}

/**
 * Retrieve message logs with optional filtering
 */
export async function getMessageLogs(db: any, query?: { saleId?: string; phone?: string; limit?: number }): Promise<MessageLogRecord[]> {
    if (!db) return [];
    try {
        let sql = `SELECT * FROM MessageLog`;
        const params: any[] = [];
        const whereClauses: string[] = [];

        if (query?.saleId) {
            whereClauses.push(`saleId = ?`);
            params.push(query.saleId);
        }
        if (query?.phone) {
            const norm = normalizePhoneNumber(query.phone);
            whereClauses.push(`(customerPhone = ? OR customerPhone = ? OR customerPhone LIKE ?)`);
            params.push(norm.digits, norm.tenDigit, `%${norm.tenDigit}`);
        }

        if (whereClauses.length > 0) {
            sql += ` WHERE ` + whereClauses.join(' AND ');
        }
        sql += ` ORDER BY createdAt DESC LIMIT ?`;
        params.push(query?.limit || 50);

        const rows: any[] = await db.$queryRawUnsafe(sql, ...params);
        return (rows || []).map(r => ({
            id: r.id,
            saleId: r.saleId,
            billNo: r.billNo,
            customerName: r.customerName,
            customerPhone: r.customerPhone,
            channel: r.channel,
            provider: r.provider,
            status: r.status,
            fallback: Boolean(r.fallback),
            fallbackReason: r.fallbackReason,
            messageText: r.messageText,
            error: r.error,
            createdAt: r.createdAt,
        }));
    } catch (err) {
        console.warn('Failed to query MessageLog table:', err);
        return [];
    }
}
