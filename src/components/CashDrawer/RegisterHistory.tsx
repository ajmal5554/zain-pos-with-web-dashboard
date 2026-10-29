import React, { useState, useEffect, useCallback } from 'react';
import {
    ChevronDown, ChevronRight, Loader2, AlertCircle,
    Calendar, TrendingUp, TrendingDown, DollarSign, Minus, Plus, RefreshCw,
    CheckCircle2, ArrowUpDown
} from 'lucide-react';
import type { CashRegister, CashDrawerTx } from '../../types/cashRegister';
import { TX_CATEGORY_LABELS } from '../../types/cashRegister';

interface RegisterWithTx extends CashRegister {
    transactions: CashDrawerTx[];
}

const fmt = (n: number | null | undefined) => {
    if (n === null || n === undefined) return '—';
    const abs = Math.abs(n);
    return `₹${abs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtSigned = (n: number | null | undefined) => {
    if (n === null || n === undefined) return '—';
    const prefix = n > 0.005 ? '+' : n < -0.005 ? '−' : '';
    return `${prefix}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const DiffBadge: React.FC<{ diff: number | null | undefined }> = ({ diff }) => {
    if (diff === null || diff === undefined) return <span className="badge bg-gray-100 text-gray-500">—</span>;
    if (Math.abs(diff) < 0.01) {
        return <span className="badge badge-success flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Balanced</span>;
    }
    if (diff < 0) {
        return <span className="badge badge-danger">Shortage {fmtSigned(diff)}</span>;
    }
    return <span className="badge badge-info">Excess {fmtSigned(diff)}</span>;
};

export const RegisterHistory: React.FC = () => {
    const [registers, setRegisters] = useState<RegisterWithTx[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await window.electronAPI.register.getHistory(60);
            if (res.success) {
                setRegisters(res.data || []);
            } else {
                setError(res.error || 'Failed to load history');
            }
        } catch (err: any) {
            setError(err.message || 'Unexpected error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const toggleExpand = (id: string) => {
        setExpandedId(prev => (prev === id ? null : id));
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center gap-3 py-16 text-red-500">
                <AlertCircle className="w-10 h-10" />
                <p className="text-sm">{error}</p>
                <button onClick={load} className="btn-outline btn-sm">Retry</button>
            </div>
        );
    }

    if (registers.length === 0) {
        return (
            <div className="flex flex-col items-center gap-3 py-20 text-gray-400">
                <Calendar className="w-12 h-12 opacity-40" />
                <p className="text-base font-medium">No closed registers yet</p>
                <p className="text-sm">Close your first daily register to see history here.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">Daily Register History</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{registers.length} records</p>
                </div>
                <button onClick={load} className="btn-ghost btn-sm flex items-center gap-1.5">
                    <RefreshCw className="w-4 h-4" />
                    Refresh
                </button>
            </div>

            {/* Table */}
            <div className="rounded-xl border border-gray-200 dark:border-dark-border overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="table w-full">
                        <thead>
                            <tr>
                                <th className="w-6"></th>
                                <th>Date</th>
                                <th className="text-right">Opening Float</th>
                                <th className="text-right">Cash Sales</th>
                                <th className="text-right">Outflows</th>
                                <th className="text-right">Expected</th>
                                <th className="text-right">Actual Count</th>
                                <th className="text-center">Difference</th>
                            </tr>
                        </thead>
                        <tbody>
                            {registers.map((reg) => {
                                const isExpanded = expandedId === reg.id;
                                const cashOut = (reg.transactions || [])
                                    .filter(t => t.type === 'CASH_OUT')
                                    .reduce((s, t) => s + Number(t.amount), 0);
                                const cashSales = reg.closingExpected !== null && reg.closingExpected !== undefined
                                    ? reg.closingExpected - Number(reg.openingFloat) + cashOut - (reg.transactions || [])
                                        .filter(t => t.type === 'CASH_IN')
                                        .reduce((s, t) => s + Number(t.amount), 0)
                                    : null;

                                return (
                                    <React.Fragment key={reg.id}>
                                        <tr
                                            className="cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition-colors"
                                            onClick={() => toggleExpand(reg.id)}
                                        >
                                            <td className="w-6 pl-3">
                                                {isExpanded
                                                    ? <ChevronDown className="w-4 h-4 text-indigo-500" />
                                                    : <ChevronRight className="w-4 h-4 text-gray-400" />
                                                }
                                            </td>
                                            <td>
                                                <div className="font-medium text-gray-900 dark:text-white">
                                                    {reg.date}
                                                </div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                                    {reg.closedAt
                                                        ? `Closed ${new Date(reg.closedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                                                        : ''}
                                                </div>
                                            </td>
                                            <td className="text-right font-mono text-sm">{fmt(reg.openingFloat)}</td>
                                            <td className="text-right font-mono text-sm text-green-700 dark:text-green-400">
                                                {cashSales !== null ? fmt(cashSales) : '—'}
                                            </td>
                                            <td className="text-right font-mono text-sm text-red-600 dark:text-red-400">
                                                {fmt(cashOut)}
                                            </td>
                                            <td className="text-right font-mono text-sm font-semibold">
                                                {fmt(reg.closingExpected)}
                                            </td>
                                            <td className="text-right font-mono text-sm font-semibold">
                                                {fmt(reg.closingActual)}
                                            </td>
                                            <td className="text-center">
                                                <DiffBadge diff={reg.difference} />
                                            </td>
                                        </tr>

                                        {/* Expanded Row */}
                                        {isExpanded && (
                                            <tr>
                                                <td colSpan={8} className="p-0">
                                                    <div className="bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-dark-border px-6 py-4">
                                                        <ExpandedDetails reg={reg} />
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// ─── Expanded Details ─────────────────────────────────────────────────────────

const ExpandedDetails: React.FC<{ reg: RegisterWithTx }> = ({ reg }) => {
    const txList = reg.transactions || [];
    const cashOutTx = txList.filter(t => t.type === 'CASH_OUT');
    const cashInTx = txList.filter(t => t.type === 'CASH_IN');

    return (
        <div className="space-y-4">
            {/* Notes */}
            {reg.notes && (
                <p className="text-sm text-gray-600 dark:text-gray-300 italic">
                    Notes: {reg.notes}
                </p>
            )}

            {txList.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No outflow or inflow transactions recorded for this day.</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Cash Outs */}
                    {cashOutTx.length > 0 && (
                        <div>
                            <h4 className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                <Minus className="w-3.5 h-3.5" /> Cash Outs
                            </h4>
                            <div className="space-y-1.5">
                                {cashOutTx.map(tx => (
                                    <TxDetailRow key={tx.id} tx={tx} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Cash Ins */}
                    {cashInTx.length > 0 && (
                        <div>
                            <h4 className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                <Plus className="w-3.5 h-3.5" /> Cash Ins
                            </h4>
                            <div className="space-y-1.5">
                                {cashInTx.map(tx => (
                                    <TxDetailRow key={tx.id} tx={tx} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Summary mini-grid */}
            <div className="flex flex-wrap gap-3 text-xs">
                <Chip icon={<DollarSign className="w-3 h-3" />} label="Opening" value={fmt(reg.openingFloat)} />
                <Chip icon={<TrendingUp className="w-3 h-3 text-green-500" />} label="Expected" value={fmt(reg.closingExpected)} />
                <Chip icon={<TrendingDown className="w-3 h-3 text-red-500" />} label="Actual" value={fmt(reg.closingActual)} />
                <Chip icon={<ArrowUpDown className="w-3 h-3 text-indigo-500" />} label="Difference" value={fmtSigned(reg.difference)} />
            </div>
        </div>
    );
};

const TxDetailRow: React.FC<{ tx: CashDrawerTx }> = ({ tx }) => (
    <div className="flex items-start justify-between gap-2 text-xs px-2.5 py-1.5 bg-white dark:bg-dark-card rounded-lg border border-gray-100 dark:border-dark-border">
        <div className="min-w-0">
            <div className="font-medium text-gray-800 dark:text-gray-200 truncate">
                {TX_CATEGORY_LABELS[tx.category as keyof typeof TX_CATEGORY_LABELS] || tx.category}
            </div>
            <div className="text-gray-500 dark:text-gray-400 truncate">{tx.note}</div>
        </div>
        <div className={`font-semibold shrink-0 ${tx.type === 'CASH_OUT' ? 'text-red-600' : 'text-green-600'}`}>
            {tx.type === 'CASH_OUT' ? '−' : '+'}₹{Number(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </div>
    </div>
);

const Chip: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-dark-card rounded-lg border border-gray-100 dark:border-dark-border">
        {icon}
        <span className="text-gray-500 dark:text-gray-400">{label}:</span>
        <span className="font-semibold text-gray-900 dark:text-white">{value}</span>
    </div>
);
