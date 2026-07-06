import * as React from 'react';
import { useEffect, useState, useCallback } from 'react';
import { Activity, AlertTriangle, Download, Eye, Receipt, Search, TrendingUp, X, FileText, Printer } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { invoiceService, type Invoice, type InvoiceParams } from '@/features/invoices/services/invoice.service';
import { PaginatedTable } from '@/components/shared/PaginatedTable';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/shared/DateRangePicker';
import { 
  Card, 
  CardContent 
} from '@/components/ui/card';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useDateFilter } from '@/contexts/DateFilterContext';
import api from '@/lib/api';
import { demoInvoices, getDemoInvoicesPage, isDemoModeEnabled } from '@/lib/demo';
import { formatCurrency } from '@/lib/format';
import { StatCard } from '@/components/shared/StatCard';

export default function Sales() {
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

    const totalRevenue = invoices.reduce((sum, inv) => sum + inv.total, 0);
    const avgInvoice = invoices.length > 0 ? totalRevenue / invoices.length : 0;

    const handleViewInvoice = async (inv: Invoice) => {
        setSelectedInvoice(inv);
        if (inDemoMode || inv.items?.length) return;

        setModalLoading(true);
        try {
            const full = await invoiceService.getInvoiceById(inv.id);
            setSelectedInvoice(full);
        } catch {
            toast.error('Could not load sale details');
            setSelectedInvoice(prev => prev ? { ...prev, items: [] } : null);
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
            console.error('Failed to load sales', err);
            setError('Failed to load sales data.');
            if (!inDemoMode) {
                toast.error('Failed to load sales');
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
        const toastId = toast.loading('Exporting sales...');
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
            link.setAttribute('download', `sales_${new Date().toISOString().split('T')[0]}.csv`);
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
            header: 'Bill No',
            render: (inv: Invoice) => (
                <button
                    onClick={() => void handleViewInvoice(inv)}
                    className="flex items-center gap-2 hover:underline text-left outline-none"
                    title="Click to view details"
                >
                    <Receipt className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium text-sky-600 dark:text-sky-400">#{inv.billNo}</span>
                </button>
            )
        },
        {
            header: 'Customer',
            render: (inv: Invoice) => (
                <div>
                    <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{inv.customer.name}</p>
                    <p className="text-xs text-muted-foreground">{inv.customer.phone}</p>
                </div>
            )
        },
        {
            header: 'Date',
            render: (inv: Invoice) => (
                <div className="text-sm text-muted-foreground">
                    {new Date(inv.createdAt).toLocaleDateString('en-IN', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    })}
                </div>
            ),
            mobileHidden: true
        },
        {
            header: 'Items',
            render: (inv: Invoice) => (
                <Badge variant="secondary" className="font-normal text-xs">
                    {inv.itemCount} items
                </Badge>
            ),
            className: 'text-center',
            mobileHidden: true
        },
        {
            header: 'Total',
            render: (inv: Invoice) => <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">{formatCurrency(inv.total)}</span>,
            className: 'text-right'
        },
        {
            header: 'Actions',
            render: (inv: Invoice) => (
                <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" className="h-8" onClick={() => void handleViewInvoice(inv)}>
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                    </Button>
                </div>
            ),
            className: 'text-right',
            mobileHidden: true
        }
    ];

    return (
        <div className="flex-1 space-y-4 pt-4 pb-6">
            <div className="flex items-center justify-between gap-4 w-full">
                <div>
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Sales</h2>
                    <p className="text-muted-foreground text-xs hidden sm:block">
                        View and manage all sales records.
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <DateRangePicker />
                    <Button 
                        variant="outline" 
                        onClick={() => void handleExport()} 
                        disabled={exporting} 
                        className="h-9 px-3 hidden sm:flex"
                    >
                        <Download className="mr-2 h-4 w-4" />
                        Export
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard 
                    title="Total Sales" 
                    value={totalItems} 
                    icon={<Receipt className="h-4 w-4" />} 
                    loading={loading}
                    variant={totalItems > 0 ? 'success' : 'default'}
                />
                <StatCard 
                    title="Revenue" 
                    value={formatCurrency(totalRevenue)} 
                    icon={<TrendingUp className="h-4 w-4" />} 
                    loading={loading}
                />
                <StatCard 
                    title="Average Order" 
                    value={formatCurrency(avgInvoice)} 
                    icon={<Activity className="h-4 w-4" />} 
                    loading={loading}
                />
            </div>

            <Card className="border-slate-200/60 shadow-sm dark:border-slate-800">
                <CardContent className="p-4">
                    <div className="relative max-w-md">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search by bill number, name, or phone..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full h-9 rounded-lg border border-slate-200 bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:border-primary/40 dark:border-slate-800"
                        />
                    </div>
                </CardContent>
            </Card>

            {error && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2 animate-in fade-in duration-200">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{error}</span>
                </div>
            )}

            <div className="rounded-xl border bg-card overflow-hidden shadow-sm border-slate-200/60 dark:border-slate-800">
                <PaginatedTable
                    data={invoices}
                    columns={columns}
                    page={page}
                    total={totalItems}
                    onPageChange={setPage}
                    loading={loading}
                    itemsPerPage={limit}
                    onLimitChange={setLimit}
                    emptyMessage="No sales found for this period."
                />
            </div>

            <Dialog open={!!selectedInvoice} onOpenChange={(open) => !open && setSelectedInvoice(null)}>
                <DialogContent className="sm:max-w-xl rounded-2xl">
                    {selectedInvoice && (
                        <>
                            <DialogHeader>
                                <div className="flex justify-between items-start mb-2">
                                     <div className="h-10 w-10 justify-center rounded-xl border bg-muted flex items-center text-muted-foreground shadow-sm">
                                         <Receipt className="h-5 w-5" />
                                     </div>
                                     <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600 font-normal">Paid</Badge>
                                </div>
                                <DialogTitle className="text-xl">Bill #{selectedInvoice.billNo}</DialogTitle>
                                <DialogDescription>
                                    Billed on {new Date(selectedInvoice.createdAt).toLocaleString('en-IN')}
                                </DialogDescription>
                            </DialogHeader>

                            <div className="py-4 space-y-6">
                                <div className="flex justify-between gap-4">
                                    <div className="space-y-1">
                                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Customer Details</p>
                                        <p className="font-semibold text-slate-900 dark:text-slate-100">{selectedInvoice.customer.name}</p>
                                        <p className="text-sm text-muted-foreground">{selectedInvoice.customer.phone}</p>
                                    </div>
                                    <div className="text-right space-y-1">
                                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Amount</p>
                                        <p className="text-2xl font-bold text-sky-600 dark:text-sky-400">{formatCurrency(selectedInvoice.total)}</p>
                                    </div>
                                </div>

                                <div className="rounded-xl border p-4 space-y-4 max-h-[40vh] overflow-y-auto border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
                                    {modalLoading ? (
                                        <div className="text-center text-muted-foreground py-8 animate-pulse text-sm">Loading sale details...</div>
                                    ) : (
                                        <>
                                            {selectedInvoice.items?.map((item, idx) => (
                                                <div key={idx} className="flex justify-between items-center pb-2.5 border-b last:border-0 last:pb-0 border-slate-100 dark:border-slate-800">
                                                     <div>
                                                         <p className="font-medium text-sm text-slate-800 dark:text-slate-200">{item.product.name}</p>
                                                         <p className="text-xs text-muted-foreground mt-0.5">Quantity: {item.quantity}</p>
                                                     </div>
                                                     <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                                                         {formatCurrency(item.sellingPrice * item.quantity)}
                                                     </div>
                                                </div>
                                            ))}
                                            {(!selectedInvoice.items || selectedInvoice.items.length === 0) && (
                                                <p className="text-center text-muted-foreground text-sm py-4">Custom Item / Generic POS Entry</p>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>

                            <DialogFooter className="flex-col sm:flex-row gap-2">
                                <Button variant="outline" className="w-full sm:w-auto h-10 rounded-xl" onClick={() => setSelectedInvoice(null)}>
                                    Close
                                </Button>
                                <Button className="w-full sm:w-auto h-10 rounded-xl font-semibold">
                                    <Printer className="mr-2 h-4 w-4" />
                                    Print Bill
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
