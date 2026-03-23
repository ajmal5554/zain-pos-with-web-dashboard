import { AlertTriangle, Info, X, ArrowRight, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { type Alert } from '@/hooks/useSmartAlerts';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface AlertBannerProps {
    alerts: Alert[];
}

export function AlertBanner({ alerts }: AlertBannerProps) {
    const [dismissed, setDismissed] = useState<string[]>([]);

    const activeAlerts = alerts.filter(a => !dismissed.includes(a.id));

    if (activeAlerts.length === 0) return null;

    return (
        <div className="flex flex-col gap-2 mb-6">
            {activeAlerts.map(alert => (
                <div
                    key={alert.id}
                    className={cn(
                        "flex items-center justify-between rounded-[1.5rem] border px-5 py-4 shadow-sm",
                        alert.type === 'critical' ? "border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300" :
                            alert.type === 'warning' ? "border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300" :
                                "border-sky-200 bg-sky-50/80 text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-300"
                    )}
                >
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-white/80 dark:bg-slate-950/40">
                            {alert.type === 'critical' ? <ShieldAlert className="w-5 h-5" /> :
                            alert.type === 'warning' ? <AlertTriangle className="w-5 h-5" /> :
                                <Info className="w-5 h-5" />}
                        </div>
                        <div>
                            <span className="mr-2 font-medium">{alert.message}</span>
                            {alert.link && (
                                <Link to={alert.link} className="inline-flex items-center text-sm font-semibold opacity-80 hover:opacity-100">
                                    {alert.action || 'View'} <ArrowRight className="w-3 h-3 ml-1" />
                                </Link>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={() => setDismissed(prev => [...prev, alert.id])}
                        className="rounded-full p-1.5 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                        <span className="sr-only">Dismiss</span>
                        <X className="w-4 h-4 opacity-50" />
                    </button>
                </div>
            ))}
        </div>
    );
}
