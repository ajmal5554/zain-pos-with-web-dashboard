import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import { AlertTriangle, BrainCircuit, TrendingUp } from 'lucide-react';
import { addMonths, format, subMonths } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { isDemoModeEnabled } from '@/lib/demo';

interface DailyPoint {
    date: string;
    sales: number;
    orders: number;
}

function buildMonthlySeries(points: DailyPoint[]) {
    const monthly = new Map<string, number>();
    for (const point of points) {
        const key = point.date.slice(0, 7);
        monthly.set(key, (monthly.get(key) || 0) + point.sales);
    }
    return Array.from(monthly.entries()).map(([month, revenue]) => ({ month, revenue }));
}

function forecastNextMonths(values: { month: string; revenue: number }[], count: number) {
    if (values.length === 0) return [];
    const recent = values.slice(-6);
    const weightedAverage = recent.reduce((sum, item, index) => sum + item.revenue * (index + 1), 0) / recent.reduce((sum, _, index) => sum + index + 1, 0);
    const trend = recent.length > 1 ? (recent[recent.length - 1].revenue - recent[0].revenue) / (recent.length - 1) : 0;
    const lastMonth = new Date(`${values[values.length - 1].month}-01T00:00:00`);

    return Array.from({ length: count }, (_, index) => {
        const date = addMonths(lastMonth, index + 1);
        const predicted = Math.max(0, weightedAverage + trend * (index + 1));
        return {
            month: format(date, 'MMM yyyy'),
            revenue: null,
            predicted
        };
    });
}

export default function ForecastingPage() {
    const [history, setHistory] = useState<{ month: string; revenue: number }[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void loadForecasting();
    }, []);

    async function loadForecasting() {
        try {
            setLoading(true);
            setError(null);

            if (isDemoModeEnabled()) {
                setHistory([
                    { month: '2025-10', revenue: 94000 },
                    { month: '2025-11', revenue: 102000 },
                    { month: '2025-12', revenue: 115000 },
                    { month: '2026-01', revenue: 110000 },
                    { month: '2026-02', revenue: 118000 },
                    { month: '2026-03', revenue: 128450 }
                ]);
                return;
            }

            const endDate = new Date();
            const startDate = subMonths(endDate, 12);
            const response = await api.get<DailyPoint[]>('/sales/daily', {
                params: {
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString()
                }
            });
            setHistory(buildMonthlySeries(response.data));
        } catch (err: any) {
            setError(err?.response?.data?.error || 'Failed to load forecasting data');
        } finally {
            setLoading(false);
        }
    }

    const forecast = useMemo(() => forecastNextMonths(history, 4), [history]);
    const chartData = useMemo(() => [
        ...history.map((item) => ({ month: format(new Date(`${item.month}-01T00:00:00`), 'MMM yyyy'), revenue: item.revenue, predicted: null })),
        ...forecast
    ], [forecast, history]);

    const nextPrediction = forecast[0]?.predicted || 0;
    const averageMonthly = history.length ? history.reduce((sum, item) => sum + item.revenue, 0) / history.length : 0;
    const lastRevenue = history[history.length - 1]?.revenue || 0;
    const growth = averageMonthly ? ((nextPrediction - averageMonthly) / averageMonthly) * 100 : 0;

    if (loading) {
        return <div className="dashboard-surface rounded-[1.5rem] px-6 py-16 text-center text-sm text-slate-500 dark:text-slate-400">Loading forecasting...</div>;
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="dashboard-section-title">Forecasting</h1>
                <p className="dashboard-section-copy">Revenue outlook built from historical monthly sales patterns.</p>
            </div>

            {error && (
                <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50/80 px-5 py-4 text-sm font-medium text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        {error}
                    </div>
                </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="flex items-center gap-4 p-6">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                            <BrainCircuit className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Next Month Projection</p>
                            <p className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{formatCurrency(nextPrediction)}</p>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="flex items-center gap-4 p-6">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                            <TrendingUp className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Growth vs Avg</p>
                            <p className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{growth.toFixed(1)}%</p>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="flex items-center gap-4 p-6">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                            <TrendingUp className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Latest Month</p>
                            <p className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{formatCurrency(lastRevenue)}</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-xl">Revenue Outlook</CardTitle>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={360}>
                        <AreaChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                            <YAxis tickFormatter={(value) => formatCurrency(value).replace('.00', '')} />
                            <Tooltip
                                formatter={(value: ValueType, name: NameType) => {
                                    const normalized = typeof value === 'number'
                                        ? value
                                        : typeof value === 'string'
                                            ? Number(value)
                                            : null;
                                    return [
                                        normalized !== null && !Number.isNaN(normalized) ? formatCurrency(normalized) : '-',
                                        name === 'predicted' ? 'Forecast' : 'Revenue'
                                    ];
                                }}
                            />
                            <Area type="monotone" dataKey="revenue" stroke="#0f172a" fill="#cbd5e1" fillOpacity={0.5} />
                            <Area type="monotone" dataKey="predicted" stroke="#0ea5e9" fill="#bae6fd" fillOpacity={0.7} strokeDasharray="6 4" />
                        </AreaChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </div>
    );
}
