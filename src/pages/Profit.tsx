import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
    TrendingUp,
    TrendingDown,
    DollarSign,
    Package,
    Calendar,
    RefreshCw,
    AlertCircle,
    AlertTriangle,
    ShieldAlert,
    Receipt,
    Info,
    ArrowRight,
    Search,
    Download,
    Percent,
    ArrowUpRight,
    CheckCircle2,
    Layers,
    FileSpreadsheet,
    HelpCircle,
    BarChart3,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { formatIndianCurrency } from '../lib/format';
import { showToast } from '../components/ui/Toast';
import { Loading } from '../components/ui/Loading';
import {
    format,
    startOfMonth,
    endOfMonth,
    subMonths,
    startOfWeek,
    endOfWeek,
    subDays,
    startOfQuarter,
    endOfQuarter,
} from 'date-fns';

type Report = Awaited<ReturnType<typeof import('../../electron/profit.service').getProfitReport>>;

const getTodayStr = () =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());

const formatPaise = (value: number | null): string => {
    if (value === null) return 'Unavailable';
    return formatIndianCurrency(value / 100);
};

function getFinancialYearStart(date: Date): Date {
    const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
    return new Date(year, 3, 1);
}

function getFinancialYearEnd(date: Date): Date {
    const year = date.getMonth() >= 3 ? date.getFullYear() + 1 : date.getFullYear();
    return new Date(year, 2, 31);
}

