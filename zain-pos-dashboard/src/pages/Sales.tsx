import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, ShoppingCart, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import { useDateFilter } from '@/contexts/DateFilterContext';
import { PaginatedTable } from '@/components/shared/PaginatedTable';
import { MobileSalesCard } from '@/components/shared/MobileSalesCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import api from '@/lib/api';
import { demoSales, isDemoModeEnabled } from '@/lib/demo';
import { formatCurrency } from '@/lib/format';

interface SaleRecord {
    id: string;
    billNo: string;
    createdAt: string;
    customerName?: string;
    customerPhone?: string;
    items?: unknown[];
    grandTotal: number;
    status: string;
    user?: {
        name?: string;
    };
}

export default function Sales() {
    const { dateRange } = useDateFilter();
    const [sales, setSales] = useState<SaleRecord[]>([]);
    const [summary, setSummary] = useState({ totalSales: 0, totalOrders: 0, averageOrderValue: 0 });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(50);
    const [totalItems, setTotalItems] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void fetchSales();
        void fetchSummary();
    }, [dateRange, page, limit]);

    const fetchSales = async () => {
        setLoading(true);
        setError(null);

        try {
            if (isDemoModeEnabled()) {
                setSales(demoSales);
                setTotalItems(demoSales.length);
                return;
            }

            const params = {
                page,
                limit,
                startDate: dateRange.startDate?.toISOString(),
                endDate: dateRange.endDate?.toISOString()
            };
            const response = await api.get('/sales', { params });
            setSales(response.data.data);
            setTotalItems(response.data.pagination.total);
        } catch (err) {
            console.error('Failed to fetch sales:', err);
            setError('Sales data is unavailable right now.');
        } finally {
            setLoading(false);
        }
    };

    const fetchSummary = async () => {
        try {
            if (isDemoModeEnabled()) {
                const totalSales = demoSales
                    .filter((sale) => sale.status === 'COMPLETED')
                    .reduce((sum, sale) => sum + sale.grandTotal, 0);
                const totalOrders = demoSales.length;
                setSummary({
                    totalSales,
                    totalOrders,
                    averageOrderValue: totalOrders ? totalSales / totalOrders : 0
                });
                return;
            }

            const params = {
                startDate: dateRange.startDate?.toISOString(),
                endDate: dateRange.endDate?.toISOString()
            };
            const response = await api.get('/sales/summary', { params });
            setSummary(response.data);
        } catch (err) {
            console.error('Failed to fetch summary:', err);
        }
    };

    const columns = [
        {
            header: 'Bill No',
            accessor: 'billNo' as keyof SaleRecord,
            className: 'font-medium'
        },
        {
            header: 'Date',
            render: (sale: SaleRecord) => format(new Date(sale.createdAt), 'dd MMM yyyy, hh:mm a')
        },
        {
            header: 'Customer',
            render: (sale: SaleRecord) => (
                <div>
                    <div className="font-medium text-slate-900 dark:text-slate-100">{sale.customerName || 'Walk-in'}</div>
                    {sale.customerPhone && <div className="text-xs text-slate-500 dark:text-slate-400">{sale.customerPhone}</div>}
                </div>
            )
        },
        {
            header: 'Items',
            render: (sale: SaleRecord) => sale.items?.length || 0,
            className: 'text-right'
        },
        {
            header: 'Amount',
            render: (sale: SaleRecord) => formatCurrency(sale.grandTotal),
            className: 'text-right font-medium'
        },
        {
            header: 'Status',
            render: (sale: SaleRecord) => (
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${sale.status === 'COMPLETED'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
                    }`}>
                    {sale.status}
                </span>
            ),
            className: 'text-center'
        },
        {
            header: 'Cashier',
            render: (sale: SaleRecord) => sale.user?.name || '-'
        }
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="dashboard-section-title">Sales History</h1>
                <p className="dashboard-section-copy">
                    Order flow, ticket value, and cashier activity for {dateRange.label}.
                </p>
            </div>

            {error && (
                <div className="dashboard-surface rounded-[1.5rem] p-4">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3 text-rose-700 dark:text-rose-300">
                            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                            <span className="truncate text-sm font-medium">{error}</span>
                        </div>
                        <Button variant="ghost" className="rounded-full" onClick={() => void fetchSales()}>
                            Retry
                        </Button>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="flex items-center gap-4 p-6">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                            <TrendingUp className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Total Revenue</p>
                            <p className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                                {formatCurrency(summary.totalSales)}
                            </p>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="flex items-center gap-4 p-6">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">
                            <ShoppingCart className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Total Orders</p>
                            <p className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{summary.totalOrders}</p>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="flex items-center gap-4 p-6">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
                            <TrendingUp className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Average Order</p>
                            <p className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                                {formatCurrency(summary.averageOrderValue)}
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="hidden md:block">
                <PaginatedTable
                    data={sales}
                    columns={columns}
                    page={page}
                    totalPages={Math.ceil(totalItems / limit) || 1}
                    onPageChange={setPage}
                    loading={loading}
                    itemsPerPage={limit}
                    totalItems={totalItems}
                    onLimitChange={setLimit}
                    emptyMessage="No sales found for the selected period."
                />
            </div>

            <div className="space-y-4 md:hidden">
                {loading ? (
                    <div className="dashboard-surface rounded-[1.5rem] px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                        Loading sales activity...
                    </div>
                ) : sales.length > 0 ? (
                    sales.map((sale) => (
                        <MobileSalesCard key={sale.id} sale={sale} />
                    ))
                ) : (
                    <div className="dashboard-surface rounded-[1.5rem] px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                        No sales found for this period.
                    </div>
                )}

                {totalItems > 0 && (
                    <div className="flex items-center justify-between pt-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page <= 1 || loading}
                            onClick={() => setPage(page - 1)}
                        >
                            <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                        </Button>
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                            Page {page} of {Math.ceil(totalItems / limit) || 1}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page >= Math.ceil(totalItems / limit) || loading}
                            onClick={() => setPage(page + 1)}
                        >
                            Next <ChevronRight className="ml-1 h-4 w-4" />
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
