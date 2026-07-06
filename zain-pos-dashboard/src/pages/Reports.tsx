import * as React from 'react';
import { useEffect, useState } from 'react';
import { FileSpreadsheet, ReceiptText, Calendar, Layers, CheckCircle, XCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import { isDemoModeEnabled } from '@/lib/demo';
import { DateRangePicker } from '@/components/shared/DateRangePicker';
import { useDateFilter } from '@/contexts/DateFilterContext';

interface GstSummary {
    count: number;
    subtotal: number;
    discount: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    totalTax: number;
    grandTotal: number;
}

interface GstInvoiceRow {
    id: string;
    billNo: string;
    createdAt: string;
    paymentMethod: string;
    status?: string;
    grossAmount?: number;
    discount?: number;
    amount?: number;
    grandTotal?: number;
}

interface GstResponse {
    summary: GstSummary;
    daily: Array<{
        date: string;
        bills: number;
        billFrom?: string;
        billTo?: string;
        taxableValue: number;
        cgst: number;
        sgst: number;
        totalTax: number;
        grandTotal: number;
        cash?: number;
        upi?: number;
        card?: number;
    }>;
    slabs: Array<{
        rate: number;
        taxableValue: number;
        cgst: number;
        sgst: number;
        totalTax: number;
    }>;
    sales: Array<
        GstInvoiceRow & {
            customerName?: string;
            taxableValue: number;
            cgst: number;
            sgst: number;
            totalTax: number;
        }
    >;
    cancelledInvoices?: GstInvoiceRow[];
}

const demoReport: GstResponse = {
    summary: {
        count: 7,
        subtotal: 5306,
        discount: 0,
        taxableValue: 5306,
        cgst: 131.58,
        sgst: 131.58,
        totalTax: 263.15,
        grandTotal: 5306
    },
    daily: [
        { date: '2026-07-01', bills: 1, billFrom: '1835', billTo: '1835', taxableValue: 478, cgst: 11.38, sgst: 11.38, totalTax: 22.76, grandTotal: 478, cash: 0, upi: 478, card: 0 },
        { date: '2026-07-02', bills: 2, billFrom: '1836', billTo: '1837', taxableValue: 1200, cgst: 30, sgst: 30, totalTax: 60, grandTotal: 1200, cash: 400, upi: 800, card: 0 },
        { date: '2026-07-03', bills: 4, billFrom: '1838', billTo: '1841', taxableValue: 3628, cgst: 90.2, sgst: 90.2, totalTax: 180.39, grandTotal: 3628, cash: 1200, upi: 1428, card: 1000 }
    ],
    slabs: [
        { rate: 5, taxableValue: 5306, cgst: 131.58, sgst: 131.58, totalTax: 263.15 }
    ],
    sales: [
        { id: '1', billNo: '1835', createdAt: '2026-07-01T10:00:00.000Z', customerName: 'Walk-in', taxableValue: 478, cgst: 11.38, sgst: 11.38, totalTax: 22.76, grandTotal: 478, paymentMethod: 'UPI' }
    ],
    cancelledInvoices: []
};

function isCancelledStatus(status?: string) {
    return Boolean(status && ['VOIDED', 'CANCELLED', 'CANCELED'].includes(status.toUpperCase()));
}

function formatDate(value: string) {
    return new Date(value).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: '2-digit'
    });
}

