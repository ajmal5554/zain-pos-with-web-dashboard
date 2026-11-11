import express from 'express';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';
import { getIO } from '../socket';
import { getShopId } from '../lib/runtime';

const router = express.Router();
const prisma = new PrismaClient();

const WHATSAPP_CONFIG_KEY = 'WHATSAPP_WEBHOOK_CONFIG';
const DEFAULT_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'zain_pos_wa_webhook_2026';

export interface CloudWhatsAppConfig {
    metaPhoneNumberId: string;
    metaAccessToken: string;
    verifyToken: string;
    autoReplyEnabled: boolean;
    forwardPhone: string;
    autoReplyMessage: string;
    cooldownHours: number;
}

const DEFAULT_AUTO_REPLY_MSG =
    'Thank you for messaging *Zain Gents Palace*! 🙏 We have received your message and our team can reply directly here.\n\nFor immediate stock & size inquiries on WhatsApp, message our store desk:\n👉 https://wa.me/919037106449\n\nOr call us at 📞 +91 90371 06449';

function normalizeWaPhone(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 10) return `91${digits}`;
    return digits;
}

const META_STATUS_ERROR_HINTS: Record<number, string> = {
    131049: 'Meta Marketing Frequency Limit: Meta blocked this promotional template for this customer right now to maintain ecosystem engagement.',
    131042: 'Meta Billing / Payment Issue: Check your prepaid INR balance or payment method in Meta Business Suite -> Billing & Payments.',
    131053: 'Media Upload / Format Error: Meta could not deliver the attached image. Ensure a clean JPG/PNG under 5MB.',
    131052: 'Media Download Error: Meta could not process the attached media.',
    131026: 'Undeliverable: Recipient phone is not on WhatsApp or cannot receive messages.',
    131047: '24h Customer Care Window Expired: Re-engage using an approved template.',
    132001: 'Template Not Found / Pending: Template does not exist in this language or is not approved.',
    132012: 'Template Parameter Format Mismatch: Variable text did not match Meta template rules.',
};

function formatMetaWebhookError(errObj: any): {
    errorCode: number | null;
    errorTitle: string | null;
    errorDetails: string | null;
    formatted: string | null;
} {
    if (!errObj || typeof errObj !== 'object') {
        return { errorCode: null, errorTitle: null, errorDetails: null, formatted: null };
    }
    const rawCode = Number(errObj.code);
    const errorCode = Number.isFinite(rawCode) && rawCode > 0 ? rawCode : null;
    const errorTitle = String(errObj.title || errObj.message || '').trim() || null;
    const rawDetails = String(errObj.error_data?.details || errObj.message || '').trim() || null;
    const hint = errorCode ? META_STATUS_ERROR_HINTS[errorCode] : undefined;
    const errorDetails = [hint, rawDetails].filter((v, idx, arr) => v && arr.indexOf(v) === idx).join(' — ') || null;
    const formatted =
        errorCode || errorTitle || errorDetails
            ? `${errorCode ? `(#${errorCode}) ` : ''}${errorDetails || errorTitle || 'Meta delivery failure'}`
            : null;
    return { errorCode, errorTitle, errorDetails, formatted };
}

async function getWebhookConfig(): Promise<CloudWhatsAppConfig> {
    const defaults: CloudWhatsAppConfig = {
        metaPhoneNumberId: process.env.META_PHONE_NUMBER_ID || '',
        metaAccessToken: process.env.META_ACCESS_TOKEN || '',
        verifyToken: DEFAULT_VERIFY_TOKEN,
        autoReplyEnabled: true,
        forwardPhone: '919037106449',
        autoReplyMessage: DEFAULT_AUTO_REPLY_MSG,
        cooldownHours: 6,
    };

    try {
        const row = await prisma.setting.findUnique({ where: { key: WHATSAPP_CONFIG_KEY } });
        if (row?.value) {
            const parsed = JSON.parse(row.value);
            return {
                ...defaults,
                ...parsed,
                metaPhoneNumberId: parsed.metaPhoneNumberId || defaults.metaPhoneNumberId,
                metaAccessToken: parsed.metaAccessToken || defaults.metaAccessToken,
                verifyToken: parsed.verifyToken || defaults.verifyToken,
                autoReplyMessage: parsed.autoReplyMessage || defaults.autoReplyMessage,
            };
        }
    } catch (err) {
        console.warn('Failed to parse WHATSAPP_WEBHOOK_CONFIG:', err);
    }

    return defaults;
}

function isValidSyncSecret(providedSecret?: string): boolean {
    const configuredSecret = process.env.CLOUD_SYNC_SECRET;
    if (!configuredSecret || !providedSecret) return false;
    const expected = Buffer.from(configuredSecret, 'utf8');
    const provided = Buffer.from(providedSecret, 'utf8');
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

/**
 * Allows either Desktop POS sync secret OR authenticated Dashboard JWT user.
 */
async function requireInboxAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const syncHeader = req.header('x-sync-secret');
    if (syncHeader) {
        if (isValidSyncSecret(syncHeader)) {
            return next();
        }
        return res.status(401).json({ error: 'Invalid sync authentication.' });
    }
    return authMiddleware(req as any, res, next);
}

async function sendMetaTextMessage(
    phone: string,
    bodyText: string,
    config: CloudWhatsAppConfig
): Promise<{ messageId?: string; error?: string }> {
    if (!config.metaPhoneNumberId || !config.metaAccessToken) {
        return { error: 'Meta credentials not yet synced to cloud server.' };
    }

    const to = normalizeWaPhone(phone);
    const url = `https://graph.facebook.com/v22.0/${config.metaPhoneNumberId}/messages`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.metaAccessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: true, body: bodyText },
        }),
    });

    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
        const errMsg = data?.error?.message || `Meta API HTTP ${response.status}`;
        return { error: errMsg };
    }

    return { messageId: data?.messages?.[0]?.id };
}

