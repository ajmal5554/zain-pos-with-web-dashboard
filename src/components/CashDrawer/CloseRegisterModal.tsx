import React, { useState, useEffect, useRef } from 'react';
import {
    X, Lock, TrendingUp, TrendingDown, Minus, Plus,
    AlertCircle, Loader2, RefreshCw, Trash2, ChevronRight, DollarSign
} from 'lucide-react';
import type { RegisterSummary, CashDrawerTx } from '../../types/cashRegister';
import { TX_CATEGORY_LABELS } from '../../types/cashRegister';

interface CloseRegisterModalProps {
    onClose: () => void;
    onClosed: () => void;
}

const fmt = (n: number) =>
    `₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const CloseRegisterModal: React.FC<CloseRegisterModalProps> = ({ onClose, onClosed }) => {
    const [summary, setSummary] = useState<RegisterSummary | null>(null);
    const [actualCash, setActualCash] = useState('');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(true);
    const [closing, setClosing] = useState(false);
    const [error, setError] = useState('');
    const [showTxList, setShowTxList] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const loadSummary = async () => {
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
            setError(err.message || 'Unexpected error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSummary();
    }, []);

    useEffect(() => {
        if (!loading) inputRef.current?.focus();
    }, [loading]);

    const handleDeleteTx = async (txId: string) => {
        try {
            const res = await window.electronAPI.register.deleteTx(txId);
            if (res.success) {
                await loadSummary();
            } else {
                setError(res.error || 'Failed to delete');
            }
        } catch (err: any) {
            setError(err.message || 'Unexpected error');
        }
    };

    const handleClose = async () => {
        const actual = parseFloat(actualCash);
        if (isNaN(actual) || actual < 0) {
            setError('Please enter the actual cash counted');
            inputRef.current?.focus();
            return;
        }

        setClosing(true);
        setError('');
        try {
            const res = await window.electronAPI.register.close({ actualCashCounted: actual, notes });
            if (res.success) {
                onClosed();
                onClose();
            } else {
                setError(res.error || 'Failed to close register');
            }
        } catch (err: any) {
            setError(err.message || 'Unexpected error');
        } finally {
            setClosing(false);
        }
    };

    // Derived values
    const actual = parseFloat(actualCash);
    const hasActual = !isNaN(actual) && actualCash !== '';
    const expected = summary?.expectedCashInDrawer ?? 0;
    const difference = hasActual ? actual - expected : null;

    const getDifferenceStyle = () => {
        if (difference === null) return { text: 'text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800', label: '—' };
        if (Math.abs(difference) < 0.01) return { text: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', label: '✓ Balanced' };
        if (difference < 0) return { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', label: `Shortage −${fmt(Math.abs(difference))}` };
        return { text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', label: `Excess +${fmt(difference)}` };
    };

    const diffStyle = getDifferenceStyle();

    const txByCashOut = summary?.transactions.filter(t => t.type === 'CASH_OUT') ?? [];
    const txByCashIn = summary?.transactions.filter(t => t.type === 'CASH_IN') ?? [];

    return (
        <div
            className="modal-overlay"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-dark-border animate-slide-up max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-dark-border shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                            <Lock className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Close Register / Cash Tally</h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {summary?.register.date
                                    ? new Date(summary.register.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
                                    : 'Loading...'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={loadSummary}
                            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            title="Refresh"
                        >
                            <RefreshCw className="w-4 h-4 text-gray-400" />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            <X className="w-4 h-4 text-gray-500" />
                        </button>
                    </div>
                </div>

                {/* Scrollable Body */}
                <div className="overflow-y-auto flex-1 p-6 space-y-5">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                        </div>
                    ) : error ? (
                        <div className="flex items-start gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg text-sm">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    ) : summary ? (
                        <>
                            {/* Summary Cards */}
                            <div className="grid grid-cols-2 gap-3">
                                <SummaryRow
                                    label="Opening Float"
                                    value={fmt(summary.openingFloat)}
                                    icon={<DollarSign className="w-4 h-4 text-gray-500" />}
                                    color="gray"
                                />
                                <SummaryRow
                                    label="(+) Cash Sales Today"
                                    value={fmt(summary.cashSales)}
                                    icon={<TrendingUp className="w-4 h-4 text-green-600" />}
                                    color="green"
                                />
                                {summary.cashIn > 0 && (
                                    <SummaryRow
                                        label="(+) Cash In"
                                        value={fmt(summary.cashIn)}
                                        icon={<Plus className="w-4 h-4 text-blue-600" />}
                                        color="blue"
                                    />
                                )}
                                <SummaryRow
                                    label="(−) Cash Outflows"
                                    value={fmt(summary.cashOut)}
                                    icon={<TrendingDown className="w-4 h-4 text-red-600" />}
                                    color="red"
                                />
                            </div>

                            {/* Expected Total */}
                            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-4 border border-indigo-100 dark:border-indigo-800">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                                        (=) Expected Cash in Drawer
                                    </span>
                                    <span className="text-xl font-bold text-indigo-700 dark:text-indigo-200">
                                        {fmt(summary.expectedCashInDrawer)}
                                    </span>
                                </div>
                            </div>

                            {/* Outflow transactions */}
                            {(txByCashOut.length > 0 || txByCashIn.length > 0) && (
                                <div>
                                    <button
                                        onClick={() => setShowTxList(!showTxList)}
                                        className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                                    >
                                        <ChevronRight className={`w-4 h-4 transition-transform ${showTxList ? 'rotate-90' : ''}`} />
                                        {showTxList ? 'Hide' : 'Show'} itemized transactions ({summary.transactions.length})
                                    </button>
                                    {showTxList && (
                                        <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                                            {summary.transactions.map((tx) => (
                                                <TxRow key={tx.id} tx={tx} onDelete={handleDeleteTx} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Actual Cash Input */}
                            <div>
                                <label className="label">Actual Cash Counted in Till (₹)</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">₹</span>
                                    <input
                                        ref={inputRef}
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={actualCash}
                                        onChange={(e) => setActualCash(e.target.value)}
                                        className="input pl-8 text-xl font-bold"
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>

                            {/* Live Difference Badge */}
                            {hasActual && (
                                <div className={`rounded-xl px-4 py-3 ${diffStyle.bg} flex items-center justify-between`}>
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Difference</span>
                                    <span className={`text-lg font-bold ${diffStyle.text}`}>{diffStyle.label}</span>
                                </div>
                            )}

                            {/* Notes */}
                            <div>
                                <label className="label">Notes (optional)</label>
                                <input
                                    type="text"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    className="input"
                                    placeholder="Any remarks for today's register..."
                                    maxLength={300}
                                />
                            </div>
                        </>
                    ) : null}
                </div>

                {/* Footer */}
                {!loading && !error && (
                    <div className="px-6 py-4 border-t border-gray-100 dark:border-dark-border shrink-0 flex gap-3">
                        <button
                            onClick={onClose}
                            className="btn-outline flex-1"
                            disabled={closing}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleClose}
                            className="btn flex-1 bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-lg focus:ring-indigo-500 focus:ring-2 focus:ring-offset-2"
                            disabled={closing || !hasActual}
                        >
                            {closing ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Lock className="w-4 h-4" />
                            )}
                            Save &amp; Close Register
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── Sub-components ──────────────────────────────────────────────────────────

const SummaryRow: React.FC<{
    label: string;
    value: string;
    icon: React.ReactNode;
    color: 'gray' | 'green' | 'red' | 'blue';
}> = ({ label, value, icon, color }) => {
    const bg = {
        gray: 'bg-gray-50 dark:bg-gray-800/50',
        green: 'bg-green-50 dark:bg-green-900/10',
        red: 'bg-red-50 dark:bg-red-900/10',
        blue: 'bg-blue-50 dark:bg-blue-900/10',
    }[color];

    return (
        <div className={`rounded-xl p-3 ${bg}`}>
            <div className="flex items-center gap-1.5 mb-1">
                {icon}
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{label}</span>
            </div>
            <span className="text-base font-bold text-gray-900 dark:text-white">{value}</span>
        </div>
    );
};

const TxRow: React.FC<{ tx: CashDrawerTx; onDelete: (id: string) => void }> = ({ tx, onDelete }) => (
    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm">
        <div className="flex items-center gap-2 min-w-0">
            {tx.type === 'CASH_OUT' ? (
                <Minus className="w-3.5 h-3.5 text-red-500 shrink-0" />
            ) : (
                <Plus className="w-3.5 h-3.5 text-green-500 shrink-0" />
            )}
            <span className="truncate text-gray-700 dark:text-gray-300" title={tx.note}>
                {TX_CATEGORY_LABELS[tx.category as keyof typeof TX_CATEGORY_LABELS] || tx.category} — {tx.note}
            </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className={`font-semibold ${tx.type === 'CASH_OUT' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                {tx.type === 'CASH_OUT' ? '−' : '+'}₹{Number(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
            <button
                onClick={() => onDelete(tx.id)}
                className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-gray-400 hover:text-red-500 transition-colors"
                title="Delete"
            >
                <Trash2 className="w-3.5 h-3.5" />
            </button>
        </div>
    </div>
);
