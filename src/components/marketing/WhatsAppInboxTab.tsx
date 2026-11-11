import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    MessageSquare,
    Send,
    RefreshCw,
    Bot,
    CheckCircle2,
    AlertTriangle,
    Copy,
    ExternalLink,
    Search,
    Clock,
    Settings2,
    Phone,
    Ban,
    ChevronDown,
    ChevronUp,
    Check
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { showToast } from '../ui/Toast';
import { messagingService } from '../../services/messaging.service';
import { useWhatsAppInboxStore } from '../../store/whatsappInboxStore';
import type {
    WhatsAppInboxMessage,
    WhatsAppWebhookConfig,
} from '../../types/messaging';
import { DEFAULT_MESSAGING_CONFIG } from '../../types/messaging';

export const WhatsAppInboxTab: React.FC = () => {
    const {
        conversations,
        cloudReachable: storeCloudReachable,
        loading: loadingThreads,
        refreshInbox,
        markReadLocally,
        targetPhoneToOpen,
        requestOpenThread,
    } = useWhatsAppInboxStore();

    const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
    const [messages, setMessages] = useState<WhatsAppInboxMessage[]>([]);
    const [windowOpen, setWindowOpen] = useState(false);
    const [optedOut, setOptedOut] = useState(false);

    const [loadingMessages, setLoadingMessages] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Reply box
    const [replyText, setReplyText] = useState('');
    const [sendingReply, setSendingReply] = useState(false);

    // Auto-reply & webhook setup panel
    const [showConfigPanel, setShowConfigPanel] = useState(false);
    const [webhookConfig, setWebhookConfig] = useState<WhatsAppWebhookConfig | null>(null);
    const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);
    const [forwardPhone, setForwardPhone] = useState('9037106449');
    const [autoReplyMessage, setAutoReplyMessage] = useState(DEFAULT_MESSAGING_CONFIG.autoReplyMessage || '');
    const [newSyncSecretInput, setNewSyncSecretInput] = useState('');
    const [savingConfig, setSavingConfig] = useState(false);
    const [copiedField, setCopiedField] = useState<string | null>(null);

    const messagesContainerRef = useRef<HTMLDivElement | null>(null);

    const cloudReachable = Boolean(webhookConfig?.cloudReachable || storeCloudReachable);

    useEffect(() => {
        void loadInitialData();
    }, []);

    // Auto-open thread when user clicks "Open Chat" from popup alert or desktop notification
    useEffect(() => {
        if (targetPhoneToOpen) {
            void handleSelectThread(targetPhoneToOpen);
            requestOpenThread(null);
        } else if (!selectedPhone && conversations.length > 0) {
            void handleSelectThread(conversations[0].phone);
        }
    }, [targetPhoneToOpen, conversations.length]);

    // Auto-refresh active chat thread messages every 3.5 seconds when Inbox is open
    useEffect(() => {
        if (!selectedPhone) return;
        const interval = setInterval(() => {
            void loadMessagesForPhone(selectedPhone, true);
        }, 3500);
        return () => clearInterval(interval);
    }, [selectedPhone]);

    // Also trigger immediate active-chat reload when the store detects a new message in this thread
    const selectedThreadLastMsgAt = useMemo(
        () => conversations.find((c) => c.phone === selectedPhone)?.lastMessageAt || '',
        [conversations, selectedPhone]
    );

    useEffect(() => {
        if (selectedPhone && selectedThreadLastMsgAt) {
            void loadMessagesForPhone(selectedPhone, true);
        }
    }, [selectedPhone, selectedThreadLastMsgAt]);

    useEffect(() => {
        const el = messagesContainerRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }, [messages.length, selectedPhone]);

    const loadInitialData = async () => {
        await Promise.all([loadWebhookConfig(), refreshInbox(false)]);
    };

    const loadWebhookConfig = async () => {
        const localCfg = await messagingService.getConfig();
        const cloudStatus = await messagingService.getWebhookStatus();

        if (cloudStatus) {
            setWebhookConfig(cloudStatus);
            if (!cloudStatus.cloudReachable) {
                setShowConfigPanel(true);
            }
            setAutoReplyEnabled(localCfg.autoReplyEnabled ?? cloudStatus.autoReplyEnabled);
            setForwardPhone(localCfg.autoReplyForwardPhone || cloudStatus.forwardPhone || '9037106449');
            setAutoReplyMessage(localCfg.autoReplyMessage || cloudStatus.autoReplyMessage);
        }
    };

    const handleSelectThread = async (phone: string) => {
        setSelectedPhone(phone);
        await loadMessagesForPhone(phone, false);
        await messagingService.markConversationRead(phone);
        markReadLocally(phone);
    };

    const loadMessagesForPhone = async (phone: string, silent = false) => {
        if (!silent) setLoadingMessages(true);
        try {
            const res = await messagingService.getConversationMessages(phone);
            setMessages(res.messages || []);
            setWindowOpen(res.windowOpen);
            setOptedOut(res.optedOut);
            if (silent && res.messages?.some((m) => m.direction === 'INBOUND' && !m.read)) {
                void messagingService.markConversationRead(phone);
                markReadLocally(phone);
            }
        } finally {
            if (!silent) setLoadingMessages(false);
        }
    };

    const handleSendReply = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!selectedPhone || !replyText.trim() || sendingReply) return;

        setSendingReply(true);
        try {
            const res = await messagingService.sendInboxReply(selectedPhone, replyText.trim());
            if (res.success && res.message) {
                setMessages((prev) => [...prev, res.message!]);
                setReplyText('');
                void refreshInbox(true);
            } else {
                showToast(res.error || 'Failed to send reply', 'error');
            }
        } finally {
            setSendingReply(false);
        }
    };

    const handleSaveAutoReplyConfig = async () => {
        setSavingConfig(true);
        try {
            const cleanForward = forwardPhone.replace(/\D/g, '');
            const res = await messagingService.syncWebhookConfig({
                autoReplyEnabled,
                autoReplyForwardPhone: cleanForward || '9037106449',
                autoReplyMessage,
                ...(newSyncSecretInput.trim() ? { cloudSyncSecret: newSyncSecretInput.trim() } : {}),
            });

            if (res.success) {
                setNewSyncSecretInput('');
                showToast('Auto-Reply rules & credentials synced to Cloud Webhook!', 'success');
                await loadInitialData();
            } else {
                showToast(`Cloud sync issue: ${res.error}`, 'error');
                await loadWebhookConfig();
            }
        } finally {
            setSavingConfig(false);
        }
    };

    const handleCopy = async (label: string, value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedField(label);
            showToast(`${label} copied!`, 'success');
            setTimeout(() => setCopiedField(null), 2000);
        } catch {
            showToast('Could not copy to clipboard', 'error');
        }
    };

    const filteredConversations = useMemo(() => {
        if (!searchQuery.trim()) return conversations;
        const q = searchQuery.toLowerCase();
        return conversations.filter(
            (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.lastMessage.toLowerCase().includes(q)
        );
    }, [conversations, searchQuery]);

    const activeConversation = useMemo(
        () => conversations.find((c) => c.phone === selectedPhone) || null,
        [conversations, selectedPhone]
    );

    const openPersonalWhatsApp = (phone: string) => {
        const digits = phone.replace(/\D/g, '');
        const wa = digits.length === 10 ? `91${digits}` : digits;
        messagingService.openUrl(`https://wa.me/${wa}`);
    };

    return (
        <div className="space-y-4">
            {/* Top Banner: Cloud Webhook & Auto-Reply Config */}
            <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200/80 dark:border-gray-800 p-4 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-2xl ${cloudReachable ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400'}`}>
                            <Bot className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-sm text-gray-900 dark:text-white">
                                    Auto-Reply & Two-Way Customer Inbox
                                </span>
                                {cloudReachable ? (
                                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live Auto-Sync Connected
                                    </span>
                                ) : webhookConfig?.authMismatch ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800">
                                        <AlertTriangle className="w-3 h-3" /> Cloud Sync Secret Mismatch (401)
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                                        <AlertTriangle className="w-3 h-3" /> Cloud Server Waking Up / Unreachable
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                                {autoReplyEnabled
                                    ? `Customers replying to +91 97784 04804 receive an instant free auto-reply directing urgent inquiries to ${forwardPhone}, plus appear here for free 24h direct replies.`
                                    : 'Auto-reply is paused. Customer replies still appear in this inbox.'}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowConfigPanel(!showConfigPanel)}
                            className="text-xs flex items-center gap-1.5"
                        >
                            <Settings2 className="w-3.5 h-3.5" />
                            <span>Auto-Reply & Webhook Setup</span>
                            {showConfigPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => loadInitialData()}
                            disabled={loadingThreads}
                            className="text-xs flex items-center gap-1.5"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loadingThreads ? 'animate-spin' : ''}`} />
                            <span>Refresh</span>
                        </Button>
                    </div>
                </div>

                {/* Expandable Setup & Auto-Reply Rules Drawer */}
                {showConfigPanel && (
                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-4">
                        {/* Auth Mismatch Helper Box */}
                        {webhookConfig?.authMismatch && (
                            <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/70 rounded-2xl p-4 space-y-3">
                                <div className="flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-200">
                                    <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                                    <div className="space-y-1">
                                        <div className="font-bold">Render API is LIVE, but your Cloud Sync Secret does not match (401)</div>
                                        <p className="text-[11px] text-rose-700 dark:text-rose-300">
                                            Open <strong>Render Dashboard → zain-pos-api → Environment → CLOUD_SYNC_SECRET</strong>, copy that value, paste it below, and click <strong>Save Secret &amp; Connect</strong>.
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <Input
                                        type="password"
                                        value={newSyncSecretInput}
                                        onChange={(e) => setNewSyncSecretInput(e.target.value)}
                                        placeholder="Paste CLOUD_SYNC_SECRET from Render Dashboard..."
                                        className="flex-1 h-9 text-xs font-mono bg-white dark:bg-gray-900"
                                    />
                                    <Button
                                        onClick={handleSaveAutoReplyConfig}
                                        disabled={savingConfig || !newSyncSecretInput.trim()}
                                        className="h-9 px-4 text-xs bg-rose-600 hover:bg-rose-700 text-white font-bold"
                                    >
                                        {savingConfig ? 'Connecting...' : 'Save Secret & Connect'}
                                    </Button>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        {/* Left: Auto-Reply Customization */}
                        <div className="lg:col-span-7 space-y-4">
                            <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2.5 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={autoReplyEnabled}
                                        onChange={(e) => setAutoReplyEnabled(e.target.checked)}
                                        className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                                    />
                                    <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                                        Enable Automatic Free Reply + Store Phone Redirect
                                    </span>
                                </label>
                                <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full">
                                    ₹0 Meta Cost (Free Service Window)
                                </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 mb-1">
                                        Store Desk WhatsApp / Call Number
                                    </label>
                                    <Input
                                        value={forwardPhone}
                                        onChange={(e) => setForwardPhone(e.target.value)}
                                        placeholder="e.g. 9037106449"
                                        className="h-9 text-xs font-mono"
                                    />
                                </div>
                                <div className="flex items-end">
                                    <Button
                                        onClick={handleSaveAutoReplyConfig}
                                        disabled={savingConfig}
                                        className="w-full h-9 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                                    >
                                        {savingConfig ? 'Syncing...' : 'Save & Sync Rules to Cloud'}
                                    </Button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 mb-1">
                                    Auto-Reply Message Text (Sent once every 6h per customer reply)
                                </label>
                                <textarea
                                    value={autoReplyMessage}
                                    onChange={(e) => setAutoReplyMessage(e.target.value)}
                                    rows={4}
                                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 text-xs text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                            </div>
                        </div>

                        {/* Right: Meta Dashboard Webhook Connection Box */}
                        <div className="lg:col-span-5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 space-y-3">
                            <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                Meta Developer Dashboard Webhook Credentials
                            </div>
                            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                                In <strong>developers.facebook.com</strong> → Your App → <strong>WhatsApp → Configuration → Webhook</strong>, click <strong>Edit</strong> and paste these values, then subscribe to <strong>messages</strong>:
                            </p>

                            <div className="space-y-2">
                                <div>
                                    <div className="text-[10px] font-bold uppercase text-slate-500 mb-0.5">Callback URL</div>
                                    <div className="flex items-center gap-1.5">
                                        <code className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] font-mono truncate">
                                            {webhookConfig?.webhookUrl || 'https://zain-pos-with-web-dashboard.onrender.com/api/whatsapp/webhook'}
                                        </code>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleCopy('Callback URL', webhookConfig?.webhookUrl || 'https://zain-pos-with-web-dashboard.onrender.com/api/whatsapp/webhook')}
                                            className="h-8 px-2.5"
                                        >
                                            {copiedField === 'Callback URL' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                        </Button>
                                    </div>
                                </div>

                                <div>
                                    <div className="text-[10px] font-bold uppercase text-slate-500 mb-0.5">Verify Token</div>
                                    <div className="flex items-center gap-1.5">
                                        <code className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] font-mono truncate">
                                            {webhookConfig?.verifyToken || 'zain_pos_wa_webhook_2026'}
                                        </code>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleCopy('Verify Token', webhookConfig?.verifyToken || 'zain_pos_wa_webhook_2026')}
                                            className="h-8 px-2.5"
                                        >
                                            {copiedField === 'Verify Token' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Split-Pane WhatsApp Inbox */}
            <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200/80 dark:border-gray-800 shadow-sm overflow-hidden grid grid-cols-1 lg:grid-cols-12 h-[500px] min-h-[380px] max-h-[calc(100vh-260px)]">
                {/* Left Pane: Thread List (4 cols) */}
                <div className="lg:col-span-4 border-r border-gray-100 dark:border-gray-800 flex flex-col min-h-0 overflow-hidden">
                    <div className="p-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
                        <div className="relative">
                            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <Input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search customer chats..."
                                className="h-9 pl-9 text-xs"
                            />
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                        {loadingThreads ? (
                            <div className="p-8 text-center text-xs text-gray-400">
                                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-600" />
                                Loading customer replies...
                            </div>
                        ) : filteredConversations.length === 0 ? (
                            <div className="p-8 text-center space-y-2">
                                <MessageSquare className="w-8 h-8 text-gray-300 mx-auto" />
                                <div className="text-xs font-bold text-gray-500">No incoming messages yet</div>
                                <p className="text-[11px] text-gray-400">
                                    {cloudReachable
                                        ? 'When customers reply to your WhatsApp bills or broadcasts, their messages will appear here automatically.'
                                        : webhookConfig?.cloudError || 'Connect your Cloud Sync Secret above and set the Webhook in Meta Dashboard to start receiving replies here.'}
                                </p>
                            </div>
                        ) : (
                            filteredConversations.map((c) => {
                                const isActive = selectedPhone === c.phone;
                                return (
                                    <button
                                        key={c.phone}
                                        onClick={() => handleSelectThread(c.phone)}
                                        className={`w-full text-left p-3.5 transition-colors flex items-start justify-between gap-2 ${
                                            isActive
                                                ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-l-4 border-l-emerald-600'
                                                : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
                                        }`}
                                    >
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-bold text-xs text-gray-900 dark:text-white truncate">
                                                    {c.name}
                                                </span>
                                                {c.windowOpen && (
                                                    <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" title="24h Free Reply Active" />
                                                )}
                                                {c.optedOut && (
                                                    <span className="text-[9px] bg-rose-100 text-rose-700 px-1.5 py-0.2 rounded font-bold">
                                                        STOP
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-[10px] font-mono text-gray-400">+{c.phone}</div>
                                            <div className="text-[11px] text-gray-600 dark:text-gray-400 truncate">
                                                {c.lastDirection === 'OUTBOUND' ? 'You: ' : ''}
                                                {c.lastMessage}
                                            </div>
                                        </div>

                                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                            <span className="text-[10px] text-gray-400">
                                                {new Date(c.lastMessageAt).toLocaleTimeString('en-IN', {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}
                                            </span>
                                            {c.unreadCount > 0 && (
                                                <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                                                    {c.unreadCount}
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Right Pane: Chat Conversation Window (8 cols) */}
                <div className="lg:col-span-8 flex flex-col min-h-0 overflow-hidden bg-[#EFEAE2] dark:bg-[#0b141a]">
                    {selectedPhone ? (
                        <>
                            {/* Chat Header */}
                            <div className="bg-white dark:bg-gray-900 px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3 flex-shrink-0">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-sm text-gray-900 dark:text-white">
                                            {activeConversation?.name || `+${selectedPhone}`}
                                        </span>
                                        {windowOpen ? (
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                                                Free 24h Reply Active (₹0)
                                            </span>
                                        ) : (
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                                24h Window Closed
                                            </span>
                                        )}
                                        {optedOut && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                                                <Ban className="w-3 h-3" /> Unsubscribed from Promos
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[11px] font-mono text-gray-500">+{selectedPhone}</div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => openPersonalWhatsApp(selectedPhone)}
                                        className="text-xs flex items-center gap-1.5"
                                    >
                                        <Phone className="w-3.5 h-3.5 text-emerald-600" />
                                        <span>Open in WhatsApp App</span>
                                        <ExternalLink className="w-3 h-3" />
                                    </Button>
                                </div>
                            </div>

                            {/* Chat Messages Feed */}
                            <div ref={messagesContainerRef} className="flex-1 min-h-0 p-4 overflow-y-auto space-y-3">
                                {loadingMessages ? (
                                    <div className="text-center py-12 text-xs text-gray-500">
                                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-600" />
                                        Loading chat history...
                                    </div>
                                ) : messages.length === 0 ? (
                                    <div className="text-center py-12 text-xs text-gray-500">
                                        No messages in this thread yet.
                                    </div>
                                ) : (
                                    messages.map((m) => {
                                        const isOutbound = m.direction === 'OUTBOUND';
                                        return (
                                            <div
                                                key={m.id}
                                                className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
                                            >
                                                <div
                                                    className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 shadow-sm text-xs space-y-1 ${
                                                        isOutbound
                                                            ? m.isAutoReply
                                                                ? 'bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 text-gray-800 dark:text-gray-100 rounded-tr-none'
                                                                : 'bg-[#D9FDD3] dark:bg-[#005C4B] text-gray-900 dark:text-white rounded-tr-none'
                                                            : 'bg-white dark:bg-[#202C33] text-gray-900 dark:text-gray-100 rounded-tl-none'
                                                    }`}
                                                >
                                                    {m.isAutoReply && (
                                                        <div className="flex items-center gap-1 text-[10px] font-bold text-teal-700 dark:text-teal-300">
                                                            <Bot className="w-3 h-3" />
                                                            <span>Automated Redirect Reply (₹0)</span>
                                                        </div>
                                                    )}
                                                    <div className="whitespace-pre-wrap leading-relaxed">{m.body}</div>
                                                    <div className="text-[10px] text-gray-500 dark:text-gray-400 text-right flex items-center justify-end gap-1">
                                                        <span>
                                                            {new Date(m.createdAt).toLocaleTimeString('en-IN', {
                                                                hour: '2-digit',
                                                                minute: '2-digit',
                                                            })}
                                                        </span>
                                                        {isOutbound && <span className="uppercase text-[9px]">• {m.status}</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            {/* Bottom Reply Composer */}
                            <div className="bg-white dark:bg-gray-900 p-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
                                {windowOpen ? (
                                    <form onSubmit={handleSendReply} className="flex items-center gap-2">
                                        <Input
                                            value={replyText}
                                            onChange={(e) => setReplyText(e.target.value)}
                                            placeholder="Type a free reply to customer (₹0 within 24h)..."
                                            className="flex-1 h-10 text-xs"
                                            disabled={sendingReply}
                                        />
                                        <Button
                                            type="submit"
                                            disabled={!replyText.trim() || sendingReply}
                                            className="h-10 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5"
                                        >
                                            <Send className="w-3.5 h-3.5" />
                                            <span>{sendingReply ? 'Sending...' : 'Send Free Reply'}</span>
                                        </Button>
                                    </form>
                                ) : (
                                    <div className="flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl px-3.5 py-2.5 text-xs">
                                        <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
                                            <Clock className="w-4 h-4 flex-shrink-0" />
                                            <span>
                                                24-hour customer care window expired. Use <strong>Open in WhatsApp App</strong> above to message them directly from your store phone.
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-2 text-gray-500">
                            <div className="w-12 h-12 rounded-2xl bg-white/80 dark:bg-gray-800 flex items-center justify-center shadow-sm">
                                <MessageSquare className="w-6 h-6 text-emerald-600" />
                            </div>
                            <div className="text-sm font-bold text-gray-700 dark:text-gray-300">
                                Select a customer conversation
                            </div>
                            <p className="text-xs text-gray-500 max-w-sm">
                                Incoming customer replies sent to <strong>+91 97784 04804</strong> appear here with instant 24-hour free direct replies.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

