import type {
    MessagingConfig,
    InvoiceMessagePayload,
    StoreCreditMessagePayload,
    MessageResult,
    MessageLogRecord,
} from '../types/messaging';
import { DEFAULT_MESSAGING_CONFIG } from '../types/messaging';
import { useAuthStore } from '../store/authStore';
import {
    buildInvoiceMessageWhatsApp,
    buildInvoiceMessageSMS,
    buildStoreCreditMessageWhatsApp,
    buildStoreCreditMessageSMS,
    normalizePhoneNumber,
} from '../lib/messagingFormat';

class MessagingFrontendService {
    private cachedConfig: MessagingConfig | null = null;

    /**
     * Fetch messaging configuration from Settings
     */
    async getConfig(): Promise<MessagingConfig> {
        try {
            if (window.electronAPI?.settings?.get) {
                const res = await window.electronAPI.settings.get({ key: 'MESSAGING_CONFIG' });
                if (res.success && res.data) {
                    const parsed = JSON.parse(res.data as string);
                    const merged: MessagingConfig = { ...DEFAULT_MESSAGING_CONFIG, ...parsed };
                    this.cachedConfig = merged;
                    return merged;
                }
            }
        } catch (err) {
            console.warn('Failed to load messaging config from settings, using default:', err);
        }
        return { ...DEFAULT_MESSAGING_CONFIG };
    }