function extractInboundMessageContent(msg: any): { type: string; body: string } {
    const msgType = msg?.type || 'text';
    if (msgType === 'text') {
        return { type: 'text', body: msg.text?.body || '' };
    }
    if (msgType === 'button') {
        return { type: 'button', body: msg.button?.text || '[Quick Reply]' };
    }
    if (msgType === 'interactive') {
        const title = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '[Interactive Reply]';
        return { type: 'interactive', body: title };
    }
    if (msgType === 'image') {
        return { type: 'image', body: msg.image?.caption ? `[Image] ${msg.image.caption}` : '[Customer sent an image]' };
    }
    if (msgType === 'audio') {
        return { type: 'audio', body: '[Customer sent a voice message]' };
    }
    if (msgType === 'document') {
        return { type: 'document', body: msg.document?.filename ? `[Document] ${msg.document.filename}` : '[Customer sent a document]' };
    }
    return { type: msgType, body: `[${msgType} message]` };
}

async function processWebhookPayload(payload: any): Promise<void> {
    if (payload?.object !== 'whatsapp_business_account') return;

    const config = await getWebhookConfig();
    const entries = Array.isArray(payload.entry) ? payload.entry : [];

    for (const entry of entries) {
        const changes = Array.isArray(entry.changes) ? entry.changes : [];
        for (const change of changes) {
            const value = change?.value || {};
            const contacts = Array.isArray(value.contacts) ? value.contacts : [];
            const messages = Array.isArray(value.messages) ? value.messages : [];
            const statuses = Array.isArray(value.statuses) ? value.statuses : [];

            // Process delivery/read/failed status updates
            for (const st of statuses) {
                if (!st?.id || !st?.status) continue;
                const mappedStatus = String(st.status).toUpperCase();
                const firstErr = Array.isArray(st.errors) && st.errors.length > 0 ? formatMetaWebhookError(st.errors[0]) : null;
                const clearError = ['SENT', 'DELIVERED', 'READ'].includes(mappedStatus);

                await prisma.whatsAppMessage
                    .updateMany({
                        where: { waMessageId: st.id },
                        data: {
                            status: mappedStatus,
                            ...(clearError ? { error: null } : firstErr?.formatted ? { error: firstErr.formatted } : {}),
                        },
                    })
                    .catch(() => {});

                const recipientPhone = normalizeWaPhone(String(st.recipient_id || ''));
                await prisma.whatsAppDispatchStatus
                    .upsert({
                        where: { waMessageId: st.id },
                        create: {
                            waMessageId: st.id,
                            recipientPhone,
                            status: mappedStatus,
                            errorCode: firstErr?.errorCode ?? null,
                            errorTitle: firstErr?.errorTitle ?? null,
                            errorDetails: firstErr?.errorDetails ?? null,
                        },
                        update: {
                            ...(recipientPhone ? { recipientPhone } : {}),
                            status: mappedStatus,
                            errorCode: clearError ? null : firstErr?.errorCode ?? null,
                            errorTitle: clearError ? null : firstErr?.errorTitle ?? null,
                            errorDetails: clearError ? null : firstErr?.errorDetails ?? null,
                        },
                    })
                    .catch((err) => {
                        console.warn('Failed to store WhatsAppDispatchStatus:', err);
                    });
            }

            // Process incoming customer messages
            for (const msg of messages) {
                const rawFrom = msg?.from;
                const waMessageId = msg?.id;
                if (!rawFrom || !waMessageId) continue;

                const customerPhone = normalizeWaPhone(rawFrom);
                const profileName = contacts.find((c: any) => c.wa_id === rawFrom)?.profile?.name || null;
                const { type, body } = extractInboundMessageContent(msg);
                const trimmedUpper = body.trim().toUpperCase();

                const isOptOut = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'OPT OUT', 'OPTOUT'].includes(trimmedUpper);
                const isOptIn = ['START', 'SUBSCRIBE', 'UNSTOP'].includes(trimmedUpper);

                const existingContact = await prisma.whatsAppContact.findUnique({ where: { phone: customerPhone } });

                // Deduplicate webhook retries by checking waMessageId
                const existingMsg = await prisma.whatsAppMessage.findUnique({ where: { waMessageId } });
                if (existingMsg) continue;

                const now = new Date();
                const createdInbound = await prisma.whatsAppMessage.create({
                    data: {
                        waMessageId,
                        customerPhone,
                        customerName: profileName || existingContact?.name || null,
                        direction: 'INBOUND',
                        type,
                        body,
                        isAutoReply: false,
                        read: false,
                        status: 'DELIVERED',
                    },
                });

                await prisma.whatsAppContact.upsert({
                    where: { phone: customerPhone },
                    create: {
                        phone: customerPhone,
                        name: profileName,
                        lastInboundAt: now,
                        optedOut: isOptOut,
                    },
                    update: {
                        ...(profileName ? { name: profileName } : {}),
                        lastInboundAt: now,
                        ...(isOptOut ? { optedOut: true } : isOptIn ? { optedOut: false } : {}),
                    },
                });

                try {
                    const io = getIO();
                    io.to(`shop_${getShopId()}`).emit('whatsapp:inbound', createdInbound);
                } catch {
                    // Socket server might not have connected clients
                }

                // Trigger Smart Auto-Reply (Option A) if enabled and cooldown has elapsed
                if (config.autoReplyEnabled && !isOptOut) {
                    const cooldownMs = (config.cooldownHours || 6) * 60 * 60 * 1000;
                    const lastAutoMs = existingContact?.lastAutoReplyAt ? new Date(existingContact.lastAutoReplyAt).getTime() : 0;
                    const shouldSendAutoReply = !lastAutoMs || Date.now() - lastAutoMs > cooldownMs;

                    if (shouldSendAutoReply) {
                        const autoReplyRes = await sendMetaTextMessage(customerPhone, config.autoReplyMessage, config);
                        if (!autoReplyRes.error) {
                            await prisma.whatsAppContact.update({
                                where: { phone: customerPhone },
                                data: { lastAutoReplyAt: new Date() },
                            });

                            await prisma.whatsAppMessage.create({
                                data: {
                                    waMessageId: autoReplyRes.messageId || `auto-${Date.now()}`,
                                    customerPhone,
                                    customerName: profileName || existingContact?.name || null,
                                    direction: 'OUTBOUND',
                                    type: 'text',
                                    body: config.autoReplyMessage,
                                    isAutoReply: true,
                                    read: true,
                                    status: 'SENT',
                                },
                            });
                        } else {
                            console.warn('Auto-reply failed:', autoReplyRes.error);
                        }
                    }
                }
            }
        }
    }
}