export default function Reports() {
    const { dateRange } = useDateFilter();
    const [report, setReport] = useState<GstResponse | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void loadReport();
    }, [dateRange.startDate, dateRange.endDate]);

    async function loadReport() {
        try {
            setLoading(true);
            if (isDemoModeEnabled()) {
                setReport(demoReport);
                return;
            }
            
            const params = new URLSearchParams();
            if (dateRange.startDate) params.append('startDate', dateRange.startDate.toISOString());
            if (dateRange.endDate) params.append('endDate', dateRange.endDate.toISOString());

            const response = await api.get<GstResponse>(`/reports/gst?${params.toString()}`);
            setReport(response.data);
        } catch (error) {
            console.error('Failed to load GST report:', error);
        } finally {
            setLoading(false);
        }
    }

    if (loading || !report) {
        return (
            <div className="flex-1 space-y-4 pt-4">
                <div className="flex items-center justify-between gap-4 w-full">
                    <div>
                        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">GST Reports</h2>
                        <p className="text-muted-foreground text-xs hidden sm:block">
                            Generate GST-compliant sales reports.
                        </p>
                    </div>
                    <div className="shrink-0">
                        <DateRangePicker />
                    </div>
                </div>
                <div className="flex items-center justify-center p-24 text-muted-foreground animate-pulse text-sm">
                    Loading GST report details...
                </div>
            </div>
        );
    }

    const cancelledInvoices = report.cancelledInvoices ?? report.sales.filter((sale) => isCancelledStatus(sale.status)).map((sale) => ({
        id: sale.id,
        billNo: sale.billNo,
        createdAt: sale.createdAt,
        grossAmount: sale.grossAmount ?? sale.grandTotal ?? sale.amount ?? 0,
        discount: sale.discount ?? 0,
        amount: sale.amount ?? sale.grandTotal ?? 0,
        status: sale.status ?? 'VOIDED',
        paymentMethod: sale.paymentMethod
    }));

    return (
        <div className="flex-1 space-y-4 pt-4 pb-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 w-full">
                <div>
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight">GST Reports</h2>
                    <p className="text-muted-foreground text-xs hidden sm:block">
                        Generate GST-compliant sales reports.
                    </p>
                </div>
                <div className="shrink-0">
                    <DateRangePicker />
                </div>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {/* Total Bills */}
                <Card className="border-t-4 border-t-blue-500 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-xs font-medium text-muted-foreground">Total Bills</CardDescription>
                        <CardTitle className="text-2xl font-bold">{report.summary.count}</CardTitle>
                    </CardHeader>
                </Card>

                {/* Taxable Value */}
                <Card className="border-t-4 border-t-emerald-500 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-xs font-medium text-muted-foreground">Taxable Value</CardDescription>
                        <CardTitle className="text-2xl font-bold">{formatCurrency(report.summary.taxableValue)}</CardTitle>
                    </CardHeader>
                </Card>

                {/* Total GST */}
                <Card className="border-t-4 border-t-purple-500 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-xs font-medium text-muted-foreground">Total GST</CardDescription>
                        <CardTitle className="text-2xl font-bold">{formatCurrency(report.summary.totalTax)}</CardTitle>
                    </CardHeader>
                </Card>

                {/* Grand Total */}
                <Card className="border-t-4 border-t-orange-500 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-xs font-medium text-muted-foreground">Grand Total</CardDescription>
                        <CardTitle className="text-2xl font-bold">{formatCurrency(report.summary.grandTotal)}</CardTitle>
                    </CardHeader>
                </Card>
            </div>

            {/* Daily Sales Summary */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <div className="space-y-1">
                        <CardTitle className="text-base font-semibold">Daily Sales Summary</CardTitle>
                        <CardDescription className="text-xs">Sales and payment breakdown by day.</CardDescription>
                    </div>
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="pt-4 p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="pl-6">Date</TableHead>
                                    <TableHead className="text-center">Bill From</TableHead>
                                    <TableHead className="text-center">Bill To</TableHead>
                                    <TableHead className="text-center">Bills</TableHead>
                                    <TableHead className="text-right">Taxable</TableHead>
                                    <TableHead className="text-right">CGST</TableHead>
                                    <TableHead className="text-right">SGST</TableHead>
                                    <TableHead className="text-right font-semibold">Grand Total</TableHead>
                                    <TableHead className="text-right text-emerald-600 dark:text-emerald-400">Cash</TableHead>
                                    <TableHead className="text-right text-violet-600 dark:text-violet-400">UPI</TableHead>
                                    <TableHead className="pr-6 text-right text-blue-600 dark:text-blue-400">Card</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {report.daily.length === 0 ? (
                                    <TableRow>
                                        <TableCell className="pl-6 py-8 text-center text-muted-foreground" colSpan={11}>
                                            No sales found for this period.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    report.daily.map((day) => (
                                        <TableRow key={day.date}>
                                            <TableCell className="pl-6 font-medium text-sm">{formatDate(day.date)}</TableCell>
                                            <TableCell className="text-center text-xs text-muted-foreground">#{day.billFrom || '—'}</TableCell>
                                            <TableCell className="text-center text-xs text-muted-foreground">#{day.billTo || '—'}</TableCell>
                                            <TableCell className="text-center font-semibold text-sm">{day.bills}</TableCell>
                                            <TableCell className="text-right text-sm">{formatCurrency(day.taxableValue)}</TableCell>
                                            <TableCell className="text-right text-xs text-muted-foreground">{formatCurrency(day.cgst)}</TableCell>
                                            <TableCell className="text-right text-xs text-muted-foreground">{formatCurrency(day.sgst)}</TableCell>
                                            <TableCell className="text-right font-semibold text-sm">{formatCurrency(day.grandTotal)}</TableCell>
                                            <TableCell className="text-right text-xs text-emerald-600 dark:text-emerald-400">{formatCurrency(day.cash ?? 0)}</TableCell>
                                            <TableCell className="text-right text-xs text-violet-600 dark:text-violet-400">{formatCurrency(day.upi ?? 0)}</TableCell>
                                            <TableCell className="pr-6 text-right text-xs text-blue-600 dark:text-blue-400">{formatCurrency(day.card ?? 0)}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Slab Partitioning */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <div className="space-y-1">
                            <CardTitle className="text-base font-semibold">Tax by Slabs</CardTitle>
                            <CardDescription className="text-xs">GST breakdown by percentage.</CardDescription>
                        </div>
                        <Layers className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent className="pt-4 p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="pl-6">Tax Rate</TableHead>
                                    <TableHead className="text-right">Taxable Amount</TableHead>
                                    <TableHead className="pr-6 text-right">CGST / SGST</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {report.slabs.length === 0 ? (
                                    <TableRow>
                                        <TableCell className="pl-6 py-8 text-center text-muted-foreground" colSpan={3}>
                                            No tax slab data.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    report.slabs.map((slab) => (
                                        <TableRow key={slab.rate}>
                                            <TableCell className="pl-6">
                                                <Badge variant="secondary" className="font-normal text-xs">
                                                    {slab.rate}%
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right text-sm">{formatCurrency(slab.taxableValue)}</TableCell>
                                            <TableCell className="pr-6 text-right text-muted-foreground text-xs">
                                                {formatCurrency(slab.cgst)} / {formatCurrency(slab.sgst)}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* Cancelled Invoices */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div className="space-y-1">
                            <CardTitle className="text-base font-semibold">Cancelled Invoices</CardTitle>
                            <CardDescription className="text-xs">Voided bills listed for reference only.</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-4 p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="pl-6">Bill No</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                    <TableHead className="pr-6">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {cancelledInvoices.length === 0 ? (
                                    <TableRow>
                                        <TableCell className="pl-6 py-8 text-center text-muted-foreground" colSpan={4}>
                                            No cancelled invoices found.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    cancelledInvoices.slice(0, 5).map((invoice) => (
                                        <TableRow key={invoice.id}>
                                            <TableCell className="pl-6 font-medium text-sm">#{invoice.billNo}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{formatDate(invoice.createdAt)}</TableCell>
                                            <TableCell className="text-right text-sm">{formatCurrency(invoice.amount ?? 0)}</TableCell>
                                            <TableCell className="pr-6">
                                                <Badge variant="destructive" className="font-normal text-[10px] px-1.5 py-0">
                                                    {invoice.status ?? 'VOIDED'}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            {/* Transaction Matrix */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div className="space-y-1">
                        <CardTitle className="text-base font-semibold">Transactions</CardTitle>
                        <CardDescription className="text-xs">Recent sales list with tax details.</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="pl-6">Bill No</TableHead>
                                    <TableHead>Customer</TableHead>
                                    <TableHead className="text-right">Taxable</TableHead>
                                    <TableHead className="text-right">CGST</TableHead>
                                    <TableHead className="text-right">SGST</TableHead>
                                    <TableHead className="text-right">Tax</TableHead>
                                    <TableHead className="pr-6 text-right font-semibold">Total Amount</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {report.sales.length === 0 ? (
                                    <TableRow>
                                        <TableCell className="pl-6 py-8 text-center text-muted-foreground" colSpan={7}>
                                            No transactions found.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    report.sales.map((sale) => (
                                        <TableRow key={sale.id}>
                                            <TableCell className="pl-6 font-medium text-sm">#{sale.billNo}</TableCell>
                                            <TableCell className="text-sm">{sale.customerName || 'Walk-in'}</TableCell>
                                            <TableCell className="text-right text-sm">{formatCurrency(sale.taxableValue)}</TableCell>
                                            <TableCell className="text-right text-xs text-muted-foreground">{formatCurrency(sale.cgst)}</TableCell>
                                            <TableCell className="text-right text-xs text-muted-foreground">{formatCurrency(sale.sgst)}</TableCell>
                                            <TableCell className="text-right text-xs text-muted-foreground">{formatCurrency(sale.totalTax)}</TableCell>
                                            <TableCell className="pr-6 text-right font-semibold text-sm">{formatCurrency(sale.grandTotal ?? 0)}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <p className="text-[11px] text-muted-foreground pl-1">
                Note: Cancelled invoices are excluded from GST calculations.
            </p>
        </div>
    );
}
