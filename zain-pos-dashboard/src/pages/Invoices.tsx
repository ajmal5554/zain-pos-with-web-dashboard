import * as React from 'react';
import { useEffect, useState, useCallback } from 'react';
import { Activity, AlertTriangle, ChevronLeft, ChevronRight, Download, Eye, Receipt, Search, TrendingUp, X, FileText, Printer } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { MobileInvoiceCard } from '@/components/shared/MobileInvoiceCard';
import { invoiceService, type Invoice, type InvoiceParams } from '@/features/invoices/services/invoice.service';
import { PaginatedTable } from '@/components/shared/PaginatedTable';
import { Button } from '@/components/ui/button';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
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
import { cn } from '@/lib/utils';

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
            toast.error('Could not load bill details');
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
            console.error('Failed to load bills', err);
            setError('Failed to load bills.');
            if (!inDemoMode) {
                toast.error('Failed to load bills');
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
        const toastId = toast.loading('Exporting bills...');
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
            link.setAttribute('download', `bills_${new Date().toISOString().split('T')[0]}.csv`);
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
                <div className="flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">#{inv.billNo}</span>
                </div>
            )
        },
        {
            header: 'Customer',
            render: (inv: Invoice) => (
                <div>
                    <p className="font-medium text-sm">{inv.customer.name}</p>
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
            )
        },
        {
            header: 'Items',
            render: (inv: Invoice) => (
                <Badge variant="secondary" className="font-normal text-xs">
                    {inv.itemCount} items
                </Badge>
            ),
            className: 'text-center'
        },
        {
            header: 'Total',
            render: (inv: Invoice) => <span className="font-medium text-sm">{formatCurrency(inv.total)}</span>,
            className: 'text-right'
        },
        {
            header: 'Actions',
            render: (inv: Invoice) => (
                <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" className="h-8" onClick={() => void handleViewInvoice(inv)}>
                        View
                    </Button>
                </div>
            ),
            className: 'text-right'
        }
    ];

    return (
        <div className="flex-1 space-y-4 pt-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Bills</h2>
                    <p className="text-muted-foreground text-sm">
                        View and manage all bills for {dateRange.label}.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button 
                        variant="outline" 
                        onClick={() => void handleExport()} 
                        disabled={exporting} 
                    >
                        <Download className="mr-2 h-4 w-4" />
                        {exporting ? 'Exporting...' : 'Export to Excel'}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard 
                    title="Total Bills" 
                    value={totalItems} 
                    icon={<Receipt className="h-4 w-4" />} 
                    loading={loading}
                />
                <StatCard 
                    title="Total Sales" 
                    value={formatCurrency(totalRevenue)} 
                    icon={<TrendingUp className="h-4 w-4" />} 
                    loading={loading}
                />
                <StatCard 
                    title="Average Bill" 
                    value={formatCurrency(avgInvoice)} 
                    icon={<Activity className="h-4 w-4" />} 
                    loading={loading}
                />
            </div>

            <Card>
                <CardContent className="p-4">
                    <div className="relative max-w-sm">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search by bill number, name, or phone..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full h-9 rounded-md border border-input bg-background pl-8 pr-3 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        />
                    </div>
                </CardContent>
            </Card>

            {error && (
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{error}</span>
                </div>
            )}

            <div className="rounded-md border bg-card overflow-hidden">
                <PaginatedTable
                    data={invoices}
                    columns={columns}
                    page={page}
                    total={totalItems}
                    onPageChange={setPage}
                    loading={loading}
                    itemsPerPage={limit}
                    onLimitChange={setLimit}
                    emptyMessage="No matching bills found."
                />
            </div>

            <Dialog open={!!selectedInvoice} onOpenChange={(open) => !open && setSelectedInvoice(null)}>
                <DialogContent className="sm:max-w-xl">
                    {selectedInvoice && (
                        <>
                            <DialogHeader>
                                <div className="flex justify-between items-start mb-2">
                                     <div className="h-10 w-10 justify-center rounded-md border bg-muted flex items-center text-muted-foreground">
                                         <Receipt className="h-5 w-5" />
                                     </div>
                                     <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600">Paid</Badge>
                                </div>
                                <DialogTitle>Bill #{selectedInvoice.billNo}</DialogTitle>
                                <DialogDescription>
                                    Billed on {new Date(selectedInvoice.createdAt).toLocaleString('en-IN')}
                                </DialogDescription>
                            </DialogHeader>

                            <div className="py-4 space-y-6">
                                <div className="flex justify-between">
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-muted-foreground">Customer Details</p>
                                        <p className="font-semibold">{selectedInvoice.customer.name}</p>
                                        <p className="text-sm text-muted-foreground">{selectedInvoice.customer.phone}</p>
                                    </div>
                                    <div className="text-right space-y-1">
                                        <p className="text-sm font-medium text-muted-foreground">Total Amount</p>
                                        <p className="text-2xl font-bold">{formatCurrency(selectedInvoice.total)}</p>
                                    </div>
                                </div>

                                <div className="rounded-md border p-4 space-y-4 max-h-[40vh] overflow-y-auto">
                                    {modalLoading ? (
                                        <div className="text-center text-muted-foreground py-8">Loading bill details...</div>
                                    ) : (
                                        <>
                                            {selectedInvoice.items?.map((item, idx) => (
                                                <div key={idx} className="flex justify-between items-center pb-2 border-b last:border-0 last:pb-0">
                                                     <div>
                                                         <p className="font-medium text-sm">{item.product.name}</p>
                                                         <p className="text-xs text-muted-foreground mt-0.5">Quantity: {item.quantity}</p>
                                                     </div>
                                                     <div className="font-medium text-sm">
                                                         {formatCurrency(item.sellingPrice * item.quantity)}
                                                     </div>
                                                </div>
                                            ))}
                                            {(!selectedInvoice.items || selectedInvoice.items.length === 0) && (
                                                <p className="text-center text-muted-foreground text-sm py-4">Custom Item</p>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>

                            <DialogFooter className="flex-col sm:flex-row gap-2">
                                <Button variant="outline" className="w-full sm:w-auto" onClick={() => setSelectedInvoice(null)}>
                                    Close
                                </Button>
                                <Button className="w-full sm:w-auto">
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
