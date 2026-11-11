import axios from 'axios';
import * as crypto from 'node:crypto';
import type {
    MessagingConfig,
    InvoiceMessagePayload,
    StoreCreditMessagePayload,
    MessageResult,
    MessageLogRecord,
    MessagingChannel,
    SendCampaignPayload,
    CampaignDispatchResult,
    WhatsAppConversation,
    WhatsAppInboxMessage,
    WhatsAppWebhookConfig,
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

function sanitizeMetaTemplateParam(value: unknown): string {
    const cleaned = String(value ?? '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s{4,}/g, '   ')
        .trim();
    return cleaned || '-';
}

/**
 * Send via Meta WhatsApp Cloud API (supports both Templates and free-form Text)
 */
async function sendViaMetaWhatsApp(
    phone: string,
    text: string,
    config: MessagingConfig,
    templateOptions?: {
        templateName?: string;
        parameters?: string[];
        languageCode?: string;
        headerImage?: { id?: string; link?: string };
        carouselCards?: Array<{
            cardIndex: number;
            mediaId: string;
            bodyParams: string[];
            quickReplyPayload?: string;
        }>;
    }
): Promise<string> {
    if (!config.metaPhoneNumberId || !config.metaAccessToken) {
        throw new Error('Meta WhatsApp Cloud API credentials missing (PhoneNumberId or AccessToken).');
    }

    const { waFormat } = normalizePhoneNumber(phone, config.defaultCountryCode);
    const url = `https://graph.facebook.com/v22.0/${config.metaPhoneNumberId}/messages`;

    const templateName = templateOptions?.templateName || config.metaTemplateName;
    const isTemplate = Boolean(templateName && templateName.toLowerCase() !== 'none');

    let bodyPayload: any;
    let langCode = (templateOptions?.languageCode || config.metaLanguageCode || 'en').trim();
    if (isTemplate) {
        if (/^english$/i.test(langCode)) langCode = 'en';
        else if (/^english\s*\(?us\)?$/i.test(langCode)) langCode = 'en_US';
        else if (/^english\s*\(?uk\)?$/i.test(langCode) || /^english\s*\(?gb\)?$/i.test(langCode)) langCode = 'en_GB';

        const components: any[] = [];
        const hasCarousel = Boolean(templateOptions?.carouselCards && templateOptions.carouselCards.length > 0);

        // Header image support (single image / collage campaigns)
        if (!hasCarousel && templateOptions?.headerImage) {
            if (templateOptions.headerImage.id) {
                components.push({
                    type: 'header',
                    parameters: [
                        {
                            type: 'image',
                            image: { id: templateOptions.headerImage.id },
                        },
                    ],
                });
            } else if (templateOptions.headerImage.link) {
                components.push({
                    type: 'header',
                    parameters: [
                        {
                            type: 'image',
                            image: { link: templateOptions.headerImage.link },
                        },
                    ],
                });
            }
        }

        const params = templateOptions?.parameters;
        if (params && params.length > 0 && templateName !== 'hello_world' && !templateName?.startsWith('3p_direct')) {
            components.push({
                type: 'body',
                parameters: params.map((p) => ({ type: 'text', text: sanitizeMetaTemplateParam(p) })),
            });
        }

        // Swipeable Media Card Carousel support
        if (hasCarousel && templateOptions?.carouselCards) {
            components.push({
                type: 'carousel',
                cards: templateOptions.carouselCards.map((card) => ({
                    card_index: card.cardIndex,
                    components: [
                        {
                            type: 'header',
                            parameters: [{ type: 'image', image: { id: card.mediaId } }],
                        },
                        {
                            type: 'body',
                            parameters: card.bodyParams.map((p) => ({ type: 'text', text: sanitizeMetaTemplateParam(p) })),
                        },
                        {
                            type: 'button',
                            sub_type: 'quick_reply',
                            index: '0',
                            parameters: [
                                {
                                    type: 'payload',
                                    payload: card.quickReplyPayload || `BOOK_COLOR_${card.cardIndex + 1}`,
                                },
                            ],
                        },
                    ],
                })),
            });
        }

        const templateObj: any = {
            name: templateName,
            language: { code: langCode },
        };
        if (components.length > 0) {
            templateObj.components = components;
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

        // Error code 132001: Template does not exist in translation / still pending approval
        if (code === 132001) {
            throw new Error(`Template "${templateName}" (${langCode}) is still undergoing review by Meta (Status: In Review / Pending Approval). Once Meta approves it, messages will send immediately.`);
        }
        if (code === 132015) {
            throw new Error(`Template "${templateName}" is currently paused by Meta.`);
        }
        // Error code 131042: Payment / Wallet Out of Funds
        if (code === 131042 || msg.includes('payment') || msg.includes('billing') || msg.includes('insufficient funds')) {
            throw new Error(`Meta WhatsApp Prepaid Wallet Out of Funds (code ${code || 131042}). Please add funds in Meta Business Settings -> Billing to resume sending.`);
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
    status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'OPENED';
    fallback: boolean;
    fallbackReason?: string | null;
    messageText: string;
    error?: string | null;
    waMessageId?: string | null;
}): Promise<void> {
    if (!db) return;
    const id = crypto.randomUUID ? crypto.randomUUID() : ('msg-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    const createdAt = new Date().toISOString();
    try {
        await db.$executeRawUnsafe(
            `INSERT INTO MessageLog (id, saleId, billNo, customerName, customerPhone, channel, provider, status, fallback, fallbackReason, messageText, error, createdAt, waMessageId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            createdAt,
            entry.waMessageId || null
        );
    } catch (err: any) {
        if (String(err?.message || '').includes('waMessageId')) {
            try {
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
                    createdAt
                );
                return;
            } catch (fallbackInsertErr) {
                console.warn('Failed to insert into MessageLog:', fallbackInsertErr);
                return;
            }
        }
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
            waMessageId: waRes.messageId || null,
        });

        if (waRes.messageId && config.whatsappProvider === 'META_API') {
            await registerCloudDispatches(db, [
                {
                    waMessageId: waRes.messageId,
                    recipientPhone: payload.customerPhone,
                    templateName: config.metaTemplateName || 'tax_invoice',
                },
            ]);
        }

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
            waMessageId: waRes.messageId || null,
        });

        if (waRes.messageId && config.whatsappProvider === 'META_API') {
            await registerCloudDispatches(db, [
                {
                    waMessageId: waRes.messageId,
                    recipientPhone: payload.customerPhone,
                    templateName: config.metaTemplateName || undefined,
                },
            ]);
        }

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
            waMessageId: r.waMessageId || null,
            createdAt: r.createdAt,
        }));
    } catch (err) {
        console.warn('Failed to query MessageLog table:', err);
        return [];
    }
}

/**
 * Upload an image file directly to Meta WhatsApp Cloud API Media endpoint
 */
export async function uploadWhatsAppMedia(
    fileBuffer: Buffer,
    mimeType: string,
    filename: string,
    config: MessagingConfig
): Promise<string> {
    if (!config.metaPhoneNumberId || !config.metaAccessToken) {
        throw new Error('Meta WhatsApp Cloud API credentials missing (PhoneNumberId or AccessToken).');
    }

    const FormData = require('form-data');
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', fileBuffer, { filename: filename || 'product.jpg', contentType: mimeType || 'image/jpeg' });
    form.append('type', mimeType || 'image/jpeg');

    const url = `https://graph.facebook.com/v22.0/${config.metaPhoneNumberId}/media`;
    const res = await axios.post(url, form, {
        headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${config.metaAccessToken}`,
        },
        timeout: 30000,
    });

    if (!res.data?.id) {
        throw new Error('Meta API did not return a valid media ID');
    }

    return res.data.id;
}

/**
 * Broadcast marketing messages to a list of recipients
 */
export async function sendCampaignMessages(
    db: any,
    payload: SendCampaignPayload,
    config: MessagingConfig
): Promise<CampaignDispatchResult> {
    const result: CampaignDispatchResult = {
        total: payload.recipients.length,
        sent: 0,
        failed: 0,
        errors: [],
        dispatches: [],
    };

    const templateName = payload.templateName || 'new_stock_arrival';
    const cloudRegistrations: Array<{ waMessageId: string; recipientPhone: string; campaignName?: string; templateName?: string }> = [];

    for (const recipient of payload.recipients) {
        if (!recipient.phone || !recipient.phone.trim()) {
            result.failed++;
            result.errors.push({ recipient: recipient.name || 'Unknown', phone: '', error: 'Missing phone number' });
            continue;
        }

        const recipientFirstName = (recipient.name || 'Valued Customer').trim().split(/\s+/)[0];
        const isCarousel = Boolean(payload.carouselCards && payload.carouselCards.length > 0);

        // Positional parameters: {{1}} is Customer Name
        const params: string[] = isCarousel
            ? [recipientFirstName, payload.templateParams?.[0] || 'New Collection']
            : [recipientFirstName, ...(payload.templateParams || [])];

        const headerImage = !isCarousel
            ? payload.headerMediaId
                ? { id: payload.headerMediaId }
                : payload.headerMediaUrl
                ? { link: payload.headerMediaUrl }
                : undefined
            : undefined;

        const mappedCarouselCards = isCarousel
            ? payload.carouselCards!.map((card, idx) => ({
                  cardIndex: idx,
                  mediaId: card.mediaId,
                  bodyParams: [card.colorName || `Color ${idx + 1}`, card.sizes || 'All Sizes', card.price || '999'],
                  quickReplyPayload: `BOOK_${(card.colorName || `COLOR_${idx + 1}`).toUpperCase().replace(/\s+/g, '_')}`,
              }))
            : undefined;

        try {
            const waMessageId = await sendViaMetaWhatsApp(recipient.phone, `[Campaign: ${payload.campaignName}]`, config, {
                templateName,
                languageCode: payload.languageCode || config.metaLanguageCode || 'en_US',
                parameters: params,
                headerImage,
                carouselCards: mappedCarouselCards,
            });

            result.sent++;
            if (waMessageId && waMessageId !== 'meta-sent') {
                result.dispatches!.push({ recipientPhone: recipient.phone, waMessageId });
                cloudRegistrations.push({
                    waMessageId,
                    recipientPhone: recipient.phone,
                    campaignName: payload.campaignName,
                    templateName,
                });
            }

            await logMessage(db, {
                customerName: recipient.name,
                customerPhone: recipient.phone,
                channel: 'WHATSAPP',
                provider: 'WhatsApp Cloud API',
                status: 'SENT',
                fallback: false,
                messageText: `[Campaign: ${payload.campaignName}] Template: ${templateName}`,
                waMessageId: waMessageId !== 'meta-sent' ? waMessageId : null,
            });

            // Delay between dispatches to ensure smooth pacing
            await new Promise((resolve) => setTimeout(resolve, 150));
        } catch (err: any) {
            result.failed++;
            result.errors.push({
                recipient: recipient.name || recipient.phone,
                phone: recipient.phone,
                error: err.message,
            });

            await logMessage(db, {
                customerName: recipient.name,
                customerPhone: recipient.phone,
                channel: 'WHATSAPP',
                provider: 'WhatsApp Cloud API',
                status: 'FAILED',
                fallback: false,
                messageText: `[Campaign: ${payload.campaignName}] Template: ${templateName}`,
                error: err.message,
            });
        }
    }

    if (cloudRegistrations.length > 0) {
        await registerCloudDispatches(db, cloudRegistrations);
    }

    return result;
}

/**
 * Retrieve Cloud API URL and sync secret from SQLite Setting table
 */
async function getCloudApiConnection(db: any): Promise<{ apiUrl: string; syncSecret: string }> {
    if (!db?.setting?.findUnique) {
        return { apiUrl: '', syncSecret: String(process.env.CLOUD_SYNC_SECRET || '').trim() };
    }
    const [urlRow, secretRow] = await Promise.all([
        db.setting.findUnique({ where: { key: 'CLOUD_API_URL' } }).catch(() => null),
        db.setting.findUnique({ where: { key: 'CLOUD_SYNC_SECRET' } }).catch(() => null),
    ]);

    const apiUrl = String(urlRow?.value || '').trim().replace(/\/+$/, '');
    const syncSecret = String(secretRow?.value || process.env.CLOUD_SYNC_SECRET || '').trim();
    return { apiUrl, syncSecret };
}

/**
 * Register outbound Meta wamid dispatches on the Cloud webhook server so asynchronous
 * delivery & failure webhook statuses can be tracked in Broadcast History & Logs.
 */
async function registerCloudDispatches(
    db: any,
    items: Array<{ waMessageId: string; recipientPhone: string; campaignName?: string; templateName?: string }>
): Promise<void> {
    if (!items.length) return;
    try {
        const { apiUrl, syncSecret } = await getCloudApiConnection(db);
        if (!apiUrl || !syncSecret) return;

        await axios.post(
            `${apiUrl}/api/whatsapp/dispatches/register`,
            { items },
            {
                headers: { 'x-sync-secret': syncSecret },
                timeout: 5000,
            }
        );
    } catch {
        // Non-fatal: webhook statuses still record by waMessageId & recipientPhone
    }
}

/**
 * Pull Meta webhook delivery statuses (SENT / DELIVERED / READ / FAILED + error details)
 * from the Cloud API server and update matching local MessageLog entries.
 */
export async function syncCloudDeliveryStatuses(db: any): Promise<{ updated: number; failedCount: number; latestErrors: string[] }> {
    const empty = { updated: 0, failedCount: 0, latestErrors: [] };
    if (!db?.$queryRawUnsafe || !db?.$executeRawUnsafe) return empty;

    let trackedRows: any[] = [];
    try {
        const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        trackedRows = await db.$queryRawUnsafe(
            `SELECT id, waMessageId, status, error FROM MessageLog
             WHERE waMessageId IS NOT NULL AND createdAt >= ? AND status IN ('SENT', 'DELIVERED')
             ORDER BY createdAt DESC LIMIT 150`,
            sinceIso
        );
    } catch {
        return empty;
    }

    const waIds = (trackedRows || []).map((r) => String(r.waMessageId || '').trim()).filter(Boolean);
    if (waIds.length === 0) return empty;

    try {
        const { apiUrl, syncSecret } = await getCloudApiConnection(db);
        if (!apiUrl || !syncSecret) return empty;

        const res = await axios.post(
            `${apiUrl}/api/whatsapp/dispatches/statuses`,
            { waMessageIds: waIds, limit: 200 },
            {
                headers: { 'x-sync-secret': syncSecret },
                timeout: 6000,
            }
        );

        const cloudStatuses: any[] = Array.isArray(res.data?.data) ? res.data.data : [];
        const statusByWaId = new Map<string, any>();
        for (const row of cloudStatuses) {
            if (row?.waMessageId) statusByWaId.set(String(row.waMessageId), row);
        }

        let updated = 0;
        let failedCount = 0;
        const latestErrors: string[] = [];

        for (const localRow of trackedRows) {
            const remote = statusByWaId.get(String(localRow.waMessageId));
            if (!remote) continue;

            const remoteStatus = String(remote.status || '').toUpperCase();
            if (!['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(remoteStatus)) continue;

            const remoteErr =
                remoteStatus === 'FAILED'
                    ? `${remote.errorCode ? `(#${remote.errorCode}) ` : ''}${remote.errorDetails || remote.errorTitle || 'Meta blocked or failed WhatsApp delivery.'}`
                    : null;

            const shouldUpdate =
                remoteStatus !== localRow.status ||
                (remoteErr && remoteErr !== localRow.error);

            if (shouldUpdate) {
                await db.$executeRawUnsafe(
                    `UPDATE MessageLog SET status = ?, error = ? WHERE id = ?`,
                    remoteStatus,
                    remoteErr,
                    localRow.id
                );
                updated += 1;
            }

            if (remoteStatus === 'FAILED' && remoteErr) {
                failedCount += 1;
                if (!latestErrors.includes(remoteErr)) {
                    latestErrors.push(remoteErr);
                }
            }
        }

        return { updated, failedCount, latestErrors };
    } catch {
        return empty;
    }
}

/**
 * Push Meta WhatsApp credentials & auto-reply settings to the Cloud API webhook server
 */
export async function syncCloudWhatsAppConfig(
    db: any,
    config: MessagingConfig
): Promise<{ success: boolean; webhookUrl?: string; error?: string }> {
    const { apiUrl, syncSecret } = await getCloudApiConnection(db);
    if (!apiUrl || !syncSecret) {
        return { success: false, error: 'Cloud API URL or sync secret is not configured.' };
    }

    try {
        const res = await axios.post(
            `${apiUrl}/api/whatsapp/config`,
            {
                metaPhoneNumberId: config.metaPhoneNumberId || '',
                metaAccessToken: config.metaAccessToken || '',
                autoReplyEnabled: config.autoReplyEnabled ?? true,
                forwardPhone: config.autoReplyForwardPhone || '919037106449',
                autoReplyMessage: config.autoReplyMessage || DEFAULT_MESSAGING_CONFIG.autoReplyMessage,
                verifyToken: config.webhookVerifyToken || DEFAULT_MESSAGING_CONFIG.webhookVerifyToken,
            },
            {
                headers: { 'x-sync-secret': syncSecret },
                timeout: 12000,
            }
        );

        return {
            success: Boolean(res.data?.success),
            webhookUrl: `${apiUrl}/api/whatsapp/webhook`,
        };
    } catch (err: any) {
        const status = err.response?.status;
        if (status === 401 || status === 503) {
            return {
                success: false,
                error: `Invalid CLOUD_SYNC_SECRET (${status}): The sync secret on Render does not match your POS Cloud Sync Secret.`,
            };
        }
        return {
            success: false,
            error: err.response?.data?.error || err.message || 'Failed to sync webhook config to Cloud API.',
        };
    }
}

/**
 * Fetch Cloud Webhook status & configuration
 */
export async function getCloudWebhookStatus(
    db: any,
    localConfig: MessagingConfig
): Promise<WhatsAppWebhookConfig> {
    const { apiUrl, syncSecret } = await getCloudApiConnection(db);
    const webhookUrl = apiUrl ? `${apiUrl}/api/whatsapp/webhook` : '';

    const fallback: WhatsAppWebhookConfig = {
        webhookUrl,
        verifyToken: localConfig.webhookVerifyToken || DEFAULT_MESSAGING_CONFIG.webhookVerifyToken || 'zain_pos_wa_webhook_2026',
        autoReplyEnabled: localConfig.autoReplyEnabled ?? true,
        forwardPhone: localConfig.autoReplyForwardPhone || '9037106449',
        autoReplyMessage: localConfig.autoReplyMessage || DEFAULT_MESSAGING_CONFIG.autoReplyMessage || '',
        cooldownHours: 6,
        hasAccessToken: Boolean(localConfig.metaAccessToken),
        metaPhoneNumberId: localConfig.metaPhoneNumberId,
        cloudReachable: false,
    };

    if (!apiUrl || !syncSecret) {
        fallback.cloudError = !apiUrl
            ? 'Cloud API URL is not configured in Settings -> Cloud & Backup.'
            : 'Cloud Sync Secret is missing in Settings -> Cloud & Backup.';
        return fallback;
    }

    try {
        const res = await axios.get(`${apiUrl}/api/whatsapp/config`, {
            headers: { 'x-sync-secret': syncSecret },
            timeout: 20000,
        });

        const cloudData = res.data?.data;
        if (cloudData) {
            return {
                webhookUrl,
                verifyToken: cloudData.verifyToken || fallback.verifyToken,
                autoReplyEnabled: typeof cloudData.autoReplyEnabled === 'boolean' ? cloudData.autoReplyEnabled : fallback.autoReplyEnabled,
                forwardPhone: cloudData.forwardPhone || fallback.forwardPhone,
                autoReplyMessage: cloudData.autoReplyMessage || fallback.autoReplyMessage,
                cooldownHours: cloudData.cooldownHours || 6,
                hasAccessToken: Boolean(cloudData.hasAccessToken),
                metaPhoneNumberId: cloudData.metaPhoneNumberId || fallback.metaPhoneNumberId,
                cloudReachable: true,
            };
        }
    } catch (err: any) {
        const status = err.response?.status;
        if (status === 401 || status === 503) {
            fallback.authMismatch = true;
            fallback.cloudError = err.response?.data?.error || 'Invalid sync authentication (CLOUD_SYNC_SECRET mismatch with Render).';
        } else if (status === 404) {
            fallback.cloudError = 'Cloud API webhook route not found (404). Push zain-pos-api updates to Render.';
        } else {
            fallback.cloudError = err.message || 'Cloud server unreachable or waking up.';
        }
        console.warn('Cloud WhatsApp webhook status check failed:', status || err.message);
    }

    return fallback;
}

/**
 * Fetch incoming/active WhatsApp conversations from Cloud Inbox
 */
export async function getCloudConversations(db: any): Promise<{ conversations: WhatsAppConversation[]; cloudReachable: boolean; error?: string }> {
    const { apiUrl, syncSecret } = await getCloudApiConnection(db);
    if (!apiUrl || !syncSecret) {
        return { conversations: [], cloudReachable: false, error: 'Cloud API URL or sync secret not configured.' };
    }

    try {
        const res = await axios.get(`${apiUrl}/api/whatsapp/conversations`, {
            headers: { 'x-sync-secret': syncSecret },
            timeout: 20000,
        });

        const threads: WhatsAppConversation[] = Array.isArray(res.data?.data) ? res.data.data : [];

        // Enrich customer names from local POS Customer table if available
        if (threads.length > 0 && db.customer?.findMany) {
            try {
                const localCustomers: any[] = await db.customer.findMany({
                    select: { name: true, phone: true },
                });
                const phoneToLocalName = new Map<string, string>();
                for (const c of localCustomers) {
                    if (!c.phone || !c.name) continue;
                    const norm = normalizePhoneNumber(c.phone);
                    if (norm.tenDigit) phoneToLocalName.set(norm.tenDigit, c.name);
                }

                for (const t of threads) {
                    const norm = normalizePhoneNumber(t.phone);
                    const localName = phoneToLocalName.get(norm.tenDigit);
                    if (localName && (!t.name || t.name === t.phone)) {
                        t.name = localName;
                    }
                }
            } catch {
                // Non-fatal enrichment failure
            }
        }

        return { conversations: threads, cloudReachable: true };
    } catch (err: any) {
        return {
            conversations: [],
            cloudReachable: false,
            error: err.response?.data?.error || err.message || 'Failed to fetch WhatsApp conversations.',
        };
    }
}

function normalizeWaThreadPhone(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 10) return `91${digits}`;
    if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
    return digits;
}

/**
 * Fetch full chat message history for one phone number from Cloud Inbox
 */
export async function getCloudConversationMessages(
    db: any,
    phone: string
): Promise<{ messages: WhatsAppInboxMessage[]; windowOpen: boolean; optedOut: boolean; error?: string }> {
    const { apiUrl, syncSecret } = await getCloudApiConnection(db);
    if (!apiUrl || !syncSecret) {
        return { messages: [], windowOpen: false, optedOut: false, error: 'Cloud API URL not configured.' };
    }

    try {
        const target = normalizeWaThreadPhone(phone);
        const res = await axios.get(`${apiUrl}/api/whatsapp/messages/${encodeURIComponent(target)}`, {
            headers: { 'x-sync-secret': syncSecret },
            timeout: 10000,
        });

        const data = res.data?.data || {};
        return {
            messages: Array.isArray(data.messages) ? data.messages : [],
            windowOpen: Boolean(data.windowOpen),
            optedOut: Boolean(data.contact?.optedOut),
        };
    } catch (err: any) {
        return {
            messages: [],
            windowOpen: false,
            optedOut: false,
            error: err.response?.data?.error || err.message,
        };
    }
}

/**
 * Send a free-form WhatsApp reply within the 24-hour customer service window via Cloud Inbox
 */
export async function sendCloudInboxReply(
    db: any,
    phone: string,
    text: string
): Promise<{ success: boolean; message?: WhatsAppInboxMessage; error?: string }> {
    const { apiUrl, syncSecret } = await getCloudApiConnection(db);
    if (!apiUrl || !syncSecret) {
        return { success: false, error: 'Cloud API URL not configured.' };
    }

    try {
        const target = normalizeWaThreadPhone(phone);
        const norm = normalizePhoneNumber(phone);
        const res = await axios.post(
            `${apiUrl}/api/whatsapp/reply`,
            { phone: target, text },
            {
                headers: { 'x-sync-secret': syncSecret },
                timeout: 12000,
            }
        );

        await logMessage(db, {
            customerPhone: norm.tenDigit || target || phone,
            channel: 'WHATSAPP',
            provider: 'WhatsApp Cloud API (Inbox Reply)',
            status: 'SENT',
            fallback: false,
            messageText: text,
            waMessageId: res.data?.data?.waMessageId || null,
        });

        return { success: true, message: res.data?.data };
    } catch (err: any) {
        return {
            success: false,
            error: err.response?.data?.error || err.message || 'Failed to send reply.',
        };
    }
}

/**
 * Mark unread messages in a thread as read
 */
export async function markCloudConversationRead(db: any, phone: string): Promise<boolean> {
    const { apiUrl, syncSecret } = await getCloudApiConnection(db);
    if (!apiUrl || !syncSecret) return false;

    try {
        const target = normalizeWaThreadPhone(phone);
        await axios.post(
            `${apiUrl}/api/whatsapp/mark-read/${encodeURIComponent(target)}`,
            {},
            {
                headers: { 'x-sync-secret': syncSecret },
                timeout: 6000,
            }
        );
        return true;
    } catch {
        return false;
    }
}
