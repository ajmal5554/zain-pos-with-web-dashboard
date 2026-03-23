import { type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface StatCardProps {
    title: string;
    value: string | number;
    trend?: number;
    trendLabel?: string;
    icon: ReactNode;
    loading?: boolean;
    className?: string;
}

export function StatCard({ title, value, trend, trendLabel, icon, loading, className }: StatCardProps) {
    if (loading) return <Skeleton className="h-36 w-full rounded-[1.5rem]" />;

    const isPositive = trend !== undefined ? trend >= 0 : false;

    return (
        <Card className={cn("group h-full overflow-hidden border-slate-200/90 transition-all duration-300 hover:border-slate-300 hover:shadow-[0_30px_60px_-32px_rgba(15,23,42,0.18)] dark:hover:border-slate-700", className)}>
            <CardContent className="flex min-h-[146px] flex-col justify-between p-6">
                <div className="flex items-start justify-between gap-4">
                    <p className="min-h-[44px] max-w-[70%] text-xs font-semibold uppercase leading-5 tracking-[0.24em] text-slate-400 dark:text-slate-500">
                        {title}
                    </p>
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition-transform duration-300 group-hover:scale-105 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                        {icon}
                    </div>
                </div>

                <div>
                    <h3 className="truncate text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{value}</h3>

                    {trend !== undefined && (
                        <div className="mt-4 flex items-center text-xs">
                            <span className={cn(
                                "flex items-center rounded-full px-2.5 py-1 font-semibold",
                                isPositive
                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                                    : "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"
                            )}>
                                {isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                                {Math.abs(trend)}%
                            </span>
                            <span className="ml-2 text-slate-400 dark:text-slate-500">{trendLabel}</span>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