export const Profit: React.FC = () => {
    const user = useAuthStore((s) => s.user);
    const allowed = user?.role === 'ADMIN' && user.isActive !== false;

    const [from, setFrom] = useState(() => getTodayStr().slice(0, 7) + '-01');
    const [to, setTo] = useState(() => getTodayStr());
    const [retry, setRetry] = useState(0);
    const [data, setData] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [productSearch, setProductSearch] = useState('');
    const [exporting, setExporting] = useState(false);

    // Date presets calculation
    const datePresets = useMemo(() => {
        const now = new Date();
        const yesterday = subDays(now, 1);
        const lastMonth = subMonths(now, 1);
        const lastQuarter = subMonths(startOfQuarter(now), 1);
        const fyStart = getFinancialYearStart(now);
        const fyEnd = getFinancialYearEnd(now);

        return [
            { label: 'Today', start: format(now, 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') },
            { label: 'Yesterday', start: format(yesterday, 'yyyy-MM-dd'), end: format(yesterday, 'yyyy-MM-dd') },
            { label: 'This Week', start: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), end: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd') },
            { label: 'This Month', start: format(startOfMonth(now), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') },
            { label: 'Last Month', start: format(startOfMonth(lastMonth), 'yyyy-MM-dd'), end: format(endOfMonth(lastMonth), 'yyyy-MM-dd') },
            { label: 'This Quarter', start: format(startOfQuarter(now), 'yyyy-MM-dd'), end: format(endOfQuarter(now), 'yyyy-MM-dd') },
            { label: 'This FY', start: format(fyStart, 'yyyy-MM-dd'), end: format(fyEnd, 'yyyy-MM-dd') },
        ];
    }, []);

    useEffect(() => {
        let current = true;
        setLoading(true);
        setError('');

        if (!allowed) {
            setLoading(false);
            return;
        }

        const timer = setTimeout(async () => {
            try {
                if (!window.electronAPI?.profit) {
                    throw new Error('Open the desktop POS application to view profit & analysis.');
                }
                const result = await window.electronAPI.profit.get({ from, to });
                if (!result.success || !result.data) {
                    throw new Error(result.error || 'Could not load profit analysis.');
                }
                if (current) {
                    setData(result.data);
                }
            } catch (e) {
                if (current) {
                    setError((e as Error).message);
                }
            } finally {
                if (current) {
                    setLoading(false);
                }
            }
        }, 150);

        return () => {
            current = false;
            clearTimeout(timer);
        };
    }, [from, to, retry, allowed, user?.id]);

    // Filtered products list
    const filteredProducts = useMemo(() => {
        if (!data?.products) return [];
        if (!productSearch.trim()) return data.products;
        const q = productSearch.toLowerCase();
        return data.products.filter((p) => p.name.toLowerCase().includes(q));
    }, [data?.products, productSearch]);

    // Total products billed value for sales mix percentage
    const totalProductsBilledPaise = useMemo(() => {
        if (!data?.products) return 0;
        return data.products.reduce((acc, curr) => acc + curr.billedPaise, 0);
    }, [data?.products]);

    // CSV Export Handler
    const handleExportCsv = () => {
        if (!data) return;
        setExporting(true);
        try {
            const rows: string[][] = [
                ['ZAIN GENTS PALACE - PROFIT & BUSINESS ANALYSIS'],
                [`Period: From ${data.from} To ${data.to}`],
                [`Generated on: ${new Date().toLocaleString('en-IN')}`],
                [],
                ['METRIC SUMMARY', 'VALUE'],
                ['Total Completed Bills', String(data.bills)],
                ['Gross Billed (after bill item discounts)', ((data.billedPaise || 0) / 100).toFixed(2)],
                ['Bill-level Discounts', ((data.discountPaise || 0) / 100).toFixed(2)],
                ['Refunds Processed', ((data.refundPaise || 0) / 100).toFixed(2)],
                ['Exchange Credit Reversed', ((data.exchangeReversalPaise || 0) / 100).toFixed(2)],
                ['Surplus Credit Issued', ((data.surplusCreditIssuedPaise || 0) / 100).toFixed(2)],
                ['Net Billed Sales Turnover', data.netSalesPaise !== null ? (data.netSalesPaise / 100).toFixed(2) : 'Unavailable'],
                ['Recorded Stock Cost of Sold Goods', ((data.knownCostPaise || 0) / 100).toFixed(2)],
                ['Held-Return Losses', ((data.heldCostPaise || 0) / 100).toFixed(2)],
                ['Provisional Gross Profit', data.grossProfitPaise !== null ? (data.grossProfitPaise / 100).toFixed(2) : 'Unavailable'],
                ['Gross Profit Margin (%)', data.marginPercent !== null ? `${data.marginPercent.toFixed(2)}%` : 'Unavailable'],
                ['Active Operating Expenses', ((data.expensePaise || 0) / 100).toFixed(2)],
                ['Drawer Expenses Awaiting Review', ((data.reviewAmountPaise || 0) / 100).toFixed(2)],
                ['Provisional Operating Balance', data.operatingProfitPaise !== null ? (data.operatingProfitPaise / 100).toFixed(2) : 'Unavailable'],
                [],
                ['INTEGRITY & DATA CHECKS', 'COUNT'],
                ['Bills with Incomplete/Missing Costs', String(data.missingBills)],
                ['Unknown Cost Pieces', String(data.unknownPieces)],
                ['Unresolved Exchange Bills', String(data.unresolvedExchangeBills)],
                ['Drawer Entries Awaiting Review', String(data.reviewCount)],
                ['Held Pieces with Unknown Loss', String(data.heldUnknown)],
                ['Bills with Later Returns', String(data.laterReturns)],
                [],
                ['TOP PRODUCTS BY BILLED ITEM VALUE', 'PIECES SOLD', 'BILLED VALUE (₹)'],
                ...data.products.map((p) => [p.name, String(p.quantity), (p.billedPaise / 100).toFixed(2)]),
            ];

            const csvContent = '\uFEFF' + rows.map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Zain_Profit_Analysis_${data.from}_to_${data.to}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showToast('Profit & analysis report exported successfully.', 'success');
        } catch (err) {
            showToast('Failed to export CSV: ' + (err as Error).message, 'error');
        } finally {
            setExporting(false);
        }
    };

    // Permission Guard
    if (!allowed) {
        return (
            <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-4">
                <div className="p-4 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-full">
                    <ShieldAlert className="w-12 h-12" />
                </div>
                <h1 className="text-2xl font-bold">Access Restricted</h1>
                <p className="text-gray-500 max-w-md">
                    Only store administrators and owners have authorization to view business profit and financial analysis.
                </p>
                <Link to="/" className="btn btn-primary mt-2">
                    Return to Dashboard
                </Link>
            </div>
        );
    }

    const hasIntegrityIssues =
        Boolean(data) &&
        (data!.missingBills > 0 ||
            data!.unresolvedExchangeBills > 0 ||
            data!.reviewCount > 0 ||
            data!.heldUnknown > 0 ||
            data!.laterReturns > 0);

    return (
        <div className="space-y-6 text-gray-800 dark:text-gray-100 pb-12">
            {/* Date Range & Controls Card */}
            <div className="card space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 dark:border-dark-border pb-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                        <Calendar className="w-4 h-4 text-primary-600" />
                        <span>Date Range & Analysis Period</span>
                        {loading && (
                            <span className="flex items-center gap-1.5 text-xs text-primary-600 dark:text-primary-400 font-normal animate-pulse ml-2">
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>Computing...</span>
                            </span>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <Link
                            to="/expenses"
                            className="btn btn-outline btn-sm flex items-center gap-1.5 text-xs"
                            title="Manage shop and operational expenses"
                        >
                            <Receipt className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" />
                            <span>Manage Expenses</span>
                        </Link>

                        <button
                            onClick={handleExportCsv}
                            disabled={!data || loading || exporting}
                            className="btn btn-secondary btn-sm flex items-center gap-1.5 text-xs"
                            title="Download summary spreadsheet"
                        >
                            <Download className="w-3.5 h-3.5" />
                            <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
                        </button>

                        <button
                            onClick={() => setRetry((n) => n + 1)}
                            disabled={loading}
                            className="btn btn-primary btn-sm flex items-center gap-1.5 text-xs shadow-xs"
                            title="Recompute analysis"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                            <span>Refresh</span>
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                        <label className="label">From Date</label>
                        <input
                            type="date"
                            className="input"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="label">To Date</label>
                        <input
                            type="date"
                            className="input"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="label">Quick Month Picker</label>
                        <input
                            type="month"
                            className="input cursor-pointer"
                            title="Select a full calendar month"
                            value={from.substring(0, 7)}
                            onChange={(e) => {
                                if (!e.target.value) return;
                                const [yr, mo] = e.target.value.split('-').map(Number);
                                setFrom(format(new Date(yr, mo - 1, 1), 'yyyy-MM-dd'));
                                setTo(format(new Date(yr, mo, 0), 'yyyy-MM-dd'));
                            }}
                        />
                    </div>
                </div>

                {/* Quick Preset Buttons */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-xs text-gray-500 mr-1 font-medium">Presets:</span>
                    {datePresets.map((preset) => {
                        const isActive = from === preset.start && to === preset.end;
                        return (
                            <button
                                key={preset.label}
                                onClick={() => {
                                    setFrom(preset.start);
                                    setTo(preset.end);
                                }}
                                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                                    isActive
                                        ? 'bg-primary-600 text-white shadow-sm ring-2 ring-primary-500/20'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                            >
                                {preset.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Error Message */}
            {error && (
                <div className="card border-l-4 border-red-500 bg-red-50/50 dark:bg-red-900/10 p-4 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-semibold text-red-900 dark:text-red-200 text-sm">Failed to Load Profit Data</h4>
                            <p className="text-sm text-red-700 dark:text-red-300 mt-0.5">{error}</p>
                        </div>
                    </div>
                    <button onClick={() => setRetry((n) => n + 1)} className="btn btn-outline btn-sm">
                        Retry
                    </button>
                </div>
            )}

            {/* Provisional Tax & Methodology Advisory */}
            <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 p-4 text-amber-900 dark:text-amber-200 flex items-start gap-3 text-sm">
                <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                    <p className="font-semibold text-amber-950 dark:text-amber-100">
                        Provisional Figures Including GST
                    </p>
                    <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                        Purchase tax treatment requires final review with your accountant. These figures reflect an
                        invoice-cohort bill analysis (all bills dated in range with their recorded subsequent returns) and
                        actual recorded operating expenses. Voided bills and old imported historical entries are excluded.
                    </p>
                </div>
            </div>

            {/* Loading State Skeleton */}
            {loading && !data && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {[1, 2, 3, 4].map((i) => (
                            <div key={i} className="card p-5 animate-pulse space-y-3">
                                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
                            </div>
                        ))}
                    </div>
                    <div className="card p-12 flex justify-center">
                        <Loading text="Compiling purchase cost allocations and financial cohorts..." />
                    </div>
                </div>
            )}

            {/* Main Content when data is ready */}
            {data && (
                <>
                    {/* Integrity Warning / Action Required Banner */}
                    {hasIntegrityIssues && (
                        <div className="card border-l-4 border-amber-500 bg-amber-50/40 dark:bg-amber-950/20 p-5 space-y-3">
                            <div className="flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                                <h3 className="font-bold text-amber-950 dark:text-amber-100 text-base">
                                    Action Required Before Relying on Profit Figures
                                </h3>
                            </div>
                            <p className="text-xs text-amber-800 dark:text-amber-300">
                                To ensure absolute accuracy, the system guards and withholds calculated profit totals rather
                                than displaying fabricated zero-cost numbers or estimated exchange revenue.
                            </p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                {data.missingBills > 0 && (
                                    <div className="p-3 bg-white dark:bg-dark-card rounded-lg border border-amber-200 dark:border-amber-900/60 text-xs space-y-1">
                                        <div className="flex items-center justify-between font-semibold text-amber-900 dark:text-amber-200">
                                            <span>Missing Receipt Costs</span>
                                            <span className="badge badge-warning">{data.missingBills} Bills</span>
                                        </div>
                                        <p className="text-gray-600 dark:text-gray-400">
                                            Bills contain items sold without saved receipt purchase costs. Stock costs above are
                                            a partial amount; current catalog costs are never guessed.
                                        </p>
                                    </div>
                                )}

                                {data.unresolvedExchangeBills > 0 && (
                                    <div className="p-3 bg-white dark:bg-dark-card rounded-lg border border-amber-200 dark:border-amber-900/60 text-xs space-y-1">
                                        <div className="flex items-center justify-between font-semibold text-amber-900 dark:text-amber-200">
                                            <span>Unresolved Exchange Bills</span>
                                            <span className="badge badge-danger">{data.unresolvedExchangeBills} Bills</span>
                                        </div>
                                        <p className="text-gray-600 dark:text-gray-400">
                                            Exchange-related bills have missing or inconsistent accounting links. Net sales and
                                            profit are withheld until those records can be reconciled.
                                        </p>
                                    </div>
                                )}

                                {data.reviewCount > 0 && (
                                    <div className="p-3 bg-white dark:bg-dark-card rounded-lg border border-amber-200 dark:border-amber-900/60 text-xs space-y-2">
                                        <div className="flex items-center justify-between font-semibold text-amber-900 dark:text-amber-200">
                                            <span>Unreviewed Drawer Expenses</span>
                                            <span className="badge badge-warning">{data.reviewCount} Entries ({formatPaise(data.reviewAmountPaise)})</span>
                                        </div>
                                        <p className="text-gray-600 dark:text-gray-400">
                                            Cash register drawer outflows await classification. Review them to complete the
                                            operating balance.
                                        </p>
                                        <Link
                                            to="/expenses"
                                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline pt-0.5"
                                        >
                                            <span>Review Drawer Outflows</span>
                                            <ArrowRight className="w-3.5 h-3.5" />
                                        </Link>
                                    </div>
                                )}

                                {data.heldUnknown > 0 && (
                                    <div className="p-3 bg-white dark:bg-dark-card rounded-lg border border-amber-200 dark:border-amber-900/60 text-xs space-y-1">
                                        <div className="flex items-center justify-between font-semibold text-amber-900 dark:text-amber-200">
                                            <span>Unknown Held-Return Loss Cost</span>
                                            <span className="badge badge-warning">{data.heldUnknown} Pieces</span>
                                        </div>
                                        <p className="text-gray-600 dark:text-gray-400">
                                            Held returns without captured stock costs prevent safe gross profit calculation.
                                        </p>
                                    </div>
                                )}

                                {data.laterReturns > 0 && (
                                    <div className="p-3 bg-white dark:bg-dark-card rounded-lg border border-amber-200 dark:border-amber-900/60 text-xs space-y-1">
                                        <div className="flex items-center justify-between font-semibold text-amber-900 dark:text-amber-200">
                                            <span>Returns After Selected Period</span>
                                            <span className="badge badge-warning">{data.laterReturns} Bills</span>
                                        </div>
                                        <p className="text-gray-600 dark:text-gray-400">
                                            Bills in this period were returned after the selected end date. Operating balance is
                                            withheld because bill returns and period expenses are from mismatched dates.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Hero KPI Stat Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* Net Bill Value Card */}
                        <div className="stat-card relative overflow-hidden group">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <p className="stat-label text-xs uppercase tracking-wider font-semibold">
                                        Net Sales Turnover
                                    </p>
                                    <div className="stat-value mt-1.5 text-xl xl:text-2xl font-bold truncate">
                                        {formatPaise(data.netSalesPaise)}
                                    </div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                        {data.bills} bills · Gross: {formatPaise(data.billedPaise)}
                                    </p>
                                </div>
                                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                                    <Receipt className="w-5 h-5" />
                                </div>
                            </div>
                            <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-dark-border flex items-center justify-between text-xs text-gray-500">
                                <span>Net of refunds & exchanges</span>
                                {data.netSalesPaise !== null ? (
                                    <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-0.5">
                                        <CheckCircle2 className="w-3.5 h-3.5" /> Reconciled
                                    </span>
                                ) : (
                                    <span className="badge badge-danger text-[10px]">Guarded</span>
                                )}
                            </div>
                        </div>

                        {/* Recorded Goods Cost Card */}
                        <div className="stat-card relative overflow-hidden group">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <p className="stat-label text-xs uppercase tracking-wider font-semibold">
                                        Recorded Goods Cost
                                    </p>
                                    <div className="stat-value mt-1.5 text-xl xl:text-2xl font-bold truncate">
                                        {formatPaise(data.knownCostPaise)}
                                    </div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                        {data.missingBills > 0
                                            ? `⚠️ Partial (${data.missingBills} bills missing costs)`
                                            : '100% matched to purchase batches'}
                                    </p>
                                </div>
                                <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex-shrink-0">
                                    <Package className="w-5 h-5" />
                                </div>
                            </div>
                            <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-dark-border flex items-center justify-between text-xs text-gray-500">
                                <span>FIFO purchase batch costs</span>
                                {data.missingBills === 0 ? (
                                    <span className="text-blue-600 dark:text-blue-400 font-medium">Complete</span>
                                ) : (
                                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                                        {data.unknownPieces} unknown pcs
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Provisional Gross Profit Card */}
                        <div className="stat-card relative overflow-hidden group">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <p className="stat-label text-xs uppercase tracking-wider font-semibold">
                                            Gross Profit
                                        </p>
                                        {data.marginPercent !== null && (
                                            <span className="badge badge-success text-[10px]">
                                                {data.marginPercent.toFixed(1)}% margin
                                            </span>
                                        )}
                                    </div>
                                    <div className={`stat-value mt-1.5 text-xl xl:text-2xl font-bold truncate ${
                                        data.grossProfitPaise !== null
                                            ? data.grossProfitPaise >= 0
                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                : 'text-red-600 dark:text-red-400'
                                            : ''
                                    }`}>
                                        {formatPaise(data.grossProfitPaise)}
                                    </div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                        Net sales − goods cost − held losses
                                    </p>
                                </div>
                                <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex-shrink-0">
                                    <TrendingUp className="w-5 h-5" />
                                </div>
                            </div>
                            <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-dark-border flex items-center justify-between text-xs text-gray-500">
                                <span>Held loss: {formatPaise(data.heldCostPaise)}</span>
                                {data.grossProfitPaise !== null ? (
                                    <span className="font-semibold text-purple-600 dark:text-purple-400">
                                        Provisional
                                    </span>
                                ) : (
                                    <span className="text-amber-600 dark:text-amber-400 font-medium">Withheld</span>
                                )}
                            </div>
                        </div>

                        {/* Provisional Operating Balance Card */}
                        <div className="stat-card relative overflow-hidden group">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <p className="stat-label text-xs uppercase tracking-wider font-semibold">
                                        Operating Balance
                                    </p>
                                    <div className={`stat-value mt-1.5 text-xl xl:text-2xl font-bold truncate ${
                                        data.operatingProfitPaise !== null
                                            ? data.operatingProfitPaise >= 0
                                                ? 'text-primary-600 dark:text-primary-400'
                                                : 'text-red-600 dark:text-red-400'
                                            : ''
                                    }`}>
                                        {formatPaise(data.operatingProfitPaise)}
                                    </div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                        Gross profit − {formatPaise(data.expensePaise)} expenses
                                    </p>
                                </div>
                                <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex-shrink-0">
                                    <DollarSign className="w-5 h-5" />
                                </div>
                            </div>
                            <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-dark-border flex items-center justify-between text-xs text-gray-500">
                                <span>Active expenses subtracted</span>
                                {data.operatingProfitPaise !== null ? (
                                    <span className="text-primary-600 dark:text-primary-400 font-medium">
                                        Period Balance
                                    </span>
                                ) : (
                                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                                        {data.reviewCount > 0 ? 'Review Needed' : 'Withheld'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Visual Financial Waterfall Flow */}
                    <div className="card space-y-4">
                        <div className="flex items-center justify-between border-b border-gray-100 dark:border-dark-border pb-3">
                            <div className="flex items-center gap-2">
                                <Layers className="w-5 h-5 text-primary-600" />
                                <h3 className="font-bold text-base">Financial Waterfall Flow</h3>
                            </div>
                            <span className="text-xs text-gray-500">Step-by-step cohort breakdown</span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5 text-center">
                            {/* Step 1: Gross Billed */}
                            <div className="p-3 bg-gray-50 dark:bg-dark-bg rounded-xl border border-gray-200 dark:border-dark-border">
                                <span className="text-[11px] font-medium text-gray-500 block">Gross Billed</span>
                                <span className="text-sm font-bold text-gray-900 dark:text-white block mt-1">
                                    {formatPaise(data.billedPaise)}
                                </span>
                                <span className="text-[10px] text-gray-400 mt-1 block">Item totals</span>
                            </div>

                            {/* Step 2: Discounts & Refunds */}
                            <div className="p-3 bg-red-50/50 dark:bg-red-950/20 rounded-xl border border-red-100 dark:border-red-900/30">
                                <span className="text-[11px] font-medium text-red-600 dark:text-red-400 block">
                                    − Discounts & Refunds
                                </span>
                                <span className="text-sm font-bold text-red-700 dark:text-red-300 block mt-1">
                                    −{formatPaise((data.discountPaise || 0) + (data.refundPaise || 0) + (data.exchangeReversalPaise || 0))}
                                </span>
                                <span className="text-[10px] text-gray-400 mt-1 block">Bill deductions</span>
                            </div>

                            {/* Step 3: Net Sales Turnover */}
                            <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800/40">
                                <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 block">
                                    = Net Turnover
                                </span>
                                <span className="text-sm font-bold text-emerald-800 dark:text-emerald-200 block mt-1">
                                    {formatPaise(data.netSalesPaise)}
                                </span>
                                <span className="text-[10px] text-emerald-600/80 mt-1 block">Retained sales</span>
                            </div>

                            {/* Step 4: Goods Cost */}
                            <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 rounded-xl border border-blue-100 dark:border-blue-900/30">
                                <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 block">
                                    − Sold Goods Cost
                                </span>
                                <span className="text-sm font-bold text-blue-700 dark:text-blue-300 block mt-1">
                                    −{formatPaise(data.knownCostPaise)}
                                </span>
                                <span className="text-[10px] text-gray-400 mt-1 block">Purchase batches</span>
                            </div>

                            {/* Step 5: Gross Profit */}
                            <div className="p-3 bg-purple-50/60 dark:bg-purple-950/30 rounded-xl border border-purple-200 dark:border-purple-800/40">
                                <span className="text-[11px] font-semibold text-purple-700 dark:text-purple-300 block">
                                    = Gross Profit
                                </span>
                                <span className="text-sm font-bold text-purple-800 dark:text-purple-200 block mt-1">
                                    {formatPaise(data.grossProfitPaise)}
                                </span>
                                <span className="text-[10px] text-purple-600/80 mt-1 block">
                                    {data.marginPercent !== null ? `${data.marginPercent.toFixed(1)}% margin` : 'Provisional'}
                                </span>
                            </div>

                            {/* Step 6: Operating Expenses */}
                            <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 rounded-xl border border-amber-100 dark:border-amber-900/30">
                                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400 block">
                                    − Shop Expenses
                                </span>
                                <span className="text-sm font-bold text-amber-800 dark:text-amber-300 block mt-1">
                                    −{formatPaise(data.expensePaise)}
                                </span>
                                <span className="text-[10px] text-gray-400 mt-1 block">Active spending</span>
                            </div>

                            {/* Step 7: Operating Balance */}
                            <div className="p-3 bg-primary-50/60 dark:bg-primary-950/30 rounded-xl border border-primary-200 dark:border-primary-800/40 col-span-2 sm:col-span-1">
                                <span className="text-[11px] font-semibold text-primary-700 dark:text-primary-300 block">
                                    = Operating Balance
                                </span>
                                <span className="text-sm font-bold text-primary-800 dark:text-primary-200 block mt-1">
                                    {formatPaise(data.operatingProfitPaise)}
                                </span>
                                <span className="text-[10px] text-primary-600/80 mt-1 block">Final balance</span>
                            </div>
                        </div>
                    </div>

                    {/* Detailed Breakdowns (2 Columns) */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Column 1: Sales & Exchange Activities */}
                        <div className="card space-y-4">
                            <div className="flex items-center justify-between border-b border-gray-100 dark:border-dark-border pb-3">
                                <div className="flex items-center gap-2">
                                    <Receipt className="w-5 h-5 text-emerald-600" />
                                    <h3 className="font-bold text-base">Sales & Revenue Breakdown</h3>
                                </div>
                                <span className="badge badge-info">{data.bills} Total Bills</span>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between items-center text-sm py-1.5 border-b border-gray-50 dark:border-gray-800">
                                    <span className="text-gray-600 dark:text-gray-400">Gross Billed Value</span>
                                    <span className="font-semibold">{formatPaise(data.billedPaise)}</span>
                                </div>

                                <div className="flex justify-between items-center text-sm py-1.5 border-b border-gray-50 dark:border-gray-800">
                                    <span className="text-gray-600 dark:text-gray-400">Bill-level Discounts</span>
                                    <span className="text-red-600 dark:text-red-400 font-medium">
                                        −{formatPaise(data.discountPaise)}
                                    </span>
                                </div>

                                <div className="flex justify-between items-center text-sm py-1.5 border-b border-gray-50 dark:border-gray-800">
                                    <span className="text-gray-600 dark:text-gray-400">Direct Customer Refunds</span>
                                    <span className="text-red-600 dark:text-red-400 font-medium">
                                        −{formatPaise(data.refundPaise)}
                                    </span>
                                </div>

                                <div className="flex justify-between items-center text-sm py-1.5 border-b border-gray-50 dark:border-gray-800">
                                    <div>
                                        <span className="text-gray-600 dark:text-gray-400 block">Exchange Credit Reversed</span>
                                        <span className="text-[11px] text-gray-400">Agreed credit granted on returned items</span>
                                    </div>
                                    <span className="text-red-600 dark:text-red-400 font-medium">
                                        −{formatPaise(data.exchangeReversalPaise)}
                                    </span>
                                </div>

                                <div className="flex justify-between items-center text-sm py-1.5 border-b border-gray-50 dark:border-gray-800">
                                    <div>
                                        <span className="text-gray-600 dark:text-gray-400 block">Surplus Customer Credit Issued</span>
                                        <span className="text-[11px] text-gray-400">Obligation to customer; not counted as revenue</span>
                                    </div>
                                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                                        {formatPaise(data.surplusCreditIssuedPaise)}
                                    </span>
                                </div>

                                <div className="flex justify-between items-center text-sm pt-2 font-bold bg-gray-50 dark:bg-dark-bg p-3 rounded-lg border border-gray-200 dark:border-dark-border">
                                    <span>Net Billed Sales Turnover</span>
                                    <span className="text-emerald-600 dark:text-emerald-400 text-base">
                                        {formatPaise(data.netSalesPaise)}
                                    </span>
                                </div>
                            </div>

                            <p className="text-xs text-gray-500 dark:text-gray-400 pt-1 leading-relaxed">
                                Exchange returns reverse the full credit granted; replacement bills count once. Surplus
                                credit issued on exchanges against selected original bills represents an obligation to the
                                customer, not store turnover.
                            </p>
                        </div>

                        {/* Column 2: Costs, Losses & Operating Outflows */}
                        <div className="card space-y-4">
                            <div className="flex items-center justify-between border-b border-gray-100 dark:border-dark-border pb-3">
                                <div className="flex items-center gap-2">
                                    <Package className="w-5 h-5 text-blue-600" />
                                    <h3 className="font-bold text-base">Costs & Operational Outflows</h3>
                                </div>
                                <span className="badge badge-success">
                                    {data.marginPercent !== null ? `${data.marginPercent.toFixed(1)}% Margin` : 'Guarded'}
                                </span>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between items-center text-sm py-1.5 border-b border-gray-50 dark:border-gray-800">
                                    <div>
                                        <span className="text-gray-600 dark:text-gray-400 block">Recorded Stock Cost</span>
                                        <span className="text-[11px] text-gray-400">Sold goods matched to purchase receipts</span>
                                    </div>
                                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                                        {formatPaise(data.knownCostPaise)}
                                    </span>
                                </div>

                                <div className="flex justify-between items-center text-sm py-1.5 border-b border-gray-50 dark:border-gray-800">
                                    <div>
                                        <span className="text-gray-600 dark:text-gray-400 block">Known Held-Return Losses</span>
                                        <span className="text-[11px] text-gray-400">Customer returns held outside saleable stock</span>
                                    </div>
                                    <span className="font-semibold text-red-600 dark:text-red-400">
                                        {formatPaise(data.heldCostPaise)}
                                    </span>
                                </div>

                                <div className="flex justify-between items-center text-sm py-1.5 border-b border-gray-50 dark:border-gray-800">
                                    <div>
                                        <span className="text-gray-600 dark:text-gray-400 block">Active Business Expenses</span>
                                        <span className="text-[11px] text-gray-400">Rent, electricity, wages, freight, etc.</span>
                                    </div>
                                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                                        {formatPaise(data.expensePaise)}
                                    </span>
                                </div>

                                <div className="flex justify-between items-center text-sm py-1.5 border-b border-gray-50 dark:border-gray-800">
                                    <div>
                                        <span className="text-gray-600 dark:text-gray-400 block">Drawer Outflows Pending Review</span>
                                        <span className="text-[11px] text-gray-400">Requires review in Expenses page</span>
                                    </div>
                                    <span className={`font-semibold ${data.reviewCount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                                        {formatPaise(data.reviewAmountPaise)} ({data.reviewCount})
                                    </span>
                                </div>

                                <div className="flex justify-between items-center text-sm py-1.5 border-b border-gray-50 dark:border-gray-800">
                                    <span className="text-gray-600 dark:text-gray-400">Reconciled Exchange Bills</span>
                                    <span className="font-semibold">{data.exchangeBills} Bills</span>
                                </div>

                                <div className="flex justify-between items-center text-sm pt-2 font-bold bg-gray-50 dark:bg-dark-bg p-3 rounded-lg border border-gray-200 dark:border-dark-border">
                                    <span>Provisional Operating Balance</span>
                                    <span className={`text-base ${
                                        data.operatingProfitPaise !== null && data.operatingProfitPaise >= 0
                                            ? 'text-primary-600 dark:text-primary-400'
                                            : 'text-red-600 dark:text-red-400'
                                    }`}>
                                        {formatPaise(data.operatingProfitPaise)}
                                    </span>
                                </div>
                            </div>

                            <p className="text-xs text-gray-500 dark:text-gray-400 pt-1 leading-relaxed">
                                Supplier purchase payments and owner cash withdrawals do not reduce profit. Gross profit
                                = net bill value − recorded goods cost − known held losses. Operating balance also
                                subtracts recorded expenses.
                            </p>
                        </div>
                    </div>

                    {/* Top Products Table */}
                    <div className="card space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 dark:border-dark-border pb-3">
                            <div className="flex items-center gap-2">
                                <BarChart3 className="w-5 h-5 text-primary-600 flex-shrink-0" />
                                <div>
                                    <h3 className="font-bold text-base">Top Products by Sales Volume & Value</h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                        Ranked by original billed item value before bill-level discounts and returns. Reflects
                                        sales mix, not individual product profit.
                                    </p>
                                </div>
                            </div>

                            {/* Search box for products */}
                            <div className="relative min-w-[200px] sm:min-w-[260px]">
                                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    className="input pl-9 py-1.5 text-xs"
                                    placeholder="Filter products..."
                                    value={productSearch}
                                    onChange={(e) => setProductSearch(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-dark-border">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th className="w-16 text-center">Rank</th>
                                        <th>Product Name</th>
                                        <th className="text-right">Units Sold</th>
                                        <th className="text-right">Billed Value</th>
                                        <th className="w-48 text-right">Sales Share</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredProducts.map((row, index) => {
                                        const sharePercent =
                                            totalProductsBilledPaise > 0
                                                ? (row.billedPaise / totalProductsBilledPaise) * 100
                                                : 0;

                                        return (
                                            <tr key={row.name} className="hover:bg-gray-50 dark:hover:bg-dark-bg/60 transition-colors">
                                                <td className="text-center font-bold text-xs">
                                                    {index === 0 ? (
                                                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 text-xs shadow-xs">
                                                            1
                                                        </span>
                                                    ) : index === 1 ? (
                                                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200 text-xs shadow-xs">
                                                            2
                                                        </span>
                                                    ) : index === 2 ? (
                                                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-700/20 text-amber-900 dark:text-amber-200 text-xs shadow-xs">
                                                            3
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-400">#{index + 1}</span>
                                                    )}
                                                </td>
                                                <td className="font-semibold text-sm text-gray-900 dark:text-white">
                                                    {row.name}
                                                </td>
                                                <td className="text-right">
                                                    <span className="badge badge-info font-medium">
                                                        {row.quantity} pcs
                                                    </span>
                                                </td>
                                                <td className="text-right font-bold text-sm text-gray-900 dark:text-white">
                                                    {formatPaise(row.billedPaise)}
                                                </td>
                                                <td className="text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <div className="w-24 bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                                                            <div
                                                                className="bg-primary-600 h-2 rounded-full"
                                                                style={{ width: `${Math.min(100, Math.max(2, sharePercent))}%` }}
                                                            />
                                                        </div>
                                                        <span className="text-xs font-medium text-gray-500 w-10 text-right">
                                                            {sharePercent.toFixed(1)}%
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}

                                    {filteredProducts.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="text-center py-10 text-gray-400 text-sm">
                                                {productSearch ? 'No matching products found.' : 'No completed bills in this date range.'}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-gray-500 dark:text-gray-400 pt-1 gap-2">
                            <span>
                                Showing {filteredProducts.length} top products by sales mix in selected period.
                            </span>
                            <span className="italic">
                                Unrecorded expenses and damaged stock losses outside held returns are not included.
                            </span>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
