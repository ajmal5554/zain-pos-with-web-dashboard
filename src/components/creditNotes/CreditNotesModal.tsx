import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { IssueCreditNoteModal } from './IssueCreditNoteModal';
import { showToast } from '../ui/Toast';
import { printService } from '../../services/print.service';
import type { CreditNoteRecord } from '../../types/creditNote';
import {
    Search, Plus, Printer, RefreshCw, AlertCircle,
    CheckCircle2, Clock, Ban, Eye, ArrowRight
} from 'lucide-react';

interface CreditNotesModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const CreditNotesModal: React.FC<CreditNotesModalProps> = ({ isOpen, onClose }) => {
    const [creditNotes, setCreditNotes] = useState<CreditNoteRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'EXHAUSTED' | 'CANCELLED'>('ALL');
    const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
    const [selectedForCancel, setSelectedForCancel] = useState<CreditNoteRecord | null>(null);
    const [selectedForRedemptions, setSelectedForRedemptions] = useState<CreditNoteRecord | null>(null);
    const [cancelReason, setCancelReason] = useState('');
    const [isCancelling, setIsCancelling] = useState(false);

    const loadCreditNotes = useCallback(async () => {
        setLoading(true);
        try {
            const res = await window.electronAPI.creditNotes.list({
                search: searchQuery.trim() || undefined,
                status: statusFilter,
            });
            if (res.success && res.data) {
                setCreditNotes(res.data);
            } else {
                showToast(res.error || 'Failed to load credit notes', 'error');
            }
        } catch (err: any) {
            console.error('Error loading credit notes:', err);
            showToast(err.message || 'Error loading credit notes', 'error');
        } finally {
            setLoading(false);
        }
    }, [searchQuery, statusFilter, showToast]);

    useEffect(() => {
        if (isOpen) {
            loadCreditNotes();
        }
    }, [isOpen, loadCreditNotes]);

    const activeTotal = useMemo(() => {
        return creditNotes
            .filter(c => c.status === 'ACTIVE')
            .reduce((sum, c) => sum + c.remainingAmount, 0);
    }, [creditNotes]);

    const handlePrint = async (cn: CreditNoteRecord) => {
        try {
            await printService.printCreditNote(cn);
            showToast(`Credit voucher ${cn.code} printed`, 'success');
        } catch (err: any) {
            console.error('Print voucher error:', err);
            showToast('Printing failed. Please check printer connection.', 'error');
        }
    };

