import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Minus, Lock, Unlock, Trash2, RefreshCw, Loader2, AlertCircle, Edit3, X, Check, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import type { RegisterSummary, CashDrawerTx, TxCategory } from '../types/cashRegister';
import { TX_CATEGORY_LABELS, CASH_OUT_CATEGORIES } from '../types/cashRegister';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useAuthStore } from '../store/authStore';

// ─── Helpers ────────────────────────────────────────────────────────────────

const fmtAmount = (n: number) =>
    `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

const fmtDate = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
    });

type HistoryFilter = 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30_DAYS' | 'ALL';
const HISTORY_PAGE_SIZE = 10;

// ─── Main Page ───────────────────────────────────────────────────────────────

export const CashDrawerPage: React.FC = () => {
    const currentUser = useAuthStore((state) => state.user);
    const [summary, setSummary] = useState<RegisterSummary | null>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [error, setError] = useState('');
    const [reopening, setReopening] = useState(false);
    const [showReopenConfirm, setShowReopenConfirm] = useState(false);

    // History filter & pagination
    const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('THIS_MONTH');
    const [historyPage, setHistoryPage] = useState(1);

    // Modal state
    const [showCashOutModal, setShowCashOutModal] = useState(false);
    const [showCloseModal, setShowCloseModal] = useState(false);
    const [showAdjustFloat, setShowAdjustFloat] = useState(false);

    const loadSummary = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await window.electronAPI.register.getCurrent();
            if (res.success) {
                setSummary(res.data);
            } else {
                setError(res.error || 'Failed to load register');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const res = await window.electronAPI.register.getHistory(historyFilter === 'ALL' ? 5000 : 365);
            if (res.success) setHistory(res.data || []);
        } catch { /* ignore */ } finally {
            setHistoryLoading(false);
        }
    }, [historyFilter]);

    useEffect(() => {
        loadSummary();
        loadHistory();
    }, [loadSummary, loadHistory]);

    // Filter history based on selected period
    const filteredHistory = useMemo(() => {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        return history.filter((reg: any) => {
            if (historyFilter === 'ALL') return true;

            const regDate = new Date(reg.date + 'T00:00:00');
            const regYear = regDate.getFullYear();
            const regMonth = regDate.getMonth();

            if (historyFilter === 'THIS_MONTH') {
                return regYear === currentYear && regMonth === currentMonth;
            }
            if (historyFilter === 'LAST_MONTH') {
                const lastMonthDate = new Date(currentYear, currentMonth - 1, 1);
                return regYear === lastMonthDate.getFullYear() && regMonth === lastMonthDate.getMonth();
            }
            if (historyFilter === 'LAST_30_DAYS') {
                const diffTime = now.getTime() - regDate.getTime();
                const diffDays = diffTime / (1000 * 3600 * 24);
                return diffDays <= 30 && diffDays >= 0;
            }
            return true;
        });
    }, [history, historyFilter]);

    useEffect(() => {
        setHistoryPage(1);
    }, [historyFilter]);

    const totalHistoryPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
    const paginatedHistory = useMemo(() => {
        const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
        return filteredHistory.slice(start, start + HISTORY_PAGE_SIZE);
    }, [filteredHistory, historyPage]);

    const handleDeleteTx = async (txId: string) => {
        const res = await window.electronAPI.register.deleteTx(txId, currentUser?.id);
        if (res.success) loadSummary();
        else setError(res.error || 'Failed to delete transaction');
    };

    const handleConfirmReopen = async () => {
        setReopening(true);
        setError('');
        try {
            const res = await window.electronAPI.register.reopen(summary?.register?.id, currentUser?.id);
            if (res.success) {
                setShowReopenConfirm(false);
                handleAfterAction();
            } else {
                setError(res.error || 'Failed to reopen register');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setReopening(false);
        }
    };

    const handleAfterAction = () => {
        loadSummary();
        loadHistory();
    };

    // Derived values
    const openingFloat = summary?.openingFloat ?? 0;
    const cashSales = summary?.cashSales ?? 0;
    const cashOut = summary?.cashOut ?? 0;
    const expected = summary?.expectedCashInDrawer ?? 0;
    const transactions = summary?.transactions ?? [];
    const isClosed = summary?.register?.status === 'CLOSED';

    return (
        <div className="space-y-6">
            {error && (
                <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm border border-red-200 dark:border-red-800">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            )}

            {/* ── Unclosed Previous Day Banner ── */}
            {summary?.isPreviousDayUnclosed && (
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                        <div>
                            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                                Unclosed Register Detected from {fmtDate(summary.unclosedRegisterDate || summary.register.date)}
                            </h3>
                            <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                                This register remained open from a previous day (e.g. power cut or shutdown). Please reconcile and close it so its balance carries forward cleanly into today's register.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowCloseModal(true)}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs rounded-lg shadow transition-all shrink-0 self-start sm:self-auto"
                    >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Reconcile &amp; Close Past Register</span>
                    </button>
                </div>
            )}

            {/* ── Stat Cards ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Yesterday's Float / Opening Float */}
                <StatCard
                    label={summary?.isPreviousDayUnclosed ? "Opening Float" : "Yesterday's Float"}
                    value={fmtAmount(openingFloat)}
                    valueClass="text-gray-900 dark:text-white"
                    loading={loading}
                    action={
                        !isClosed ? (
                            <button
                                onClick={() => setShowAdjustFloat(true)}
                                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 flex items-center gap-1"
                            >
                                <Edit3 className="w-3.5 h-3.5" /> Adjust Float
                            </button>
                        ) : null
                    }
                />

                {/* Today's Cash Sales */}
                <StatCard
                    label={summary?.isPreviousDayUnclosed ? `Cash Sales (${summary.register.date})` : "Today's Cash Sales"}
                    value={fmtAmount(cashSales)}
                    valueClass="text-emerald-600 dark:text-emerald-400"
                    loading={loading}
                    action={
                        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                            <span>Gross: {fmtAmount(summary?.grossCashSales ?? cashSales)}</span>
                            {(summary?.cashRefunds ?? 0) > 0 && (
                                <span className="text-rose-500 font-medium">Refunds: −{fmtAmount(summary?.cashRefunds ?? 0)}</span>
                            )}
                        </div>
                    }
                />

                {/* Outflows / Taken */}
                <StatCard
                    label="Outflows / Taken"
                    value={fmtAmount(cashOut)}
                    valueClass="text-rose-600 dark:text-rose-400"
                    loading={loading}
                    action={
                        !isClosed ? (
                            <button
                                onClick={() => setShowCashOutModal(true)}
                                className="text-xs font-medium text-rose-600 hover:text-rose-700 dark:text-rose-400 flex items-center gap-1"
                            >
                                <Minus className="w-3.5 h-3.5" /> Add Cash Out
                            </button>
                        ) : null
                    }
                />

                {/* Expected in Till */}
                <StatCard
                    label="Expected in Till"
                    value={fmtAmount(expected)}
                    valueClass="text-indigo-600 dark:text-indigo-400"
                    highlight
                    loading={loading}
                    action={
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                            Float + Sales − Outflows
                        </span>
                    }
                />
            </div>

            {/* ── Action Buttons ── */}
            {!isClosed ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                        onClick={() => setShowCashOutModal(true)}
                        className="flex items-center justify-center gap-2 py-3 px-4 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-semibold rounded-xl shadow-sm hover:shadow transition-all text-sm"
                    >
                        <Minus className="w-4 h-4" />
                        <span>Add Cash Out <span className="text-xs font-normal opacity-85">(Freight / Expenses / Owner)</span></span>
                    </button>
                    <button
                        onClick={() => setShowCloseModal(true)}
                        className="flex items-center justify-center gap-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold rounded-xl shadow-sm hover:shadow transition-all text-sm"
                    >
                        <Lock className="w-4 h-4" />
                        <span>{summary?.isPreviousDayUnclosed ? `Close Register (${summary.register.date})` : "Close Today's Register"}</span>
                    </button>
                </div>
            ) : (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-xl">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                            <Check className="w-4 h-4" />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                                Today's Register is Closed
                            </h3>
                            <p className="text-xs text-emerald-700 dark:text-emerald-400">
                                Cash count has been reconciled and logged. Need to record a late customer sale? Reopen below.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowReopenConfirm(true)}
                        disabled={reopening}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white dark:bg-dark-card border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 text-xs font-semibold rounded-lg shadow-sm transition-all whitespace-nowrap self-start sm:self-auto disabled:opacity-50"
                    >
                        {reopening ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                        ) : (
                            <Unlock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        )}
                        <span>Reopen Register (Late Customer)</span>
                    </button>
                </div>
            )}

            {/* ── Today's Cash Ledger ── */}
            <div className="bg-white dark:bg-dark-card rounded-xl shadow-sm border border-gray-200 dark:border-dark-border overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-dark-border bg-gray-50/50 dark:bg-gray-800/20">
                    <div>
                        <h2 className="font-semibold text-gray-900 dark:text-white text-base">Today's Cash Ledger</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Chronological record of today's drawer cash movements</p>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full border border-gray-200 dark:border-gray-700">
                        {transactions.length} {transactions.length === 1 ? 'entry' : 'entries'}
                    </span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-dark-border">
                            <tr>
                                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-32">Time</th>
                                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-36">Type</th>
                                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Description</th>
                                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-44">Amount</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {loading ? (
                                <tr>
                                    <td colSpan={4} className="text-center py-10">
                                        <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mx-auto" />
                                    </td>
                                </tr>
                            ) : transactions.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
                                        No cash entries recorded for today yet.
                                    </td>
                                </tr>
                            ) : (
                                transactions.map((tx: CashDrawerTx) => {
                                    const isPositive = tx.type === 'CASH_SALE' || tx.type === 'CASH_IN';

                                    // Type Badge
                                    let badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/40';
                                    let badgeLabel = 'Cash Sale';
                                    if (tx.type === 'CASH_OUT') {
                                        badgeClass = 'bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800/40';
                                        badgeLabel = 'Cash Out';
                                    } else if (tx.type === 'CASH_IN') {
                                        badgeClass = 'bg-blue-50 text-blue-700 border-blue-200/60 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/40';
                                        badgeLabel = 'Cash In';
                                    } else if (tx.type === 'CASH_REFUND') {
                                        badgeClass = 'bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/40';
                                        badgeLabel = 'Refund';
                                    }

                                    // Clean Description (no redundant "POS Cash Sale" text)
                                    let title = '';
                                    let subtitle = '';
                                    if (tx.isSale || tx.isRefund) {
                                        title = tx.note || `Bill #${tx.billNo || '—'}`;
                                    } else {
                                        title = TX_CATEGORY_LABELS[tx.category as keyof typeof TX_CATEGORY_LABELS] || tx.category;
                                        if (tx.note) subtitle = tx.note;
                                    }

                                    return (
                                        <tr key={tx.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/30 transition-colors">
                                            <td className="px-5 py-3.5 text-xs font-mono text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                {fmtTime(tx.createdAt)}
                                            </td>
                                            <td className="px-5 py-3.5 whitespace-nowrap">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${badgeClass}`}>
                                                    {badgeLabel}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3.5 text-gray-900 dark:text-gray-100">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-medium text-sm text-gray-900 dark:text-white">{title}</span>
                                                    {subtitle && (
                                                        <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">
                                                            — {subtitle}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3.5 text-right whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-2">
                                                    <span className={`font-mono font-semibold text-sm ${
                                                        isPositive
                                                            ? 'text-emerald-600 dark:text-emerald-400'
                                                            : 'text-rose-600 dark:text-rose-400'
                                                    }`}>
                                                        {isPositive ? `+${fmtAmount(tx.amount)}` : `−${fmtAmount(tx.amount)}`}
                                                    </span>
                                                    {!tx.isSale && !tx.isRefund && tx.type !== 'CASH_REFUND' && !isClosed && (
                                                        <button
                                                            onClick={() => handleDeleteTx(tx.id)}
                                                            title="Delete manual entry"
                                                            className="p-1 text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Historical Register Closings ── */}
            <div className="bg-white dark:bg-dark-card rounded-xl shadow-sm border border-gray-200 dark:border-dark-border overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-dark-border bg-gray-50/50 dark:bg-gray-800/20">
                    <div>
                        <h2 className="font-semibold text-gray-900 dark:text-white text-base">Historical Register Closings</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Latest saved closing for each day and its cash reconciliation balance</p>
                    </div>
                    <div className="flex items-center gap-2 self-start sm:self-auto">
                        <div className="flex items-center gap-1.5 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-300 shadow-sm">
                            <Calendar className="w-3.5 h-3.5 text-gray-400" />
                            <select
                                value={historyFilter}
                                onChange={e => setHistoryFilter(e.target.value as HistoryFilter)}
                                className="bg-transparent border-none text-xs text-gray-700 dark:text-gray-300 focus:outline-none cursor-pointer font-medium pr-1"
                            >
                                <option value="THIS_MONTH">This Month</option>
                                <option value="LAST_MONTH">Last Month</option>
                                <option value="LAST_30_DAYS">Last 30 Days</option>
                                <option value="ALL">All Time</option>
                            </select>
                        </div>
                        <button
                            onClick={loadHistory}
                            disabled={historyLoading}
                            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 font-medium px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors border border-transparent hover:border-indigo-100 dark:hover:border-indigo-900/40"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${historyLoading ? 'animate-spin' : ''}`} />
                            <span>Refresh</span>
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-dark-border">
                            <tr>
                                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Opening Float</th>
                                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cash Sales</th>
                                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Outflows</th>
                                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Expected</th>
                                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actual Count</th>
                                <th className="px-5 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Difference</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {historyLoading ? (
                                <tr>
                                    <td colSpan={7} className="text-center py-10">
                                        <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mx-auto" />
                                    </td>
                                </tr>
                            ) : filteredHistory.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="text-center py-10 text-sm text-gray-400 dark:text-gray-500">
                                        No past day closures found for this selected period.
                                    </td>
                                </tr>
                            ) : (
                                paginatedHistory.map((reg: any) => {
                                    const diff = reg.difference ?? 0;
                                    const diffClass = Math.abs(diff) < 0.01
                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                                        : diff < 0
                                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400'
                                            : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
                                    const diffLabel = Math.abs(diff) < 0.01
                                        ? '✓ Balanced'
                                        : diff < 0
                                            ? `Shortage −${fmtAmount(Math.abs(diff))}`
                                            : `Excess +${fmtAmount(diff)}`;

                                    const txList = reg.transactions || [];
                                    const regCashOut = txList.filter((t: any) => t.type === 'CASH_OUT').reduce((s: number, t: any) => s + Number(t.amount), 0);
                                    const regCashIn  = txList.filter((t: any) => t.type === 'CASH_IN').reduce((s: number, t: any) => s + Number(t.amount), 0);
                                    const regSales = reg.closingExpected != null
                                        ? Number(reg.closingExpected) - Number(reg.openingFloat) + regCashOut - regCashIn
                                        : null;

                                    return (
                                        <tr key={reg.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/30 transition-colors">
                                            <td className="px-5 py-3.5 font-medium text-gray-900 dark:text-white">
                                                <div>{fmtDate(reg.date)}</div>
                                                {reg.notes && (
                                                    <div className="text-xs text-gray-400 mt-0.5 italic">{reg.notes}</div>
                                                )}
                                            </td>
                                            <td className="px-5 py-3.5 text-right font-mono text-gray-700 dark:text-gray-300">
                                                {fmtAmount(Number(reg.openingFloat))}
                                            </td>
                                            <td className="px-5 py-3.5 text-right font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                                                {regSales !== null ? fmtAmount(regSales) : '—'}
                                            </td>
                                            <td className="px-5 py-3.5 text-right font-mono text-rose-600 dark:text-rose-400 font-medium">
                                                {fmtAmount(regCashOut)}
                                            </td>
                                            <td className="px-5 py-3.5 text-right font-mono font-semibold text-gray-900 dark:text-white">
                                                {reg.closingExpected != null ? fmtAmount(Number(reg.closingExpected)) : '—'}
                                            </td>
                                            <td className="px-5 py-3.5 text-right font-mono font-semibold text-gray-900 dark:text-white">
                                                {reg.closingActual != null ? fmtAmount(Number(reg.closingActual)) : '—'}
                                            </td>
                                            <td className="px-5 py-3.5 text-center">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${diffClass}`}>
                                                    {diffLabel}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* ── Pagination Footer ── */}
                {filteredHistory.length > 0 && (
                    <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-dark-border bg-gray-50/50 dark:bg-gray-800/20 text-xs">
                        <span className="text-gray-500 dark:text-gray-400">
                            Showing <span className="font-semibold text-gray-700 dark:text-gray-200">{(historyPage - 1) * HISTORY_PAGE_SIZE + 1}</span> to{' '}
                            <span className="font-semibold text-gray-700 dark:text-gray-200">
                                {Math.min(historyPage * HISTORY_PAGE_SIZE, filteredHistory.length)}
                            </span>{' '}
                            of <span className="font-semibold text-gray-700 dark:text-gray-200">{filteredHistory.length}</span> closures
                        </span>
                        {totalHistoryPages > 1 && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                                    disabled={historyPage === 1}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
                                >
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                    <span>Prev</span>
                                </button>
                                <span className="font-medium text-gray-700 dark:text-gray-300 px-1">
                                    {historyPage} / {totalHistoryPages}
                                </span>
                                <button
                                    onClick={() => setHistoryPage(p => Math.min(totalHistoryPages, p + 1))}
                                    disabled={historyPage === totalHistoryPages}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
                                >
                                    <span>Next</span>
                                    <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── Modals ── */}
            {showCashOutModal && (
                <CashOutModal
                    onClose={() => setShowCashOutModal(false)}
                    onSuccess={() => { setShowCashOutModal(false); handleAfterAction(); }}
                    userId={currentUser?.id}
                />
            )}
            {showCloseModal && (
                <CloseRegisterInlineModal
                    summary={summary}
                    onClose={() => setShowCloseModal(false)}
                    onClosed={() => { setShowCloseModal(false); handleAfterAction(); }}
                    userId={currentUser?.id}
                />
            )}
            {showAdjustFloat && (
                <AdjustFloatModal
                    currentFloat={openingFloat}
                    onClose={() => setShowAdjustFloat(false)}
                    onSuccess={() => { setShowAdjustFloat(false); handleAfterAction(); }}
                    userId={currentUser?.id}
                />
            )}
            {showReopenConfirm && (
                <ConfirmDialog
                    isOpen={showReopenConfirm}
                    onClose={() => setShowReopenConfirm(false)}
                    onConfirm={handleConfirmReopen}
                    title="Reopen Today's Register"
                    message="Reopen today's register? This allows you to record late customer sales or outflows before doing the final close."
                    confirmText="Reopen Register"
                    variant="primary"
                    confirmVariant="primary"
                    loading={reopening}
                />
            )}
        </div>
    );
};

// ─── Stat Card Component ─────────────────────────────────────────────────────

const StatCard: React.FC<{
    label: string;
    value: string;
    valueClass?: string;
    valueSize?: string;
    loading?: boolean;
    action?: React.ReactNode;
    highlight?: boolean;
}> = ({ label, value, valueClass = '', valueSize = 'text-2xl', loading, action, highlight }) => (
    <div className={`bg-white dark:bg-dark-card rounded-xl p-5 shadow-sm border flex flex-col justify-between ${
        highlight
            ? 'border-indigo-300 dark:border-indigo-600/60 ring-1 ring-indigo-200 dark:ring-indigo-800/40'
            : 'border-gray-200 dark:border-dark-border'
    }`}>
        <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 tracking-wider uppercase mb-1">{label}</p>
            {loading ? (
                <div className="h-8 w-28 bg-gray-100 dark:bg-gray-700 rounded animate-pulse my-2" />
            ) : (
                <p className={`${valueSize} font-bold font-mono my-1 tracking-tight ${valueClass}`}>{value}</p>
            )}
        </div>
        {action && (
            <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-dark-border/60">
                {action}
            </div>
        )}
    </div>
);


// ─── Cash Out Modal ─────────────────────────────────────────────────────────

const CashOutModal: React.FC<{
    onClose: () => void;
    onSuccess: () => void;
    userId?: string;
}> = ({ onClose, onSuccess, userId }) => {
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState<TxCategory>('OWNER_WITHDRAWAL');
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const amountRef = useRef<HTMLInputElement>(null);

    useEffect(() => { amountRef.current?.focus(); }, []);

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const amt = parseFloat(amount);
        if (isNaN(amt) || amt <= 0) { setError('Enter a valid amount'); return; }
        if (!note.trim()) { setError('Add a brief note'); return; }
        setLoading(true);
        setError('');
        try {
            const res = await window.electronAPI.register.addTx({
                type: 'CASH_OUT',
                category,
                amount: amt,
                note: note.trim(),
                userId
            });
            if (res.success) onSuccess();
            else setError(res.error || 'Failed');
        } catch (err: any) { setError(err.message); }
        finally { setLoading(false); }
    };

    const categories = CASH_OUT_CATEGORIES.map(c => ({ value: c, label: TX_CATEGORY_LABELS[c] }));

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-sm border border-gray-200 dark:border-dark-border animate-slide-up">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 rounded-t-2xl bg-rose-600">
                    <div className="flex items-center gap-2 text-white">
                        <Minus className="w-5 h-5" />
                        <h2 className="font-semibold text-base">Add Cash Out</h2>
                    </div>
                    <button onClick={onClose} className="text-white/70 hover:text-white p-1 rounded">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="p-5 space-y-4" onKeyDown={e => e.key === 'Escape' && onClose()}>
                    <div>
                        <label className="label">Amount (₹)</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">₹</span>
                            <input
                                ref={amountRef}
                                type="number" min="0.01" step="0.01"
                                value={amount} onChange={e => setAmount(e.target.value)}
                                onWheel={(e) => (e.target as HTMLElement).blur()}
                                className="input pl-8 text-xl font-bold font-mono" placeholder="0.00"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="label">Category</label>
                        <select value={category} onChange={e => setCategory(e.target.value as TxCategory)} className="input">
                            {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="label">Note / Description</label>
                        <input
                            type="text" value={note} onChange={e => setNote(e.target.value)}
                            className="input" placeholder="Brief description..." maxLength={200}
                        />
                    </div>
                    {error && <p className="text-sm text-rose-500 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 rounded-lg">{error}</p>}
                    <div className="flex gap-3 pt-1">
                        <button type="button" onClick={onClose} className="btn-outline flex-1" disabled={loading}>Cancel</button>
                        <button
                            type="submit"
                            className="btn flex-1 text-white bg-rose-600 hover:bg-rose-700"
                            disabled={loading}
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Minus className="w-4 h-4" />}
                            Save Entry
                        </button>
                    </div>
                    <p className="text-center text-xs text-gray-400">Press <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">Enter</kbd> to save</p>
                </form>
            </div>
        </div>
    );
};

// ─── Adjust Float Modal ───────────────────────────────────────────────────────

const AdjustFloatModal: React.FC<{
    currentFloat: number;
    onClose: () => void;
    onSuccess: () => void;
    userId?: string;
}> = ({ currentFloat, onClose, onSuccess, userId }) => {
    const [value, setValue] = useState(currentFloat.toFixed(2));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

    const handleSave = async () => {
        const v = parseFloat(value);
        if (isNaN(v) || v < 0) { setError('Enter a valid amount'); return; }
        setLoading(true);
        try {
            const res = await window.electronAPI.register.adjustOpeningFloat(v, userId);
            if (res.success) onSuccess();
            else setError(res.error || 'Failed');
        } catch (err: any) { setError(err.message); }
        finally { setLoading(false); }
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-xs border border-gray-200 dark:border-dark-border animate-slide-up p-6 space-y-4">
                <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <Edit3 className="w-4 h-4 text-indigo-500" /> Adjust Opening Float
                </h2>
                <div>
                    <label className="label">Opening Float (₹)</label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">₹</span>
                        <input
                            ref={inputRef}
                            type="number" min="0" step="0.01"
                            value={value} onChange={e => setValue(e.target.value)}
                            onWheel={(e) => (e.target as HTMLElement).blur()}
                            className="input pl-8 text-xl font-bold font-mono"
                            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
                        />
                    </div>
                </div>
                {error && <p className="text-sm text-rose-500">{error}</p>}
                <div className="flex gap-3">
                    <button onClick={onClose} className="btn-outline flex-1" disabled={loading}>Cancel</button>
                    <button onClick={handleSave} className="btn-primary flex-1" disabled={loading}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── Close Register Modal (inline, self-contained) ────────────────────────────

const CloseRegisterInlineModal: React.FC<{
    summary: RegisterSummary | null;
    onClose: () => void;
    onClosed: () => void;
    userId?: string;
}> = ({ summary, onClose, onClosed, userId }) => {
    const [actualCash, setActualCash] = useState('');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => { inputRef.current?.focus(); }, []);

    const expected = summary?.expectedCashInDrawer ?? 0;
    const actual = parseFloat(actualCash);
    const hasActual = !isNaN(actual) && actualCash !== '';
    const difference = hasActual ? actual - expected : null;

    const diffInfo = (() => {
        if (difference === null) return { label: '—', cls: 'text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800' };
        if (Math.abs(difference) < 0.01) return { label: '✓ Balanced', cls: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' };
        if (difference < 0) return { label: `Shortage −${fmtAmount(Math.abs(difference))}`, cls: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-900/20' };
        return { label: `Excess +${fmtAmount(difference)}`, cls: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' };
    })();

    const handleClose = async () => {
        if (!hasActual) { setError('Enter the cash counted'); return; }
        setLoading(true);
        setError('');
        try {
            const res = await window.electronAPI.register.close({
                actualCashCounted: actual,
                notes,
                registerId: summary?.register?.id,
                userId
            });
            if (res.success) onClosed();
            else setError(res.error || 'Failed');
        } catch (err: any) { setError(err.message); }
        finally { setLoading(false); }
    };

    const isPastDay = summary?.isPreviousDayUnclosed;
    const modalTitle = isPastDay
        ? `Reconcile & Close Past Register (${fmtDate(summary?.unclosedRegisterDate || summary?.register?.date || '')})`
        : "Close Today's Register";

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-md border border-gray-200 dark:border-dark-border animate-slide-up">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 bg-indigo-600 rounded-t-2xl">
                    <div className="flex items-center gap-2 text-white">
                        <Lock className="w-5 h-5" />
                        <h2 className="font-semibold text-base">{modalTitle}</h2>
                    </div>
                    <button onClick={onClose} className="text-white/70 hover:text-white p-1 rounded">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Summary */}
                <div className="px-6 pt-5 pb-4 space-y-3">
                    <SummaryLine label="Opening Float" value={fmtAmount(summary?.openingFloat ?? 0)} />
                    <SummaryLine
                        label="(+) Cash Sales (Gross)"
                        value={fmtAmount(summary?.grossCashSales ?? summary?.cashSales ?? 0)}
                        valueClass="text-emerald-600 dark:text-emerald-400"
                    />
                    {(summary?.cashRefunds ?? 0) > 0 && (
                        <SummaryLine
                            label="(−) Cash Refunds Paid Out"
                            value={`−${fmtAmount(summary?.cashRefunds ?? 0)}`}
                            valueClass="text-rose-600 dark:text-rose-400"
                        />
                    )}
                    <SummaryLine label="(+) Cash In / Top-Up" value={fmtAmount(summary?.cashIn ?? 0)} valueClass="text-blue-600 dark:text-blue-400" />
                    <SummaryLine label="(−) Cash Outflows" value={fmtAmount(summary?.cashOut ?? 0)} valueClass="text-rose-600 dark:text-rose-400" />
                    <div className="border-t border-gray-100 dark:border-dark-border pt-3">
                        <SummaryLine label="(=) Expected Cash in Till" value={fmtAmount(expected)} valueClass="text-indigo-600 dark:text-indigo-400 text-lg font-bold" bold />
                    </div>
                </div>

                <div className="px-6 pb-5 space-y-4">
                    {/* Actual cash input */}
                    <div>
                        <label className="label">Actual Cash Counted (₹)</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">₹</span>
                            <input
                                ref={inputRef}
                                type="number" min="0" step="0.01"
                                value={actualCash} onChange={e => setActualCash(e.target.value)}
                                onWheel={(e) => (e.target as HTMLElement).blur()}
                                className="input pl-8 text-2xl font-bold font-mono" placeholder="0.00"
                                onKeyDown={e => e.key === 'Escape' && onClose()}
                            />
                        </div>
                    </div>

                    {/* Live difference */}
                    {hasActual && (
                        <div className={`flex items-center justify-between px-4 py-3 rounded-xl ${diffInfo.bg}`}>
                            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Difference</span>
                            <span className={`font-bold text-base ${diffInfo.cls}`}>{diffInfo.label}</span>
                        </div>
                    )}

                    <div>
                        <label className="label">Notes (optional)</label>
                        <input
                            type="text" value={notes} onChange={e => setNotes(e.target.value)}
                            className="input" placeholder="Any remarks..." maxLength={300}
                        />
                    </div>

                    {error && <p className="text-sm text-rose-500 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 rounded-lg">{error}</p>}

                    <div className="flex gap-3">
                        <button onClick={onClose} className="btn-outline flex-1" disabled={loading}>Cancel</button>
                        <button
                            onClick={handleClose}
                            className="btn flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                            disabled={loading || !hasActual}
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                            Save &amp; Close Register
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SummaryLine: React.FC<{ label: string; value: string; valueClass?: string; bold?: boolean }> = ({
    label, value, valueClass = 'text-gray-900 dark:text-white', bold
}) => (
    <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
        <span className={`text-sm font-${bold ? 'bold' : 'semibold'} ${valueClass}`}>{value}</span>
    </div>
);
