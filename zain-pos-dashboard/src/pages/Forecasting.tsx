import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { AlertTriangle, BrainCircuit, TrendingUp, Calendar, Zap, Sparkles, Activity } from 'lucide-react';
import { format, addMonths } from 'date-fns';
import { StatCard } from '@/components/shared/StatCard';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { isDemoModeEnabled } from '@/lib/demo';
import { cn } from '@/lib/utils';

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
            const startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 12);
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
        return (
            <div className="flex flex-col items-center justify-center p-24 text-center">
                 <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-6">
                     <BrainCircuit className="h-7 w-7 text-muted-foreground" />
                 </div>
                 <p className="text-sm text-muted-foreground">Loading forecast...</p>
            </div>
        );
    }

    return (
        <div className="flex-1 space-y-4 pt-4 pb-12">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Forecasting</h2>
                    <p className="text-sm text-muted-foreground">
                        Revenue outlook based on past sales.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                     <Badge variant="secondary" className="gap-1.5">
                         <Sparkles className="h-3 w-3" />
                         AI Forecast
                     </Badge>
                </div>
            </div>

            {error && (
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{error}</span>
                </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard title="Next Month Prediction" value={formatCurrency(nextPrediction)} icon={<BrainCircuit className="h-4 w-4" />} trend={Number(growth.toFixed(1))} trendLabel="vs historical avg" />
                <StatCard title="Expected Growth" value={`${growth.toFixed(1)}%`} icon={<Activity className="h-4 w-4" />} />
                <StatCard title="Last Month Revenue" value={formatCurrency(lastRevenue)} icon={<Calendar className="h-4 w-4" />} />
            </div>

            <Card className="overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <div className="space-y-1">
                        <CardTitle className="text-base font-semibold">Revenue Forecast Model</CardTitle>
                        <CardDescription className="text-xs">Historical data vs projected growth.</CardDescription>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                         <div className="flex items-center gap-2">
                              <div className="h-2 w-2 rounded-full bg-slate-400" />
                              <span className="text-muted-foreground">Actual Revenue</span>
                         </div>
                         <div className="flex items-center gap-2">
                              <div className="h-2 w-2 rounded-full bg-primary" />
                              <span className="text-muted-foreground">Predicted Revenue</span>
                         </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-4">
                    <ResponsiveContainer width="100%" height={350}>
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.15}/>
                                    <stop offset="95%" stopColor="#94a3b8" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorPredicted" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.2}/>
                                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                            <XAxis 
                                dataKey="month" 
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                                dy={10}
                            />
                            <YAxis 
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(value) => `\u20B9${(value / 1000).toFixed(0)}k`}
                                tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                            />
                            <Tooltip
                                contentStyle={{ 
                                    backgroundColor: 'var(--background)', 
                                    borderRadius: '8px', 
                                    border: '1px solid var(--border)', 
                                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                }}
                                itemStyle={{ fontSize: '14px', fontWeight: 600 }}
                                labelStyle={{ color: 'var(--muted-foreground)', fontSize: '12px', marginBottom: '8px' }}
                                formatter={(value: ValueType) => [formatCurrency(Number(value)), 'Revenue']}
                            />
                            <Area 
                                type="monotone" 
                                dataKey="revenue" 
                                stroke="#64748b" 
                                strokeWidth={2}
                                fillOpacity={1} 
                                fill="url(#colorRevenue)" 
                            />
                            <Area 
                                type="monotone" 
                                dataKey="predicted" 
                                stroke="var(--primary)" 
                                strokeWidth={2}
                                strokeDasharray="5 5"
                                fillOpacity={1} 
                                fill="url(#colorPredicted)" 
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                    
                    <div className="mt-8 p-4 rounded-md bg-muted/50 border flex items-start gap-4">
                         <div className="mt-0.5">
                             <Zap className="h-5 w-5 text-muted-foreground" />
                         </div>
                         <div>
                             <p className="text-sm font-semibold">How this works</p>
                             <p className="text-sm text-muted-foreground mt-1">This forecast uses historical sales data to predict future revenue, giving more weight to recent months to capture current trends.</p>
                         </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
