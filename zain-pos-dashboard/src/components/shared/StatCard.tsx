import { type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from "@/components/ui/card"

/**
 * Formats trend percentage value
 * Prevents confusing notation like "-99%+" by capping and clearly showing direction
 */
function formatTrendValue(trend: number): string {
    const absValue = Math.abs(trend);
    
    // For large changes (>99%), show "99%+" without the minus sign
    // The arrow already indicates direction
    if (absValue > 99) {
        return '99%+';
    }
    
    // For normal ranges, show the actual percentage
    return `${absValue.toFixed(1)}%`;
}

interface StatCardProps {
    title: string;
    value: string | number;
    trend?: number;
    trendLabel?: string;
    icon: ReactNode;
    loading?: boolean;
    className?: string;
    variant?: 'default' | 'warning' | 'success';
    subtitle?: string;
}

export function StatCard({ title, value, trend, trendLabel, icon, loading, className, variant = 'default', subtitle }: StatCardProps) {
    if (loading) return <Skeleton className="h-[120px] w-full rounded-xl" />;

    // Smarter trend color logic: only show red/green for significant changes
    let trendColor = 'text-muted-foreground';
    if (trend !== undefined) {
        const absValue = Math.abs(trend);
        if (absValue < 10) {
            // Small change (<10%) - neutral gray
            trendColor = 'text-muted-foreground';
        } else if (absValue < 30) {
            // Moderate change (10-30%) - amber/yellow
            trendColor = trend >= 0 ? 'text-emerald-600' : 'text-amber-600';
        } else {
            // Significant change (>30%) - green/red
            trendColor = trend >= 0 ? 'text-emerald-600' : 'text-rose-600';
        }
    }

    const isPositive = trend !== undefined ? trend >= 0 : false;

    return (
        <Card className={cn(
            "rounded-xl border bg-card text-card-foreground shadow-sm",
            variant === 'warning' && "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20",
            variant === 'success' && "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20",
            className
        )}>
            <CardContent className="p-3 sm:p-4">
                <div className="flex flex-row items-start justify-between gap-1 pb-1.5">
                    <h3 className="tracking-tight text-xs sm:text-sm font-medium text-muted-foreground leading-tight">
                        {title}
                    </h3>
                    <div className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5">
                        {icon}
                    </div>
                </div>
                <div className="flex flex-col">
                    <div className="text-xl sm:text-2xl font-bold leading-tight">{value}</div>
                    {subtitle && !trend && (
                        <p className="text-xs text-muted-foreground mt-1">
                            {subtitle}
                        </p>
                    )}
                    {trend !== undefined && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center">
                            <span className={cn("inline-flex items-center font-medium mr-1", trendColor)}>
                                {isPositive ? <ArrowUpRight className="mr-0.5 h-3 w-3" /> : <ArrowDownRight className="mr-0.5 h-3 w-3" />}
                                {formatTrendValue(trend)}
                            </span>
                            {trendLabel || 'change'}
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
