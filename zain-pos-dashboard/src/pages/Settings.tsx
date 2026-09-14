import { useEffect, useMemo, useState } from 'react';
import { Save, Store, CreditCard, Printer, Cloud, RefreshCw, Database, Server, Sparkles } from 'lucide-react';
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
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';

const editableKeys = [
    'APPEARANCE',
    'SHOP_SETTINGS',
    'PAYMENT_METHODS',
    'PRINTER_CONFIG',
    'CLOUD_API_URL',
    'CLOUD_SYNC_CONFIG',
    'BACKUP_CONFIG'
] as const;

type SettingKey = typeof editableKeys[number];

const settingMeta: Record<SettingKey, { icon: React.ElementType, title: string, desc: string }> = {
    APPEARANCE: { icon: Sparkles, title: 'Appearance & UI', desc: 'Personalize the visual theme, liquid glass aesthetics, and display modes.' },
    SHOP_SETTINGS: { icon: Store, title: 'Store Details', desc: 'Manage your store name, address, and contact info.' },
    PAYMENT_METHODS: { icon: CreditCard, title: 'Payment Options', desc: 'Configure accepted payment methods at checkout.' },
    PRINTER_CONFIG: { icon: Printer, title: 'Receipt Printer', desc: 'Setup physical receipt printer integrations.' },
    CLOUD_API_URL: { icon: Server, title: 'API Endpoint', desc: 'Target endpoint for backend cloud integration.' },
    CLOUD_SYNC_CONFIG: { icon: Cloud, title: 'Cloud Sync', desc: 'Manage real-time synchronization settings.' },
    BACKUP_CONFIG: { icon: Database, title: 'Data Backup', desc: 'Automated database backup routines and schedules.' },
};

function isJsonObj(str: string) {
    try {
        const parsed = JSON.parse(str);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
    } catch {
        return false;
    }
}

