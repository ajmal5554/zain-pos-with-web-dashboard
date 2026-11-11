import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, X, Send, ArrowUpRight } from 'lucide-react';
import { useWhatsAppInboxStore } from '../../store/whatsappInboxStore';
import { messagingService } from '../../services/messaging.service';
import { showToast } from '../ui/Toast';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

export const WhatsAppPopupAlert: React.FC = () => {
    const navigate = useNavigate();
    const { popupAlert, dismissPopup, requestOpenThread, markReadLocally, refreshInbox } =
        useWhatsAppInboxStore();
    const [quickReply, setQuickReply] = useState('');
    const [sending, setSending] = useState(false);

    if (!popupAlert) return null;

    const handleOpenInInbox = () => {
        const phone = popupAlert.phone;
        requestOpenThread(phone);
        dismissPopup();
        navigate('/campaigns?tab=inbox');
    };

    const handleSendQuickReply = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!quickReply.trim() || sending) return;

        setSending(true);
        try {
            const res = await messagingService.sendInboxReply(popupAlert.phone, quickReply.trim());
            if (res.success) {
                showToast(`Reply sent to ${popupAlert.name}!`, 'success');
                setQuickReply('');
                markReadLocally(popupAlert.phone);
                dismissPopup();
                void refreshInbox(true);
            } else {
                showToast(res.error || 'Could not send quick reply', 'error');
            }
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="fixed bottom-5 right-5 z-[9990] w-[360px] max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-emerald-300 dark:border-emerald-700/80 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
            {/* Emerald Header Strip */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
                    </span>
                    <MessageCircle className="w-4 h-4" />
                    <span className="text-xs font-bold tracking-wide">New WhatsApp Reply</span>
                </div>
                <button
                    type="button"
                    onClick={dismissPopup}
                    className="p-1 rounded-lg hover:bg-white/20 text-white/90 hover:text-white transition-colors"
                    title="Dismiss popup"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Body */}
            <div className="p-3.5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="text-xs font-bold text-gray-900 dark:text-white truncate">
                            {popupAlert.name}
                        </div>
                        <div className="text-[11px] font-mono text-gray-500">+{popupAlert.phone}</div>
                    </div>
                    <button
                        type="button"
                        onClick={handleOpenInInbox}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex-shrink-0"
                    >
                        <span>Open Chat</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/80 rounded-xl px-3 py-2 text-xs text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-700/60 line-clamp-3">
                    {popupAlert.preview}
                </div>

                {/* Inline Quick Reply */}
                <form onSubmit={handleSendQuickReply} className="flex items-center gap-2">
                    <Input
                        value={quickReply}
                        onChange={(e) => setQuickReply(e.target.value)}
                        placeholder="Quick reply right here (₹0)..."
                        className="flex-1 h-8 text-xs"
                        disabled={sending}
                    />
                    <Button
                        type="submit"
                        disabled={!quickReply.trim() || sending}
                        className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1"
                    >
                        <Send className="w-3 h-3" />
                        <span>{sending ? '...' : 'Send'}</span>
                    </Button>
                </form>
            </div>
        </div>
    );
};

