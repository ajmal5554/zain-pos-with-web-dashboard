import React, { useEffect, useRef, useState } from 'react';
import { Truck } from 'lucide-react';
import { PurchaseTaxFields, PurchaseTaxSummary } from '../components/purchases/PurchaseTaxFields';
import { PurchaseActions } from '../components/purchases/PurchaseActions';
import { purchasesService as service, PurchaseRequestError } from '../services/purchases.service';
import type {
    PurchaseDetail,
    PurchaseInput,
    PurchaseItemOption,
    PurchasePaymentInput,
    PurchasePaymentMode,
    PurchaseRecord,
} from '../types/purchases';
import { useAuthStore } from '../store/authStore';
import { showToast } from '../components/ui/Toast';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Modal } from '../components/ui/Modal';

// Self-contained inline SVGs for UI polish without external mock dependencies
const IconSearch = ({ className = 'w-4 h-4' }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
);

const IconAlertCircle = ({ className = 'w-5 h-5' }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
);

const IconCheckCircle = ({ className = 'w-5 h-5' }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const IconReceipt = ({ className = 'w-5 h-5' }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
    </svg>
);

const IconWallet = ({ className = 'w-5 h-5' }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
);

const currency = (paise: number) =>
    (Number(paise) / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });

const localDate = () =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());

const initial = (): PurchaseInput => ({
    operationId: crypto.randomUUID(),
    supplier: '',
    invoiceNumber: '',
    invoiceDate: localDate(),
    batchName: '',
    discount: 0,
    charges: 0,
    paid: 0,
    paymentMode: 'UPI',
    tax: {
        supplierGstin: '',
        cgst: 0,
        sgst: 0,
        igst: 0,
        roundOff: 0,
        itcStatus: 'PENDING',
    },
    lines: [],
});

const control =
    'input text-sm py-2 px-3 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all w-full';

const modes: Array<[PurchasePaymentMode, string]> = [
    ['UPI', 'UPI'],
    ['BANK', 'Bank transfer'],
    ['CASH_DRAWER', 'Shop cash drawer'],
    ['PERSONAL_CASH', 'Personal cash (outside drawer)'],
];

type Draft = { form: PurchaseInput; options: PurchaseItemOption[]; pending: boolean };

