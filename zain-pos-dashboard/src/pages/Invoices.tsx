import { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Download, Eye, Receipt, Search, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { MobileInvoiceCard } from '@/components/shared/MobileInvoiceCard';
import { invoiceService, type Invoice, type InvoiceParams } from '@/features/invoices/services/invoice.service';
import { PaginatedTable } from '@/components/shared/PaginatedTable';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDateFilter } from '@/contexts/DateFilterContext';
import api from '@/lib/api';
import { demoInvoices, getDemoInvoicesPage, isDemoModeEnabled } from '@/lib/demo';
import { formatCurrency } from '@/lib/format';

export default function Invoices() {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const { dateRange } = useDateFilter();
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
    const [modalLoading, setModalLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const inDemoMode = isDemoModeEnabled();

    const handleViewInvoice = async (inv: Invoice) => {
        setSelectedInvoice(inv);
        if (inDemoMode || inv.items?.length) return;

        setModalLoading(true);
        try {
            const full = await invoiceService.getInvoiceById(inv.id);
            setSelectedInvoice(full);
        } catch {
            toast.error('Could not load invoice details');
        } finally {
            setModalLoading(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 350);
        return () => clearTimeout(timer);
    }, [search]);

    const fetchInvoices = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            if (inDemoMode) {
                const filtered = demoInvoices.filter((invoice) => {
                    const term = debouncedSearch.toLowerCase();
                    if (!term) return true;
                    return (
                        String(invoice.billNo).toLowerCase().includes(term) ||
                        invoice.customer.name.toLowerCase().includes(term) ||
                        invoice.customer.phone.toLowerCase().includes(term)
                    );
                });

                const paged = getDemoInvoicesPage(page, limit);
                const invoicesPage = {
                    ...paged,
                    invoices: filtered.slice((page - 1) * limit, page * limit),
                    pagination: {
                        ...paged.pagination,
                        total: filtered.length,
                        pages: Math.max(1, Math.ceil(filtered.length / limit))
                    }
                };

                setInvoices(invoicesPage.invoices);
                setTotalPages(invoicesPage.pagination.pages);
                setTotalItems(invoicesPage.pagination.total);
                return;
            }

            const params: InvoiceParams = {
                page,
                limit,
                search: debouncedSearch,
                startDate: dateRange.startDate?.toISOString(),
                endDate: dateRange.endDate?.toISOString()
            };

            const data = await invoiceService.getInvoices(params);

            setInvoices(data.invoices);
            setTotalPages(data.pagination.pages);
            setTotalItems(data.pagination.total);
        } catch (err) {
            console.error('Failed to load invoices', err);
            setError('Failed to load invoices.');
            if (!inDemoMode) {
                toast.error('Failed to load invoices');
            }
        } finally {
            setLoading(false);
        }
    }, [page, limit, debouncedSearch, dateRange, inDemoMode]);

    useEffect(() => {
        void fetchInvoices();
    }, [fetchInvoices]);

    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, dateRange, limit]);

    const handleExport = async () => {
        setExporting(true);
        const toastId = toast.loading('Exporting invoices...');
        try {
            if (inDemoMode) {
                toast.success('Demo mode does not export real files.', { id: toastId });
                return;
            }

            const params = {
                search: debouncedSearch,
                startDate: dateRange.startDate?.toISOString(),
                endDate: dateRange.endDate?.toISOString()
            };

            const response = await api.get('/invoices/export', {
                params,
                responseType: 'blob'
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `invoices_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();

            toast.success('Export completed', { id: toastId });
        } catch (err) {
            console.error('Export failed:', err);
            toast.error('Export failed', { id: toastId });
        } finally {
            setExporting(false);
        }
    };

    const columns = [
        {
            header: 'Invoice #',
            render: (inv: Invoice) => <span className="font-mono font-medium">#{inv.billNo}</span>
        },
        {
            header: 'Customer',
            render: (inv: Invoice) => (
                <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">{inv.customer.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{inv.customer.phone}</p>
                </div>
            )
        },
        {
            header: 'Date',
            render: (inv: Invoice) => new Date(inv.createdAt).toLocaleDateString('en-IN', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            })
        },
        {
            header: 'Items',
            render: (inv: Invoice) => <span className="text-slate-600 dark:text-slate-400">{inv.itemCount} items</span>,
            className: 'text-center'
        },
        {
            header: 'Total',
            render: (inv: Invoice) => <span className="font-bold">{formatCurrency(inv.total)}</span>,
            className: 'text-right'
        },
        {
            header: 'Action',
            render: (inv: Invoice) => (
                <div className="flex justify-center">
                    <Button variant="ghost" size="sm" onClick={() => void handleViewInvoice(inv)}>
                        <Eye className="h-4 w-4" />
                    </Button>
                </div>
            ),
            className: 'text-center'
        }
    ];

    return (
        <div className="space-y-6 pb-20 lg:pb-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="dashboard-section-title">Invoices</h1>
                    <p className="dashboard-section-copy">Billing records for {dateRange.label}.</p>
                </div>
                <Button variant="outline" onClick={() => void handleExport()} disabled={exporting} className="rounded-2xl">
                    <Download className="mr-2 h-4 w-4" />
                    {exporting ? 'Exporting...' : 'Export CSV'}
                </Button>
            </div>

            <Card>
                <CardHeader className="border-b border-slate-200/70 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/40">
                    <CardTitle className="text-xl">Search Invoices</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search invoice, customer, or phone"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-700 dark:focus:ring-sky-950/40"
                        />
                    </div>
                </CardContent>
            </Card>

            {error && (
                <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50/80 px-5 py-4 text-sm font-medium text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300">
                    {error}
                </div>
            )}

            <div className="hidden md:block">
                <PaginatedTable
                    data={invoices}
                    columns={columns}
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    loading={loading}
                    itemsPerPage={limit}
                    onLimitChange={setLimit}
                    totalItems={totalItems}
                    emptyMessage="No invoices found matching your criteria."
                />
            </div>

            <div className="space-y-4 md:hidden">
                {loading ? (
                    <div className="dashboard-surface rounded-[1.5rem] px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                        Loading invoices...
                    </div>
                ) : invoices.length > 0 ? (
                    invoices.map((invoice) => (
                        <MobileInvoiceCard
                            key={invoice.id}
                            invoice={invoice}
                            onView={(inv) => void handleViewInvoice(inv)}
                        />
                    ))
                ) : (
                    <div className="dashboard-surface rounded-[1.5rem] px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                        No invoices found.
                    </div>
                )}

                {totalItems > 0 && (
                    <div className="flex items-center justify-between pt-4">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page <= 1 || loading}
                            onClick={() => setPage(page - 1)}
                        >
                            <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                        </Button>
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                            Page {page} of {totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page >= totalPages || loading}
                            onClick={() => setPage(page + 1)}
                        >
                            Next <ChevronRight className="ml-1 h-4 w-4" />
                        </Button>
                    </div>
                )}
            </div>

            {selectedInvoice && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-2xl overflow-y-auto rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_30px_80px_-32px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-slate-950">
                        <div className="p-6">
                            <div className="mb-6 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                                        <Receipt className="h-[18px] w-[18px] stroke-[1.9]" />
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-semibold">Invoice #{selectedInvoice.billNo}</h2>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            {new Date(selectedInvoice.createdAt).toLocaleString('en-IN')}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => { setSelectedInvoice(null); setModalLoading(false); }}
                                    className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-900"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="space-y-6">
                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <p className="mb-1 text-sm text-slate-500 dark:text-slate-400">Customer</p>
                                        <p className="text-lg font-medium">{selectedInvoice.customer.name}</p>
                                        <p className="text-slate-600 dark:text-slate-300">{selectedInvoice.customer.phone}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="mb-1 text-sm text-slate-500 dark:text-slate-400">Total</p>
                                        <p className="text-lg font-semibold">{formatCurrency(selectedInvoice.total)}</p>
                                    </div>
                                </div>

                                <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                                    {modalLoading ? (
                                        <div className="py-6 text-center text-slate-400">Loading items...</div>
                                    ) : (
                                        <table className="w-full">
                                            <thead>
                                                <tr className="text-left text-sm text-slate-500 dark:text-slate-400">
                                                    <th className="pb-2">Item</th>
                                                    <th className="pb-2 text-right">Qty</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {selectedInvoice.items.map((item, idx) => (
                                                    <tr key={idx} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                                        <td className="py-2">{item.product.name}</td>
                                                        <td className="py-2 text-right">{item.quantity}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>

                            <div className="mt-8 flex justify-end gap-3">
                                <Button variant="outline" onClick={() => { setSelectedInvoice(null); setModalLoading(false); }}>Close</Button>
                                <Button onClick={() => window.print()}>Print Invoice</Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
