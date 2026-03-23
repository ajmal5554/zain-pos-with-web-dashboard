import { useEffect, useState } from 'react';
import { Activity, Search, ShoppingCart, Trash2, User } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import api from '@/lib/api';
import { demoActivityLogs, isDemoModeEnabled } from '@/lib/demo';

interface AuditLog {
    id: string;
    action: string;
    details: string;
    userId: string;
    createdAt: string;
    user?: {
        name: string;
        role: string;
    };
}

export default function ActivityPage() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');

    useEffect(() => {
        void fetchLogs();
    }, []);

    const fetchLogs = async () => {
        try {
            setLoading(true);

            if (isDemoModeEnabled()) {
                setLogs(demoActivityLogs);
                return;
            }

            const response = await api.get('/activity');
            setLogs(response.data);
        } catch (error) {
            console.error('Failed to fetch activity logs:', error);
        } finally {
            setLoading(false);
        }
    };

    const getIcon = (action: string) => {
        if (action.includes('DELETE') || action.includes('VOID')) return <Trash2 className="text-rose-500" />;
        if (action.includes('SALE')) return <ShoppingCart className="text-emerald-500" />;
        if (action.includes('USER')) return <User className="text-sky-500" />;
        return <Activity className="text-slate-500" />;
    };

    const filteredLogs = logs.filter((log) =>
        log.details.toLowerCase().includes(filter.toLowerCase()) ||
        log.action.toLowerCase().includes(filter.toLowerCase()) ||
        (log.user?.name || '').toLowerCase().includes(filter.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <div>
                <h1 className="dashboard-section-title">Activity Log</h1>
                <p className="dashboard-section-copy">System events, user actions, and exception signals in a single stream.</p>
            </div>

            <Card>
                <CardContent className="p-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search logs"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-700 dark:focus:ring-sky-950/40"
                        />
                    </div>
                </CardContent>
            </Card>

            {loading ? (
                <div className="dashboard-surface rounded-[1.5rem] px-6 py-16 text-center text-sm text-slate-500 dark:text-slate-400">
                    Loading activity...
                </div>
            ) : filteredLogs.length > 0 ? (
                <div className="space-y-4">
                    {filteredLogs.map((log) => (
                        <Card key={log.id} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                            <CardContent className="flex items-start gap-4 p-5">
                                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-900">
                                    {getIcon(log.action)}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                                        <h3 className="font-semibold text-slate-950 dark:text-slate-100">
                                            {log.action.replace(/_/g, ' ')}
                                        </h3>
                                        <span className="text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                                            {new Date(log.createdAt).toLocaleString()}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{log.details}</p>
                                    <div className="mt-3 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                        <User className="h-3.5 w-3.5" />
                                        <span>{log.user?.name || 'Unknown User'} / {log.user?.role || 'System'}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : (
                <div className="dashboard-surface rounded-[1.5rem] px-6 py-16 text-center text-sm text-slate-500 dark:text-slate-400">
                    No logs found matching your filter.
                </div>
            )}
        </div>
    );
}
