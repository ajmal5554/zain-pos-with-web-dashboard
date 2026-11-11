import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { showToast } from '../ui/Toast';
import { printService } from '../../services/print.service';
import { messagingService } from '../../services/messaging.service';
import { db } from '../../lib/db';
import {
    findExistingCustomerMatches,
    isSaleCustomerDismissed,
    normalizeCustomerPhoneToken,
    sanitizeCustomerNameInput,
    type DismissedCustomerMap,
} from '../../lib/customerDirectory';
import type { CreditNoteRecord } from '../../types/creditNote';
import { CreditCard, Printer, CheckCircle, MessageSquare, User, Receipt, AlertTriangle } from 'lucide-react';

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

interface RecentSaleSuggestion {
    id: string;
    billNo: string;
    customerName?: string | null;
    customerPhone?: string | null;
    grandTotal: number;
    createdAt: string;
}

interface EnrichedCreditCustomer {
    id: string;
    name: string;
    phone: string | null;
    gstin?: string | null;
    activeCredit: number;
    activeNoteCount: number;
    recentBills: RecentSaleSuggestion[];
}

const CREDIT_REASON_SUGGESTIONS = [
    'Item returned - store credit issued',
    'Exchange price difference credit',
    'Size / alteration hold credit',
    'Advance deposit / loyalty credit',
];

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
    const [linkedBill, setLinkedBill] = useState<{ billNo?: string; invoiceId?: string }>({
        billNo: initialData?.originalBillNo,
        invoiceId: initialData?.originalInvoiceId,
    });
    const [loading, setLoading] = useState(false);
    const [sendingMessage, setSendingMessage] = useState(false);
    const [createdCreditNote, setCreatedCreditNote] = useState<CreditNoteRecord | null>(null);

    // Smart suggestions directory state
    const [directory, setDirectory] = useState<EnrichedCreditCustomer[]>([]);
    const [activeField, setActiveField] = useState<'name' | 'phone' | null>(null);

    useEffect(() => {
        if (!isOpen) return;

        setCreatedCreditNote(null);
        setCustomerName(initialData?.customerName || '');
        setCustomerPhone(initialData?.customerPhone || '');
        setAmount(initialData?.amount ? String(initialData.amount) : '');
        setReason(initialData?.reason || '');
        setLinkedBill({
            billNo: initialData?.originalBillNo,
            invoiceId: initialData?.originalInvoiceId,
        });

        let cancelled = false;
        (async () => {
            try {
                const [customersRes, salesRes, activeCreditsRes, dismissedRes] = await Promise.all([
                    db.customers.findMany({ orderBy: { createdAt: 'desc' } }).catch(() => []),
                    db.sales
                        .findMany({
                            where: { status: 'COMPLETED' },
                            select: {
                                id: true,
                                billNo: true,
                                customerName: true,
                                customerPhone: true,
                                grandTotal: true,
                                createdAt: true,
                            },
                            orderBy: { createdAt: 'desc' },
                            take: 50,
                        })
                        .catch(() => []),
                    window.electronAPI?.creditNotes?.list?.({ status: 'ACTIVE' }).catch(() => ({ success: false, data: [] })) ??
                        Promise.resolve({ success: false, data: [] }),
                    window.electronAPI?.customers?.getDismissed?.().catch(() => ({ success: false, data: {} })) ??
                        Promise.resolve({ success: false, data: {} }),
                ]);

                if (cancelled) return;

                const dismissedMap: DismissedCustomerMap = dismissedRes?.data || {};
                const activeNotes: CreditNoteRecord[] =
                    activeCreditsRes?.success && Array.isArray(activeCreditsRes.data) ? activeCreditsRes.data : [];
                const recentSales: RecentSaleSuggestion[] = Array.isArray(salesRes) ? salesRes : [];

                const creditByPhone = new Map<string, { total: number; count: number }>();
                for (const cn of activeNotes) {
                    const tok = normalizeCustomerPhoneToken(cn.customerPhone);
                    if (!tok) continue;
                    const cur = creditByPhone.get(tok) || { total: 0, count: 0 };
                    cur.total += Number(cn.remainingAmount || 0);
                    cur.count += 1;
                    creditByPhone.set(tok, cur);
                }

                const billsByPhone = new Map<string, RecentSaleSuggestion[]>();
                const billsByName = new Map<string, RecentSaleSuggestion[]>();
                for (const sale of recentSales) {
                    const tok = normalizeCustomerPhoneToken(sale.customerPhone);
                    if (tok) {
                        const list = billsByPhone.get(tok) || [];
                        if (list.length < 3) list.push(sale);
                        billsByPhone.set(tok, list);
                    }
                    const lowerName = (sale.customerName || '').trim().toLowerCase();
                    if (lowerName && lowerName !== 'walk-in customer' && lowerName !== 'walk-in') {
                        const list = billsByName.get(lowerName) || [];
                        if (list.length < 3) list.push(sale);
                        billsByName.set(lowerName, list);
                    }
                }

                const mergedByPhone = new Map<string, EnrichedCreditCustomer>();
                const namelessList: EnrichedCreditCustomer[] = [];

                for (const c of Array.isArray(customersRes) ? customersRes : []) {
                    const tok = normalizeCustomerPhoneToken(c.phone);
                    const credit = tok ? creditByPhone.get(tok) : undefined;
                    const bills = tok
                        ? billsByPhone.get(tok) || []
                        : billsByName.get((c.name || '').trim().toLowerCase()) || [];
                    const item: EnrichedCreditCustomer = {
                        id: c.id,
                        name: c.name || (tok ? `Customer ${tok}` : 'Customer'),
                        phone: tok || c.phone || null,
                        gstin: c.gstin || null,
                        activeCredit: credit?.total || 0,
                        activeNoteCount: credit?.count || 0,
                        recentBills: bills,
                    };
                    if (tok) mergedByPhone.set(tok, item);
                    else namelessList.push(item);
                }

                for (const sale of recentSales) {
                    if (isSaleCustomerDismissed(sale, dismissedMap)) continue;
                    const tok = normalizeCustomerPhoneToken(sale.customerPhone);
                    if (!tok || mergedByPhone.has(tok)) continue;
                    const rawName = (sale.customerName || '').trim();
                    const isAnon = !rawName || rawName.toLowerCase() === 'walk-in customer' || rawName.toLowerCase() === 'walk-in';
                    const credit = creditByPhone.get(tok);
                    mergedByPhone.set(tok, {
                        id: `sale-cust-${tok}`,
                        name: isAnon ? `Customer ${tok}` : rawName,
                        phone: tok,
                        activeCredit: credit?.total || 0,
                        activeNoteCount: credit?.count || 0,
                        recentBills: billsByPhone.get(tok) || [],
                    });
                }

                setDirectory([...Array.from(mergedByPhone.values()), ...namelessList]);
            } catch (err) {
                console.warn('Could not load store credit customer suggestions:', err);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [isOpen, initialData]);

    const matchResult = useMemo(
        () =>
            findExistingCustomerMatches(directory, {
                name: customerName,
                phone: customerPhone,
            }),
        [directory, customerName, customerPhone]
    );

    const dropdownSuggestions = useMemo(() => {
        if (!activeField) return [];
        const hasQuery = customerName.trim().length >= 1 || customerPhone.replace(/\D/g, '').length >= 2;
        if (hasQuery && matchResult.matches.length > 0) {
            return matchResult.matches.map((m) => m.customer);
        }
        if (!hasQuery) {
            return directory.slice(0, 5);
        }
        return [];
    }, [activeField, customerName, customerPhone, matchResult, directory]);

    // Identify the active matched customer (exact phone/name match) for live credit balance & recent bills
    const activeMatchedCustomer = useMemo(() => {
        if (matchResult.exactMatch) return matchResult.exactMatch.customer;
        const phoneTok = normalizeCustomerPhoneToken(customerPhone);
        if (phoneTok) {
            return directory.find((c) => normalizeCustomerPhoneToken(c.phone) === phoneTok) || null;
        }
        return null;
    }, [matchResult, customerPhone, directory]);

    // Check if the database already has a customer matching entered phone/name whose details aren't filled yet
    const duplicateSuggestionNotice = useMemo(() => {
        const match = matchResult.exactMatch;
        if (!match) return null;
        const enteredName = customerName.trim().toLowerCase();
        const dbName = match.customer.name.trim().toLowerCase();
        const enteredPhone = normalizeCustomerPhoneToken(customerPhone);
        const dbPhone = normalizeCustomerPhoneToken(match.customer.phone);
        if (enteredName === dbName && enteredPhone === dbPhone) return null;
        return match.customer;
    }, [matchResult, customerName, customerPhone]);

    const handlePickSuggestion = (cust: EnrichedCreditCustomer) => {
        setCustomerName(cust.name);
        if (cust.phone) {
            setCustomerPhone(cust.phone.replace(/\D/g, '').slice(-10));
        }
        setActiveField(null);
    };

    const handlePickRecentBill = (bill: RecentSaleSuggestion) => {
        setAmount(String(bill.grandTotal));
        setReason((prev) => {
            const trimmed = prev.trim();
            if (!trimmed || trimmed.startsWith('Store credit for Bill #')) {
                return `Store credit for Bill #${bill.billNo}`;
            }
            return prev;
        });
        setLinkedBill({ billNo: String(bill.billNo), invoiceId: bill.id });
    };

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
                originalBillNo: linkedBill.billNo || initialData?.originalBillNo || null,
                originalInvoiceId: linkedBill.invoiceId || initialData?.originalInvoiceId || null,
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
        setLinkedBill({});
        setActiveField(null);
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

                        {/* Smart Recent Bill Suggestions for Matched Customer */}
                        {activeMatchedCustomer && activeMatchedCustomer.recentBills.length > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <span className="text-[11px] font-medium text-gray-500 flex items-center gap-1">
                                    <Receipt className="w-3 h-3" />
                                    Recent bills:
                                </span>
                                {activeMatchedCustomer.recentBills.map((bill) => (
                                    <button
                                        key={bill.id}
                                        type="button"
                                        onClick={() => handlePickRecentBill(bill)}
                                        className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 transition-colors"
                                        title={`Use ₹${bill.grandTotal.toFixed(2)} from Bill #${bill.billNo}`}
                                    >
                                        Bill #{bill.billNo} · ₹{bill.grandTotal.toLocaleString('en-IN')}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="relative">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-1">
                                    Customer Name
                                </label>
                                <input
                                    type="text"
                                    value={customerName}
                                    onFocus={() => setActiveField('name')}
                                    onBlur={() => setTimeout(() => setActiveField((cur) => (cur === 'name' ? null : cur)), 150)}
                                    onChange={(e) => {
                                        setCustomerName(sanitizeCustomerNameInput(e.target.value, 50));
                                        setActiveField('name');
                                    }}
                                    placeholder="Search or type name"
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
                                    onFocus={() => setActiveField('phone')}
                                    onBlur={() => setTimeout(() => setActiveField((cur) => (cur === 'phone' ? null : cur)), 150)}
                                    onChange={(e) => {
                                        handlePhoneChange(e.target.value);
                                        setActiveField('phone');
                                    }}
                                    placeholder="10-digit mobile"
                                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:outline-none font-mono"
                                />
                            </div>
                        </div>

                        {/* Smart Customer Autocomplete Suggestions */}
                        {dropdownSuggestions.length > 0 && (
                            <div className="mt-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg divide-y divide-gray-100 dark:divide-gray-800 max-h-44 overflow-y-auto">
                                <div className="px-2.5 py-1 bg-gray-50 dark:bg-gray-800/70 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                    Suggested Customers from Database
                                </div>
                                {dropdownSuggestions.map((cust) => (
                                    <button
                                        key={cust.id}
                                        type="button"
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            handlePickSuggestion(cust);
                                        }}
                                        className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-primary-50 dark:hover:bg-primary-950/30 transition-colors"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                            <div className="min-w-0">
                                                <div className="text-xs font-bold text-gray-900 dark:text-white truncate">
                                                    {cust.name}
                                                </div>
                                                <div className="text-[11px] font-mono text-gray-500">
                                                    {cust.phone || 'No phone'}
                                                </div>
                                            </div>
                                        </div>
                                        {cust.activeCredit > 0 && (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 shrink-0">
                                                Credit: ₹{cust.activeCredit.toFixed(0)}
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Existing Database Customer Match Prompt */}
                        {duplicateSuggestionNotice && (
                            <div className="mt-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2 flex items-center justify-between gap-2 text-xs">
                                <div className="flex items-start gap-1.5 text-amber-900 dark:text-amber-200 min-w-0">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                                    <span className="truncate">
                                        In database: <strong>{duplicateSuggestionNotice.name}</strong>
                                        {duplicateSuggestionNotice.phone ? ` (${duplicateSuggestionNotice.phone})` : ''}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handlePickSuggestion(duplicateSuggestionNotice)}
                                    className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] shrink-0"
                                >
                                    Auto-Fill
                                </button>
                            </div>
                        )}

                        {/* Active Credit Balance Indicator for Selected Phone */}
                        {activeMatchedCustomer && activeMatchedCustomer.activeCredit > 0 && (
                            <div className="mt-2 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/30 px-3 py-1.5 text-[11px] text-indigo-800 dark:text-indigo-300 font-medium">
                                Existing active credit balance: <strong>₹{activeMatchedCustomer.activeCredit.toFixed(2)}</strong> ({activeMatchedCustomer.activeNoteCount} active note{activeMatchedCustomer.activeNoteCount === 1 ? '' : 's'}).
                            </div>
                        )}
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
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {CREDIT_REASON_SUGGESTIONS.map((preset) => (
                                <button
                                    key={preset}
                                    type="button"
                                    onClick={() => setReason(preset)}
                                    className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                                        reason === preset
                                            ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-950/40 dark:border-primary-700 dark:text-primary-300'
                                            : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700 dark:border-gray-700 dark:text-gray-300'
                                    }`}
                                >
                                    {preset}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-xs text-blue-800 dark:text-blue-300 leading-relaxed border border-blue-200 dark:border-blue-800 flex items-start gap-2">
                        <CreditCard className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <div>
                            This creates an active store credit balance under the customer&apos;s phone and generates a unique Credit Note code. No cash is deducted from the till.
                        </div>
                    </div>

                    <div className="flex gap-2 justify-end pt-3 border-t border-gray-100 dark:border-gray-800">
                        <Button type="button" variant="secondary" onClick={handleClose} disabled={loading}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="primary" disabled={loading}>
                            {loading ? 'Issuing...' : 'Issue Store Credit'}
                        </Button>
                    </div>
                </form>
            )}
        </Modal>
    );
};
