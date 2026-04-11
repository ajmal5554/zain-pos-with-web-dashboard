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
        <div className="flex flex-col gap-3 mb-8">
            {activeAlerts.map(alert => (
                <div
                    key={alert.id}
                    className={cn(
                        "rounded-xl px-5 py-4 flex items-center justify-between border shadow-sm transition-all animate-fade-in",
                        alert.type === 'critical' ? "alert-soft" :
                        alert.type === 'warning' ? "alert-warning" :
                        "bg-[#F0F9FF] border-[#B9E6FE] text-[#026AA2]"
                    )}
                >
                    <div className="flex items-center gap-4">
                        <div className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm bg-white/60 dark:bg-slate-900/40",
                        )}>
                            {alert.type === 'critical' ? <ShieldAlert className="w-5 h-5" /> :
                            alert.type === 'warning' ? <AlertTriangle className="w-5 h-5" /> :
                                <Info className="w-5 h-5" />}
                        </div>
                        <div className="flex flex-col md:flex-row md:items-center gap-x-3 gap-y-0.5">
                            <span className="font-bold text-sm tracking-tight">{alert.message}</span>
                            {alert.link && (
                                <Link to={alert.link} className="inline-flex items-center text-xs font-bold underline underline-offset-4 opacity-80 hover:opacity-100 transition-opacity">
                                    {alert.action || 'Take Action'} <ArrowRight className="w-3 h-3 ml-1" />
                                </Link>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={() => setDismissed(prev => [...prev, alert.id])}
                        className="rounded-lg p-1 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    >
                        <X className="w-4 h-4 opacity-60" />
                    </button>
                </div>
            ))}
        </div>
    );
}
