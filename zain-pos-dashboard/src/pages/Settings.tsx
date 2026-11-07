import { useEffect, useMemo, useState } from 'react';
import { Save, Store, CreditCard, RefreshCw, Server, Sparkles, CheckCircle2, ShieldCheck, Tag } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { adminService, type AdminSetting } from '@/features/admin/services/admin.service';
import { isDemoModeEnabled, demoSettings } from '@/lib/demo';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { VersionInfo } from '@/components/settings/VersionInfo';

const editableKeys = [
    'SHOP_SETTINGS',
    'PAYMENT_METHODS',
    'PRINTER_CONFIG',
    'CLOUD_API_URL',
    'CLOUD_SYNC_CONFIG',
    'BACKUP_CONFIG'
] as const;

type MainTab = 'shop' | 'payments' | 'version' | 'advanced';

interface ShopSettingsState {
    shopName: string;
    address: string;
    phone: string;
    gstin: string;
}

interface PaymentMethodsState {
    CASH: boolean;
    UPI: boolean;
    CARD: boolean;
    SPLIT: boolean;
}

const defaultShopSettings: ShopSettingsState = {
    shopName: 'ZAIN GENTS PALACE',
    address: 'CHIRAMMAL TOWER, BEHIND CANARA BANK\nRAJA ROAD, NILESHWAR',
    phone: '9037106449, 7907026827',
    gstin: '32PVGPS0686J1ZV',
};

const defaultPaymentMethods: PaymentMethodsState = {
    CASH: true,
    UPI: true,
    CARD: true,
    SPLIT: true,
};