// =========================================================================
// PUBLIC META WEBHOOK ENDPOINTS (Verified by Token)
// =========================================================================

router.get('/webhook', async (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const config = await getWebhookConfig();
    if (mode === 'subscribe' && token === config.verifyToken) {
        console.log('✅ WhatsApp Webhook verified successfully by Meta!');
        return res.status(200).type('text/plain').send(String(challenge || ''));
    }

    console.warn('❌ WhatsApp Webhook verification failed. Received token:', token);
    return res.sendStatus(403);
});

router.post('/webhook', (req, res) => {
    // Always acknowledge receipt immediately within Meta's timeout window
    res.sendStatus(200);

    Promise.resolve()
        .then(() => processWebhookPayload(req.body))
        .catch((err) => {
            console.error('Error processing WhatsApp webhook payload:', err);
        });
});

// =========================================================================
// AUTHENTICATED POS & DASHBOARD INBOX ENDPOINTS
// =========================================================================

router.get('/config', requireInboxAuth, async (_req, res) => {
    try {
        const config = await getWebhookConfig();
        res.json({
            success: true,
            data: {
                metaPhoneNumberId: config.metaPhoneNumberId,
                hasAccessToken: Boolean(config.metaAccessToken),
                verifyToken: config.verifyToken,
                autoReplyEnabled: config.autoReplyEnabled,
                forwardPhone: config.forwardPhone,
                autoReplyMessage: config.autoReplyMessage,
                cooldownHours: config.cooldownHours,
            },
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/config', requireInboxAuth, async (req, res) => {
    try {
        const current = await getWebhookConfig();
        const body = req.body || {};

        const updated: CloudWhatsAppConfig = {
            metaPhoneNumberId: body.metaPhoneNumberId ?? current.metaPhoneNumberId,
            metaAccessToken: body.metaAccessToken ?? current.metaAccessToken,
            verifyToken: body.verifyToken ?? current.verifyToken,
            autoReplyEnabled: typeof body.autoReplyEnabled === 'boolean' ? body.autoReplyEnabled : current.autoReplyEnabled,
            forwardPhone: body.forwardPhone ?? current.forwardPhone,
            autoReplyMessage: body.autoReplyMessage ?? current.autoReplyMessage,
            cooldownHours: typeof body.cooldownHours === 'number' ? body.cooldownHours : current.cooldownHours,
        };

        await prisma.setting.upsert({
            where: { key: WHATSAPP_CONFIG_KEY },
            create: { key: WHATSAPP_CONFIG_KEY, value: JSON.stringify(updated) },
            update: { value: JSON.stringify(updated) },
        });

        res.json({
            success: true,
            data: {
                metaPhoneNumberId: updated.metaPhoneNumberId,
                hasAccessToken: Boolean(updated.metaAccessToken),
                verifyToken: updated.verifyToken,
                autoReplyEnabled: updated.autoReplyEnabled,
                forwardPhone: updated.forwardPhone,
                autoReplyMessage: updated.autoReplyMessage,
                cooldownHours: updated.cooldownHours,
            },
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/conversations', requireInboxAuth, async (_req, res) => {
    try {
        const [contacts, recentMessages] = await Promise.all([
            prisma.whatsAppContact.findMany({ orderBy: { updatedAt: 'desc' } }),
            prisma.whatsAppMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
        ]);

        const contactMap = new Map<string, any>();
        for (const c of contacts) {
            contactMap.set(c.phone, c);
        }

        const threadMap = new Map<string, any>();
        for (const msg of recentMessages) {
            const phone = msg.customerPhone;
            if (!threadMap.has(phone)) {
                const contact = contactMap.get(phone);
                const lastInboundMs = contact?.lastInboundAt ? new Date(contact.lastInboundAt).getTime() : 0;
                const windowOpen = lastInboundMs > 0 && Date.now() - lastInboundMs < 24 * 60 * 60 * 1000;

                threadMap.set(phone, {
                    phone,
                    name: contact?.name || msg.customerName || phone,
                    lastMessage: msg.body,
                    lastDirection: msg.direction,
                    lastMessageAt: msg.createdAt,
                    lastInboundAt: contact?.lastInboundAt || null,
                    windowOpen,
                    optedOut: Boolean(contact?.optedOut),
                    unreadCount: 0,
                });
            }

            if (msg.direction === 'INBOUND' && !msg.read) {
                const thread = threadMap.get(phone);
                thread.unreadCount += 1;
            }
        }

        res.json({
            success: true,
            data: Array.from(threadMap.values()),
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/messages/:phone', requireInboxAuth, async (req, res) => {
    try {
        const phone = normalizeWaPhone(String(req.params.phone || ''));
        const messages = await prisma.whatsAppMessage.findMany({
            where: { customerPhone: phone },
            orderBy: { createdAt: 'asc' },
            take: 200,
        });

        const contact = await prisma.whatsAppContact.findUnique({ where: { phone } });
        const lastInboundMs = contact?.lastInboundAt ? new Date(contact.lastInboundAt).getTime() : 0;
        const windowOpen = lastInboundMs > 0 && Date.now() - lastInboundMs < 24 * 60 * 60 * 1000;

        res.json({
            success: true,
            data: {
                messages,
                contact,
                windowOpen,
            },
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/mark-read/:phone', requireInboxAuth, async (req, res) => {
    try {
        const phone = normalizeWaPhone(String(req.params.phone || ''));
        await prisma.whatsAppMessage.updateMany({
            where: { customerPhone: phone, direction: 'INBOUND', read: false },
            data: { read: true },
        });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/reply', requireInboxAuth, async (req, res) => {
    try {
        const { phone, text } = req.body || {};
        if (!phone || !text || !String(text).trim()) {
            return res.status(400).json({ success: false, error: 'Phone and message text are required.' });
        }

        const normalizedPhone = normalizeWaPhone(String(phone));
        const config = await getWebhookConfig();
        const contact = await prisma.whatsAppContact.findUnique({ where: { phone: normalizedPhone } });

        const lastInboundMs = contact?.lastInboundAt ? new Date(contact.lastInboundAt).getTime() : 0;
        const windowOpen = lastInboundMs > 0 && Date.now() - lastInboundMs < 24 * 60 * 60 * 1000;

        if (!windowOpen) {
            return res.status(400).json({
                success: false,
                error: '24-hour customer reply window has expired. Meta only allows free-form replies within 24 hours of a customer message.',
            });
        }

        const sendRes = await sendMetaTextMessage(normalizedPhone, String(text).trim(), config);
        if (sendRes.error) {
            return res.status(502).json({ success: false, error: sendRes.error });
        }

        const saved = await prisma.whatsAppMessage.create({
            data: {
                waMessageId: sendRes.messageId || `out-${Date.now()}`,
                customerPhone: normalizedPhone,
                customerName: contact?.name || null,
                direction: 'OUTBOUND',
                type: 'text',
                body: String(text).trim(),
                isAutoReply: false,
                read: true,
                status: 'SENT',
            },
        });

        // Mark inbound messages read upon manual reply
        await prisma.whatsAppMessage.updateMany({
            where: { customerPhone: normalizedPhone, direction: 'INBOUND', read: false },
            data: { read: true },
        });

        res.json({ success: true, data: saved });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/dispatches/register', requireInboxAuth, async (req, res) => {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        let registered = 0;

        for (const item of items) {
            const waMessageId = String(item?.waMessageId || '').trim();
            if (!waMessageId) continue;

            const recipientPhone = normalizeWaPhone(String(item?.recipientPhone || ''));
            const campaignName = item?.campaignName ? String(item.campaignName) : null;
            const templateName = item?.templateName ? String(item.templateName) : null;

            await prisma.whatsAppDispatchStatus.upsert({
                where: { waMessageId },
                create: {
                    waMessageId,
                    recipientPhone,
                    campaignName,
                    templateName,
                    status: 'ACCEPTED',
                },
                update: {
                    ...(recipientPhone ? { recipientPhone } : {}),
                    ...(campaignName ? { campaignName } : {}),
                    ...(templateName ? { templateName } : {}),
                },
            });
            registered += 1;
        }

        res.json({ success: true, registered });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/dispatches/statuses', requireInboxAuth, async (req, res) => {
    try {
        const waMessageIds: string[] = Array.isArray(req.body?.waMessageIds)
            ? req.body.waMessageIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
            : [];
        const limit = Math.min(Math.max(Number(req.body?.limit) || 100, 1), 300);

        const rows = await prisma.whatsAppDispatchStatus.findMany({
            ...(waMessageIds.length > 0 ? { where: { waMessageId: { in: waMessageIds } } } : {}),
            orderBy: { updatedAt: 'desc' },
            take: limit,
        });

        res.json({ success: true, data: rows });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/dispatches', requireInboxAuth, async (req, res) => {
    try {
        const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200);
        const rows = await prisma.whatsAppDispatchStatus.findMany({
            orderBy: { updatedAt: 'desc' },
            take: limit,
        });
        res.json({ success: true, data: rows });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;