export default function SettingsPage() {
    const { isLiquidGlass, setIsLiquidGlass } = useTheme();
    const [settings, setSettings] = useState<AdminSetting[]>([]);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [savingKey, setSavingKey] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<SettingKey>('APPEARANCE');

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
            const serverKeys = editableKeys.filter((k) => k !== 'APPEARANCE');
            const data = await adminService.getSettings([...serverKeys]);
            setSettings(data);
            setDrafts(Object.fromEntries(data.map((setting) => [setting.key, setting.value])));
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to load settings');
        } finally {
            setLoading(false);
        }
    }

    const settingsMap = useMemo(() => new Map(settings.map((setting) => [setting.key, setting])), [settings]);

    async function saveSetting(key: string) {
        if (key === 'APPEARANCE') {
            toast.success('Appearance preferences updated');
            return;
        }
        if (isDemoModeEnabled()) {
            toast.success('Simulation: Setting saved locally.');
            return;
        }
        try {
            setSavingKey(key);
            const updated = await adminService.setSetting(key, drafts[key] ?? '');
            setSettings((current) => {
                const existing = current.find((item) => item.key === key);
                if (existing) {
                    return current.map((item) => item.key === key ? updated : item);
                }
                return [...current, updated];
            });
            toast.success(`${settingMeta[key as SettingKey].title} updated`);
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to save setting');
        } finally {
            setSavingKey(null);
        }
    }

    const handleObjectChange = (key: string, field: string, value: any) => {
        try {
            const currentObj = JSON.parse(drafts[key] || '{}');
            const newObj = { ...currentObj, [field]: value };
            setDrafts((prev) => ({ ...prev, [key]: JSON.stringify(newObj, null, 2) }));
        } catch (e) {
            // fallback
        }
    };

    if (loading) {
        return (
            <div className="flex-1 space-y-4 pb-12">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
                        <p className="text-muted-foreground text-sm">Manage system configurations and options.</p>
                    </div>
                </div>
                <div className="flex justify-center p-12 text-muted-foreground animate-pulse">
                    Loading configuration...
                </div>
            </div>
        );
    }

    const activeDraft = drafts[activeTab] ?? '';
    const isJson = isJsonObj(activeDraft);
    const activeMeta = settingMeta[activeTab];
    const ActiveIcon = activeMeta.icon;
    
    let parsedObj: Record<string, any> = {};
    if (isJson) {
        try { parsedObj = JSON.parse(activeDraft); } catch (e) { }
    }

    return (
        <div className="flex flex-col flex-1 space-y-6 pb-12 max-w-6xl mx-auto w-full">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
                <p className="text-muted-foreground text-sm">
                    Manage system configurations, appearance, and integrations.
                </p>
            </div>

            <div className="flex flex-col md:flex-row gap-6 lg:gap-8 items-start">
                {/* Vertical Sidebar Navigation */}
                <aside className="w-full md:w-64 shrink-0 px-1 space-y-1">
                    {editableKeys.map((key) => {
                        const meta = settingMeta[key];
                        const Icon = meta.icon;
                        const isActive = activeTab === key;
                        return (
                            <button
                                key={key}
                                onClick={() => setActiveTab(key)}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left",
                                    isActive 
                                        ? "bg-primary/10 text-primary" 
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                )}
                            >
                                <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
                                <span>{meta.title}</span>
                            </button>
                        );
                    })}
                </aside>

                {/* Main Content Area */}
                <main className="flex-1 w-full min-w-0">
                    <Card className="border-slate-200/60 shadow-sm dark:border-slate-800">
                        <CardHeader className="bg-muted/30 border-b pb-6">
                            <div className="flex items-center gap-3 pb-2">
                                <div className="p-2 rounded-md bg-background border shadow-sm">
                                    <ActiveIcon className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-lg">{activeMeta.title}</CardTitle>
                                    <CardDescription className="mt-1">{activeMeta.desc}</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-6 md:p-8 space-y-8">
                            {activeTab === 'APPEARANCE' ? (
                                <div className="space-y-6">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border border-slate-200/80 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50 transition-all">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-base">iOS Liquid Glass Theme</span>
                                                {isLiquidGlass ? (
                                                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                                                        Active
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-slate-200/60 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                                        Off
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-muted-foreground max-w-xl">
                                                Enable visionOS & iOS-inspired translucent acrylic glass surfaces, specular border highlights, and fluid ambient refractions across the entire dashboard.
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-medium text-muted-foreground">
                                                {isLiquidGlass ? 'Enabled' : 'Disabled'}
                                            </span>
                                            <Switch
                                                checked={isLiquidGlass}
                                                onCheckedChange={(val) => {
                                                    setIsLiquidGlass(val);
                                                    toast.success(val ? 'iOS Liquid Glass turned ON' : 'iOS Liquid Glass turned OFF');
                                                }}
                                            />
                                        </div>
                                    </div>

                                    {/* Live Theme Preview */}
                                    <div className="p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-background/50 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                                Live Theme Preview
                                            </h4>
                                            <span className="text-xs text-muted-foreground">
                                                {isLiquidGlass ? 'Translucent glass active' : 'Classic solid mode active'}
                                            </span>
                                        </div>
                                        <div className="grid sm:grid-cols-2 gap-4">
                                            <div className="p-4 rounded-xl border bg-card text-card-foreground shadow-sm space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-sm font-semibold">Today's Sales</span>
                                                    <Sparkles className="h-4 w-4 text-primary" />
                                                </div>
                                                <div className="text-2xl font-bold">₹1,725</div>
                                                <p className="text-xs text-muted-foreground">Frosted glass refraction preview</p>
                                            </div>
                                            <div className="p-4 rounded-xl border bg-card text-card-foreground shadow-sm space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-sm font-semibold">Terminal Status</span>
                                                    <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                                                </div>
                                                <div className="text-2xl font-bold">Connected</div>
                                                <p className="text-xs text-muted-foreground">Real-time sync active</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : isJson ? (
                                <div className="space-y-6 max-w-2xl">
                                    {Object.entries(parsedObj).map(([fieldKey, fieldValue]) => {
                                        const labelName = fieldKey === fieldKey.toUpperCase() 
                                            ? fieldKey.replace(/_/g, ' ') 
                                            : fieldKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();

                                        if (typeof fieldValue === 'boolean') {
                                            return (
                                                <div key={fieldKey} className="flex items-center justify-between py-3 px-4 rounded-lg bg-muted/40 border">
                                                    <div className="space-y-0.5">
                                                        <Label htmlFor={`${activeTab}-${fieldKey}`} className="text-sm font-medium">{labelName}</Label>
                                                        <p className="text-xs text-muted-foreground">Enable or disable {labelName.toLowerCase()} across the system.</p>
                                                    </div>
                                                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                                        <input 
                                                            type="checkbox" 
                                                            className="sr-only peer"
                                                            checked={fieldValue}
                                                            onChange={(e) => handleObjectChange(activeTab, fieldKey, e.target.checked)}
                                                            id={`${activeTab}-${fieldKey}`}
                                                        />
                                                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-primary"></div>
                                                    </label>
                                                </div>
                                            )
                                        }
                                        return (
                                            <div key={fieldKey} className="grid gap-2 relative">
                                                <Label htmlFor={`${activeTab}-${fieldKey}`} className="text-sm font-semibold text-foreground/80">{labelName}</Label>
                                                <Input 
                                                    id={`${activeTab}-${fieldKey}`}
                                                    value={String(fieldValue)}
                                                    className="max-w-xl transition-all border-slate-200 shadow-none focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:border-primary/40"
                                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                                        const val = typeof fieldValue === 'number' ? Number(e.target.value) : e.target.value;
                                                        handleObjectChange(activeTab, fieldKey, val);
                                                    }}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="space-y-2 max-w-3xl">
                                    <Label className="text-sm font-semibold text-foreground/80">Raw Configuration Value</Label>
                                    <textarea
                                        value={activeDraft}
                                        onChange={(e) => setDrafts((current) => ({ ...current, [activeTab]: e.target.value }))}
                                        className="w-full min-h-[300px] font-mono rounded-lg border border-slate-200 bg-muted/20 px-4 py-3 text-sm shadow-inner placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:border-primary/40 dark:border-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                        spellCheck={false}
                                    />
                                    <p className="text-xs text-muted-foreground mt-2">
                                        This configuration accepts structured string data. Please ensure exact syntax before saving.
                                    </p>
                                </div>
                            )}

                            {activeTab !== 'APPEARANCE' && (
                                <div className="flex items-center justify-between pt-6 border-t mt-8">
                                    <div className="text-xs text-muted-foreground">
                                        {settingsMap.get(activeTab)?.updatedAt ? `Last saved on ${new Date(settingsMap.get(activeTab)!.updatedAt).toLocaleString()}` : 'Default configuration loaded'}
                                    </div>
                                    <Button 
                                        onClick={() => void saveSetting(activeTab)} 
                                        disabled={savingKey === activeTab}
                                        className="min-w-[140px] font-semibold tracking-wide shadow-sm"
                                    >
                                        {savingKey === activeTab ? (
                                            <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
                                        ) : (
                                            <><Save className="mr-2 h-4 w-4" /> Save Changes</>
                                        )}
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </main>
            </div>
        </div>
    );
}
