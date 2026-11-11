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
    metaWabaId?: string;
    metaAccessToken?: string;
    metaTemplateName?: string;
    metaLanguageCode?: string;

    // Auto-Reply & Cloud Webhook
    autoReplyEnabled?: boolean;
    autoReplyForwardPhone?: string;
    autoReplyMessage?: string;
    webhookVerifyToken?: string;

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
    autoReplyEnabled: true,
    autoReplyForwardPhone: '9037106449',
    autoReplyMessage:
        'Thank you for messaging *Zain Gents Palace*! 🙏 We have received your message and our team can reply directly here.\n\nFor immediate stock & size inquiries on WhatsApp, message our store desk:\n👉 https://wa.me/919037106449\n\nOr call us at 📞 +91 90371 06449',
    webhookVerifyToken: 'zain_pos_wa_webhook_2026',
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
    status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'OPENED';
    fallback: boolean;
    fallbackReason?: string | null;
    messageText: string;
    error?: string | null;
    waMessageId?: string | null;
    createdAt: string;
}

export interface CampaignRecipient {
    id: string;
    name: string;
    phone: string;
    totalSpend?: number;
    lastVisitDate?: string;
}

export interface CarouselCardPayload {
    mediaId: string;
    colorName: string;
    sizes: string;
    price: string;
}

export interface SendCampaignPayload {
    campaignName: string;
    templateName: string;
    languageCode?: string;
    headerMediaId?: string;
    headerMediaUrl?: string;
    templateParams: string[];
    carouselCards?: CarouselCardPayload[];
    recipients: CampaignRecipient[];
}

export interface CampaignDispatchResult {
    total: number;
    sent: number;
    failed: number;
    errors: { recipient: string; phone: string; error: string }[];
    dispatches?: Array<{ recipientPhone: string; waMessageId: string }>;
}

export interface WhatsAppConversation {
    phone: string;
    name: string;
    lastMessage: string;
    lastDirection: 'INBOUND' | 'OUTBOUND';
    lastMessageAt: string;
    lastInboundAt?: string | null;
    windowOpen: boolean;
    optedOut: boolean;
    unreadCount: number;
}

export interface WhatsAppInboxMessage {
    id: string;
    waMessageId?: string | null;
    customerPhone: string;
    customerName?: string | null;
    direction: 'INBOUND' | 'OUTBOUND';
    type: string;
    body: string;
    isAutoReply: boolean;
    read: boolean;
    status: string;
    createdAt: string;
}

export interface WhatsAppWebhookConfig {
    webhookUrl: string;
    verifyToken: string;
    autoReplyEnabled: boolean;
    forwardPhone: string;
    autoReplyMessage: string;
    cooldownHours: number;
    hasAccessToken: boolean;
    metaPhoneNumberId?: string;
    cloudReachable: boolean;
    cloudError?: string;
    authMismatch?: boolean;
}

export interface CampaignTemplateVariables {
    collectionName: string;
    details: string;
    sizes: string;
    startingPrice: string;
}

export interface SavedColorPhotoSlot {
    id: string;
    dataUrl: string;
    mimeType: string;
    filename: string;
    colorLabel: string;
    sizes?: string;
    price?: string;
    uploadedMediaId?: string;
    uploadedAt?: number;
}

export interface MarketingCampaignSnapshot {
    id: string;
    presetName?: string;
    updatedAt: string;
    campaignName: string;
    mediaMode: 'SINGLE' | 'COLLAGE' | 'CAROUSEL';
    variables: CampaignTemplateVariables;
    singlePhoto?: {
        dataUrl: string;
        mimeType: string;
        filename: string;
        uploadedMediaId?: string;
        uploadedAt?: number;
    } | null;
    collagePhotos: SavedColorPhotoSlot[];
    carouselCards: SavedColorPhotoSlot[];
}

export interface SavedMarketingCampaignsData {
    lastDraft: MarketingCampaignSnapshot | null;
    presets: MarketingCampaignSnapshot[];
}

