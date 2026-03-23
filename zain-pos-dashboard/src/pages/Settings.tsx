import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { adminService, type AdminSetting } from '@/features/admin/services/admin.service';
import { isDemoModeEnabled } from '@/lib/demo';

const editableKeys = [
    'SHOP_SETTINGS',
    'PAYMENT_METHODS',
    'PRINTER_CONFIG',
    'CLOUD_API_URL',
    'CLOUD_SYNC_CONFIG',
    'BACKUP_CONFIG'
] as const;

export default function SettingsPage() {
    const [settings, setSettings] = useState<AdminSetting[]>([]);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [savingKey, setSavingKey] = useState<string | null>(null);

    useEffect(() => {
        void loadSettings();
    }, []);

    async function loadSettings() {
        try {
            setLoading(true);
            if (isDemoModeEnabled()) return;
            const data = await adminService.getSettings([...editableKeys]);
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
            toast.success(`${key} updated`);
        } catch (error: any) {
            toast.error(error?.response?.data?.error || 'Failed to save setting');
        } finally {
            setSavingKey(null);
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="dashboard-section-title">Settings</h1>
                <p className="dashboard-section-copy">Remote business settings, cloud sync values, and printer/runtime configuration.</p>
            </div>

            {loading ? (
                <div className="dashboard-surface rounded-[1.5rem] px-6 py-16 text-center text-sm text-slate-500 dark:text-slate-400">
                    Loading settings...
                </div>
            ) : (
                <div className="grid gap-6 lg:grid-cols-2">
                    {editableKeys.map((key) => (
                        <Card key={key}>
                            <CardHeader className="border-b border-slate-200/70 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/40">
                                <CardTitle className="text-lg">{key}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4 p-6">
                                <textarea
                                    value={drafts[key] ?? ''}
                                    onChange={(e) => setDrafts((current) => ({ ...current, [key]: e.target.value }))}
                                    className="min-h-[220px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-sm outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-700 dark:focus:ring-sky-950/40"
                                />
                                <div className="flex items-center justify-between gap-4">
                                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                                        Updated {settingsMap.get(key)?.updatedAt ? new Date(settingsMap.get(key)!.updatedAt).toLocaleString() : 'not yet'}
                                    </p>
                                    <Button className="rounded-2xl" onClick={() => void saveSetting(key)} disabled={savingKey === key}>
                                        <Save className="mr-2 h-4 w-4" />
                                        {savingKey === key ? 'Saving...' : 'Save'}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