export default function SettingsPage() {
    const [settings, setSettings] = useState<AdminSetting[]>([]);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [savingKey, setSavingKey] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<MainTab>('shop');

    useEffect(() => {
        void loadSettings();
    }, []);

    async function loadSettings() {
        try {
            setLoading(true);
            if (isDemoModeEnabled()) {
                setSettings(demoSettings);
                setDrafts(Object.fromEntries(demoSettings.map((s) => [s.key, s.value])));
                return;
            }
            const data = await adminService.getSettings([...editableKeys]);
            setSettings(data);
            setDrafts(Object.fromEntries(data.map((setting) => [setting.key, setting.value])));
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to load settings');
        } finally {
            setLoading(false);
        }
    }

    const shopSettings = useMemo<ShopSettingsState>(() => {
        try {
            const raw = drafts['SHOP_SETTINGS'];
            if (raw) return { ...defaultShopSettings, ...JSON.parse(raw) };
        } catch {}
        return defaultShopSettings;
    }, [drafts]);

    const paymentMethods = useMemo<PaymentMethodsState>(() => {
        try {
            const raw = drafts['PAYMENT_METHODS'];
            if (raw) return { ...defaultPaymentMethods, ...JSON.parse(raw) };
        } catch {}
        return defaultPaymentMethods;
    }, [drafts]);

    async function saveSetting(key: string, valueToSave?: string) {
        const val = valueToSave ?? drafts[key] ?? '';
        if (isDemoModeEnabled()) {
            setDrafts((prev) => ({ ...prev, [key]: val }));
            toast.success('Simulation: Setting saved locally.');
            return;
        }
        try {
            setSavingKey(key);
            const updated = await adminService.setSetting(key, val);
            setSettings((current) => {
                const existing = current.find((item) => item.key === key);
                if (existing) {
                    return current.map((item) => item.key === key ? updated : item);
                }
                return [...current, updated];
            });
            setDrafts((prev) => ({ ...prev, [key]: updated.value }));
            toast.success('Settings saved successfully');
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to save setting');
        } finally {
            setSavingKey(null);
        }
    }

    const handleUpdateShop = (field: keyof ShopSettingsState, value: string) => {
        const updated = { ...shopSettings, [field]: value };
        setDrafts((prev) => ({ ...prev, SHOP_SETTINGS: JSON.stringify(updated, null, 2) }));
    };

    const handleTogglePaymentMethod = (key: keyof PaymentMethodsState) => {
        const updated = { ...paymentMethods, [key]: !paymentMethods[key] };
        const jsonStr = JSON.stringify(updated, null, 2);
        setDrafts((prev) => ({ ...prev, PAYMENT_METHODS: jsonStr }));
        void saveSetting('PAYMENT_METHODS', jsonStr);
    };

    if (loading) {
        return (
            <div className="flex-1 space-y-4 pb-12">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
                        <p className="text-muted-foreground text-sm">Manage store configuration and preferences.</p>
                    </div>
                </div>
                <div className="flex justify-center p-12 text-muted-foreground animate-pulse">
                    Loading settings...
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 space-y-6 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
                    <p className="text-muted-foreground text-sm">
                        Manage store details, accepted tender options, cloud connections, and release notes.
                    </p>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 border-b pb-2 overflow-x-auto">
                <Button
                    variant={activeTab === 'shop' ? 'default' : 'ghost'}
                    size="sm"
                    className="gap-2 rounded-xl"
                    onClick={() => setActiveTab('shop')}
                >
                    <Store className="w-4 h-4" />
                    Store Details
                </Button>
                <Button
                    variant={activeTab === 'payments' ? 'default' : 'ghost'}
                    size="sm"
                    className="gap-2 rounded-xl"
                    onClick={() => setActiveTab('payments')}
                >
                    <CreditCard className="w-4 h-4" />
                    Payment Options
                </Button>
                <Button
                    variant={activeTab === 'version' ? 'default' : 'ghost'}
                    size="sm"
                    className="gap-2 rounded-xl"
                    onClick={() => setActiveTab('version')}
                >
                    <Sparkles className="w-4 h-4" />
                    System Version
                </Button>
                <Button
                    variant={activeTab === 'advanced' ? 'default' : 'ghost'}
                    size="sm"
                    className="gap-2 rounded-xl"
                    onClick={() => setActiveTab('advanced')}
                >
                    <Server className="w-4 h-4" />
                    Cloud & Config
                </Button>
            </div>

            {/* Tab: Store Details */}
            {activeTab === 'shop' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card className="rounded-2xl">
                        <CardHeader>
                            <CardTitle className="text-lg font-bold flex items-center gap-2">
                                <Store className="w-5 h-5 text-primary" />
                                Store Identity & Contact
                            </CardTitle>
                            <CardDescription>
                                This information is printed on thermal receipts and included in digital invoices.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="shopName">Store Name</Label>
                                <Input
                                    id="shopName"
                                    value={shopSettings.shopName}
                                    onChange={(e) => handleUpdateShop('shopName', e.target.value)}
                                    placeholder="e.g. ZAIN GENTS PALACE"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="phone">Phone / Mobile</Label>
                                <Input
                                    id="phone"
                                    value={shopSettings.phone}
                                    onChange={(e) => handleUpdateShop('phone', e.target.value)}
                                    placeholder="e.g. 9037106449, 7907026827"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="gstin">GSTIN</Label>
                                <Input
                                    id="gstin"
                                    value={shopSettings.gstin}
                                    onChange={(e) => handleUpdateShop('gstin', e.target.value)}
                                    placeholder="e.g. 32PVGPS0686J1ZV"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="address">Address</Label>
                                <textarea
                                    id="address"
                                    rows={3}
                                    value={shopSettings.address}
                                    onChange={(e) => handleUpdateShop('address', e.target.value)}
                                    className="w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    placeholder="Store physical location"
                                />
                            </div>

                            <Button
                                className="w-full gap-2 rounded-xl mt-2"
                                disabled={savingKey === 'SHOP_SETTINGS'}
                                onClick={() => void saveSetting('SHOP_SETTINGS')}
                            >
                                <Save className="w-4 h-4" />
                                {savingKey === 'SHOP_SETTINGS' ? 'Saving...' : 'Save Store Details'}
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="rounded-2xl bg-slate-50/50 dark:bg-slate-900/50 border-dashed">
                        <CardHeader>
                            <CardTitle className="text-base font-bold">Store Profile Summary</CardTitle>
                            <CardDescription>Preview of business credentials declared to customers</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4 text-sm">
                            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                                <p className="font-bold text-base text-slate-900 dark:text-white">
                                    {shopSettings.shopName || 'Store Name Not Set'}
                                </p>
                                <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">
                                    {shopSettings.address || 'Address not configured'}
                                </p>
                                <div className="pt-2 flex flex-wrap gap-3 text-xs text-muted-foreground border-t border-slate-100 dark:border-slate-800">
                                    <span>📞 {shopSettings.phone || 'No phone'}</span>
                                    <span>🏷️ GSTIN: {shopSettings.gstin || 'Not registered'}</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Tab: Payment Options */}
            {activeTab === 'payments' && (
                <div className="max-w-2xl space-y-4">
                    <Card className="rounded-2xl">
                        <CardHeader>
                            <CardTitle className="text-lg font-bold flex items-center gap-2">
                                <CreditCard className="w-5 h-5 text-primary" />
                                Accepted Payment Methods
                            </CardTitle>
                            <CardDescription>
                                Toggle accepted tender methods. Changes synchronize instantly across Dashboard payment audits and reports.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                                <div>
                                    <h4 className="font-semibold text-sm">Cash Tender</h4>
                                    <p className="text-xs text-muted-foreground">Standard physical currency collection</p>
                                </div>
                                <Switch
                                    checked={paymentMethods.CASH}
                                    onCheckedChange={() => handleTogglePaymentMethod('CASH')}
                                />
                            </div>

                            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                                <div>
                                    <h4 className="font-semibold text-sm">UPI / QR Code</h4>
                                    <p className="text-xs text-muted-foreground">Instant digital mobile payment via Google Pay, PhonePe, Paytm</p>
                                </div>
                                <Switch
                                    checked={paymentMethods.UPI}
                                    onCheckedChange={() => handleTogglePaymentMethod('UPI')}
                                />
                            </div>

                            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                                <div>
                                    <h4 className="font-semibold text-sm">Card Swipe / POS Terminal</h4>
                                    <p className="text-xs text-muted-foreground">Debit and credit card payments</p>
                                </div>
                                <Switch
                                    checked={paymentMethods.CARD}
                                    onCheckedChange={() => handleTogglePaymentMethod('CARD')}
                                />
                            </div>

                            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                                <div>
                                    <h4 className="font-semibold text-sm">Split Tender</h4>
                                    <p className="text-xs text-muted-foreground">Allow customers to pay partially with Cash and balance with UPI or Store Credit</p>
                                </div>
                                <Switch
                                    checked={paymentMethods.SPLIT}
                                    onCheckedChange={() => handleTogglePaymentMethod('SPLIT')}
                                />
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Tab: Version Info */}
            {activeTab === 'version' && (
                <VersionInfo />
            )}

            {/* Tab: Cloud & Advanced */}
            {activeTab === 'advanced' && (
                <div className="space-y-6">
                    <Card className="rounded-2xl">
                        <CardHeader>
                            <CardTitle className="text-lg font-bold flex items-center gap-2">
                                <Server className="w-5 h-5 text-primary" />
                                Cloud API & Advanced Configurations
                            </CardTitle>
                            <CardDescription>
                                Raw configuration parameters synchronized with the desktop POS and cloud database.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {editableKeys.map((key) => (
                                <div key={key} className="space-y-2 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                                    <div className="flex items-center justify-between">
                                        <Label className="font-mono text-sm font-semibold">{key}</Label>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={savingKey === key}
                                            onClick={() => void saveSetting(key)}
                                        >
                                            {savingKey === key ? 'Saving...' : 'Save'}
                                        </Button>
                                    </div>
                                    <textarea
                                        rows={4}
                                        value={drafts[key] ?? ''}
                                        onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                                        className="w-full font-mono text-xs rounded-md border border-input bg-muted/40 p-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    />
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
