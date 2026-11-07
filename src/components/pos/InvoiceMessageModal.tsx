import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { showToast } from '../ui/Toast';
import { messagingService } from '../../services/messaging.service';
import type { InvoiceMessagePayload, MessageResult, MessagingConfig } from '../../types/messaging';
import {
    MessageSquare,
    Smartphone,
    Send,
    CheckCircle,
    AlertCircle,
    Copy,
    Tag,
    Gift,
    ExternalLink,
    RefreshCw,
    User,
    Phone,
} from 'lucide-react';

interface InvoiceMessageModalProps {
    isOpen: boolean;
    onClose: () => void;
    sale: any;
    shopSettings?: {
        shopName?: string;
        address?: string;
        phone?: string;
        gstin?: string;
    };
    appliedCredits?: Array<{ code: string; amount: number }>;
    activeStoreCreditBalance?: number;
    activeStoreCreditCodes?: string[];
    customerHasWhatsApp?: boolean;
    onStatusChange?: (result: MessageResult) => void;
}

export const InvoiceMessageModal: React.FC<InvoiceMessageModalProps> = ({
    isOpen,
    onClose,
    sale,
    shopSettings,
    appliedCredits = [],
    activeStoreCreditBalance = 0,
    activeStoreCreditCodes = [],
    customerHasWhatsApp: initialHasWhatsApp = true,
    onStatusChange,
}) => {
    const [selectedTab, setSelectedTab] = useState<'whatsapp' | 'sms'>('whatsapp');
    const [hasWhatsApp, setHasWhatsApp] = useState<boolean>(initialHasWhatsApp);
    const [sending, setSending] = useState(false);
    const [lastResult, setLastResult] = useState<MessageResult | null>(null);
    const [messagingConfig, setMessagingConfig] = useState<MessagingConfig | null>(null);

    // Sync initial state when modal opens
    useEffect(() => {
        if (isOpen) {
            setHasWhatsApp(initialHasWhatsApp !== false);
            setSelectedTab(initialHasWhatsApp === false ? 'sms' : 'whatsapp');
            setLastResult(null);
            void messagingService.getConfig().then(cfg => setMessagingConfig(cfg));
        }
    }, [isOpen, initialHasWhatsApp]);

    // Build the payload
    const payload: InvoiceMessagePayload = useMemo(() => {
        if (!sale) {
            return {
                billNo: '',
                customerPhone: '',
                items: [],
                subtotal: 0,
                grandTotal: 0,
                paymentMethod: 'CASH',
            };
        }

        const items = (sale.items || []).map((item: any) => ({
            name: item.name || item.productName || 'Item',
            variantInfo: item.variantInfo,
            quantity: item.quantity || 1,
            sellingPrice: item.rate || item.sellingPrice || 0,
            total: item.total || ((item.rate || item.sellingPrice || 0) * (item.quantity || 1)),
        }));

        return {
            saleId: sale.id,
            billNo: sale.billNo,
            date: sale.actualSaleDate || sale.createdAt || new Date(),
            customerName: sale.customerName || 'Walk-in Customer',
            customerPhone: sale.customerPhone || '',
            items,
            subtotal: sale.subtotal || 0,
            discount: sale.discount || 0,
            grandTotal: sale.grandTotal || 0,
            paymentMethod: sale.paymentMethod || 'CASH',
            paidAmount: sale.paidAmount,
            changeAmount: sale.changeAmount,
            remarks: sale.remarks,
            appliedStoreCredit: appliedCredits.length > 0 ? appliedCredits : undefined,
            activeStoreCreditBalance: activeStoreCreditBalance > 0 ? activeStoreCreditBalance : undefined,
            activeStoreCreditCodes: activeStoreCreditCodes.length > 0 ? activeStoreCreditCodes : undefined,
            shopName: shopSettings?.shopName,
            shopAddress: shopSettings?.address,
            shopPhone: shopSettings?.phone,
            gstin: shopSettings?.gstin,
            customerHasWhatsApp: hasWhatsApp,
        };
    }, [sale, shopSettings, appliedCredits, activeStoreCreditBalance, activeStoreCreditCodes, hasWhatsApp]);

    const { whatsappText, smsText } = useMemo(() => {
        return messagingService.previewInvoice(payload);
    }, [payload]);

    const handleToggleWhatsApp = async (val: boolean) => {
        setHasWhatsApp(val);
        if (!val) {
            setSelectedTab('sms');
        }
        if (payload.customerPhone) {
            await messagingService.updateCustomerWhatsAppStatus(payload.customerPhone, val);
        }
    };

    const handleSendMessage = async (forceChannel?: 'WHATSAPP' | 'SMS') => {
        if (!payload.customerPhone) {
            showToast('Customer phone number is missing', 'error');
            return;
        }

        setSending(true);
        try {
            const sendPayload: InvoiceMessagePayload = {
                ...payload,
                forceChannel,
                customerHasWhatsApp: hasWhatsApp,
            };

            const result = await messagingService.sendInvoice(sendPayload);
            setLastResult(result);
            if (onStatusChange) onStatusChange(result);

            if (result.success) {
                if (result.fallback) {
                    showToast(`No WhatsApp account found. Invoice delivered via SMS to ${payload.customerPhone}`, 'warning');
                } else {
                    showToast(`Invoice messaged via ${result.channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS'}!`, 'success');
                }
            } else {
                showToast(result.error || 'Failed to dispatch invoice message.', 'error');
            }
        } catch (err: any) {
            showToast(err.message || 'Error sending message', 'error');
        } finally {
            setSending(false);
        }
    };

    const handleCopy = () => {
        const textToCopy = selectedTab === 'whatsapp' ? whatsappText : smsText;
        navigator.clipboard.writeText(textToCopy);
        showToast('Message text copied to clipboard', 'success');
    };

    if (!isOpen || !sale) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Message Invoice #${sale.billNo}`}
            size="lg"
        >
            <div className="space-y-4 py-1 text-sm">
                {/* Customer Information & WhatsApp Availability Banner */}
                <div className="bg-gray-50 dark:bg-gray-800/60 p-4 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                            <Phone className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                                <span>{sale.customerName || 'Walk-in Customer'}</span>
                                <span className="text-gray-400 font-normal">({payload.customerPhone || 'No Phone'})</span>
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                Total Bill: <span className="font-bold text-gray-900 dark:text-white">₹{Number(sale.grandTotal).toFixed(2)}</span> ({sale.paymentMethod || 'CASH'})
                            </div>
                        </div>
                    </div>

                    {/* WhatsApp Account Toggle */}
                    <div className="flex items-center gap-2 bg-white dark:bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-2xs">
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Has WhatsApp?</span>
                        <div className="flex rounded-md p-0.5 bg-gray-100 dark:bg-gray-700">
                            <button
                                type="button"
                                onClick={() => handleToggleWhatsApp(true)}
                                className={`px-2.5 py-1 text-xs font-semibold rounded ${
                                    hasWhatsApp
                                        ? 'bg-emerald-600 text-white shadow-xs'
                                        : 'text-gray-600 dark:text-gray-300 hover:text-black'
                                }`}
                            >
                                Yes
                            </button>
                            <button
                                type="button"
                                onClick={() => handleToggleWhatsApp(false)}
                                className={`px-2.5 py-1 text-xs font-semibold rounded ${
                                    !hasWhatsApp
                                        ? 'bg-blue-600 text-white shadow-xs'
                                        : 'text-gray-600 dark:text-gray-300 hover:text-black'
                                }`}
                            >
                                No (SMS)
                            </button>
                        </div>
                    </div>
                </div>

                {/* Notice if customer has NO WhatsApp account */}
                {!hasWhatsApp && (
                    <div className="flex items-center gap-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 p-3 rounded-lg text-xs">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <div>
                            <strong>No WhatsApp Account:</strong> Invoice will be delivered via <strong>SMS</strong> directly to {payload.customerPhone}.
                        </div>
                    </div>
                )}

                {/* Store Credit Highlight Banner */}
                {((appliedCredits && appliedCredits.length > 0) || (activeStoreCreditBalance > 0)) && (
                    <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/80 p-3.5 rounded-xl space-y-1.5 text-xs text-indigo-900 dark:text-indigo-200">
                        <div className="flex items-center gap-2 font-bold text-indigo-800 dark:text-indigo-300">
                            <Gift className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                            <span>Store Credit Information Attached to Invoice</span>
                        </div>
                        <div className="flex flex-wrap gap-4 pl-6 text-gray-700 dark:text-gray-300">
                            {appliedCredits && appliedCredits.length > 0 && (
                                <div>
                                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">Redeemed:</span> ₹
                                    {appliedCredits.reduce((s, c) => s + c.amount, 0).toFixed(2)} ({appliedCredits.map(c => c.code).join(', ')})
                                </div>
                            )}
                            {activeStoreCreditBalance > 0 && (
                                <div>
                                    <span className="font-semibold text-indigo-600 dark:text-indigo-400">Available Balance:</span> ₹
                                    {activeStoreCreditBalance.toFixed(2)}
                                    {activeStoreCreditCodes.length > 0 && (
                                        <span className="text-gray-500"> (Code: {activeStoreCreditCodes.join(', ')})</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Delivery Result Banner if sent */}
                {lastResult && (
                    <div
                        className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                            lastResult.success
                                ? lastResult.fallback
                                    ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 text-amber-900 dark:text-amber-200'
                                    : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 text-emerald-900 dark:text-emerald-200'
                                : 'bg-red-50 dark:bg-red-950/30 border-red-300 text-red-900 dark:text-red-200'
                        }`}
                    >
                        {lastResult.success ? (
                            <CheckCircle className="w-4 h-4 mt-0.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                        ) : (
                            <AlertCircle className="w-4 h-4 mt-0.5 text-red-600 dark:text-red-400 flex-shrink-0" />
                        )}
                        <div>
                            <div className="font-bold">
                                {lastResult.success
                                    ? lastResult.fallback
                                        ? 'Delivered via SMS Fallback'
                                        : `Dispatched via ${lastResult.channel}`
                                    : 'Message Dispatch Failed'}
                            </div>
                            <div className="mt-0.5">
                                {lastResult.fallbackReason || lastResult.error || `Provider: ${lastResult.provider}`}
                            </div>
                        </div>
                    </div>
                )}

                {/* Preview Tabs */}
                <div>
                    <div className="flex border-b border-gray-200 dark:border-gray-700 mb-2">
                        <button
                            type="button"
                            onClick={() => setSelectedTab('whatsapp')}
                            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold border-b-2 transition-colors ${
                                selectedTab === 'whatsapp'
                                    ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                                    : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'
                            }`}
                        >
                            <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                            WhatsApp Preview
                        </button>
                        <button
                            type="button"
                            onClick={() => setSelectedTab('sms')}
                            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold border-b-2 transition-colors ${
                                selectedTab === 'sms'
                                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                                    : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'
                            }`}
                        >
                            <Smartphone className="w-3.5 h-3.5 text-blue-600" />
                            SMS Preview ({smsText.length} chars)
                        </button>
                    </div>

                    {/* Preview Box */}
                    <div className="relative">
                        <pre
                            className={`w-full p-4 rounded-xl text-xs font-mono whitespace-pre-wrap break-words max-h-56 overflow-y-auto border shadow-inner ${
                                selectedTab === 'whatsapp'
                                    ? 'bg-[#EFEAE2] dark:bg-[#111B21] text-gray-900 dark:text-[#E9EDEF] border-[#DAD3CC] dark:border-[#222E35]'
                                    : 'bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-700'
                            }`}
                        >
                            {selectedTab === 'whatsapp' ? whatsappText : smsText}
                        </pre>
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="absolute top-2.5 right-2.5 bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 p-1.5 rounded-md border border-gray-200 dark:border-gray-700 shadow-2xs transition-all"
                            title="Copy message text"
                        >
                            <Copy className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {/* Footer Action Buttons */}
                <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-700">
                    <Button variant="secondary" size="sm" onClick={onClose}>
                        Close
                    </Button>

                    <div className="flex items-center gap-2">
                        {/* Send SMS Button */}
                        <Button
                            variant={hasWhatsApp ? 'outline' : 'primary'}
                            size="sm"
                            disabled={sending || !payload.customerPhone}
                            onClick={() => handleSendMessage('SMS')}
                            className="flex items-center gap-1.5"
                        >
                            <Smartphone className="w-4 h-4 text-blue-500" />
                            {sending ? 'Sending...' : 'Send via SMS'}
                        </Button>

                        {/* Send WhatsApp Button */}
                        <Button
                            variant={hasWhatsApp ? 'success' : 'outline'}
                            size="sm"
                            disabled={sending || !payload.customerPhone}
                            onClick={() => handleSendMessage('WHATSAPP')}
                            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                            <Send className="w-4 h-4" />
                            {sending ? 'Sending...' : 'Send via WhatsApp'}
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

