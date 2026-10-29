import React, { useEffect, useRef, useState } from 'react';
import { EXPENSE_CATEGORIES } from '../types/expenses';
import type {
    ExpenseInput,
    ExpenseAction,
    ExpenseQuery,
    ExpenseList,
    ExpenseRecord,
    ExpenseDetail,
    ExpenseSource,
    ExpenseCategory,
    ExpenseStatus,
} from '../types/expenses';
import { expensesService as service, ExpenseRequestError } from '../services/expenses.service';
import { useAuthStore } from '../store/authStore';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { showToast } from '../components/ui/Toast';

// Inline SVGs for self-contained visual excellence
const IconReceipt = ({ className = 'w-5 h-5' }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
    </svg>
);

const IconAlertTriangle = ({ className = 'w-5 h-5' }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
);

const IconLayers = ({ className = 'w-5 h-5' }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
);

const IconInfo = ({ className = 'w-4 h-4' }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const IconShieldAlert = ({ className = 'w-12 h-12' }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
);

const today = () =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());

const formatYmd = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);

const money = (paise: number) =>
    (paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });

const sources: Record<ExpenseSource, string> = {
    CASH_DRAWER: 'Shop cash drawer',
    UPI: 'UPI',
    BANK: 'Bank transfer',
    PERSONAL_CASH: 'Personal cash / outside drawer',
};

const labels: Record<ExpenseStatus, string> = {
    ACTIVE: 'Business expense',
    REVIEW: 'Needs review',
    EXCLUDED: 'Excluded',
    VOIDED: 'Voided',
};

type Pending =
    | { kind: 'CREATE'; input: ExpenseInput }
    | { kind: 'ACTION'; input: ExpenseAction; row: ExpenseRecord };

const empty = (): ExpenseInput => ({
    operationId: crypto.randomUUID(),
    date: today(),
    category: 'OTHER',
    amount: 0,
    note: '',
    paymentSource: 'CASH_DRAWER',
});

