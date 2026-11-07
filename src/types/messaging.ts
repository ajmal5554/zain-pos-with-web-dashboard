export type MessagingChannel = 'WHATSAPP' | 'SMS';
export type MessagingStrategy = 'WHATSAPP_FIRST' | 'WHATSAPP_ONLY' | 'SMS_ONLY';
export type WhatsAppProvider = 'DIRECT' | 'META_API' | 'TWILIO' | 'CUSTOM_HTTP';
export type SmsProvider = 'DIRECT' | 'FAST2SMS' | 'TWILIO' | 'CUSTOM_HTTP';

export interface MessagingConfig {
    enabled: boolean;
    autoSend: boolean;
    defaultChannel: MessagingStrategy;
    includeStoreCredit: boolean;
    includeShopDetails: boolean;
    defaultCountryCode: string; // e.g. "91"

    // WhatsApp
    whatsappProvider: WhatsAppProvider;
    metaPhoneNumberId?: string;
    metaAccessToken?: string;
    metaTemplateName?: string;
    metaLanguageCode?: string;

    // SMS
    smsProvider: SmsProvider;
    fast2smsApiKey?: string;
    fast2smsSenderId?: string;

    // Twilio
    twilioAccountSid?: string;
    twilioAuthToken?: string;
    twilioWhatsappFrom?: string; // e.g. "whatsapp:+14155238886"
    twilioSmsFrom?: string; // e.g. "+14155238886"

    // Custom HTTP endpoints
    customSmsUrl?: string;
    customSmsMethod?: 'GET' | 'POST';
    customSmsHeadersJson?: string;
    customSmsBodyJson?: string;

    customWhatsappUrl?: string;
    customWhatsappMethod?: 'GET' | 'POST';
    customWhatsappHeadersJson?: string;
    customWhatsappBodyJson?: string;
}

export const DEFAULT_MESSAGING_CONFIG: MessagingConfig = {
    enabled: true,
    autoSend: false,
    defaultChannel: 'WHATSAPP_FIRST',
    includeStoreCredit: true,
    includeShopDetails: true,
    defaultCountryCode: '91',
    whatsappProvider: 'DIRECT',
    metaTemplateName: 'tax_invoice',
    metaLanguageCode: 'en_US',
    smsProvider: 'DIRECT',
};

export interface InvoiceMessageItem {
    name: string;
    variantInfo?: string;
    quantity: number;
    sellingPrice: number;
    total: number;
}

export interface InvoiceMessagePayload {
    saleId?: string;
    billNo: string | number;
    date?: string | Date;
    customerName?: string;
    customerPhone: string;
    items: InvoiceMessageItem[];
    subtotal: number;
    discount?: number;
    grandTotal: number;
    paymentMethod: string;
    paidAmount?: number;
    changeAmount?: number;
    remarks?: string;

    // Store credit info
    appliedStoreCredit?: Array<{ code: string; amount: number }>;
    activeStoreCreditBalance?: number;
    activeStoreCreditCodes?: string[];

    // Shop info
    shopName?: string;
    shopAddress?: string;
    shopPhone?: string;
    gstin?: string;

    // Delivery controls
    forceChannel?: MessagingChannel;
    customerHasWhatsApp?: boolean; // if false, automatically skips WhatsApp and sends SMS
}

export interface StoreCreditMessagePayload {
    customerName?: string;
    customerPhone: string;
    code: string;
    amount: number;
    remainingAmount: number;
    reason?: string;
    totalActiveBalance?: number;
    shopName?: string;
    shopPhone?: string;
    forceChannel?: MessagingChannel;
    customerHasWhatsApp?: boolean;
}

export interface MessageResult {
    success: boolean;
    channel: MessagingChannel;
    fallback: boolean;
    fallbackReason?: string;
    recipientPhone: string;
    messageText: string;
    directUrl?: string;
    provider: string;
    error?: string;
    messageId?: string;
    loggedAt?: string;
}

export interface MessageLogRecord {
    id: string;
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
    createdAt: string;
}

