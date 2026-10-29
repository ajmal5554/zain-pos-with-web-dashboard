import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
    TrendingUp,
    RefreshCw,
    Calendar,
    Package,
    ArrowRight,
    BarChart3,
    AlertTriangle,
    CheckCircle2,
    ShieldCheck,
    Layers,
    Clock,
    Activity,
    Search,
} from 'lucide-react';
import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
} from 'recharts';
import { useAuthStore } from '../store/authStore';
import { ForecastSeasons } from '../components/ForecastSeasons';
import type { BusinessInsights } from '../types/insights';

const money = (value: number | null) =>
    value === null
        ? 'Unavailable'
        : (value / 100).toLocaleString('en-IN', {
              style: 'currency',
              currency: 'INR',
              maximumFractionDigits: 0,
          });

const monthName = (month: string) =>
    new Intl.DateTimeFormat('en-IN', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(month + '-01T00:00:00Z'));

const methods = {
    AVERAGE: 'Recent completed-month average',
    TREND: 'Bounded damped trend',
    NAIVE: 'Last completed-month pace',
    DAILY_RUN_RATE: 'Early daily run-rate projection',
    NONE: 'Insufficient recorded sales',
};

export const Forecasting: React.FC = () => {
    const user = useAuthStore((s) => s.user);
    const allowed = !!user && user.isActive !== false && (user.role === 'ADMIN' || user.permViewInsights);
    const [data, setData] = useState<BusinessInsights | null>(null);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [horizon, setHorizon] = useState(6);
    const [leadDays, setLeadDays] = useState(7);
    const [bufferDays, setBufferDays] = useState(21);
    const [stockFilter, setStockFilter] = useState('ALL');
    const [search, setSearch] = useState('');

    useEffect(() => {
        let current = true;
        setData(null);
        setError('');
        if (!allowed) return;
        (async () => {
            try {
                if (!window.electronAPI?.insights) {
                    throw new Error('Restart the updated desktop POS or its web preview to load sales forecasting.');
                }
                const result = await window.electronAPI.insights.get();
                if (!result.success || !result.data?.monthly) {
                    throw new Error(result.error || 'Restart the updated app to load monthly forecasts.');
                }
                if (current) setData(result.data);
            } catch (e) {
                if (current) setError((e as Error).message);
            }
        })();
        return () => {
            current = false;
        };
    }, [retry, allowed, user?.id]);

    if (!allowed) return <Navigate to="/pos" replace />;

    const planning = data?.monthly;
    const projections = planning?.projections.slice(0, horizon) || [];
    const total =
        projections.length && projections.every((p) => p.predictedPaise !== null)
            ? projections.reduce((n, p) => n + p.predictedPaise!, 0)
            : null;

    const chart = planning
        ? [
              ...planning.history.slice(-12).map((m) => ({
                  month: m.month,
                  actual: m.amountPaise / 100,
                  predicted: null as number | null,
                  partial: null as number | null,
              })),
              {
                  month: planning.currentMonth.month,
                  actual: null,
                  predicted: null,
                  partial: planning.currentMonth.actualPaise / 100,
              },
              ...projections.map((p) => ({
                  month: p.month,
                  actual: null,
                  predicted: p.predictedPaise === null ? null : p.predictedPaise / 100,
                  partial: null,
              })),
          ]
        : [];

    const reorder = (row: BusinessInsights['stock'][number]) =>
        row.daysCover === null
            ? null
            : Math.max(0, Math.ceil((row.netUnits28 / 28) * (leadDays + bufferDays)) - row.stock);

    const candidates =
        data?.stock.filter(
            (row) =>
                (stockFilter === 'ALL' ||
                    (stockFilter === 'REVIEW' ? (reorder(row) ?? 0) > 0 : row.status === stockFilter)) &&
                `${row.name} ${row.barcode} ${row.size} ${row.category}`.toLowerCase().includes(search.toLowerCase())
        ) || [];

    return (
        <div className="space-y-6 text-gray-800 dark:text-gray-100 pb-12">
            {/* Top Controls Toolbar (Unboxed) */}
            <header className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="sr-only">Sales Forecasting & Business Planning</h1>
                <p className="sr-only">Upcoming sales, restocking directions, seasonal alerts and comparisons.</p>

                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 border border-primary-200/50 dark:border-primary-800/40 text-xs font-medium">
                        <TrendingUp className="w-3.5 h-3.5 text-primary-600" />
                        <span>Sales Outlook & Restocking</span>
                    </span>
                    {data && (
                        <span className="hidden sm:inline">
                            · Records through <strong>{data.through}</strong>
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2.5 ml-auto">
                    <div className="flex items-center gap-2 bg-white dark:bg-dark-card px-3 py-1.5 rounded-xl border border-gray-200 dark:border-dark-border shadow-xs">
                        <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Forecast horizon</span>
                        <select
                            aria-label="Forecast horizon"
                            className="bg-transparent text-gray-800 dark:text-gray-100 text-sm font-medium focus:outline-none cursor-pointer"
                            value={horizon}
                            onChange={(e) => setHorizon(Number(e.target.value))}
                        >
                            {[1, 2, 3, 4, 5, 6].map((n) => (
                                <option key={n} value={n}>
                                    {n} {n === 1 ? 'month' : 'months'}
                                </option>
                            ))}
                        </select>
                    </div>

                    <button
                        className="btn btn-primary btn-sm flex items-center gap-1.5 px-3.5 py-1.5 text-xs shadow-xs disabled:opacity-40"
                        disabled={!data && !error}
                        onClick={() => setRetry((n) => n + 1)}
                    >
                        <RefreshCw size={14} className={!data && !error ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </header>

            {error ? (
                <div role="alert" className="card p-6 border border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-950/20 text-red-700 dark:text-red-300 rounded-2xl flex items-start gap-4">
                    <div className="p-2 rounded-xl bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 shrink-0">
                        <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div className="space-y-2">
                        <h3 className="font-semibold text-base">Forecast Data Unavailable</h3>
                        <p className="text-sm opacity-90">{error}</p>
                        <button
                            className="btn btn-danger btn-sm text-xs mt-2 underline"
                            onClick={() => setRetry((n) => n + 1)}
                        >
                            Try again
                        </button>
                    </div>
                </div>
            ) : !data || !planning ? (
                <div role="status" className="card p-12 text-center space-y-4 border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card rounded-2xl">
                    <RefreshCw className="w-8 h-8 text-primary-600 animate-spin mx-auto" />
                    <p className="text-base font-medium text-gray-700 dark:text-gray-300">
                        Preparing sales forecasts and planning comparisons…
                    </p>
                    <p className="text-xs text-gray-500">
                        Training statistical model across completed calendar months and evaluating recent product velocity.
                    </p>
                </div>
            ) : (
                <>
                    {/* Metadata & Audit Subtitle */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400 px-1">
                        <p>
                            Records through <strong className="text-gray-800 dark:text-gray-200">{data.through}</strong> ·{' '}
                            <span className="font-medium text-gray-700 dark:text-gray-300">{planning.history.length} completed calendar months</span> ·{' '}
                            Updated {new Date(data.asOf).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}. Today’s partial sales, historical imports and labelled demo bills are excluded.
                        </p>
                    </div>

                    {/* Forecast Basis Banner */}
                    <div
                        className={`rounded-2xl p-5 border text-sm transition-colors ${
                            planning.basis === 'BILLED'
                                ? 'bg-amber-50/70 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800/50 text-amber-900 dark:text-amber-200'
                                : 'bg-primary-50/60 border-primary-100 dark:bg-primary-950/20 dark:border-primary-900/40 text-primary-950 dark:text-primary-200'
                        }`}
                    >
                        <div className="flex items-start gap-3.5">
                            <div
                                className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                                    planning.basis === 'BILLED'
                                        ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'
                                        : 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300'
                                }`}
                            >
                                {planning.basis === 'BILLED' ? (
                                    <AlertTriangle className="w-5 h-5" />
                                ) : (
                                    <CheckCircle2 className="w-5 h-5" />
                                )}
                            </div>
                            <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <strong className="text-base font-semibold">
                                        Forecast basis: {planning.basis === 'NET' ? 'Net recorded sales' : 'Billed sales before returns'}
                                    </strong>
                                    <span
                                        className={`badge ${
                                            planning.basis === 'NET' ? 'badge-info' : 'badge-warning'
                                        }`}
                                    >
                                        {planning.basis === 'NET' ? 'Reconciled Net' : 'Provisional Billed'}
                                    </span>
                                </div>
                                <p className="opacity-90 leading-relaxed text-sm">{planning.basisNote}</p>
                                {planning.basis === 'BILLED' && (
                                    <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-100/60 dark:bg-amber-900/40 p-2.5 rounded-lg border border-amber-200/50 dark:border-amber-800/40">
                                        Net forecasting needs exchange reconciliation. Billed-sales projections remain available so you can still plan, with this limitation visible.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 4 Hero Stat Cards */}
                    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                        {/* Card 1: Next Month Forecast */}
                        <div className="card !p-4 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-xs flex flex-col justify-between">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                                        Next month forecast
                                    </p>
                                    <strong className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white block">
                                        {money(projections[0]?.predictedPaise ?? null)}
                                    </strong>
                                </div>
                                <div className="p-2 rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 border border-violet-100 dark:border-violet-800/40">
                                    <TrendingUp className="w-5 h-5" />
                                </div>
                            </div>
                            <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-dark-border/60">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {projections[0] ? monthName(projections[0].month) : 'Awaiting records'}
                                </p>
                            </div>
                        </div>

                        {/* Card 2: Projected Total for Horizon */}
                        <div className="card !p-4 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-xs flex flex-col justify-between">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                                        Next {horizon} {horizon === 1 ? 'month' : 'months'} · projected total
                                    </p>
                                    <strong className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white block">
                                        {money(total)}
                                    </strong>
                                </div>
                                <div className="p-2 rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400 border border-primary-100 dark:border-primary-800/40">
                                    <Layers className="w-5 h-5" />
                                </div>
                            </div>
                            <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-dark-border/60">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Same basis as the chart; not profit or a guaranteed target.
                                </p>
                            </div>
                        </div>

                        {/* Card 3: Current Month Recorded So Far */}
                        <div className="card !p-4 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-xs flex flex-col justify-between">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                                        {monthName(planning.currentMonth.month)} · recorded so far
                                    </p>
                                    <strong className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white block">
                                        {money(planning.currentMonth.actualPaise)}
                                    </strong>
                                </div>
                                <div className="p-2 rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-100 dark:border-amber-800/40">
                                    <Clock className="w-5 h-5" />
                                </div>
                            </div>
                            <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-dark-border/60">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {planning.currentMonth.elapsedDays} completed days. Current-month pace: {money(planning.currentMonth.projectedPaise)}.
                                </p>
                            </div>
                        </div>

                        {/* Card 4: Restocking Checks */}
                        <div className="card !p-4 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-xs flex flex-col justify-between">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                                        Restocking checks
                                    </p>
                                    <strong className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white block">
                                        {String(data.stock.filter((row) => (reorder(row) ?? 0) > 0).length)}
                                    </strong>
                                </div>
                                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/40">
                                    <Package className="w-5 h-5" />
                                </div>
                            </div>
                            <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-dark-border/60">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {data.inventory.tracked} active audited barcodes; generic stock checks remain separate.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Sales Forecast Chart & Scenario Table */}
                    <section className="card p-5 space-y-5 shadow-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card rounded-xl">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-dark-border pb-4">
                            <div>
                                <h2 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2.5">
                                    <Calendar className="w-5 h-5 text-primary-600" />
                                    <span>Sales forecast · next {horizon} {horizon === 1 ? 'month' : 'months'}</span>
                                </h2>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{planning.reason}</p>
                            </div>
                        </div>

                        {planning.history.length > 0 || projections.some((p) => p.predictedPaise !== null) ? (
                            <div className="h-80 w-full pt-2">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chart} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:opacity-20" />
                                        <XAxis
                                            dataKey="month"
                                            tickFormatter={monthName}
                                            minTickGap={30}
                                            stroke="#9ca3af"
                                            tick={{ fontSize: 12 }}
                                        />
                                        <YAxis
                                            width={88}
                                            tickFormatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`}
                                            stroke="#9ca3af"
                                            tick={{ fontSize: 12 }}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: '#1f2937',
                                                borderColor: '#374151',
                                                borderRadius: '0.75rem',
                                                color: '#f9fafb',
                                                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                                            }}
                                            labelFormatter={(v) => monthName(String(v))}
                                            formatter={(v: any, name: any) => [money(Math.round(Number(v) * 100)), name]}
                                        />
                                        <Legend wrapperStyle={{ paddingTop: '16px', fontSize: '13px' }} />
                                        <Line
                                            type="linear"
                                            dataKey="actual"
                                            name="Completed-month sales"
                                            stroke="#0284c7"
                                            strokeWidth={2.5}
                                            dot={false}
                                        />
                                        <Line
                                            type="linear"
                                            dataKey="partial"
                                            name="Current month so far"
                                            stroke="#f59e0b"
                                            strokeWidth={0}
                                            dot={{ r: 5, fill: '#f59e0b' }}
                                        />
                                        <Line
                                            type="linear"
                                            dataKey="predicted"
                                            name="Monthly forecast"
                                            stroke="#8b5cf6"
                                            strokeWidth={2.5}
                                            strokeDasharray="5 4"
                                            dot={{ r: 4, fill: '#8b5cf6' }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="p-8 text-center bg-gray-50 dark:bg-dark-bg/40 rounded-xl border border-dashed border-gray-200 dark:border-dark-border">
                                <p className="text-gray-500 dark:text-gray-400 text-sm">
                                    Estimate withheld until enough sales are recorded. All six forecast months remain listed below.
                                </p>
                            </div>
                        )}

                        {/* Upcoming Months Table */}
                        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-dark-border">
                            <table className="table w-full text-left text-sm">
                                <thead>
                                    <tr>
                                        {['Upcoming month', 'Forecast', 'Planning scenario range', 'Same month last year', 'Projected change vs last year'].map((h) => (
                                            <th key={h} className="px-4 py-3 bg-gray-50 dark:bg-dark-bg/70 text-xs font-semibold text-gray-600 dark:text-gray-300">
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-dark-border">
                                    {projections.map((p) => {
                                        const change =
                                            p.predictedPaise !== null && p.lastYearPaise !== null && p.lastYearPaise > 0
                                                ? ((p.predictedPaise - p.lastYearPaise) / p.lastYearPaise) * 100
                                                : null;
                                        return (
                                            <tr className="hover:bg-gray-50 dark:hover:bg-dark-bg/40 transition-colors" key={p.month}>
                                                <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                                    <Calendar className="w-4 h-4 text-primary-500 shrink-0" />
                                                    <span>{monthName(p.month)}</span>
                                                </td>
                                                <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">
                                                    {money(p.predictedPaise)}
                                                </td>
                                                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                                                    {p.lowerPaise === null ? (
                                                        <span className="text-gray-400 italic">Unavailable</span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 dark:bg-dark-bg text-xs font-mono">
                                                             {money(p.lowerPaise)} – {money(p.upperPaise)}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                                                    {p.lastYearPaise === null ? (
                                                        <span className="text-gray-400 italic">No comparable history</span>
                                                    ) : (
                                                        money(p.lastYearPaise)
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    {change === null ? (
                                                        <span className="text-gray-400 italic text-xs">Unavailable</span>
                                                    ) : (
                                                        <span className={`badge ${change >= 0 ? 'badge-success' : 'badge-danger'} font-semibold text-xs`}>
                                                            {change > 0 ? '+' : ''}{change.toFixed(1)}%
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <p className="text-xs text-gray-500 leading-relaxed">
                            Scenario ranges widen further into the future. They show planning uncertainty, not statistically calibrated confidence intervals. Forecasts include GST and are not profit estimates. No fixed growth uplift or festival-sales boost is invented.
                        </p>

                        {planning.history.some((m) => m.bills === 0) && (
                            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                <span>
                                    Some completed months have no recorded bills. They remain zero in this record-based projection; check for missing data or closures before using the estimates.
                                </span>
                            </div>
                        )}

                        {/* Forecast Method & Reliability Accordion */}
                        <details className="group border border-gray-200 dark:border-dark-border rounded-xl p-4 bg-gray-50/50 dark:bg-dark-bg/20 transition-all text-sm">
                            <summary className="font-semibold text-gray-800 dark:text-gray-200 cursor-pointer flex items-center justify-between list-none">
                                <span className="flex items-center gap-2">
                                    <Activity className="w-4 h-4 text-primary-600" />
                                    Forecast method & reliability
                                </span>
                                <span className="text-xs text-primary-600 font-medium group-open:rotate-180 transition-transform">
                                    ▼
                                </span>
                            </summary>
                            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-dark-border space-y-2 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                                <p>
                                    <strong>Method:</strong> <span className="font-medium text-gray-800 dark:text-gray-200">{methods[planning.method]}</span>. Completed calendar months train the model; the current partial month is shown separately. Calendar-month lengths are taken into account. {planning.seasonality ? 'Two annual cycles are available for a bounded seasonal adjustment.' : 'There are fewer than two full annual cycles; seasonal reminders are shown, but a recurring sales uplift is not inferred.'}
                                </p>
                                {planning.backtest ? (
                                    <div className="p-3 bg-white dark:bg-dark-card rounded-lg border border-gray-200 dark:border-dark-border space-y-1">
                                        <p className="font-semibold text-gray-800 dark:text-gray-200">
                                            Past-only monthly tests: {planning.backtest.months} · Mean miss: {money(planning.backtest.maePaise)} · Absolute error ratio: {planning.backtest.wapePercent === null ? 'Unavailable' : `${planning.backtest.wapePercent}%`}.
                                        </p>
                                        <p className="text-gray-500">
                                            This tests next-month performance, not the accuracy of all six future months.
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-gray-500 italic">
                                        Monthly validation is not available yet. Treat long-range figures as provisional planning estimates.
                                    </p>
                                )}
                            </div>
                        </details>
                    </section>

                    {/* Sales Comparisons Section */}
                    <section className="card p-5 space-y-4 shadow-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card rounded-xl">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-dark-border pb-3">
                            <div>
                                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                    <BarChart3 className="w-5 h-5 text-primary-600" />
                                    Sales comparisons
                                </h2>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    Same basis as the forecast. Month-to-date comparisons match the number of completed days; missing previous records remain unavailable.
                                </p>
                            </div>
                        </div>

                        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-dark-border">
                            <table className="table w-full text-sm text-left">
                                <thead>
                                    <tr>
                                        {['Comparison', 'Current period', 'Previous period', 'Change'].map((h) => (
                                            <th key={h} className="px-4 py-3 bg-gray-50 dark:bg-dark-bg/70 text-xs font-semibold text-gray-600 dark:text-gray-300">
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-dark-border">
                                    {planning.comparisons.map((c) => (
                                        <tr key={c.label} className="hover:bg-gray-50 dark:hover:bg-dark-bg/40 transition-colors">
                                            <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">
                                                {c.label}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-xs text-gray-500 block">{c.currentLabel}</span>
                                                <p className="font-bold text-gray-900 dark:text-white mt-0.5">{money(c.currentPaise)}</p>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-xs text-gray-500 block">{c.previousLabel}</span>
                                                <p className="font-bold text-gray-900 dark:text-white mt-0.5">{money(c.previousPaise)}</p>
                                            </td>
                                            <td className="px-4 py-3">
                                                {c.changePercent === null ? (
                                                    <span className="text-gray-400 italic text-xs">Not comparable</span>
                                                ) : (
                                                    <span className={`badge ${c.changePercent >= 0 ? 'badge-success' : 'badge-danger'} font-semibold text-xs`}>
                                                        {c.changePercent > 0 ? '+' : ''}{c.changePercent.toFixed(1)}%
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {/* Season Alerts */}
                    <ForecastSeasons
                        today={new Date(data.asOf).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}
                        horizon={horizon}
                        userId={user.id}
                    />

                    {/* What to Restock & Purchase Planning */}
                    <section className="card p-5 space-y-4 shadow-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card rounded-xl">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-dark-border pb-3">
                            <div>
                                <h2 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                                    <Package className="w-5 h-5 text-primary-600" />
                                    What to restock & purchase planning
                                </h2>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    Recent category demand includes traditional billing; exact stock-based purchase quantities use audited barcodes. Check physical pieces, supplier minimums and goods already ordered before buying.
                                </p>
                            </div>
                        </div>

                        {/* Category Demand Pills */}
                        {data.categoryDemand.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                    Category Velocity (Last 28 Days)
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                                    {data.categoryDemand.slice(0, 6).map((c) => (
                                        <div
                                            key={c.category}
                                            className="p-3.5 rounded-xl border border-gray-200 dark:border-dark-border bg-gray-50/70 dark:bg-dark-bg/40 hover:border-primary-300 dark:hover:border-primary-700 transition-all flex flex-col justify-between"
                                        >
                                            <div>
                                                <strong className="text-sm font-semibold text-gray-900 dark:text-white truncate block" title={c.category}>
                                                    {c.category}
                                                </strong>
                                                <p className="text-xs font-bold text-primary-600 dark:text-primary-400 mt-1">
                                                    {c.netUnits28} net pieces · last 28 days
                                                </p>
                                            </div>
                                            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 line-clamp-2">
                                                {c.netUnits28 > 0
                                                    ? 'Check fast-selling sizes before the next delivery.'
                                                    : 'Review demand and existing stock before reordering.'}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Interactive Filter Controls */}
                        <div className="bg-gray-50 dark:bg-dark-bg p-4 rounded-xl border border-gray-200 dark:border-dark-border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div>
                                <label className="label text-xs">Supplier lead time (days)</label>
                                <input
                                    aria-label="Supplier lead time"
                                    type="number"
                                    min={0}
                                    max={90}
                                    value={leadDays}
                                    className="input text-sm py-2"
                                    onWheel={(e) => e.currentTarget.blur()}
                                    onChange={(e) => setLeadDays(Math.max(0, Math.min(90, Math.trunc(Number(e.target.value)) || 0)))}
                                />
                            </div>
                            <div>
                                <label className="label text-xs">Extra stock buffer (days)</label>
                                <input
                                    aria-label="Stock buffer"
                                    type="number"
                                    min={1}
                                    max={90}
                                    value={bufferDays}
                                    className="input text-sm py-2"
                                    onWheel={(e) => e.currentTarget.blur()}
                                    onChange={(e) => setBufferDays(Math.max(1, Math.min(90, Math.trunc(Number(e.target.value)) || 1)))}
                                />
                            </div>
                            <div>
                                <label className="label text-xs">Filter stock</label>
                                <select
                                    className="input text-sm py-2"
                                    value={stockFilter}
                                    onChange={(e) => setStockFilter(e.target.value)}
                                >
                                    <option value="ALL">All audited stock</option>
                                    <option value="REVIEW">Reorder review</option>
                                    <option value="CHECK_COUNT">Count problems</option>
                                    <option value="OBSERVING">Still observing</option>
                                </select>
                            </div>
                            <div>
                                <label className="label text-xs">Find item / size / barcode</label>
                                <div className="relative">
                                    <input
                                        className="input text-sm py-2 pl-9"
                                        placeholder="Search name, barcode..."
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                    />
                                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                                </div>
                            </div>
                        </div>

                        <p className="text-xs text-gray-500 leading-relaxed">
                            Review quantity = recent net daily demand × ({leadDays} lead-time days + {bufferDays} buffer days) − recorded stock, rounded up. This is a transparent scenario, not an automatic order or purchase budget. Newly audited or sparse items keep their quantity unavailable.
                        </p>

                        {/* Stock Candidates Table */}
                        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-dark-border">
                            <table className="table w-full text-sm text-left">
                                <thead>
                                    <tr>
                                        {['Item / barcode', 'Size', 'Stock', 'Net pieces · 28 days', 'Estimated cover', 'Review purchase quantity', 'Direction'].map((h) => (
                                            <th key={h} className="px-4 py-3 bg-gray-50 dark:bg-dark-bg/70 text-xs font-semibold text-gray-600 dark:text-gray-300">
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-dark-border">
                                    {candidates.slice(0, 30).map((row) => {
                                        const quantity = reorder(row);
                                        return (
                                            <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-dark-bg/40 transition-colors">
                                                <td className="px-4 py-3">
                                                    <strong className="font-semibold text-gray-900 dark:text-white block">{row.name}</strong>
                                                    <p className="text-xs text-gray-500">{row.barcode} · {row.category}</p>
                                                </td>
                                                <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.size || 'Not specified'}</td>
                                                <td className="px-4 py-3 font-semibold text-gray-800 dark:text-gray-200">{row.stock}</td>
                                                <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.netUnits28}</td>
                                                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                                                    {row.daysCover === null ? 'Unavailable' : `${row.daysCover} days`}
                                                </td>
                                                <td className="px-4 py-3 font-semibold">{quantity === null ? 'Awaiting reliable counts / demand' : quantity}</td>
                                                <td className="px-4 py-3">
                                                    <span className={`badge ${
                                                        row.status === 'CHECK_COUNT'
                                                            ? 'badge-danger'
                                                            : quantity !== null && quantity > 0
                                                            ? 'badge-warning font-semibold'
                                                            : row.status === 'OBSERVING'
                                                            ? 'badge-info'
                                                            : 'bg-gray-100 dark:bg-dark-bg text-gray-700 dark:text-gray-300'
                                                    }`}>
                                                        {row.status === 'CHECK_COUNT'
                                                            ? 'Correct the count first'
                                                            : quantity !== null && quantity > 0
                                                            ? 'Check supplier availability and pending deliveries'
                                                            : row.status === 'OBSERVING'
                                                            ? 'Still collecting sales'
                                                            : row.status === 'NO_DEMAND'
                                                            ? 'Review slow-moving stock before buying'
                                                            : 'Monitor size availability'}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {!data.stock.length && (
                                <p className="p-6 text-center text-sm text-gray-500">
                                    No active audited stock to assess. Category demand can guide checks, but exact purchase quantities need verified stock.
                                </p>
                            )}
                            {data.stock.length > 0 && (
                                <div className="px-4 py-3 bg-gray-50/50 dark:bg-dark-bg/20 border-t border-gray-200 dark:border-dark-border">
                                    <p className="text-xs text-gray-500">
                                        Showing {Math.min(30, candidates.length)} of {candidates.length} matching barcodes. Use search or filters to find the rest.
                                    </p>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Data Checks & Next Actions */}
                    <section className="card p-5 space-y-4 shadow-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card rounded-xl">
                        <div className="flex items-center gap-2.5 border-b border-gray-100 dark:border-dark-border pb-3">
                            <ShieldCheck className="w-5 h-5 text-primary-600" />
                            <h2 className="font-bold text-lg text-gray-900 dark:text-white">Data checks & next actions</h2>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="p-4 rounded-xl bg-gray-50 dark:bg-dark-bg/40 border border-gray-200 dark:border-dark-border text-sm space-y-1.5">
                                <div className="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-200">
                                    <Package className="w-4 h-4 text-primary-600" />
                                    <span>Inventory Audit Coverage</span>
                                </div>
                                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                                    {data.inventory.legacy} generic barcodes have no audited stock count; {data.inventory.observing} audited barcodes need more observation or sales. They do not stop the sales forecast.
                                </p>
                            </div>

                            <div className="p-4 rounded-xl bg-gray-50 dark:bg-dark-bg/40 border border-gray-200 dark:border-dark-border text-sm space-y-1.5">
                                <div className="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-200">
                                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                                    <span>Promotions & Margin Prudence</span>
                                </div>
                                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                                    Promotions should use reliable purchase costs, GST treatment and your minimum margin. The forecast does not automatically recommend a discount that could erase profit.
                                </p>
                            </div>
                        </div>

                        {data.unresolvedExchangeBills > 0 && (
                            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-sm space-y-2">
                                <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
                                    <AlertTriangle className="w-5 h-5" />
                                    <span>Exchange Reconciliation Required</span>
                                </div>
                                <p className="text-xs leading-relaxed">
                                    Net sales need reconciliation for {data.unresolvedExchangeBills} exchange-related bills. The monthly projection is explicitly labelled billed sales until this is resolved.
                                </p>
                                <ul className="text-xs space-y-1 list-disc list-inside mt-2 font-mono">
                                    {data.exchangeIssues.map((issue) => (
                                        <li key={issue.billNo}>
                                            Check bill <strong>#{issue.billNo}</strong> · {issue.date}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="pt-2">
                            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Quick Navigation</p>
                            <div className="flex flex-wrap gap-2.5">
                                <Link className="btn btn-outline btn-sm text-xs flex items-center gap-1.5" to="/stock">
                                    <span>Review stock</span>
                                    <ArrowRight size={14} />
                                </Link>
                                <Link className="btn btn-outline btn-sm text-xs" to="/purchases">
                                    Plan purchases
                                </Link>
                                <Link className="btn btn-outline btn-sm text-xs" to="/sales">
                                    Review sales
                                </Link>
                                <Link className="btn btn-outline btn-sm text-xs" to="/profit">
                                    Check profit and costs
                                </Link>
                            </div>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
};
