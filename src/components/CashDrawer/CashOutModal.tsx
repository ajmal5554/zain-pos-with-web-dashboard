import React, { useState, useEffect, useRef } from 'react';
import { X, Minus, DollarSign, Loader2 } from 'lucide-react';
import type { TxCategory } from '../../types/cashRegister';
import { CASH_OUT_CATEGORIES, TX_CATEGORY_LABELS } from '../../types/cashRegister';

interface CashOutModalProps {
    onClose: () => void;
    onSuccess: () => void;
}

export const CashOutModal: React.FC<CashOutModalProps> = ({ onClose, onSuccess }) => {
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState<TxCategory>('OWNER_WITHDRAWAL');
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const amountRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        amountRef.current?.focus();
    }, []);

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const amt = parseFloat(amount);
        if (isNaN(amt) || amt <= 0) {
            setError('Please enter a valid amount');
            return;
        }
        if (!note.trim()) {
            setError('Please add a note');
            return;
        }

        setLoading(true);
        setError('');
        try {
            const res = await window.electronAPI.register.addTx({
                type: 'CASH_OUT',
                category,
                amount: amt,
                note: note.trim(),
            });
            if (res.success) {
                onSuccess();
                onClose();
            } else {
                setError(res.error || 'Failed to record transaction');
            }
        } catch (err: any) {
            setError(err.message || 'Unexpected error');
        } finally {
            setLoading(false);
        }
    };

    // Press Enter to save (from any field)
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
        if (e.key === 'Escape') onClose();
    };

    return (
        <div
            className="modal-overlay"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div
                className="bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-md border border-gray-200 dark:border-dark-border animate-slide-up"
                onKeyDown={handleKeyDown}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-dark-border">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                            <Minus className="w-5 h-5 text-red-600 dark:text-red-400" />
                        </div>
                        <div>
                            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Cash Out</h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Record cash taken from drawer</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        <X className="w-4 h-4 text-gray-500" />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {/* Amount */}
                    <div>
                        <label className="label">Amount (₹)</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 font-medium">₹</span>
                            <input
                                ref={amountRef}
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="input pl-8 text-lg font-semibold"
                                placeholder="0.00"
                            />
                        </div>
                    </div>

                    {/* Category */}
                    <div>
                        <label className="label">Category</label>
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value as TxCategory)}
                            className="input"
                        >
                            {CASH_OUT_CATEGORIES.map((cat) => (
                                <option key={cat} value={cat}>
                                    {TX_CATEGORY_LABELS[cat]}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Note */}
                    <div>
                        <label className="label">Note</label>
                        <input
                            type="text"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            className="input"
                            placeholder="Brief description..."
                            maxLength={200}
                        />
                    </div>

                    {error && (
                        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                            {error}
                        </p>
                    )}

                    {/* Actions */}
                    <div className="flex gap-3 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn-outline flex-1"
                            disabled={loading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn-danger flex-1"
                            disabled={loading}
                        >
                            {loading ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Minus className="w-4 h-4" />
                            )}
                            Record Cash Out
                        </button>
                    </div>
                    <p className="text-center text-xs text-gray-400 dark:text-gray-500">
                        Press <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">Enter</kbd> to save quickly
                    </p>
                </form>
            </div>
        </div>
    );
};
