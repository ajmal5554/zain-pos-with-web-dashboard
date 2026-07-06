import * as React from 'react';
import {
  TrendingUp,
  ShoppingBag,
  Users,
  Package,
  Banknote,
  Smartphone,
  CreditCard,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useDashboardStats } from '@/features/dashboard/hooks/useDashboardStats';
import { StatCard } from '@/components/shared/StatCard';
import { cn } from '@/lib/utils';
import { useDateFilter } from '@/contexts/DateFilterContext';

const METHOD_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string; badge: string }> = {
    CASH: { label: 'Cash',  icon: Banknote,    color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
    UPI:  { label: 'UPI',   icon: Smartphone,  color: 'text-violet-600 dark:text-violet-400',   bg: 'bg-violet-50 dark:bg-violet-900/20',   badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
    CARD: { label: 'Card',  icon: CreditCard,  color: 'text-blue-600 dark:text-blue-400',       bg: 'bg-blue-50 dark:bg-blue-900/20',       badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
};

export default function DashboardPage() {
    const { stats, loading } = useDashboardStats();
    const { dateRange } = useDateFilter();

    const effectiveGstRate = React.useMemo(() => {
        if (!stats?.summary?.totalSales || !stats?.summary?.totalTax) return 5;
        const netSales = stats.summary.totalSales - stats.summary.totalTax;
        if (netSales <= 0) return 5;
        return Math.round((stats.summary.totalTax / netSales) * 100);
    }, [stats]);

    // Flatten all payment audit transactions into one sorted list
    const allTransactions = React.useMemo(() => {
        if (!stats?.paymentAudit) return [];
        const combined = [
            ...(stats.paymentAudit.CASH ?? []).map((s: any) => ({ ...s, method: 'CASH' })),
            ...(stats.paymentAudit.UPI  ?? []).map((s: any) => ({ ...s, method: 'UPI' })),
            ...(stats.paymentAudit.CARD ?? []).map((s: any) => ({ ...s, method: 'CARD' })),
        ];
        return combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [stats?.paymentAudit]);

    // Chart data — use real trend or fall back to placeholder
    const chartData = stats?.salesTrend?.length
        ? stats.salesTrend
        : [
            { label: 'Mon', sales: 0, orders: 0 },
            { label: 'Tue', sales: 0, orders: 0 },
            { label: 'Wed', sales: 0, orders: 0 },
            { label: 'Thu', sales: 0, orders: 0 },
            { label: 'Fri', sales: 0, orders: 0 },
            { label: 'Sat', sales: 0, orders: 0 },
            { label: 'Sun', sales: 0, orders: 0 },
        ];

    return (
        <div className="flex-1 space-y-4 pt-4 pb-6">
            {/* Page Header */}
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Dashboard ✨ UPDATED</h2>
                <p className="text-muted-foreground text-sm">Your daily shop overview - New version loaded!</p>
            </div>

            {/* Stat Cards — 2 col on mobile, 4 col on desktop */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                    title="Today's Sales"
                    value={`₹${stats?.summary.totalSales.toLocaleString() || '0'}`}
                    subtitle="Total revenue"
                    icon={<TrendingUp className="h-4 w-4" />}
                    loading={loading}
                    variant={(stats?.summary.totalSales || 0) > 0 ? 'success' : 'default'}
                />
                <StatCard
                    title="Total Bills (Today)"
                    value={stats?.summary.totalOrders.toString() || '0'}
                    subtitle={stats?.summary.totalOrders ? `₹${(stats.summary.totalSales / stats.summary.totalOrders).toFixed(0)} avg` : undefined}
                    icon={<ShoppingBag className="h-4 w-4" />}
                    loading={loading}
                />
                <StatCard
                    title="Tax Collected (Today)"
                    value={`₹${stats?.summary?.totalTax?.toLocaleString('en-IN') || '0'}`}
                    subtitle={`GST @ ${effectiveGstRate}% (Effective)`}
                    icon={<Banknote className="h-4 w-4" />}
                    loading={loading}
                />
                <StatCard
                    title="Low Stock Items"
                    value={stats?.lowStock.length.toString() || '0'}
                    subtitle={(stats?.lowStock.length || 0) > 0 ? 'Needs attention' : 'All good'}
                    icon={<Package className="h-4 w-4" />}
                    loading={loading}
                    variant={(stats?.lowStock.length || 0) > 0 ? 'warning' : 'default'}
                />
            </div>

            {/* Sales Chart */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                        {dateRange.label === 'Today' ? 'Sales Today' : `Sales: ${dateRange.label}`}
                    </CardTitle>
                    <CardDescription>
                        {dateRange.label === 'Today' ? 'Hourly sales breakdown' : `Total revenue over ${dateRange.label}`}
                    </CardDescription>
                </CardHeader>
                <CardContent className="h-[220px] pl-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                            <defs>
                                <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%"  stopColor="hsl(var(--primary))" stopOpacity={0.15}/>
                                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                            <XAxis
                                dataKey="label"
                                stroke="#888888"
                                fontSize={11}
                                tickLine={false}
                                axisLine={false}
                                dy={8}
                            />
                            <YAxis
                                stroke="#888888"
                                fontSize={11}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(v) => `₹${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`}
                                width={40}
                            />
                            <Tooltip
                                contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))' }}
                                formatter={(value: any) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Sales']}
                            />
                            <Area
                                type="monotone"
                                dataKey="sales"
                                stroke="hsl(var(--primary))"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorSales)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            {/* Payment method cards — 3 columns on md (Cash / UPI / Card) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(['CASH', 'UPI', 'CARD'] as const).map((method) => {
                    const meta = METHOD_META[method];
                    const Icon = meta.icon;
                    const txList: any[] = stats?.paymentAudit?.[method] ?? [];
                    const total = txList.reduce((s: number, t: any) => s + Number(t.grandTotal ?? 0), 0);
                    return (
                        <Card key={method}>
                            <CardHeader className="pb-2">
                                <div className="flex items-center gap-2">
                                    <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", meta.bg)}>
                                        <Icon className={cn("h-4 w-4", meta.color)} />
                                    </span>
                                    <div>
                                        <CardTitle className="text-sm font-semibold">{meta.label}</CardTitle>
                                        <p className={cn("text-xs font-bold", meta.color)}>
                                            ₹{total.toLocaleString('en-IN')}
                                        </p>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                {loading ? (
                                    <div className="divide-y px-4">
                                        {[1,2,3].map(i => (
                                            <div key={i} className="flex items-center justify-between py-2.5">
                                                <div className="h-3 w-16 bg-muted rounded animate-pulse" />
                                                <div className="h-3 w-12 bg-muted rounded animate-pulse" />
                                            </div>
                                        ))}
                                    </div>
                                ) : txList.length === 0 ? (
                                    <p className="text-xs text-muted-foreground text-center py-6">No {meta.label} sales today</p>
                                ) : (
                                    <div className="divide-y max-h-[280px] overflow-y-auto">
                                        {txList.map((tx: any) => {
                                            const time = new Date(tx.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                                            return (
                                                <div key={tx.id} className="flex items-center justify-between px-4 py-2 hover:bg-muted/30 transition-colors">
                                                    <div>
                                                        <p className="text-xs font-medium">#{tx.billNo ?? tx.id}</p>
                                                        <p className="text-[10px] text-muted-foreground">{time}</p>
                                                    </div>
                                                    <span className="text-xs font-semibold">₹{Number(tx.grandTotal ?? 0).toLocaleString('en-IN')}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* Top Products */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Top Products</CardTitle>
                    <CardDescription>Best selling items this period</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                            {[1,2,3,4,5].map(i => (
                                <div key={i} className="flex flex-col items-center gap-2 p-3 rounded-lg bg-muted/40 animate-pulse">
                                    <div className="h-8 w-8 rounded-md bg-muted" />
                                    <div className="h-3 w-16 bg-muted rounded" />
                                </div>
                            ))}
                        </div>
                    ) : stats?.topProducts?.length ? (
                        <div className="divide-y">
                            {stats.topProducts.slice(0, 5).map((p: any, i: number) => (
                                <div key={i} className="flex items-center gap-3 py-2.5">
                                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground">
                                        {i + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{p.product?.name ?? p.name ?? p.product_name ?? 'Item'}</p>
                                        <p className="text-xs text-muted-foreground">{p.totalQuantity ?? p.total_quantity ?? p.qty ?? '—'} sold</p>
                                    </div>
                                    <div className="text-sm font-semibold shrink-0">
                                        ₹{Number(p.totalRevenue ?? p.total_revenue ?? p.revenue ?? 0).toLocaleString('en-IN')}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground py-4 text-center">No sales data yet</p>
                    )}
                </CardContent>
            </Card>

            {/* Recent Bills */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Recent Bills</CardTitle>
                    <CardDescription>Latest bills in this period</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="divide-y">
                        {loading ? (
                            [1, 2, 3].map((i) => (
                                <div key={i} className="flex items-center gap-3 py-2.5 animate-pulse">
                                    <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
                                    <div className="flex-1 min-w-0 space-y-2">
                                        <div className="h-4 bg-muted rounded w-1/4" />
                                        <div className="h-3 bg-muted rounded w-1/3" />
                                    </div>
                                    <div className="h-4 bg-muted rounded w-16 shrink-0" />
                                </div>
                            ))
                        ) : allTransactions.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-4 text-center">No recent bills found</p>
                        ) : (
                            allTransactions.slice(0, 5).map((tx: any) => {
                                const time = new Date(tx.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                                return (
                                    <div key={tx.id} className="flex items-center gap-3 py-2.5">
                                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                                            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium">Bill #{tx.billNo ?? tx.id}</p>
                                            <p className="text-xs text-muted-foreground">Sold at {time} ({tx.method})</p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-sm font-semibold text-emerald-600">
                                                +₹{Number(tx.grandTotal ?? 0).toLocaleString('en-IN')}
                                            </span>
                                            <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-emerald-700 border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20">
                                                PAID
                                            </Badge>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