    /**
     * Save messaging configuration to Settings
     */
    async saveConfig(config: MessagingConfig, userId?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const activeUserId = userId || useAuthStore.getState().user?.id || 'default-user';
            if (window.electronAPI?.settings?.set) {
                const res = await window.electronAPI.settings.set({
                    key: 'MESSAGING_CONFIG',
                    value: JSON.stringify(config),
                    userId: activeUserId,
                });
                if (res?.success) {
                    this.cachedConfig = { ...config };
                    return { success: true };
                }
                return { success: false, error: res?.error || 'Failed to save configuration.' };
            }

            // Fallback for browser preview / localStorage
            localStorage.setItem('MESSAGING_CONFIG', JSON.stringify(config));
            this.cachedConfig = { ...config };
            return { success: true };
        } catch (err: any) {
            console.error('Failed to save messaging config:', err);
            return { success: false, error: err?.message || 'Error saving messaging configuration.' };
        }
    }

    /**
     * Send invoice message with smart WhatsApp -> SMS fallback
     */
    async sendInvoice(payload: InvoiceMessagePayload): Promise<MessageResult> {
        if (!payload.customerPhone) {
            return {
                success: false,
                channel: 'WHATSAPP',
                fallback: false,
                recipientPhone: '',
                messageText: '',
                provider: 'None',
                error: 'Customer phone number is required.',
            };
        }

        try {
            if (window.electronAPI?.messaging?.sendInvoice) {
                const res = await window.electronAPI.messaging.sendInvoice(payload);
                if (res.success && res.data) {
                    // If direct URL is returned (direct mode), open it
                    if (res.data.directUrl) {
                        await this.openUrl(res.data.directUrl);
                    }
                    return res.data;
                }
                return {
                    success: false,
                    channel: res.data?.channel || 'WHATSAPP',
                    fallback: false,
                    recipientPhone: payload.customerPhone,
                    messageText: '',
                    provider: 'None',
                    error: res.error || 'Failed to dispatch invoice message.',
                };
            }
        } catch (err: any) {
            console.error('Failed to send invoice message:', err);
            return {
                success: false,
                channel: 'WHATSAPP',
                fallback: false,
                recipientPhone: payload.customerPhone,
                messageText: '',
                provider: 'None',
                error: err.message || 'Messaging service error.',
            };
        }

        // Fallback for purely browser / mockup mode
        const waText = buildInvoiceMessageWhatsApp(payload);
        const norm = normalizePhoneNumber(payload.customerPhone);
        const url = `https://wa.me/${norm.waFormat}?text=${encodeURIComponent(waText)}`;
        await this.openUrl(url);

        return {
            success: true,
            channel: 'WHATSAPP',
            fallback: false,
            recipientPhone: payload.customerPhone,
            messageText: waText,
            directUrl: url,
            provider: 'Direct (WhatsApp Web)',
        };
    }

    /**
     * Send store credit voucher message to customer
     */
    async sendStoreCredit(payload: StoreCreditMessagePayload): Promise<MessageResult> {
        if (!payload.customerPhone) {
            return {
                success: false,
                channel: 'WHATSAPP',
                fallback: false,
                recipientPhone: '',
                messageText: '',
                provider: 'None',
                error: 'Customer phone is required.',
            };
        }

        try {
            if (window.electronAPI?.messaging?.sendStoreCredit) {
                const res = await window.electronAPI.messaging.sendStoreCredit(payload);
                if (res.success && res.data) {
                    if (res.data.directUrl) {
                        await this.openUrl(res.data.directUrl);
                    }
                    return res.data;
                }
                return {
                    success: false,
                    channel: res.data?.channel || 'WHATSAPP',
                    fallback: false,
                    recipientPhone: payload.customerPhone,
                    messageText: '',
                    provider: 'None',
                    error: res.error || 'Failed to dispatch store credit message.',
                };
            }
        } catch (err: any) {
            return {
                success: false,
                channel: 'WHATSAPP',
                fallback: false,
                recipientPhone: payload.customerPhone,
                messageText: '',
                provider: 'None',
                error: err.message,
            };
        }

        const waText = buildStoreCreditMessageWhatsApp(payload);
        const norm = normalizePhoneNumber(payload.customerPhone);
        const url = `https://wa.me/${norm.waFormat}?text=${encodeURIComponent(waText)}`;
        await this.openUrl(url);

        return {
            success: true,
            channel: 'WHATSAPP',
            fallback: false,
            recipientPhone: payload.customerPhone,
            messageText: waText,
            directUrl: url,
            provider: 'Direct (WhatsApp Web)',
        };
    }

    /**
     * Retrieve recent message logs
     */
    async getLogs(query?: { saleId?: string; phone?: string; limit?: number }): Promise<MessageLogRecord[]> {
        try {
            if (window.electronAPI?.messaging?.getLogs) {
                const res = await window.electronAPI.messaging.getLogs(query);
                if (res.success && Array.isArray(res.data)) {
                    return res.data;
                }
            }
        } catch (err) {
            console.warn('Failed to fetch message logs:', err);
        }
        return [];
    }

    /**
     * Update customer hasWhatsApp status
     */
    async updateCustomerWhatsAppStatus(phone: string, hasWhatsApp: boolean): Promise<boolean> {
        try {
            if (window.electronAPI?.messaging?.updateCustomerWhatsAppStatus) {
                const res = await window.electronAPI.messaging.updateCustomerWhatsAppStatus(phone, hasWhatsApp);
                return Boolean(res?.success);
            }
        } catch (err) {
            console.warn('Failed to update customer WhatsApp status:', err);
        }
        return false;
    }

    /**
     * Open an external link (WhatsApp Web, SMS protocol, etc.)
     */
    async openUrl(url: string): Promise<void> {
        try {
            if (window.electronAPI?.shell?.openExternal) {
                await window.electronAPI.shell.openExternal(url);
                return;
            }
        } catch (err) {
            console.warn('Electron openExternal failed, falling back to window.open:', err);
        }
        try {
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (e) {
            console.error('Cannot open URL in window:', e);
        }
    }

    /**
     * Generate preview texts for both channels
     */
    previewInvoice(payload: InvoiceMessagePayload): { whatsappText: string; smsText: string } {
        return {
            whatsappText: buildInvoiceMessageWhatsApp(payload),
            smsText: buildInvoiceMessageSMS(payload),
        };
    }

    previewStoreCredit(payload: StoreCreditMessagePayload): { whatsappText: string; smsText: string } {
        return {
            whatsappText: buildStoreCreditMessageWhatsApp(payload),
            smsText: buildStoreCreditMessageSMS(payload),
        };
    }
}

export const messagingService = new MessagingFrontendService();
