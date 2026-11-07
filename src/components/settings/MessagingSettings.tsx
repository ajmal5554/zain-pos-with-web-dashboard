import React, { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { showToast } from '../ui/Toast';
import { messagingService } from '../../services/messaging.service';
import type {
    MessagingConfig,
    MessageLogRecord,
    WhatsAppProvider,
    SmsProvider,
    MessagingStrategy,
} from '../../types/messaging';
import { DEFAULT_MESSAGING_CONFIG } from '../../types/messaging';
import { useAuthStore } from '../../store/authStore';
import {
    MessageSquare,
    Smartphone,
    Send,
    CheckCircle,
    AlertCircle,
    RefreshCw,
    ShieldCheck,
    Save,
    History,
    Key,
    Globe,
    Gift,
} from 'lucide-react';

export const MessagingSettings: React.FC = () => {
    const { user } = useAuthStore();
    const [config, setConfig] = useState<MessagingConfig>(DEFAULT_MESSAGING_CONFIG);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testPhone, setTestPhone] = useState('');
    const [testChannel, setTestChannel] = useState<'WHATSAPP' | 'SMS'>('WHATSAPP');
    const [testing, setTesting] = useState(false);
    const [logs, setLogs] = useState<MessageLogRecord[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);

    useEffect(() => {
        void loadConfigAndLogs();
    }, []);

    const loadConfigAndLogs = async () => {
        setLoading(true);
        try {
            const cfg = await messagingService.getConfig();
            setConfig(cfg);
            await refreshLogs();
        } catch (err: any) {
            showToast('Failed to load messaging settings: ' + err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const refreshLogs = async () => {
        setLoadingLogs(true);
        try {
            const fetched = await messagingService.getLogs({ limit: 15 });
            setLogs(fetched);
        } catch (err) {
            console.warn('Failed to fetch logs:', err);
        } finally {
            setLoadingLogs(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await messagingService.saveConfig(config, user?.id);
            if (res.success) {
                showToast('Messaging configuration saved successfully!', 'success');
            } else {
                showToast(res.error || 'Failed to save messaging configuration.', 'error');
            }
        } catch (err: any) {
            showToast(err.message || 'Save error', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleTestMessage = async () => {
        if (!testPhone.trim()) {
            showToast('Enter a test mobile number first', 'warning');
            return;
        }

        setTesting(true);
        try {
            const testPayload = {
                billNo: 'TEST-1001',
                customerName: 'Test Customer',
                customerPhone: testPhone.trim(),
                items: [
                    { name: 'Formal Cotton Shirt', variantInfo: 'Size 40, Blue', quantity: 1, sellingPrice: 1299, total: 1299 },
                    { name: 'Casual Chino Trouser', variantInfo: 'Size 32, Beige', quantity: 1, sellingPrice: 1499, total: 1499 },
                ],
                subtotal: 2798,
                discount: 200,
                grandTotal: 2598,
                paymentMethod: 'CASH',
                activeStoreCreditBalance: 450,
                activeStoreCreditCodes: ['CN-DEMO'],
                shopName: 'ZAIN GENTS PALACE',
                shopPhone: '9037106449',
                shopAddress: 'CHIRAMMAL TOWER, RAJA ROAD, NILESHWAR',
                gstin: '32PVGPS0686J1ZV',
                forceChannel: testChannel,
            };

            const result = await messagingService.sendInvoice(testPayload);
            if (result.success) {
                if (result.fallback) {
                    showToast(`Test sent via SMS (Recipient does not have WhatsApp account)`, 'warning');
                } else {
                    showToast(`Test message sent successfully via ${result.channel}!`, 'success');
                }
                await refreshLogs();
            } else {
                showToast(`Test dispatch failed: ${result.error}`, 'error');
            }
        } catch (err: any) {
            showToast('Test failed: ' + err.message, 'error');
        } finally {
            setTesting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12 text-gray-500">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Loading messaging settings...
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-200">
            {/* Header & Save Action */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-700 pb-4">
                <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        Customer Messaging & Invoice Notifications
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Send invoices and store credit vouchers to customer phone numbers via WhatsApp with automatic SMS fallback when WhatsApp is not available.
                    </p>
                </div>
                <Button
                    variant="primary"
                    size="sm"
                    disabled={saving}
                    onClick={handleSave}
                    className="flex items-center gap-2"
                >
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving...' : 'Save Messaging Settings'}
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Column: Configuration Controls (7 cols) */}
                <div className="lg:col-span-7 space-y-6">
                    {/* General Settings Card */}
                    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-200 dark:border-dark-border p-6 shadow-2xs space-y-5">
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 border-b border-gray-100 dark:border-dark-border pb-3">
                            <ShieldCheck className="w-4 h-4 text-blue-600" />
                            General Delivery Rules
                        </h3>

                        <div className="space-y-4">
                            {/* Enable Toggle */}
                            <label className="flex items-center justify-between p-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 cursor-pointer">
                                <div>
                                    <div className="font-semibold text-xs text-gray-900 dark:text-white">Enable Invoice Messaging</div>
                                    <div className="text-[11px] text-gray-500">Allow sending digital bills to customer mobile numbers</div>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={config.enabled}
                                    onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                                />
                            </label>

                            {/* Auto-Send on Checkout */}
                            <label className="flex items-center justify-between p-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 cursor-pointer">
                                <div>
                                    <div className="font-semibold text-xs text-gray-900 dark:text-white">Auto-Send on Checkout</div>
                                    <div className="text-[11px] text-gray-500">Automatically send invoice when a customer phone is entered without asking</div>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={config.autoSend}
                                    onChange={(e) => setConfig({ ...config, autoSend: e.target.checked })}
                                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                                />
                            </label>

                            {/* Default Channel Strategy */}
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                                    Delivery Routing Strategy
                                </label>
                                <select
                                    value={config.defaultChannel}
                                    onChange={(e) => setConfig({ ...config, defaultChannel: e.target.value as MessagingStrategy })}
                                    className="w-full h-10 px-3 text-xs bg-white dark:bg-dark-card border border-gray-300 dark:border-dark-border rounded-lg focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="WHATSAPP_FIRST">WhatsApp First (Auto-fallback to SMS if no WhatsApp account) — Recommended</option>
                                    <option value="WHATSAPP_ONLY">WhatsApp Only</option>
                                    <option value="SMS_ONLY">SMS Only</option>
                                </select>
                            </div>

                            {/* Store Credit Balance inclusion */}
                            <label className="flex items-center justify-between p-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 cursor-pointer">
                                <div>
                                    <div className="font-semibold text-xs text-gray-900 dark:text-white flex items-center gap-1.5">
                                        <Gift className="w-3.5 h-3.5 text-indigo-500" />
                                        Include Store Credit Details
                                    </div>
                                    <div className="text-[11px] text-gray-500">Attach customer active credit balance and voucher codes to invoice messages</div>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={config.includeStoreCredit}
                                    onChange={(e) => setConfig({ ...config, includeStoreCredit: e.target.checked })}
                                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                                />
                            </label>

                            {/* Country Code */}
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                    Default Country Calling Code
                                </label>
                                <Input
                                    type="text"
                                    value={config.defaultCountryCode}
                                    onChange={(e) => setConfig({ ...config, defaultCountryCode: e.target.value.replace(/\D/g, '') })}
                                    placeholder="e.g. 91 for India"
                                    className="h-9 text-xs"
                                />
                            </div>
                        </div>
                    </div>

                    {/* WhatsApp Provider Card */}
                    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-200 dark:border-dark-border p-6 shadow-2xs space-y-4">
                        <h3 className="text-sm font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-2 border-b border-gray-100 dark:border-dark-border pb-3">
                            <MessageSquare className="w-4 h-4" />
                            WhatsApp Gateway Settings
                        </h3>

                        <div>
                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                                WhatsApp Provider
                            </label>
                            <select
                                value={config.whatsappProvider}
                                onChange={(e) => setConfig({ ...config, whatsappProvider: e.target.value as WhatsAppProvider })}
                                className="w-full h-10 px-3 text-xs bg-white dark:bg-dark-card border border-gray-300 dark:border-dark-border rounded-lg"
                            >
                                <option value="DIRECT">Direct (WhatsApp Web / App - Free, no API keys needed)</option>
                                <option value="META_API">Meta WhatsApp Cloud API (Official Cloud Graph API)</option>
                                <option value="TWILIO">Twilio WhatsApp</option>
                                <option value="CUSTOM_HTTP">Custom HTTP Webhook / API</option>
                            </select>
                        </div>

                        {config.whatsappProvider === 'META_API' && (
                            <div className="space-y-3 pt-2">
                                <Input
                                    label="Meta Phone Number ID"
                                    value={config.metaPhoneNumberId || ''}
                                    onChange={(e) => setConfig({ ...config, metaPhoneNumberId: e.target.value })}
                                    placeholder="e.g. 104859293847291"
                                    className="h-9 text-xs"
                                />
                                <Input
                                    label="Permanent Access Token"
                                    type="password"
                                    value={config.metaAccessToken || ''}
                                    onChange={(e) => setConfig({ ...config, metaAccessToken: e.target.value })}
                                    placeholder="Bearer EAA..."
                                    className="h-9 text-xs"
                                />
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <Input
                                        label="Template Name (Approved in Meta)"
                                        value={config.metaTemplateName ?? 'tax_invoice'}
                                        onChange={(e) => setConfig({ ...config, metaTemplateName: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                                        placeholder="tax_invoice or hello_world"
                                        className="h-9 text-xs"
                                    />
                                    <Input
                                        label="Template Language Code"
                                        value={config.metaLanguageCode ?? 'en'}
                                        onChange={(e) => setConfig({ ...config, metaLanguageCode: e.target.value })}
                                        placeholder="en or en_US"
                                        className="h-9 text-xs"
                                    />
                                </div>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                    Meta requires an approved Utility template to send bills outside the 24h window. Use <code className="text-emerald-600 font-mono">tax_invoice</code> or <code className="text-emerald-600 font-mono">hello_world</code> for testing.
                                </p>
                            </div>
                        )}

                        {config.whatsappProvider === 'TWILIO' && (
                            <div className="space-y-3 pt-2">
                                <Input
                                    label="Twilio Account SID"
                                    value={config.twilioAccountSid || ''}
                                    onChange={(e) => setConfig({ ...config, twilioAccountSid: e.target.value })}
                                    className="h-9 text-xs"
                                />
                                <Input
                                    label="Twilio Auth Token"
                                    type="password"
                                    value={config.twilioAuthToken || ''}
                                    onChange={(e) => setConfig({ ...config, twilioAuthToken: e.target.value })}
                                    className="h-9 text-xs"
                                />
                                <Input
                                    label="Twilio WhatsApp From (e.g. whatsapp:+14155238886)"
                                    value={config.twilioWhatsappFrom || ''}
                                    onChange={(e) => setConfig({ ...config, twilioWhatsappFrom: e.target.value })}
                                    className="h-9 text-xs"
                                />
                            </div>
                        )}

                        {config.whatsappProvider === 'CUSTOM_HTTP' && (
                            <div className="space-y-3 pt-2">
                                <Input
                                    label="Custom WhatsApp URL (tokens: {phone}, {message})"
                                    value={config.customWhatsappUrl || ''}
                                    onChange={(e) => setConfig({ ...config, customWhatsappUrl: e.target.value })}
                                    placeholder="https://api.gateway.com/send-wa?to={phone}&msg={message}"
                                    className="h-9 text-xs"
                                />
                            </div>
                        )}
                    </div>

                    {/* SMS Provider Card */}
                    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-200 dark:border-dark-border p-6 shadow-2xs space-y-4">
                        <h3 className="text-sm font-bold text-blue-700 dark:text-blue-400 flex items-center gap-2 border-b border-gray-100 dark:border-dark-border pb-3">
                            <Smartphone className="w-4 h-4" />
                            SMS Gateway Settings (Fallback & Direct)
                        </h3>

                        <div>
                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                                SMS Provider
                            </label>
                            <select
                                value={config.smsProvider}
                                onChange={(e) => setConfig({ ...config, smsProvider: e.target.value as SmsProvider })}
                                className="w-full h-10 px-3 text-xs bg-white dark:bg-dark-card border border-gray-300 dark:border-dark-border rounded-lg"
                            >
                                <option value="DIRECT">Direct (Device / System SMS Intent)</option>
                                <option value="FAST2SMS">Fast2SMS (Quick Transactional Route for India)</option>
                                <option value="TWILIO">Twilio SMS</option>
                                <option value="CUSTOM_HTTP">Custom HTTP SMS Gateway (DLT / Provider URL)</option>
                            </select>
                        </div>

                        {config.smsProvider === 'FAST2SMS' && (
                            <div className="space-y-3 pt-2">
                                <Input
                                    label="Fast2SMS API Authorization Key"
                                    type="password"
                                    value={config.fast2smsApiKey || ''}
                                    onChange={(e) => setConfig({ ...config, fast2smsApiKey: e.target.value })}
                                    placeholder="Your Fast2SMS API Key"
                                    className="h-9 text-xs"
                                />
                                <Input
                                    label="Sender ID (Optional, 6 characters)"
                                    value={config.fast2smsSenderId || ''}
                                    onChange={(e) => setConfig({ ...config, fast2smsSenderId: e.target.value.slice(0, 6) })}
                                    placeholder="FTWSMS"
                                    className="h-9 text-xs"
                                />
                            </div>
                        )}

                        {config.smsProvider === 'TWILIO' && (
                            <div className="space-y-3 pt-2">
                                <Input
                                    label="Twilio Account SID"
                                    value={config.twilioAccountSid || ''}
                                    onChange={(e) => setConfig({ ...config, twilioAccountSid: e.target.value })}
                                    className="h-9 text-xs"
                                />
                                <Input
                                    label="Twilio Auth Token"
                                    type="password"
                                    value={config.twilioAuthToken || ''}
                                    onChange={(e) => setConfig({ ...config, twilioAuthToken: e.target.value })}
                                    className="h-9 text-xs"
                                />
                                <Input
                                    label="Twilio SMS From Number"
                                    value={config.twilioSmsFrom || ''}
                                    onChange={(e) => setConfig({ ...config, twilioSmsFrom: e.target.value })}
                                    placeholder="+1234567890"
                                    className="h-9 text-xs"
                                />
                            </div>
                        )}

                        {config.smsProvider === 'CUSTOM_HTTP' && (
                            <div className="space-y-3 pt-2">
                                <div className="flex items-center justify-between">
                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                                        HTTP Request Method
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setConfig({
                                                    ...config,
                                                    customSmsMethod: 'POST',
                                                    customSmsUrl: config.customSmsUrl || 'http://192.168.1.50:8080/message',
                                                    customSmsHeadersJson: config.customSmsHeadersJson || JSON.stringify({
                                                        "Authorization": "Basic " + btoa("admin:password"),
                                                        "Content-Type": "application/json"
                                                    }, null, 2),
                                                    customSmsBodyJson: config.customSmsBodyJson || JSON.stringify({
                                                        "textMessage": { "text": "{message}" },
                                                        "phoneNumbers": ["{e164}"]
                                                    }, null, 2),
                                                });
                                                showToast('Applied Android SMS Gateway template (replace IP & credentials)', 'info');
                                            }}
                                            className="text-[10px] text-blue-600 hover:text-blue-700 font-medium underline"
                                        >
                                            Use Android Gateway Preset
                                        </button>
                                    </div>
                                </div>
                                <select
                                    value={config.customSmsMethod || 'GET'}
                                    onChange={(e) => setConfig({ ...config, customSmsMethod: e.target.value as 'GET' | 'POST' })}
                                    className="w-full h-9 px-3 text-xs bg-white dark:bg-dark-card border border-gray-300 dark:border-dark-border rounded-lg"
                                >
                                    <option value="GET">GET (Query String Parameters in URL)</option>
                                    <option value="POST">POST (JSON Body / REST API)</option>
                                </select>

                                <Input
                                    label="Custom SMS URL (tokens: {phone}, {tenDigit}, {e164}, {message})"
                                    value={config.customSmsUrl || ''}
                                    onChange={(e) => setConfig({ ...config, customSmsUrl: e.target.value })}
                                    placeholder={config.customSmsMethod === 'POST' ? 'http://192.168.1.50:8080/message' : 'http://192.168.1.50:8080/send?to={tenDigit}&msg={message}'}
                                    className="h-9 text-xs"
                                />

                                {config.customSmsMethod === 'POST' && (
                                    <>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                Headers (JSON)
                                            </label>
                                            <textarea
                                                rows={3}
                                                value={config.customSmsHeadersJson || ''}
                                                onChange={(e) => setConfig({ ...config, customSmsHeadersJson: e.target.value })}
                                                placeholder={'{\n  "Authorization": "Basic dXNlcjpwYXNz",\n  "Content-Type": "application/json"\n}'}
                                                className="w-full p-2.5 text-xs font-mono bg-white dark:bg-dark-card border border-gray-300 dark:border-dark-border rounded-lg focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                POST Body Template (JSON with tokens: &#123;phone&#125;, &#123;tenDigit&#125;, &#123;e164&#125;, &#123;message&#125;)
                                            </label>
                                            <textarea
                                                rows={4}
                                                value={config.customSmsBodyJson || ''}
                                                onChange={(e) => setConfig({ ...config, customSmsBodyJson: e.target.value })}
                                                placeholder={'{\n  "textMessage": {\n    "text": "{message}"\n  },\n  "phoneNumbers": ["{e164}"]\n}'}
                                                className="w-full p-2.5 text-xs font-mono bg-white dark:bg-dark-card border border-gray-300 dark:border-dark-border rounded-lg focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Testing & Recent Message Logs (5 cols) */}
                <div className="lg:col-span-5 space-y-6">
                    {/* Test Dispatch Box */}
                    <div className="bg-emerald-50/50 dark:bg-emerald-950/20 rounded-2xl border border-emerald-200 dark:border-emerald-800/80 p-5 space-y-4">
                        <div className="flex items-center gap-2 font-bold text-xs text-emerald-800 dark:text-emerald-300">
                            <Send className="w-4 h-4 text-emerald-600" />
                            <span>Test Live Message Dispatch</span>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                            Send a sample invoice message with store credit info to verify connectivity.
                        </p>

                        <div className="space-y-3">
                            <Input
                                label="Recipient Mobile Number"
                                value={testPhone}
                                onChange={(e) => setTestPhone(e.target.value)}
                                placeholder="e.g. 9876543210"
                                className="h-9 text-xs bg-white dark:bg-dark-card"
                            />

                            <div className="flex items-center gap-2">
                                <select
                                    value={testChannel}
                                    onChange={(e) => setTestChannel(e.target.value as 'WHATSAPP' | 'SMS')}
                                    className="h-9 px-3 text-xs bg-white dark:bg-dark-card border border-gray-300 dark:border-dark-border rounded-lg"
                                >
                                    <option value="WHATSAPP">Test WhatsApp</option>
                                    <option value="SMS">Test SMS</option>
                                </select>

                                <Button
                                    variant="primary"
                                    size="sm"
                                    disabled={testing || !testPhone.trim()}
                                    onClick={handleTestMessage}
                                    className="flex-1 flex items-center justify-center gap-1.5"
                                >
                                    {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                    {testing ? 'Sending...' : 'Send Test'}
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Recent Message Logs Card */}
                    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-200 dark:border-dark-border p-5 shadow-2xs space-y-4">
                        <div className="flex items-center justify-between border-b border-gray-100 dark:border-dark-border pb-3">
                            <h3 className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                                <History className="w-4 h-4 text-gray-500" />
                                Recent Message Logs
                            </h3>
                            <button
                                type="button"
                                onClick={refreshLogs}
                                disabled={loadingLogs}
                                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                title="Refresh Logs"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
                            </button>
                        </div>

                        {logs.length === 0 ? (
                            <div className="text-center py-6 text-xs text-gray-400">
                                No messages dispatched yet. Complete a sale with customer phone to see logs here.
                            </div>
                        ) : (
                            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                                {logs.map((log) => (
                                    <div
                                        key={log.id}
                                        className="p-2.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 text-xs space-y-1"
                                    >
                                        <div className="flex items-center justify-between font-semibold">
                                            <span className="text-gray-900 dark:text-gray-100">
                                                {log.billNo ? `Bill #${log.billNo}` : 'Direct'}
                                            </span>
                                            <span
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                    log.status === 'SENT'
                                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                                        : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                                                }`}
                                            >
                                                {log.status}
                                            </span>
                                        </div>
                                        <div className="text-gray-500 text-[11px] flex items-center justify-between">
                                            <span>{log.customerPhone}</span>
                                            <span className="font-medium text-gray-700 dark:text-gray-300">
                                                {log.channel} ({log.provider})
                                            </span>
                                        </div>
                                        {log.fallback && (
                                            <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                                                ⚠️ Fallback: {log.fallbackReason || 'Switched from WhatsApp to SMS'}
                                            </div>
                                        )}
                                        {log.error && (
                                            <div className="text-[10px] text-red-600 dark:text-red-400">
                                                {log.error}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

