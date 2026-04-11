import * as React from 'react';
import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ChevronLeft, ChevronRight, ShoppingCart, TrendingUp, Receipt, User, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useDateFilter } from '@/contexts/DateFilterContext';
import { PaginatedTable } from '@/components/shared/PaginatedTable';
import { MobileSalesCard } from '@/components/shared/MobileSalesCard';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import api from '@/lib/api';
import { demoSales, isDemoModeEnabled } from '@/lib/demo';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

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
            render: (sale: SaleRecord) => (
                <div className="flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">#{sale.billNo}</span>
                </div>
            )
        },
        {
            header: 'Customer',
            render: (sale: SaleRecord) => (
                <div className="flex flex-col">
                    <span className="text-sm font-medium">{sale.customerName || 'Walk-in'}</span>
                    <span className="text-xs text-muted-foreground">{sale.customerPhone || 'Direct'}</span>
                </div>
            )
        },
        {
            header: 'Date',
            render: (sale: SaleRecord) => (
                <div className="text-sm text-muted-foreground text-left">
                    {format(new Date(sale.createdAt), 'dd MMM, hh:mm a')}
                </div>
            )
        },
        {
            header: 'Status',
            render: (sale: SaleRecord) => (
                sale.status === 'COMPLETED' ? (
                    <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600 font-normal text-xs gap-1 py-0 px-2 h-5">
                         <CheckCircle2 className="h-3 w-3" />
                         Completed
                    </Badge>
                ) : (
                    <Badge variant="destructive" className="font-normal text-xs gap-1 py-0 px-2 h-5">
                         <XCircle className="h-3 w-3" />
                         {sale.status}
                    </Badge>
                )
            ),
            className: 'text-center'
        },
        {
             header: 'Total',
             render: (sale: SaleRecord) => (
                 <span className="font-medium text-sm">
                     {formatCurrency(sale.grandTotal)}
                 </span>
             ),
             className: 'text-right'
        },
        {
            header: 'Action',
            render: (sale: SaleRecord) => (
                <div className="flex justify-end pr-4">
                     <Button variant="outline" size="sm" className="h-8">
                         View
                     </Button>
                </div>
            ),
            className: 'text-right'
        }
    ];

    return (
        <div className="flex-1 space-y-4 pt-4 pb-12">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Sales</h2>
                    <p className="text-sm text-muted-foreground">
                        View and manage all sales for {dateRange.label}.
                    </p>
                </div>
            </div>

            {error && (
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        <span>{error}</span>
                    </div>
                    <Button variant="outline" size="sm" className="h-8" onClick={() => void fetchSales()}>
                        Retry
                    </Button>
                </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard
                    title="Revenue"
                    value={formatCurrency(summary.totalSales)}
                    trend={15.2}
                    icon={<TrendingUp className="h-4 w-4" />}
                    loading={loading}
                />
                <StatCard
                    title="Orders"
                    value={summary.totalOrders}
                    trend={-2.4}
                    icon={<ShoppingCart className="h-4 w-4" />}
                    loading={loading}
                />
                <StatCard
                    title="Avg Order"
                    value={formatCurrency(summary.averageOrderValue)}
                    icon={<Activity className="h-4 w-4" />}
                    loading={loading}
                />
            </div>

            <div className="rounded-md border bg-card overflow-hidden">
                <PaginatedTable
                    data={sales}
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
        </div>
    );
}