export const Expenses: React.FC = () => {
    const user = useAuthStore((s) => s.user);
    const allowed = !!user && user.isActive !== false && (user.role === 'ADMIN' || user.permManageCashDrawer);
    const key = `expense-request-v1:${user?.id}`;
    const initial = useRef<Pending | null>(null);
    const initialized = useRef(false);

    if (!initialized.current) {
        initialized.current = true;
        try {
            const saved = JSON.parse(localStorage.getItem(key) || 'null');
            if (saved?.input?.operationId && ['CREATE', 'ACTION'].includes(saved.kind)) {
                initial.current = saved;
            }
        } catch {
            /* Ignore corrupt local drafts; no financial data changes. */
        }
    }

    const [pending, setPending] = useState<Pending | null>(initial.current);
    const [form, setForm] = useState<ExpenseInput>(
        initial.current?.kind === 'CREATE' ? initial.current.input : empty()
    );
    const [addOpen, setAddOpen] = useState(initial.current?.kind === 'CREATE');
    const [action, setAction] = useState<{ input: ExpenseAction; row: ExpenseRecord } | null>(
        initial.current?.kind === 'ACTION' ? { input: initial.current.input, row: initial.current.row } : null
    );
    const [detail, setDetail] = useState<ExpenseDetail | null>(null);
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [filter, setFilter] = useState<ExpenseQuery>({
        from: today().slice(0, 7) + '-01',
        to: today(),
        search: '',
        status: 'ALL',
        paymentSource: 'ALL',
        page: 1,
    });
    const [data, setData] = useState<ExpenseList>({
        items: [],
        total: 0,
        page: 1,
        totals: { expensePaise: 0, reviewPaise: 0, reviewCount: 0 },
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const version = useRef(0);
    const inFlight = useRef(false);

    // Quick date presets using native Date
    const now = new Date();
    const todayStr = formatYmd(now);
    const thisMonthStart = todayStr.slice(0, 7) + '-01';
    const lastMonthEndD = new Date(now.getFullYear(), now.getMonth(), 0);
    const lastMonthStartD = new Date(lastMonthEndD.getFullYear(), lastMonthEndD.getMonth(), 1);
    const thisYearStart = `${now.getFullYear()}-01-01`;

    const datePresets = [
        { label: 'Today', start: todayStr, end: todayStr },
        { label: 'This Month', start: thisMonthStart, end: todayStr },
        { label: 'Last Month', start: formatYmd(lastMonthStartD), end: formatYmd(lastMonthEndD) },
        { label: 'This Year', start: thisYearStart, end: todayStr },
    ];

    async function refresh() {
        const request = ++version.current;
        setLoading(true);
        setError('');
        try {
            const result = await service.list(filter);
            if (request === version.current) setData(result);
        } catch (failure) {
            if (request === version.current) setError((failure as Error).message);
        } finally {
            if (request === version.current) setLoading(false);
        }
    }

    useEffect(() => {
        if (!allowed) return;
        const timer = setTimeout(refresh, 180);
        return () => {
            clearTimeout(timer);
            version.current++;
        };
    }, [filter, allowed]);

    const changeFilter = (patch: Partial<ExpenseQuery>) =>
        setFilter((previous) => ({ ...previous, ...patch, page: patch.page ?? 1 }));

    const change = (patch: Partial<ExpenseInput>) => {
        if (!busy && !pending) setForm((previous) => ({ ...previous, ...patch }));
    };

    function startAction(row: ExpenseRecord) {
        if (busy || pending || addOpen || action || detail) return;
        setAction({
            row,
            input: {
                operationId: crypto.randomUUID(),
                id: row.id,
                expectedRevision: row.revision,
                action: 'CLASSIFY',
                category: row.category as ExpenseCategory,
                reason: '',
            },
        });
    }

    async function save() {
        if (inFlight.current) return;
        const request =
            pending ||
            (addOpen
                ? { kind: 'CREATE' as const, input: form }
                : action
                ? { kind: 'ACTION' as const, ...action }
                : null);
        if (!request) return;
        inFlight.current = true;
        setBusy(true);
        try {
            localStorage.setItem(key, JSON.stringify(request));
            setPending(request);
            if (request.kind === 'CREATE') await service.create(request.input);
            else await service.act(request.input);
            localStorage.removeItem(key);
            setPending(null);
            setAddOpen(false);
            setAction(null);
            setConfirm(false);
            setForm(empty());
            showToast('Expense records updated.', 'success');
            await refresh();
        } catch (failure) {
            if (failure instanceof ExpenseRequestError && failure.confirmedRejected) {
                localStorage.removeItem(key);
                setPending(null);
            }
            showToast((failure as Error).message, 'error');
            setConfirm(false);
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }

    async function view(id: string) {
        if (busy || pending || addOpen || action || detail) return;
        try {
            setDetail(await service.detail(id));
        } catch (failure) {
            showToast((failure as Error).message, 'error');
        }
    }

    async function exportCsv() {
        setExporting(true);
        try {
            const result = await service.export(filter);
            const url = URL.createObjectURL(
                new Blob(['\uFEFF' + result.csv], { type: 'text/csv;charset=utf-8' })
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = `Zain_Expenses_${filter.from}_${filter.to}.csv`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showToast(`${result.rowCount} expense entries exported.`, 'success');
        } catch (failure) {
            showToast((failure as Error).message, 'error');
        } finally {
            setExporting(false);
        }
    }

    const actionMessage =
        action?.input.action === 'VOID'
            ? 'Void this mistaken entry? For a payment from today’s open drawer, an equal reversing cash-in entry will be recorded. Closed-register cash entries cannot be voided here.'
            : action?.input.action === 'EXCLUDE'
            ? 'Exclude this entry from business expense totals? Its original cash movement stays unchanged.'
            : 'Include or reclassify this business expense? An existing drawer payment will be reused; no extra cash outflow is created.';

    if (!allowed) {
        return (
            <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-4">
                <div className="p-4 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-full">
                    <IconShieldAlert className="w-12 h-12" />
                </div>
                <h1 className="text-2xl font-bold">Access Restricted</h1>
                <p className="text-gray-500 max-w-md">
                    Cash-register permission is required to manage expenses.
                </p>
            </div>
        );
    }

    const totalPages = Math.ceil(data.total / 50) || 1;
    const currentPage = filter.page ?? 1;

    return (
        <div className="space-y-6 text-gray-800 dark:text-gray-100 pb-12">
            {/* Top Action & Controls Bar */}
            <div className="card space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 dark:border-dark-border pb-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                        <IconReceipt className="w-4 h-4 text-primary-600" />
                        <span>Business Expenses & Drawer Outflows</span>
                        {loading && (
                            <span className="flex items-center gap-1.5 text-xs text-primary-600 dark:text-primary-400 font-normal animate-pulse ml-2">
                                <span>Loading expenses...</span>
                            </span>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            className="btn btn-secondary btn-sm text-xs"
                            disabled={exporting || loading}
                            onClick={exportCsv}
                        >
                            {exporting ? 'Exporting…' : 'Export CSV'}
                        </button>
                        <button
                            className="btn btn-primary btn-sm text-xs shadow-sm"
                            disabled={busy || !!pending || addOpen || !!action || !!detail}
                            onClick={() => {
                                setForm(empty());
                                setAddOpen(true);
                            }}
                        >
                            Add expense
                        </button>
                    </div>
                </div>

                {/* Hero Stat Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Card 1: Recorded Business Expenses */}
                    <div className="stat-card relative overflow-hidden group">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                                <p className="stat-label text-xs uppercase tracking-wider font-semibold">
                                    Recorded business expenses
                                </p>
                                <div className="stat-value mt-1.5 text-xl xl:text-2xl font-bold truncate text-emerald-600 dark:text-emerald-400">
                                    {money(data.totals.expensePaise)}
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                    Active classified business costs
                                </p>
                            </div>
                            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                                <IconReceipt className="w-5 h-5" />
                            </div>
                        </div>
                        <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-dark-border flex items-center justify-between text-xs text-gray-500">
                            <span>Operating overhead</span>
                            <span className="badge badge-success text-[10px]">Active</span>
                        </div>
                    </div>

                    {/* Card 2: Drawer Entries Awaiting Review */}
                    <div className="stat-card relative overflow-hidden group">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                                <p className="stat-label text-xs uppercase tracking-wider font-semibold">
                                    Drawer entries awaiting review ({data.totals.reviewCount})
                                </p>
                                <div className={`stat-value mt-1.5 text-xl xl:text-2xl font-bold truncate ${
                                    data.totals.reviewCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'
                                }`}>
                                    {money(data.totals.reviewPaise)}
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                    {data.totals.reviewCount > 0
                                        ? '⚠️ Drawer cash out requires review'
                                        : 'All drawer outflows classified'}
                                </p>
                            </div>
                            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex-shrink-0">
                                <IconAlertTriangle className="w-5 h-5" />
                            </div>
                        </div>
                        <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-dark-border flex items-center justify-between text-xs text-gray-500">
                            <span>Pending cash ledger check</span>
                            {data.totals.reviewCount > 0 ? (
                                <span className="badge badge-warning text-[10px]">Review Needed</span>
                            ) : (
                                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Reconciled</span>
                            )}
                        </div>
                    </div>

                    {/* Card 3: Matching Entries */}
                    <div className="stat-card relative overflow-hidden group">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                                <p className="stat-label text-xs uppercase tracking-wider font-semibold">
                                    Matching entries
                                </p>
                                <div className="stat-value mt-1.5 text-xl xl:text-2xl font-bold truncate">
                                    {data.total}
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                    Showing page {currentPage} of {totalPages}
                                </p>
                            </div>
                            <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex-shrink-0">
                                <IconLayers className="w-5 h-5" />
                            </div>
                        </div>
                        <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-dark-border flex items-center justify-between text-xs text-gray-500">
                            <span>Total filtered results</span>
                            <span className="badge badge-info text-[10px]">Page {currentPage}</span>
                        </div>
                    </div>
                </div>

                {/* Policy / Tax Advisory Notice */}
                <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 p-3.5 text-amber-900 dark:text-amber-200 flex items-start gap-3 text-xs leading-relaxed">
                    <IconInfo className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold text-amber-950 dark:text-amber-100">
                            Expense Accounting & Ledger Policy
                        </p>
                        <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                            Amounts include tax as paid; tax treatment is not yet reviewed. Owner withdrawals, float changes and linked supplier payments are excluded. Do not add purchase charges already included in stock cost.
                        </p>
                    </div>
                </div>

                {/* Filters Section */}
                <div className="space-y-3 pt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-gray-500 mr-1 font-medium">Presets:</span>
                        {datePresets.map((preset) => {
                            const isActive = filter.from === preset.start && filter.to === preset.end;
                            return (
                                <button
                                    key={preset.label}
                                    onClick={() => changeFilter({ from: preset.start, to: preset.end })}
                                    className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${
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

                    <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
                        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                            From
                            <input
                                type="date"
                                className="input mt-1 text-sm font-normal"
                                value={filter.from}
                                onChange={(e) => changeFilter({ from: e.target.value })}
                            />
                        </label>

                        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                            To
                            <input
                                type="date"
                                className="input mt-1 text-sm font-normal"
                                value={filter.to}
                                onChange={(e) => changeFilter({ to: e.target.value })}
                            />
                        </label>

                        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                            Search
                            <input
                                className="input mt-1 text-sm font-normal"
                                placeholder="Description or category"
                                value={filter.search}
                                onChange={(e) => changeFilter({ search: e.target.value })}
                            />
                        </label>

                        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                            Status
                            <select
                                className="input mt-1 text-sm font-normal"
                                value={filter.status}
                                onChange={(e) => changeFilter({ status: e.target.value as ExpenseQuery['status'] })}
                            >
                                <option value="ALL">All statuses</option>
                                {Object.entries(labels).map(([value, label]) => (
                                    <option key={value} value={value}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                            Payment source
                            <select
                                className="input mt-1 text-sm font-normal"
                                value={filter.paymentSource}
                                onChange={(e) =>
                                    changeFilter({ paymentSource: e.target.value as ExpenseQuery['paymentSource'] })
                                }
                            >
                                <option value="ALL">All sources</option>
                                {Object.entries(sources).map(([value, label]) => (
                                    <option key={value} value={value}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                </div>
            </div>

            {/* Error Alert */}
            {error && (
                <div className="card border-l-4 border-red-500 bg-red-50/50 dark:bg-red-900/10 p-4 flex items-center justify-between gap-3 text-sm">
                    <span role="alert" className="text-red-700 dark:text-red-300 font-medium">
                        {error}
                    </span>
                    <button className="btn btn-outline btn-sm text-xs" onClick={refresh}>
                        Retry
                    </button>
                </div>
            )}

            {/* Table Card */}
            <div className="card overflow-hidden !p-0">
                <div className="overflow-x-auto">
                    <table className="table">
                        <thead>
                            <tr>
                                {['Date', 'Category / description', 'Source', 'Amount', 'Status', 'Actions'].map((label) => (
                                    <th key={label} className="p-3">
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {data.items.map((row) => (
                                <tr
                                    key={row.id}
                                    className={`border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-dark-bg/50 transition-colors ${
                                        row.status === 'VOIDED' || row.status === 'EXCLUDED'
                                            ? 'text-gray-400 dark:text-gray-500'
                                            : ''
                                    }`}
                                >
                                    <td className="p-3 whitespace-nowrap text-sm font-medium">
                                        {row.expenseDate}
                                    </td>

                                    <td className="p-3 min-w-48">
                                        <span className="font-semibold text-gray-900 dark:text-white text-sm">
                                            {EXPENSE_CATEGORIES[row.category as ExpenseCategory] || row.category}
                                        </span>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                            {row.note}
                                        </p>
                                    </td>

                                    <td className="p-3 text-sm">
                                        <span>{sources[row.paymentSource]}</span>
                                        {row.drawerTxId && (
                                            <span className="block text-[11px] text-primary-600 dark:text-primary-400 font-medium">
                                                Existing cash entry linked
                                            </span>
                                        )}
                                    </td>

                                    <td className="p-3 whitespace-nowrap font-bold text-sm text-gray-900 dark:text-white">
                                        {money(row.amountPaise)}
                                    </td>

                                    <td className="p-3">
                                        <span
                                            className={`badge ${
                                                row.status === 'ACTIVE'
                                                    ? 'badge-success'
                                                    : row.status === 'REVIEW'
                                                    ? 'badge-warning font-semibold'
                                                    : row.status === 'EXCLUDED'
                                                    ? 'badge-info'
                                                    : 'badge-danger'
                                            }`}
                                        >
                                            {labels[row.status]}
                                        </span>
                                    </td>

                                    <td className="p-3">
                                        <div className="flex items-center gap-2">
                                            <button
                                                className="btn btn-outline btn-sm text-xs"
                                                disabled={busy || !!pending || addOpen || !!action || !!detail}
                                                onClick={() => view(row.id)}
                                            >
                                                Details
                                            </button>
                                            {row.status !== 'VOIDED' && (
                                                <button
                                                    className={`btn btn-sm text-xs ${
                                                        row.status === 'REVIEW' ? 'btn-primary shadow-xs' : 'btn-secondary'
                                                    }`}
                                                    disabled={busy || !!pending || addOpen || !!action || !!detail}
                                                    onClick={() => startAction(row)}
                                                >
                                                    {row.status === 'REVIEW' ? 'Review' : 'Change'}
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {!data.items.length && (
                        <div className="text-center py-12 text-gray-500 dark:text-gray-400 space-y-2">
                            <IconReceipt className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto" />
                            <p className="text-sm font-medium">
                                {loading ? 'Loading expenses…' : 'No expense entries in this date range.'}
                            </p>
                        </div>
                    )}
                </div>

                {/* Table Footer with Pagination */}
                <div className="p-3 border-t border-gray-200 dark:border-dark-border flex flex-col sm:flex-row items-center justify-between gap-3 bg-gray-50/50 dark:bg-dark-bg/30">
                    <button
                        className="btn btn-outline btn-sm text-xs"
                        onClick={refresh}
                        disabled={loading}
                    >
                        Refresh
                    </button>

                    <div className="flex items-center gap-3">
                        <button
                            className="btn btn-outline btn-sm text-xs"
                            disabled={(filter.page ?? 1) <= 1 || loading}
                            onClick={() => changeFilter({ page: (filter.page ?? 1) - 1 })}
                        >
                            Previous
                        </button>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                            Page {filter.page ?? 1}
                        </span>
                        <button
                            className="btn btn-outline btn-sm text-xs"
                            disabled={(filter.page ?? 1) * 50 >= data.total || loading}
                            onClick={() => changeFilter({ page: (filter.page ?? 1) + 1 })}
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>

            {/* Modal: Add Expense */}
            <Modal
                isOpen={addOpen}
                onClose={() => !busy && !pending && setAddOpen(false)}
                title="Record business expense"
                size="lg"
            >
                <div className="space-y-4">
                    {pending && (
                        <p role="alert" className="text-amber-600 text-xs font-semibold">
                            This save needs confirmation. Retry the unchanged request; it may already have saved.
                        </p>
                    )}

                    <fieldset disabled={busy || !!pending || confirm} className="space-y-4">
                        <div className="grid sm:grid-cols-2 gap-3">
                            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                                Expense date
                                <input
                                    className="input mt-1 text-sm font-normal"
                                    type="date"
                                    max={today()}
                                    value={form.date}
                                    onChange={(e) => change({ date: e.target.value })}
                                />
                            </label>

                            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                                Amount (₹)
                                <input
                                    className="input mt-1 text-sm font-normal"
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={form.amount}
                                    onWheel={(e) => e.currentTarget.blur()}
                                    onChange={(e) => change({ amount: Number(e.target.value) })}
                                />
                            </label>
                        </div>

                        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                            Category
                            <select
                                className="input mt-1 text-sm font-normal"
                                value={form.category}
                                onChange={(e) => change({ category: e.target.value as ExpenseCategory })}
                            >
                                {Object.entries(EXPENSE_CATEGORIES).map(([value, label]) => (
                                    <option key={value} value={value}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                            Paid from
                            <select
                                className="input mt-1 text-sm font-normal"
                                value={form.paymentSource}
                                onChange={(e) => change({ paymentSource: e.target.value as ExpenseSource })}
                            >
                                {Object.entries(sources).map(([value, label]) => (
                                    <option key={value} value={value}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                            Description / bill reference
                            <input
                                className="input mt-1 text-sm font-normal"
                                maxLength={500}
                                value={form.note}
                                onChange={(e) => change({ note: e.target.value })}
                                placeholder="Enter description or reference number"
                            />
                        </label>
                    </fieldset>

                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed bg-gray-50 dark:bg-dark-bg p-3 rounded-lg border border-gray-100 dark:border-dark-border">
                        Shop cash creates one outflow in today’s open register. Other sources do not change drawer cash. For a payment already recorded in the register, review that entry instead of adding it again.
                    </p>

                    <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-dark-border">
                        <button
                            className="btn btn-secondary text-sm"
                            disabled={busy || !!pending}
                            onClick={() => setAddOpen(false)}
                        >
                            Close
                        </button>
                        <button
                            className="btn btn-primary text-sm shadow-sm"
                            disabled={busy || !form.note.trim() || !(form.amount > 0)}
                            onClick={() => setConfirm(true)}
                        >
                            {pending ? 'Retry unchanged save' : 'Review & save'}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Modal: Action (Review/Change/Void/Exclude) */}
            <Modal
                isOpen={!!action}
                onClose={() => !busy && !pending && setAction(null)}
                title="Review or correct expense"
                size="lg"
            >
                {action && (
                    <div className="space-y-4">
                        <div className="p-3 bg-gray-50 dark:bg-dark-bg rounded-lg border border-gray-200 dark:border-dark-border">
                            <div className="flex items-center justify-between">
                                <strong className="text-lg text-primary-600 dark:text-primary-400">
                                    {money(action.row.amountPaise)}
                                </strong>
                                <span className="badge badge-info">{sources[action.row.paymentSource]}</span>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">Date: {action.row.expenseDate}</p>
                            <p className="text-sm font-medium mt-1">{action.row.note}</p>
                        </div>

                        {pending && (
                            <p className="text-amber-600 text-xs font-semibold">
                                Retry this unchanged request to confirm its result.
                            </p>
                        )}

                        <fieldset disabled={busy || !!pending || confirm} className="space-y-4">
                            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                                Action
                                <select
                                    className="input mt-1 text-sm font-normal"
                                    value={action.input.action}
                                    onChange={(e) =>
                                        setAction({
                                            ...action,
                                            input: { ...action.input, action: e.target.value as ExpenseAction['action'] },
                                        })
                                    }
                                >
                                    <option value="CLASSIFY">Include / change business expense category</option>
                                    <option value="EXCLUDE">Exclude from expenses; keep cash unchanged</option>
                                    <option value="VOID">Void a mistaken entry</option>
                                </select>
                            </label>

                            {action.input.action === 'CLASSIFY' && (
                                <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                                    Business category
                                    <select
                                        className="input mt-1 text-sm font-normal"
                                        value={action.input.category}
                                        onChange={(e) =>
                                            setAction({
                                                ...action,
                                                input: {
                                                    ...action.input,
                                                    category: e.target.value as ExpenseCategory,
                                                },
                                            })
                                        }
                                    >
                                        {Object.entries(EXPENSE_CATEGORIES).map(([value, label]) => (
                                            <option key={value} value={value}>
                                                {label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}

                            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                                Reason
                                <input
                                    className="input mt-1 text-sm font-normal"
                                    maxLength={500}
                                    value={action.input.reason}
                                    onChange={(e) =>
                                        setAction({
                                            ...action,
                                            input: { ...action.input, reason: e.target.value },
                                        })
                                    }
                                    placeholder="Enter reason for this classification or correction"
                                />
                            </label>
                        </fieldset>

                        <div className="bg-gray-50 dark:bg-dark-bg p-3 rounded-lg border border-gray-100 dark:border-dark-border space-y-1">
                            <p className="text-xs text-gray-600 dark:text-gray-400">{actionMessage}</p>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                Amount and original payment stay in history. To fix a wrong amount, void the mistaken entry and record the correct amount. Voiding is for recording mistakes, not an actual expense refund.
                            </p>
                        </div>

                        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-dark-border">
                            <button
                                className="btn btn-secondary text-sm"
                                disabled={busy || !!pending}
                                onClick={() => setAction(null)}
                            >
                                Close
                            </button>
                            <button
                                className="btn btn-primary text-sm shadow-sm"
                                disabled={busy || !action.input.reason.trim()}
                                onClick={() => setConfirm(true)}
                            >
                                {pending ? 'Retry unchanged action' : 'Review & confirm'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Confirm Dialog */}
            <ConfirmDialog
                isOpen={confirm}
                onClose={() => !busy && setConfirm(false)}
                onConfirm={save}
                title={addOpen ? 'Record this expense?' : 'Confirm expense change'}
                message={
                    addOpen
                        ? `${money(Math.round(form.amount * 100))} · ${form.date} · ${sources[form.paymentSource]}\n${
                              form.note
                          }\n${
                              form.paymentSource === 'CASH_DRAWER'
                                  ? 'This also creates one cash outflow.'
                                  : 'This records the expense without changing drawer cash.'
                          }`
                        : `${money(action?.row.amountPaise ?? 0)} · ${action?.row.note}\n${actionMessage}`
                }
                confirmText={pending ? 'Retry safely' : 'Confirm'}
                variant={action?.input.action === 'VOID' ? 'danger' : 'primary'}
                loading={busy}
            />

            {/* Modal: Details History */}
            <Modal isOpen={!!detail} onClose={() => setDetail(null)} title="Expense history" size="lg">
                {detail && (
                    <div className="space-y-4">
                        <div className="p-4 bg-gray-50 dark:bg-dark-bg rounded-xl border border-gray-200 dark:border-dark-border space-y-2">
                            <div className="flex items-center justify-between">
                                <strong className="text-xl text-primary-600 dark:text-primary-400">
                                    {money(detail.amountPaise)}
                                </strong>
                                <span className={`badge ${
                                    detail.status === 'ACTIVE'
                                        ? 'badge-success'
                                        : detail.status === 'REVIEW'
                                        ? 'badge-warning'
                                        : detail.status === 'EXCLUDED'
                                        ? 'badge-info'
                                        : 'badge-danger'
                                }`}>
                                    {labels[detail.status]}
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                                <span>Date: {detail.expenseDate}</span>
                                <span>Source: {sources[detail.paymentSource]}</span>
                                <span>Category: {EXPENSE_CATEGORIES[detail.category as ExpenseCategory]}</span>
                            </div>
                            <p className="text-sm font-medium pt-1 text-gray-800 dark:text-gray-200">
                                {detail.note}
                            </p>
                        </div>

                        {detail.status === 'REVIEW' && (
                            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
                                <IconInfo className="w-4 h-4 text-amber-600 flex-shrink-0" />
                                <span>This cash movement is already recorded. Review it to include or exclude it from business expense totals.</span>
                            </div>
                        )}

                        <div className="space-y-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                                Audit & Event History
                            </h4>
                            <div className="space-y-2">
                                {detail.history.map((event) => (
                                    <div
                                        key={event.id}
                                        className="p-3 bg-white dark:bg-dark-card border border-gray-100 dark:border-dark-border rounded-lg text-xs space-y-1"
                                    >
                                        <div className="flex items-center justify-between font-semibold">
                                            <span className="text-primary-600 dark:text-primary-400">
                                                {event.action}
                                            </span>
                                            <span className="text-gray-400">
                                                {new Date(event.createdAt).toLocaleString('en-IN')}
                                            </span>
                                        </div>
                                        <p className="text-gray-500">Actor: {event.actor}</p>
                                        <p className="text-gray-700 dark:text-gray-300 font-medium">
                                            {event.reason}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};