    const handleConfirmCancel = async () => {
        if (!selectedForCancel) return;
        setIsCancelling(true);
        try {
            const res = await window.electronAPI.creditNotes.cancel({
                id: selectedForCancel.id,
                reason: cancelReason.trim() || 'Cancelled by staff',
            });
            if (res.success) {
                showToast(`Credit Note ${selectedForCancel.code} cancelled`, 'success');
                setSelectedForCancel(null);
                setCancelReason('');
                loadCreditNotes();
            } else {
                showToast(res.error || 'Failed to cancel credit note', 'error');
            }
        } catch (err: any) {
            console.error('Cancel credit note error:', err);
            showToast(err.message || 'Error cancelling credit note', 'error');
        } finally {
            setIsCancelling(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Store Credit / Credit Notes" size="xl">
            <div className="space-y-4">
                {/* Header summary & action bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-4">
                        <div>
                            <span className="text-xs uppercase font-bold text-gray-500 dark:text-gray-400">Total Notes</span>
                            <div className="text-xl font-black text-gray-900 dark:text-gray-100">{creditNotes.length}</div>
                        </div>
                        <div className="h-8 w-px bg-gray-200 dark:bg-gray-700" />
                        <div>
                            <span className="text-xs uppercase font-bold text-emerald-600 dark:text-emerald-400">Active Outstanding</span>
                            <div className="text-xl font-black text-emerald-600 dark:text-emerald-400">₹{activeTotal.toFixed(2)}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            onClick={() => loadCreditNotes()}
                            className="p-2"
                            title="Refresh"
                            disabled={loading}
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button
                            variant="primary"
                            onClick={() => setIsIssueModalOpen(true)}
                            className="flex items-center gap-1.5"
                        >
                            <Plus className="w-4 h-4" />
                            <span>Issue Credit Note</span>
                        </Button>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by Code (e.g. CN-1001), Customer, Phone, or Bill No..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && loadCreditNotes()}
                            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:outline-none"
                        />
                    </div>
                    <div className="flex gap-1">
                        {(['ALL', 'ACTIVE', 'EXHAUSTED', 'CANCELLED'] as const).map((status) => (
                            <button
                                key={status}
                                type="button"
                                onClick={() => setStatusFilter(status)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-colors ${
                                    statusFilter === status
                                        ? 'bg-primary-600 text-white'
                                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Table */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden max-h-[460px] overflow-y-auto">
                    <table className="w-full text-left text-sm border-collapse">
                        <thead className="sticky top-0 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-bold uppercase border-b border-gray-200 dark:border-gray-700 z-10">
                            <tr>
                                <th className="p-3">Code / Ref</th>
                                <th className="p-3">Date</th>
                                <th className="p-3">Customer</th>
                                <th className="p-3 text-right">Initial Amount</th>
                                <th className="p-3 text-right">Remaining</th>
                                <th className="p-3 text-center">Status</th>
                                <th className="p-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-gray-900 dark:text-gray-100">
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center text-gray-500">
                                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-primary-500" />
                                        Loading credit notes...
                                    </td>
                                </tr>
                            ) : creditNotes.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center text-gray-500">
                                        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                                        No credit notes found matching criteria.
                                    </td>
                                </tr>
                            ) : (
                                creditNotes.map((cn) => {
                                    const isExhausted = cn.status === 'EXHAUSTED';
                                    const isCancelled = cn.status === 'CANCELLED';
                                    const isActive = cn.status === 'ACTIVE';

                                    return (
                                        <tr key={cn.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors">
                                            <td className="p-3">
                                                <div className="font-mono font-bold text-primary-600 dark:text-primary-400 flex items-center gap-1">
                                                    {cn.code}
                                                </div>
                                                {cn.originalBillNo && (
                                                    <span className="text-[11px] text-gray-500">Ref: #{cn.originalBillNo}</span>
                                                )}
                                                {cn.reason && (
                                                    <div className="text-[11px] text-gray-400 truncate max-w-[180px]" title={cn.reason}>
                                                        {cn.reason}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
                                                {new Date(cn.createdAt).toLocaleDateString('en-IN', {
                                                    day: '2-digit', month: 'short', year: 'numeric'
                                                })}
                                                <div className="text-[10px] text-gray-400">
                                                    {new Date(cn.createdAt).toLocaleTimeString('en-IN', {
                                                        hour: '2-digit', minute: '2-digit'
                                                    })}
                                                </div>
                                            </td>
                                            <td className="p-3">
                                                <div className="font-medium text-gray-800 dark:text-gray-200">
                                                    {cn.customerName || 'Walk-in Customer'}
                                                </div>
                                                {cn.customerPhone ? (
                                                    <div className="text-xs font-mono text-gray-500">{cn.customerPhone}</div>
                                                ) : (
                                                    <div className="text-[11px] text-gray-400 italic">No phone</div>
                                                )}
                                            </td>
                                            <td className="p-3 text-right font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                                ₹{cn.amount.toFixed(2)}
                                            </td>
                                            <td className="p-3 text-right whitespace-nowrap">
                                                <span className={`font-bold ${
                                                    isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'
                                                }`}>
                                                    ₹{cn.remainingAmount.toFixed(2)}
                                                </span>
                                            </td>
                                            <td className="p-3 text-center whitespace-nowrap">
                                                {isActive && (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                                                        <CheckCircle2 className="w-3 h-3" />
                                                        Active
                                                    </span>
                                                )}
                                                {isExhausted && (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400">
                                                        <Clock className="w-3 h-3" />
                                                        Used
                                                    </span>
                                                )}
                                                {isCancelled && (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400">
                                                        <Ban className="w-3 h-3" />
                                                        Void
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-3 text-right whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1">
                                                    {cn.redemptions && cn.redemptions.length > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setSelectedForRedemptions(cn)}
                                                            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 hover:text-primary-600 transition-colors"
                                                            title="View Redemptions"
                                                        >
                                                            <Eye className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => handlePrint(cn)}
                                                        className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 hover:text-emerald-600 transition-colors"
                                                        title="Print Slip"
                                                    >
                                                        <Printer className="w-4 h-4" />
                                                    </button>
                                                    {isActive && cn.remainingPaise === cn.amountPaise && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setSelectedForCancel(cn)}
                                                            className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 rounded text-gray-400 hover:text-red-600 transition-colors"
                                                            title="Cancel Note"
                                                        >
                                                            <Ban className="w-4 h-4" />
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

                <div className="flex justify-end pt-2">
                    <Button variant="secondary" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>

            {/* Issue Credit Note Modal */}
            <IssueCreditNoteModal
                isOpen={isIssueModalOpen}
                onClose={() => setIsIssueModalOpen(false)}
                onIssued={() => {
                    loadCreditNotes();
                }}
            />

            {/* View Redemptions Modal */}
            {selectedForRedemptions && (
                <Modal
                    isOpen={true}
                    onClose={() => setSelectedForRedemptions(null)}
                    title={`Redemption History: ${selectedForRedemptions.code}`}
                    size="sm"
                >
                    <div className="space-y-3">
                        <div className="text-xs text-gray-500">
                            Credit Note total ₹{selectedForRedemptions.amount.toFixed(2)}, remaining ₹{selectedForRedemptions.remainingAmount.toFixed(2)}.
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-gray-800 border rounded-lg overflow-hidden">
                            {(selectedForRedemptions.redemptions || []).map((r) => (
                                <div key={r.id} className="p-3 flex items-center justify-between text-sm">
                                    <div>
                                        <div className="font-bold flex items-center gap-1">
                                            <span>Bill #{r.billNo}</span>
                                            <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                                        </div>
                                        <div className="text-xs text-gray-400">
                                            {new Date(r.createdAt).toLocaleString('en-IN')}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-bold text-emerald-600 dark:text-emerald-400">
                                            -₹{r.amount.toFixed(2)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-end pt-2">
                            <Button variant="secondary" onClick={() => setSelectedForRedemptions(null)}>
                                Close
                            </Button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Cancel Confirm Dialog */}
            {selectedForCancel && (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => { setSelectedForCancel(null); setCancelReason(''); }}
                    onConfirm={handleConfirmCancel}
                    title={`Cancel Credit Note ${selectedForCancel.code}?`}
                    message={`Are you sure you want to cancel Credit Note ${selectedForCancel.code} for ₹${selectedForCancel.amount.toFixed(2)}? This action cannot be undone.`}
                    confirmText="Yes, Cancel Note"
                    variant="danger"
                    loading={isCancelling}
                />
            )}
        </Modal>
    );
};