export const Purchases: React.FC = () => {
    const user = useAuthStore((s) => s.user);
    const key = `purchase-draft-v1:${user?.id}`;

    const [draft, setDraft] = useState<Draft>(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(key) || 'null');
            if (saved?.form?.operationId && Array.isArray(saved.form.lines) && Array.isArray(saved.options)) {
                return saved;
            }
        } catch {
            /* Keep a fresh form if storage is unavailable. */
        }
        return { form: initial(), options: [], pending: false };
    });

    const [tab, setTab] = useState<'history' | 'new'>('history');
    const [history, setHistory] = useState<PurchaseRecord[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totals, setTotals] = useState({ totalPaise: 0, paidPaise: 0, duePaise: 0, creditDuePaise: 0 });
    const [actionBlocked, setActionBlocked] = useState(false);
    const [search, setSearch] = useState('');
    const [itemSearch, setItemSearch] = useState('');
    const [options, setOptions] = useState<PurchaseItemOption[]>([]);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [confirm, setConfirm] = useState<'receive' | 'discard' | null>(null);
    const [detail, setDetail] = useState<PurchaseDetail | null>(() => {
        try {
            return JSON.parse(localStorage.getItem(`purchase-action-v1:${user?.id}`) || 'null')?.invoice || null;
        } catch {
            return null;
        }
    });

    const [payInput, setPayInput] = useState<PurchasePaymentInput | null>(null);
    const [payPending, setPayPending] = useState(false);
    const [payConfirm, setPayConfirm] = useState(false);

    const requestVersion = useRef(0);
    const itemVersion = useRef(0);
    const mutation = useRef(false);

    const allowed = !!user && (user.role === 'ADMIN' || (user.permManageInventory && user.permViewCostPrice));
    const form = draft.form;

    const subtotal = form.lines.reduce((sum, row) => sum + Math.round(row.unitCost * 100) * row.quantity, 0);
    const taxTotal = form.tax
        ? Math.round(form.tax.cgst * 100) + Math.round(form.tax.sgst * 100) + Math.round(form.tax.igst * 100)
        : 0;
    const taxable = subtotal - Math.round(form.discount * 100) + Math.round(form.charges * 100);
    const payable = taxable + taxTotal + (form.tax ? Math.round(form.tax.roundOff * 100) : 0);

    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(draft));
        } catch {
            showToast('Could not remember this purchase draft on this device.', 'warning');
        }
    }, [key, draft]);

    async function refresh() {
        const version = ++requestVersion.current;
        setLoading(true);
        setError('');
        try {
            const result = await service.list({ search, page });
            if (version === requestVersion.current) {
                setHistory(result.items);
                setTotal(result.total);
                setTotals(result.totals);
            }
        } catch (e) {
            if (version === requestVersion.current) setError((e as Error).message);
        } finally {
            if (version === requestVersion.current) setLoading(false);
        }
    }

    useEffect(() => {
        if (!allowed) return;
        const timer = setTimeout(refresh, 200);
        return () => {
            clearTimeout(timer);
            requestVersion.current++;
        };
    }, [search, page, allowed]);

    useEffect(() => {
        const version = ++itemVersion.current;
        setOptions([]);
        if (!allowed || !itemSearch.trim()) return;
        const timer = setTimeout(() => {
            service
                .items(itemSearch)
                .then((rows) => {
                    if (version === itemVersion.current) setOptions(rows);
                })
                .catch((e) => {
                    if (version === itemVersion.current) showToast(e.message, 'error');
                });
        }, 200);
        return () => {
            clearTimeout(timer);
            itemVersion.current++;
        };
    }, [itemSearch, allowed]);

    const change = (patch: Partial<PurchaseInput>) => {
        if (!busy && !draft.pending) setDraft((d) => ({ ...d, form: { ...d.form, ...patch } }));
    };

    function add(item: PurchaseItemOption) {
        if (busy || draft.pending) return;
        if (form.lines.some((line) => line.variantId === item.id)) {
            showToast('Already added. Change its quantity in the table.', 'info');
            return;
        }
        if (form.lines.length >= 100) {
            showToast('Save at most 100 items per invoice.', 'error');
            return;
        }
        setDraft((d) => ({
            ...d,
            options: [...d.options, item],
            form: {
                ...d.form,
                lines: [
                    ...d.form.lines,
                    {
                        variantId: item.id,
                        quantity: 1,
                        unitCost: 0,
                        sellingPrice: item.sellingPrice,
                        mrp: item.mrp,
                        expectedSellingPrice: item.sellingPrice,
                        expectedMrp: item.mrp,
                    },
                ],
            },
        }));
        setItemSearch('');
        setOptions([]);
    }

    async function receive() {
        if (mutation.current) return;
        mutation.current = true;
        setBusy(true);
        const snapshot = { ...draft, pending: true };
        try {
            localStorage.setItem(key, JSON.stringify(snapshot));
            setDraft(snapshot);
            const saved = await service.receive(snapshot.form);
            const clean = { form: initial(), options: [], pending: false };
            localStorage.setItem(key, JSON.stringify(clean));
            setDraft(clean);
            setConfirm(null);
            setTab('history');
            showToast('Purchase saved and stock received. Print any new price-batch labels from Products.', 'success');
            await refresh();
            await openDetail(saved.id);
        } catch (e) {
            if (e instanceof PurchaseRequestError && e.confirmedRejected) {
                setDraft((d) => ({ ...d, pending: false }));
            }
            showToast((e as Error).message, 'error');
            setConfirm(null);
        } finally {
            mutation.current = false;
            setBusy(false);
        }
    }

    async function openDetail(id: string) {
        try {
            setDetail(await service.detail(id));
        } catch (e) {
            showToast((e as Error).message, 'error');
        }
    }

    async function pay() {
        if (!payInput || mutation.current) return;
        mutation.current = true;
        setBusy(true);
        try {
            localStorage.setItem(`${key}:payment`, JSON.stringify(payInput));
            setPayPending(true);
            await service.pay(payInput);
            localStorage.removeItem(`${key}:payment`);
            setPayPending(false);
            setPayInput(null);
            setPayConfirm(false);
            await openDetail(payInput.purchaseId);
            await refresh();
            showToast('Supplier payment recorded.', 'success');
        } catch (e) {
            if (e instanceof PurchaseRequestError && e.confirmedRejected) {
                localStorage.removeItem(`${key}:payment`);
                setPayPending(false);
            }
            showToast((e as Error).message, 'error');
            setPayConfirm(false);
        } finally {
            mutation.current = false;
            setBusy(false);
        }
    }

    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(`${key}:payment`) || 'null');
            if (saved?.operationId) {
                setPayInput(saved);
                setPayPending(true);
            }
        } catch {
            /* Leave invoice history available. */
        }
    }, [key]);

    if (!allowed) {
        return (
            <div className="card max-w-lg mx-auto my-12 p-8 text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 flex items-center justify-center mx-auto">
                    <IconAlertCircle className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold">Access Restricted</h2>
                <p className="text-sm text-gray-500">
                    Purchases require inventory and cost-price permissions.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6 text-gray-800 dark:text-gray-100 pb-12">
            {/* Top Toolbar: View Switcher & Search Bar in One Cohesive Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h1 className="sr-only">Purchases</h1>
                <p className="sr-only">Record new supplier invoices, receive stock and track pending payments.</p>

                <div className="flex items-center gap-3">
                    <button
                        className="btn btn-primary btn-sm flex items-center gap-1.5 px-4 py-2 text-xs shadow-xs"
                        onClick={() => setTab(tab === 'new' ? 'history' : 'new')}
                    >
                        {tab === 'new' ? 'Purchase history' : 'New purchase'}
                    </button>
                    {tab === 'history' && (
                        <span className="badge badge-secondary text-xs px-2.5 py-1">
                            {total} {total === 1 ? 'invoice' : 'invoices'}
                        </span>
                    )}
                </div>

                {tab === 'history' && (
                    <div className="flex items-center gap-2 flex-1 sm:max-w-md ml-auto">
                        <div className="relative flex-1">
                            <input
                                aria-label="Search purchases"
                                className={`${control} pl-9 text-xs py-2`}
                                placeholder="Search supplier, invoice or batch..."
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setPage(1);
                                }}
                            />
                            <div className="absolute left-3 top-2.5 text-gray-400 pointer-events-none">
                                <IconSearch className="w-4 h-4" />
                            </div>
                        </div>
                        <button
                            className="btn btn-secondary btn-sm px-3.5 py-2 text-xs shadow-xs whitespace-nowrap"
                            onClick={refresh}
                            disabled={loading}
                        >
                            Refresh
                        </button>
                    </div>
                )}
            </div>

            {error && (
                <div role="alert" className="card p-4 border border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-950/20 text-red-700 dark:text-red-300 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                        <IconAlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                        <span>{error}</span>
                    </div>
                    <button className="underline font-semibold text-sm hover:text-red-800" onClick={refresh}>
                        Retry
                    </button>
                </div>
            )}

            {tab === 'history' ? (
                <>
                    {/* 4 Hero KPI Stat Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* Card 1: Purchases after credits */}
                        <div className="card !p-4 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-xs flex flex-col justify-between">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                            Purchases after credits
                                        </p>
                                        {search && <span className="badge badge-info text-[10px] py-0 px-1.5">Filtered</span>}
                                    </div>
                                    <strong className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white block">
                                        {currency(totals.totalPaise)}
                                    </strong>
                                </div>
                                <div className="p-2 rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400 border border-primary-100 dark:border-primary-800/40">
                                    <IconReceipt className="w-5 h-5" />
                                </div>
                            </div>
                            <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-dark-border/60">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {search ? 'Filtered search results' : 'Total invoice value after credits'}
                                </p>
                            </div>
                        </div>

                        {/* Card 2: Net paid */}
                        <div className="card !p-4 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-xs flex flex-col justify-between">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                            Net paid
                                        </p>
                                        {search && <span className="badge badge-info text-[10px] py-0 px-1.5">Filtered</span>}
                                    </div>
                                    <strong className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white block">
                                        {currency(totals.paidPaise)}
                                    </strong>
                                </div>
                                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/40">
                                    <IconCheckCircle className="w-5 h-5" />
                                </div>
                            </div>
                            <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-dark-border/60">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Settled supplier payments
                                </p>
                            </div>
                        </div>

                        {/* Card 3: Supplier balances pending */}
                        <div className="card !p-4 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-xs flex flex-col justify-between">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                            Supplier balances pending
                                        </p>
                                        {search && <span className="badge badge-info text-[10px] py-0 px-1.5">Filtered</span>}
                                    </div>
                                    <strong className={`text-2xl font-bold tracking-tight block ${totals.duePaise > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'}`}>
                                        {currency(totals.duePaise)}
                                    </strong>
                                </div>
                                <div className={`p-2 rounded-xl border ${
                                    totals.duePaise > 0
                                        ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 border-amber-100 dark:border-amber-800/40'
                                        : 'bg-gray-100 text-gray-500 dark:bg-dark-bg dark:text-gray-400 border-gray-200 dark:border-dark-border'
                                }`}>
                                    <IconAlertCircle className="w-5 h-5" />
                                </div>
                            </div>
                            <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-dark-border/60">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {totals.duePaise > 0 ? 'Outstanding invoice balance' : 'All invoice balances settled'}
                                </p>
                            </div>
                        </div>

                        {/* Card 4: Supplier refunds due */}
                        <div className="card !p-4 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-xs flex flex-col justify-between">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                            Supplier refunds due
                                        </p>
                                        {search && <span className="badge badge-info text-[10px] py-0 px-1.5">Filtered</span>}
                                    </div>
                                    <strong className={`text-2xl font-bold tracking-tight block ${totals.creditDuePaise > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-white'}`}>
                                        {currency(totals.creditDuePaise || 0)}
                                    </strong>
                                </div>
                                <div className={`p-2 rounded-xl border ${
                                    totals.creditDuePaise > 0
                                        ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 border-blue-100 dark:border-blue-800/40'
                                        : 'bg-gray-100 text-gray-500 dark:bg-dark-bg dark:text-gray-400 border-gray-200 dark:border-dark-border'
                                }`}>
                                    <IconWallet className="w-5 h-5" />
                                </div>
                            </div>
                            <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-dark-border/60">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {totals.creditDuePaise > 0 ? 'Credit note refund owed by supplier' : 'No supplier credit pending'}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Invoices History Table */}
                    <div className="card p-0 overflow-hidden border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card rounded-xl shadow-xs">
                        <div className="overflow-x-auto">
                            <table className="table w-full text-sm text-left">
                                <thead>
                                    <tr>
                                        {[
                                            { label: 'Date', cls: 'text-left w-32 whitespace-nowrap' },
                                            { label: 'Supplier / Invoice', cls: 'text-left min-w-[200px]' },
                                            { label: 'Batch', cls: 'text-left w-48' },
                                            { label: 'Purchase total', cls: 'text-right w-36 whitespace-nowrap' },
                                            { label: 'Paid', cls: 'text-right w-32 whitespace-nowrap' },
                                            { label: 'Pending', cls: 'text-right w-36 whitespace-nowrap' },
                                            { label: '', cls: 'text-right w-28 whitespace-nowrap' },
                                        ].map((col, i) => (
                                            <th
                                                key={col.label || i}
                                                className={`px-4 py-3 bg-gray-50 dark:bg-dark-bg/60 text-xs uppercase font-semibold text-gray-600 dark:text-gray-300 ${col.cls}`}
                                            >
                                                {col.label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-dark-border">
                                    {history.map((row) => (
                                        <tr key={row.id} className="hover:bg-gray-50/80 dark:hover:bg-dark-bg/40 transition-colors">
                                            <td className="px-4 py-3 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap text-xs">
                                                {row.invoiceDate}
                                            </td>
                                            <td className="px-4 py-3">
                                                <strong className="text-gray-900 dark:text-white font-semibold block text-sm">
                                                    {row.supplier}
                                                </strong>
                                                <div className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                                                    <span className="font-mono">{row.invoiceNumber}</span>
                                                    {row.status === 'CANCELLED' && (
                                                        <span className="badge badge-danger">Cancelled</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-xs">
                                                {row.batchName ? (
                                                    <span className="inline-block px-2 py-0.5 rounded bg-gray-100 dark:bg-dark-bg text-gray-700 dark:text-gray-300 text-xs">
                                                        {row.batchName}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap text-right font-mono">
                                                {currency(row.totalPaise)}
                                            </td>
                                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap text-right font-mono">
                                                {currency(row.paidPaise)}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-right">
                                                <span className={`font-semibold font-mono ${
                                                    row.duePaise > 0
                                                        ? 'text-amber-600 dark:text-amber-400'
                                                        : 'text-gray-700 dark:text-gray-300'
                                                }`}>
                                                    {currency(row.duePaise)}
                                                </span>
                                                {row.creditDuePaise > 0 && (
                                                    <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
                                                        Supplier owes {currency(row.creditDuePaise)}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                                <button
                                                    className="btn btn-outline btn-sm text-xs text-primary-600 hover:text-primary-700 hover:bg-primary-50 px-3 py-1.5"
                                                    onClick={() => openDetail(row.id)}
                                                >
                                                    View / Pay
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {!history.length && (
                            <div className="p-8 text-center text-sm text-gray-500">
                                {loading ? 'Loading purchases…' : 'No purchases recorded. Opening audit stock is separate.'}
                            </div>
                        )}

                        {/* Pagination Bar */}
                        <div className="px-4 py-3 border-t border-gray-100 dark:border-dark-border bg-gray-50/50 dark:bg-dark-bg/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-gray-600 dark:text-gray-400">
                            <span className="font-medium">
                                {total} {total === 1 ? 'invoice' : 'invoices'}
                            </span>
                            <div className="flex items-center gap-3">
                                <button
                                    className="btn btn-secondary btn-sm text-xs px-3 py-1"
                                    disabled={page <= 1 || loading}
                                    onClick={() => setPage((p) => p - 1)}
                                >
                                    Previous
                                </button>
                                <span className="font-medium px-2">Page {page}</span>
                                <button
                                    className="btn btn-secondary btn-sm text-xs px-3 py-1"
                                    disabled={page * 50 >= total || loading}
                                    onClick={() => setPage((p) => p + 1)}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            ) : (
                <>
                    {draft.pending && (
                        <div role="alert" className="card p-4 border border-amber-200 bg-amber-50/80 text-amber-900 rounded-xl flex items-center gap-3">
                            <IconAlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                            <p className="text-sm">
                                A previous save needs confirmation. Retry this unchanged purchase to check its result safely.
                            </p>
                        </div>
                    )}

                    <fieldset disabled={busy || draft.pending || confirm !== null} className="space-y-6 disabled:opacity-60">
                        {/* Section 1: Supplier & Invoice Information */}
                        <div className="card p-5 space-y-4 border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card rounded-xl shadow-sm">
                            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                                Supplier & Invoice Details
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                {([
                                    ['supplier', 'Supplier'],
                                    ['invoiceNumber', 'Invoice number'],
                                    ['batchName', 'Batch name'],
                                ] as const).map(([k, label]) => (
                                    <label key={k} className="space-y-1 block">
                                        <span className="label text-xs">{label}</span>
                                        <input
                                            className={control}
                                            maxLength={200}
                                            value={form[k]}
                                            onChange={(e) => change({ [k]: e.target.value })}
                                        />
                                    </label>
                                ))}
                                <label className="space-y-1 block">
                                    <span className="label text-xs">Invoice date</span>
                                    <input
                                        type="date"
                                        max={localDate()}
                                        className={control}
                                        value={form.invoiceDate}
                                        onChange={(e) => change({ invoiceDate: e.target.value })}
                                    />
                                </label>
                            </div>
                        </div>

                        {/* Section 2: Item Lookup & Line Items */}
                        <div className="card p-5 space-y-4 border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card rounded-xl shadow-sm">
                            <div className="space-y-1">
                                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                                    Audited Items & Line Quantities
                                </h2>
                                <label className="space-y-1 block">
                                    <span className="text-xs text-gray-500">Find audited item by name, attributes or barcode</span>
                                    <div className="relative">
                                        <input
                                            className={`${control} pl-9`}
                                            placeholder="Search existing audited stock…"
                                            value={itemSearch}
                                            onChange={(e) => setItemSearch(e.target.value)}
                                        />
                                        <div className="absolute left-3 top-2.5 text-gray-400 pointer-events-none">
                                            <IconSearch className="w-4 h-4" />
                                        </div>
                                    </div>
                                </label>
                                <p className="text-xs text-gray-500 mt-1">
                                    For a new style, use Stock → Add manually → Create item codes only, then receive it here. Do not add its quantity twice.
                                </p>

                                {!!options.length && (
                                    <div className="border border-gray-200 dark:border-dark-border rounded-xl max-h-64 overflow-auto bg-white dark:bg-dark-card shadow-lg divide-y divide-gray-100 dark:divide-dark-border z-10 relative mt-2">
                                        {options.map((item) => (
                                            <button
                                                key={item.id}
                                                className="block w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-dark-bg/60 transition-colors"
                                                onClick={() => add(item)}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className="font-semibold text-gray-900 dark:text-white text-sm">
                                                        {item.name} · {item.size}
                                                    </span>
                                                    <span className="badge badge-secondary font-mono text-xs">
                                                        {currency(item.sellingPrice * 100)}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-gray-500 mt-0.5">
                                                    Barcode: {item.barcode} {item.description && `· ${item.description}`}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Line Items Table */}
                            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-dark-border">
                                <table className="table w-full text-sm text-left">
                                    <thead>
                                        <tr>
                                            {[
                                                'Item',
                                                'Qty',
                                                form.tax ? 'Rate before GST / piece (₹)' : 'Cost including tax / piece (₹)',
                                                'Selling / piece (₹)',
                                                'MRP / piece (₹)',
                                                'Cost total',
                                                '',
                                            ].map((h) => (
                                                <th key={h} className="p-3 bg-gray-50 dark:bg-dark-bg/60 text-xs font-semibold text-gray-600 dark:text-gray-300">
                                                    {h}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-dark-border">
                                        {form.lines.map((line, index) => {
                                            const item = draft.options.find((o) => o.id === line.variantId);
                                            return (
                                                <tr key={line.variantId} className="hover:bg-gray-50 dark:hover:bg-dark-bg/40 transition-colors">
                                                    <td className="p-3 min-w-48">
                                                        <strong className="font-semibold text-gray-900 dark:text-white block">
                                                            {item?.name}
                                                        </strong>
                                                        <div className="text-xs text-gray-500">
                                                            {item?.size} · {item?.barcode}
                                                        </div>
                                                        {item?.description && (
                                                            <div className="text-xs text-gray-400">{item.description}</div>
                                                        )}
                                                        {form.tax && (
                                                            <label className="text-xs block mt-1.5">
                                                                <span className="text-gray-500">HSN (optional)</span>
                                                                <input
                                                                    aria-label={`HSN row ${index + 1}`}
                                                                    className={`${control} mt-0.5 py-1 text-xs`}
                                                                    maxLength={8}
                                                                    value={line.hsn || ''}
                                                                    onChange={(e) =>
                                                                        change({
                                                                            lines: form.lines.map((r, i) =>
                                                                                i === index ? { ...r, hsn: e.target.value } : r
                                                                            ),
                                                                        })
                                                                    }
                                                                />
                                                            </label>
                                                        )}
                                                        {(line.sellingPrice !== line.expectedSellingPrice ||
                                                            line.mrp !== line.expectedMrp) && (
                                                            <div className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-1">
                                                                New price batch: new barcode
                                                            </div>
                                                        )}
                                                    </td>
                                                    {(['quantity', 'unitCost', 'sellingPrice', 'mrp'] as const).map(
                                                        (field) => (
                                                            <td key={field} className="p-3">
                                                                <input
                                                                    aria-label={`${field} row ${index + 1}`}
                                                                    type="number"
                                                                    min={field === 'quantity' ? 1 : 0}
                                                                    step={field === 'quantity' ? 1 : '0.01'}
                                                                    className={`${control} min-w-24 text-right font-mono`}
                                                                    value={line[field]}
                                                                    onWheel={(e) => e.currentTarget.blur()}
                                                                    onChange={(e) =>
                                                                        change({
                                                                            lines: form.lines.map((r, i) =>
                                                                                i === index
                                                                                    ? { ...r, [field]: Number(e.target.value) }
                                                                                    : r
                                                                            ),
                                                                        })
                                                                    }
                                                                />
                                                            </td>
                                                        )
                                                    )}
                                                    <td className="p-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                                                        {currency(Math.round(line.unitCost * 100) * line.quantity)}
                                                    </td>
                                                    <td className="p-3 text-right">
                                                        <button
                                                            className="text-red-600 hover:text-red-700 font-medium text-xs underline"
                                                            onClick={() =>
                                                                change({
                                                                    lines: form.lines.filter((_, i) => i !== index),
                                                                })
                                                            }
                                                        >
                                                            Remove
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                {!form.lines.length && (
                                    <div className="p-8 text-center text-sm text-gray-500">
                                        No items added yet. Search above to add items to this purchase.
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Section 3: Financials & Tax */}
                        <div className="card p-5 space-y-4 border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card rounded-xl shadow-sm">
                            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                                Invoice Adjustments & Tax Breakdown
                            </h2>
                            <p className="text-xs text-gray-500 leading-relaxed">
                                {form.tax
                                    ? 'Enter rates before GST. Enter the exact tax amounts printed on the invoice below; no tax rate is assumed. Until accountant review, stock costs provisionally include GST and round-off.'
                                    : 'This restored draft uses costs including tax. Its original save format is preserved; GST is not separated.'}
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                {([
                                    ['discount', 'Invoice discount (₹)'],
                                    ['charges', 'Charges before GST (₹)'],
                                    ['paid', 'Paid now (₹)'],
                                ] as const).map(([field, label]) => (
                                    <label key={field} className="space-y-1 block">
                                        <span className="label text-xs">{label}</span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            className={control}
                                            value={form[field]}
                                            onWheel={(e) => e.currentTarget.blur()}
                                            onChange={(e) => change({ [field]: Number(e.target.value) })}
                                        />
                                    </label>
                                ))}
                                <label className="space-y-1 block">
                                    <span className="label text-xs">Payment source</span>
                                    <select
                                        className={control}
                                        value={form.paymentMode}
                                        onChange={(e) =>
                                            change({ paymentMode: e.target.value as PurchasePaymentMode })
                                        }
                                    >
                                        {modes.map(([val, label]) => (
                                            <option key={val} value={val}>
                                                {label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>

                            {form.tax && <PurchaseTaxFields value={form.tax} onChange={(tax) => change({ tax })} />}
                        </div>
                    </fieldset>

                    {/* Bottom Summary Bar */}
                    <div className="card p-5 border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card rounded-xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                            {form.tax && (
                                <p className="text-xs text-gray-500">
                                    Taxable value {currency(taxable)} · GST {currency(taxTotal)} · Round-off{' '}
                                    {currency(Math.round(form.tax.roundOff * 100))}
                                </p>
                            )}
                            <div className="text-base text-gray-800 dark:text-gray-200">
                                Purchase total <strong className="text-gray-900 dark:text-white text-lg">{currency(payable)}</strong> · Pending{' '}
                                <strong className="text-amber-600 dark:text-amber-400">{currency(payable - Math.round(form.paid * 100))}</strong>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 self-end sm:self-auto">
                            <button
                                disabled={busy || draft.pending}
                                className="btn btn-ghost text-red-600 hover:bg-red-50 text-xs px-3 py-2"
                                onClick={() => setConfirm('discard')}
                            >
                                Discard draft
                            </button>
                            <button
                                className="btn btn-primary btn-sm px-4 py-2 text-xs shadow-xs"
                                disabled={busy || !form.lines.length}
                                onClick={() => setConfirm('receive')}
                            >
                                {draft.pending ? 'Retry saved request' : 'Save purchase & receive stock'}
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* Confirm Discard / Receive Modal */}
            <ConfirmDialog
                isOpen={confirm !== null}
                onClose={() => !busy && setConfirm(null)}
                onConfirm={
                    confirm === 'discard'
                        ? () => {
                              setDraft({ form: initial(), options: [], pending: false });
                              setConfirm(null);
                          }
                        : receive
                }
                title={confirm === 'discard' ? 'Discard purchase draft?' : 'Receive this purchase?'}
                message={
                    confirm === 'discard'
                        ? 'This clears the unsaved form. No stock has been received.'
                        : `${form.supplier} · ${form.invoiceNumber}\nTotal ${currency(payable)}. Saving adds the quantities to stock and records the supplier balance. Corrections and supplier returns are recorded separately after saving.`
                }
                confirmText={confirm === 'discard' ? 'Discard' : 'Save purchase'}
                variant={confirm === 'discard' ? 'danger' : 'primary'}
                loading={busy}
            />

            {/* Purchase Detail Modal */}
            <Modal
                isOpen={!!detail}
                onClose={() => !busy && !actionBlocked && setDetail(null)}
                title="Purchase invoice and batches"
                size="xl"
            >
                {detail && (
                    <div className="space-y-5">
                        <div className="border-b border-gray-100 dark:border-dark-border pb-3">
                            <strong className="text-lg text-gray-900 dark:text-white block">
                                {detail.supplier} · {detail.invoiceNumber}
                            </strong>
                            <p className="text-xs text-gray-500 mt-0.5">
                                {detail.invoiceDate} · {detail.batchName} · <span className="badge badge-secondary">{detail.status}</span>
                            </p>
                        </div>

                        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-dark-border">
                            <table className="table w-full text-sm text-left">
                                <thead>
                                    <tr>
                                        {[
                                            'Item / barcode',
                                            'Qty',
                                            'Invoice unit cost',
                                            'Landed batch cost',
                                            'Selling price',
                                            'MRP',
                                        ].map((h) => (
                                            <th key={h} className="p-3 bg-gray-50 dark:bg-dark-bg/60 text-xs font-semibold text-gray-600 dark:text-gray-300">
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-dark-border">
                                    {detail.lines.map((line) => (
                                        <tr key={line.id} className="hover:bg-gray-50 dark:hover:bg-dark-bg/40">
                                            <td className="p-3">
                                                <strong className="font-semibold block">{line.name} · {line.size}</strong>
                                                <p className="text-xs text-gray-500 font-mono">{line.barcode}</p>
                                                {line.hsn && <p className="text-xs text-gray-400">HSN {line.hsn}</p>}
                                                {line.description && <p className="text-xs text-gray-400">{line.description}</p>}
                                            </td>
                                            <td className="p-3">
                                                <span className="font-medium">{line.quantity}</span>
                                                {line.returnedQuantity > 0 && (
                                                    <p className="text-xs text-amber-600">{line.returnedQuantity} returned</p>
                                                )}
                                            </td>
                                            <td className="p-3">{currency(line.unitCostPaise)}</td>
                                            <td className="p-3 font-semibold">{currency(line.landedTotalPaise)}</td>
                                            <td className="p-3">{currency(line.sellingPricePaise)}</td>
                                            <td className="p-3">{currency(line.mrpPaise)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <PurchaseTaxSummary
                            tax={detail.tax}
                            adjusted={detail.adjustments.some((a) => a.kind !== 'CORRECTION')}
                        />

                        <div className="p-4 bg-gray-50 dark:bg-dark-bg/40 rounded-xl border border-gray-200 dark:border-dark-border text-sm space-y-1">
                            <p className="text-xs text-gray-500">
                                Discount {currency(detail.discountPaise)} · Charges {currency(detail.chargesPaise)}
                            </p>
                            <p className="text-base font-medium">
                                Total <strong>{currency(detail.totalPaise)}</strong> · Paid {currency(detail.paidPaise)} · Pending{' '}
                                <strong className="text-amber-600">{currency(detail.duePaise)}</strong>
                                {detail.creditDuePaise > 0 && (
                                    <> · Supplier owes you <strong className="text-emerald-600">{currency(detail.creditDuePaise)}</strong></>
                                )}
                            </p>
                        </div>

                        {/* Payments Section */}
                        <div className="space-y-3">
                            <h3 className="font-semibold text-sm uppercase tracking-wider text-gray-700 dark:text-gray-300">
                                Payments
                            </h3>
                            <div className="space-y-2">
                                {detail.payments.map((p) => (
                                    <div key={p.id} className="p-3 rounded-lg border border-gray-200 dark:border-dark-border text-xs flex justify-between items-center">
                                        <div>
                                            <span className="font-medium">{new Date(p.createdAt).toLocaleString('en-IN')}</span> ·{' '}
                                            <span className={`badge ${p.amountPaise < 0 ? 'badge-warning' : 'badge-success'}`}>
                                                {p.amountPaise < 0 ? 'Refund received' : 'Payment'}
                                            </span> · {modes.find(([m]) => m === p.mode)?.[1]}
                                            {p.reason && <span className="block text-gray-500 mt-0.5">{p.reason}</span>}
                                        </div>
                                        <strong className="text-sm">{currency(Math.abs(p.amountPaise))}</strong>
                                    </div>
                                ))}
                                {!detail.payments.length && <p className="text-xs text-gray-500">No payments recorded.</p>}
                            </div>

                            {detail.status !== 'CANCELLED' && detail.duePaise > 0 && (
                                <button
                                    className="btn btn-primary btn-sm text-xs mt-2"
                                    disabled={!!payInput || actionBlocked}
                                    onClick={() =>
                                        setPayInput({
                                            operationId: crypto.randomUUID(),
                                            purchaseId: detail.id,
                                            amount: detail.duePaise / 100,
                                            mode: 'UPI',
                                        })
                                    }
                                >
                                    Record supplier payment
                                </button>
                            )}
                        </div>

                        <PurchaseActions
                            detail={detail}
                            disabled={busy || !!payInput}
                            onBlockedChange={setActionBlocked}
                            onSaved={async (id) => {
                                await openDetail(id);
                                await refresh();
                            }}
                        />

                        {!!detail.adjustments?.length && (
                            <div className="border-t border-gray-200 dark:border-dark-border pt-3 space-y-2">
                                <h3 className="font-semibold text-sm">Corrections and supplier returns</h3>
                                {detail.adjustments.map((a) => (
                                    <div key={a.id} className="p-3 border rounded-xl dark:border-dark-border text-xs space-y-1">
                                        <div className="flex justify-between">
                                            <strong>{a.kind}</strong>
                                            <span className="text-gray-500">
                                                {new Date(a.createdAt).toLocaleString('en-IN')}
                                                {a.createdByName && ` · ${a.createdByName}`}
                                            </span>
                                        </div>
                                        <p>{a.reason}</p>
                                        {a.lines?.map((line) => (
                                            <p key={line.lineId} className="text-gray-600 dark:text-gray-300">
                                                {line.name} · {line.barcode}: {line.quantity} pieces reversed
                                            </p>
                                        ))}
                                        <p className="font-semibold">
                                            {a.creditPaise >= 0 ? 'Invoice reduced by ' : 'Invoice increased by '}
                                            {currency(Math.abs(a.creditPaise))}
                                        </p>
                                        {a.replacementJson && (
                                            <details className="mt-1">
                                                <summary className="cursor-pointer text-primary-600">Saved correction details</summary>
                                                {(() => {
                                                    const saved = JSON.parse(a.replacementJson!);
                                                    return (
                                                        <div className="p-2 bg-gray-50 dark:bg-dark-bg/60 rounded mt-1 space-y-0.5">
                                                            <p className="font-medium">
                                                                {saved.header.supplier} · {saved.header.invoiceNumber} · {saved.header.invoiceDate} · {saved.header.batchName}
                                                            </p>
                                                            {saved.lines.map((l: { id: string; name: string; barcode: string; quantity: number; unitCostPaise: number }) => (
                                                                <p key={l.id}>
                                                                    {l.name} · {l.barcode}: {l.quantity} pieces at {currency(l.unitCostPaise)} cost each
                                                                </p>
                                                            ))}
                                                        </div>
                                                    );
                                                })()}
                                            </details>
                                        )}
                                    </div>
                                ))}
                                <details className="text-xs">
                                    <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Original invoice before changes</summary>
                                    <div className="p-2 bg-gray-50 dark:bg-dark-bg/60 rounded mt-1 space-y-0.5">
                                        <p className="font-medium">
                                            {detail.original.supplier} · {detail.original.invoiceNumber} · {currency(detail.original.totalPaise)}
                                        </p>
                                        {detail.original.lines.map((l) => (
                                            <p key={l.id}>
                                                {l.name} · {l.barcode}: {l.quantity} pieces at {currency(l.unitCostPaise)} cost each
                                            </p>
                                        ))}
                                    </div>
                                </details>
                            </div>
                        )}

                        <p className="text-xs text-gray-500">
                            Costs above belong to this receipt. They do not change the costs of earlier receipts. Sale-by-sale batch profit is a later step.
                        </p>
                    </div>
                )}
            </Modal>

            {/* Record Supplier Payment Modal */}
            <Modal
                isOpen={!!payInput}
                onClose={() => !busy && !payPending && setPayInput(null)}
                title="Record supplier payment"
            >
                {payInput && (
                    <div className="space-y-4">
                        {payPending && (
                            <p className="text-xs text-amber-600 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                                Payment result needs confirmation. Retry this same payment.
                            </p>
                        )}
                        <label className="space-y-1 block">
                            <span className="label text-xs">Amount (₹)</span>
                            <input
                                disabled={busy || payPending}
                                type="number"
                                min="0.01"
                                step="0.01"
                                className={control}
                                value={payInput.amount}
                                onWheel={(e) => e.currentTarget.blur()}
                                onChange={(e) => setPayInput({ ...payInput, amount: Number(e.target.value) })}
                            />
                        </label>
                        <label className="space-y-1 block">
                            <span className="label text-xs">Payment source</span>
                            <select
                                disabled={busy || payPending}
                                className={control}
                                value={payInput.mode}
                                onChange={(e) => setPayInput({ ...payInput, mode: e.target.value as PurchasePaymentMode })}
                            >
                                {modes.map(([val, label]) => (
                                    <option key={val} value={val}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className="pt-2 flex justify-end">
                            <button
                                disabled={busy}
                                className="btn btn-primary btn-sm px-4 py-2 text-xs"
                                onClick={() => setPayConfirm(true)}
                            >
                                {payPending ? 'Retry payment' : 'Review payment'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Confirm Supplier Payment Dialog */}
            <ConfirmDialog
                isOpen={payConfirm}
                onClose={() => !busy && setPayConfirm(false)}
                onConfirm={pay}
                title="Confirm supplier payment"
                message={`Record ${currency((payInput?.amount || 0) * 100)} against this invoice? Shop drawer payments also reduce the cash register balance.`}
                confirmText="Record payment"
                variant="primary"
                loading={busy}
            />
        </div>
    );
};
