import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { showToast } from '../ui/Toast';
import { printService } from '../../services/print.service';
import { messagingService } from '../../services/messaging.service';
import type { CreditNoteRecord } from '../../types/creditNote';
import { CreditCard, Printer, CheckCircle, MessageSquare, Send, Smartphone } from 'lucide-react';

interface IssueCreditNoteModalProps {
    isOpen: boolean;
    onClose: () => void;
    onIssued?: (creditNote: CreditNoteRecord) => void;
    initialData?: {
        customerName?: string;
        customerPhone?: string;
        amount?: number;
        reason?: string;
        originalBillNo?: string;
        originalInvoiceId?: string;
    };
}

export const IssueCreditNoteModal: React.FC<IssueCreditNoteModalProps> = ({
    isOpen,
    onClose,
    onIssued,
    initialData,
}) => {
    const [customerName, setCustomerName] = useState(initialData?.customerName || '');
    const [customerPhone, setCustomerPhone] = useState(initialData?.customerPhone || '');
    const [amount, setAmount] = useState(initialData?.amount ? String(initialData.amount) : '');
    const [reason, setReason] = useState(initialData?.reason || '');
    const [loading, setLoading] = useState(false);
    const [sendingMessage, setSendingMessage] = useState(false);
    const [createdCreditNote, setCreatedCreditNote] = useState<CreditNoteRecord | null>(null);

    const handleSendMessage = async (forceChannel?: 'WHATSAPP' | 'SMS') => {
        if (!createdCreditNote?.customerPhone) {
            showToast('No customer phone recorded for this voucher.', 'warning');
            return;
        }
        setSendingMessage(true);
        try {
            const payload = {
                customerName: createdCreditNote.customerName || undefined,
                customerPhone: createdCreditNote.customerPhone,
                code: createdCreditNote.code,
                amount: createdCreditNote.amount,
                remainingAmount: createdCreditNote.remainingAmount,
                reason: createdCreditNote.reason || undefined,
                forceChannel,
            };
            const res = await messagingService.sendStoreCredit(payload);
            if (res.success) {
                if (res.fallback) {
                    showToast(`No WhatsApp account. Voucher sent via SMS to ${createdCreditNote.customerPhone}`, 'warning');
                } else {
                    showToast(`Store credit voucher messaged via ${res.channel}!`, 'success');
                }
            } else {
                showToast(`Messaging failed: ${res.error}`, 'error');
            }
        } catch (err: any) {
            showToast('Error sending store credit message: ' + err.message, 'error');
        } finally {
            setSendingMessage(false);
        }
    };

    const handlePhoneChange = (val: string) => {
        const clean = val.replace(/\D/g, '').slice(0, 10);
        setCustomerPhone(clean);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            showToast('Enter a valid credit amount greater than 0', 'warning');
            return;
        }

        setLoading(true);
        try {
            const res = await window.electronAPI.creditNotes.issue({
                customerName: customerName.trim() || null,
                customerPhone: customerPhone.trim() || null,
                amount: numAmount,
                reason: reason.trim() || 'Store credit issued',
                originalBillNo: initialData?.originalBillNo || null,
                originalInvoiceId: initialData?.originalInvoiceId || null,
            });

            if (res.success && res.data) {
                showToast(`Store Credit ${res.data.code} issued for ₹${numAmount.toFixed(2)}`, 'success');
                setCreatedCreditNote(res.data);
                if (onIssued) onIssued(res.data);
            } else {
                showToast(res.error || 'Failed to issue credit note', 'error');
            }
        } catch (err: any) {
            console.error('Issue credit note error:', err);
            showToast(err.message || 'Error issuing credit note', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = async () => {
        if (!createdCreditNote) return;
        try {
            await printService.printCreditNote(createdCreditNote);
            showToast('Credit voucher printed successfully', 'success');
        } catch (err: any) {
            console.error('Print voucher error:', err);
            showToast('Printing failed. Please check printer connection.', 'error');
        }
    };

    const handleClose = () => {
        setCreatedCreditNote(null);
        setCustomerName('');
        setCustomerPhone('');
        setAmount('');
        setReason('');
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title={createdCreditNote ? 'Credit Note Issued' : 'Issue Store Credit / Credit Note'} size="sm">
            {createdCreditNote ? (
                <div className="space-y-5 py-2">
                    <div className="flex flex-col items-center justify-center text-center p-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800">
                        <CheckCircle className="w-12 h-12 text-emerald-600 dark:text-emerald-400 mb-2" />
                        <span className="text-xs uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-300">
                            Store Credit Active
                        </span>
                        <div className="text-2xl font-black text-emerald-900 dark:text-emerald-100 font-mono my-1">
                            {createdCreditNote.code}
                        </div>
                        <div className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 my-1">
                            ₹{createdCreditNote.remainingAmount.toFixed(2)}
                        </div>
                        {createdCreditNote.customerName && (
                            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">
                                {createdCreditNote.customerName} {createdCreditNote.customerPhone ? `(${createdCreditNote.customerPhone})` : ''}
                            </div>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                            The customer can use this credit voucher or their phone number on their next purchase.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-gray-100 dark:border-gray-800">
                        <Button variant="secondary" onClick={handleClose}>
                            Close
                        </Button>
                        {createdCreditNote.customerPhone && (
                            <Button
                                variant="outline"
                                onClick={() => handleSendMessage()}
                                disabled={sendingMessage}
                                className="flex items-center gap-1.5 text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                                title="Send Voucher via WhatsApp (or SMS fallback)"
                            >
                                <MessageSquare className="w-4 h-4" />
                                <span>{sendingMessage ? 'Sending...' : 'Message Voucher'}</span>
                            </Button>
                        )}
                        <Button
                            variant="primary"
                            onClick={handlePrint}
                            className="flex items-center gap-1.5"
                        >
                            <Printer className="w-4 h-4" />
                            <span>Print Voucher</span>
                        </Button>
                    </div>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-1">
                            Credit Amount (₹) <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">₹</span>
                            <input
                                type="number"
                                step="any"
                                min="0.01"
                                required
                                autoFocus
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="e.g. 600"
                                className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-bold text-lg focus:ring-2 focus:ring-primary-500 focus:outline-none"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-1">
                                Customer Name
                            </label>
                            <input
                                type="text"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                placeholder="Customer name"
                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-1">
                                Phone Number
                            </label>
                            <input
                                type="tel"
                                value={customerPhone}
                                onChange={(e) => handlePhoneChange(e.target.value)}
                                placeholder="10-digit mobile"
                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:outline-none font-mono"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-1">
                            Reason / Description
                        </label>
                        <input
                            type="text"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="e.g. Item returned - store credit issued"
                            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:outline-none"
                        />
                    </div>

                    <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-xs text-blue-800 dark:text-blue-300 leading-relaxed border border-blue-200 dark:border-blue-800 flex items-start gap-2">
                        <CreditCard className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <div>
                            This creates an active store credit balance under the customer's phone and generates a unique Credit Note code. No cash is deducted from the till.
                        </div>
                    </div>

                    <div className="flex gap-2 justify-end pt-3 border-t border-gray-100 dark:border-gray-800">
                        <Button type="button" variant="secondary" onClick={handleClose} disabled={loading}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="primary" disabled={loading || !amount}>
                            {loading ? 'Issuing...' : 'Issue Credit Note'}
                        </Button>
                    </div>
                </form>
            )}
        </Modal>
    );
};
