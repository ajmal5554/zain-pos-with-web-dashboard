import {
    AlertTriangle,
    BadgeIndianRupee,
    Boxes,
    ShoppingBag,
    TrendingUp
} from 'lucide-react';
import {
    CartesianGrid,
    Line,
    LineChart,
    Tooltip,
    XAxis,
    YAxis
} from 'recharts';
import { StatCard } from '@/components/shared/StatCard';
import { ChartWidget } from '@/components/shared/ChartWidget';
import { useDashboardStats } from '@/features/dashboard/hooks/useDashboardStats';
import { useSmartAlerts } from '@/hooks/useSmartAlerts';
import { AlertBanner } from '@/components/shared/AlertBanner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/format';

export default function Dashboard() {
    const { stats, loading, error, refetch } = useDashboardStats();
    const { alerts } = useSmartAlerts();

    const summary = stats?.summary || { totalSales: 0, totalOrders: 0, averageOrderValue: 0 };
    const salesTrend = stats?.salesTrend || [];
    const topProducts = stats?.topProducts || [];
    const paymentAudit = stats?.paymentAudit || { CASH: [], UPI: [], CARD: [] };
    const lowStockCount = stats?.lowStock?.length || 0;

    return (
        <div className="space-y-6">
            <section className="dashboard-surface rounded-[2rem] p-6 lg:p-7">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-2xl">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
                            Today
                        </p>
                        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white lg:text-[2.6rem]">
                            Store performance at a glance.
                        </h1>
                        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                            Sales, orders, low-stock pressure, and product winners without jumping between pages.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm lg:min-w-[320px]">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Revenue</p>
                            <p className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">{formatCurrency(summary.totalSales)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Orders</p>
                            <p className="mt-2 text-xl font-semibold">{summary.totalOrders}</p>
                        </div>
                    </div>
                </div>
            </section>

            <AlertBanner alerts={alerts} />

            {error && (
                <div className="dashboard-surface rounded-[1.5rem] p-4">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3 text-rose-700 dark:text-rose-300">
                            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                            <span className="truncate text-sm font-medium">{error}</span>
                        </div>
                        <button
                            onClick={refetch}
                            className="rounded-full bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-300"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard
                    title="Total Sales"
                    value={formatCurrency(summary.totalSales)}
                    icon={<BadgeIndianRupee className="h-[18px] w-[18px] stroke-[1.9]" />}
                    loading={loading}
                />
                <StatCard
                    title="Orders"
                    value={summary.totalOrders}
                    icon={<ShoppingBag className="h-[18px] w-[18px] stroke-[1.9]" />}
                    loading={loading}
                />
                <StatCard
                    title="Avg Order Value"
                    value={formatCurrency(summary.averageOrderValue)}
                    icon={<TrendingUp className="h-[18px] w-[18px] stroke-[1.9]" />}
                    loading={loading}
                />
                <StatCard
                    title="Low Stock"
                    value={lowStockCount}
                    icon={<Boxes className="h-[18px] w-[18px] stroke-[1.9]" />}
                    loading={loading}
                />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr]">
                <ChartWidget title="Sales Trend" loading={loading}>
                    <LineChart data={salesTrend}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                        <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis
                            stroke="#94a3b8"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => formatCurrency(value).replace('.00', '')}
                        />
                        <Tooltip
                            formatter={(value: number) => [formatCurrency(value), 'Sales']}
                            labelStyle={{ color: '#334155' }}
                            contentStyle={{
                                borderRadius: '18px',
                                border: '1px solid rgba(148,163,184,0.2)',
                                boxShadow: '0 24px 60px -36px rgba(15,23,42,0.45)'
                            }}
                        />
                        <Line
                            type="monotone"
                            dataKey="sales"
                            stroke="#0ea5e9"
                            strokeWidth={3}
                            dot={{ fill: '#0ea5e9', strokeWidth: 0, r: 4 }}
                            activeDot={{ r: 6 }}
                        />
                    </LineChart>
                </ChartWidget>

                <Card className="h-[380px] overflow-hidden">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-xl">Top Selling Products</CardTitle>
                    </CardHeader>
                    <CardContent className="flex h-[calc(100%-5.5rem)] flex-col gap-3 overflow-y-auto">
                        {loading ? (
                            [1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />)
                        ) : topProducts.length > 0 ? (
                            topProducts.map((item, index) => (
                                <div key={index} className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-sky-400 dark:text-slate-950">
                                            <Boxes className="h-[18px] w-[18px] stroke-[1.9]" />
                                        </div>
                                        <div>
                                            <p className="font-medium text-slate-900 dark:text-slate-100">{item.product.name}</p>
                                            <p className="text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                                                {item.totalQuantity} units sold
                                            </p>
                                        </div>
                                    </div>
                                    <p className="font-semibold text-slate-950 dark:text-slate-100">
                                        {formatCurrency(item.totalRevenue)}
                                    </p>
                                </div>
                            ))
                        ) : (
                            <div className="flex h-full flex-col items-center justify-center text-center text-slate-400 dark:text-slate-500">
                                <Boxes className="mb-3 h-12 w-12 opacity-30" />
                                <p className="text-sm font-medium">No sales data yet</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="pb-4">
                    <CardTitle className="text-xl">Audit by Payment Mode</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                        {(['CASH', 'UPI', 'CARD'] as const).map((mode) => {
                            const transactions = paymentAudit[mode] || [];
                            const total = transactions.reduce((sum: number, item: { grandTotal: number }) => sum + item.grandTotal, 0);

                            return (
                                <div key={mode} className="overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/50">
                                    <div className={cn(
                                        'flex items-center justify-between border-b border-slate-200/70 px-4 py-4 dark:border-slate-800',
                                        mode === 'CASH' && 'bg-emerald-50/80 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300',
                                        mode === 'UPI' && 'bg-sky-50/80 text-sky-700 dark:bg-sky-950/20 dark:text-sky-300',
                                        mode === 'CARD' && 'bg-violet-50/80 text-violet-700 dark:bg-violet-950/20 dark:text-violet-300'
                                    )}>
                                        <span className="text-sm font-semibold tracking-[0.18em]">{mode}</span>
                                        <span className="text-lg font-semibold">{formatCurrency(total)}</span>
                                    </div>
                                    <div className="max-h-64 overflow-y-auto bg-white/80 dark:bg-slate-950/50">
                                        {transactions.length > 0 ? (
                                            <table className="w-full text-sm">
                                                <thead className="sticky top-0 bg-white/[0.9] text-slate-400 dark:bg-slate-950/[0.9] dark:text-slate-500">
                                                    <tr>
                                                        <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">Bill</th>
                                                        <th className="px-4 py-3 text-right font-semibold uppercase tracking-[0.16em]">Amount</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                                    {transactions.map((item: { id: string; billNo: string; grandTotal: number }) => (
                                                        <tr key={item.id}>
                                                            <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">#{item.billNo}</td>
                                                            <td className="px-4 py-3 text-right font-medium text-slate-950 dark:text-slate-100">
                                                                {formatCurrency(item.grandTotal)}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <div className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                                                No transactions
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
