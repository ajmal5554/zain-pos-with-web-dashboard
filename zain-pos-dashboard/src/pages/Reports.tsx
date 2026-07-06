import * as React from 'react';
import { useEffect, useState } from 'react';
import { FileSpreadsheet, FileText, Calendar, Layers } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

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
    subtotal?: number;
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
        subtotal?: number;
        discount?: number;
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
            subtotal: number;
            discount: number;
            taxableValue: number;
            cgst: number;
            sgst: number;
            totalTax: number;
        }
    >;
    cancelledInvoices?: GstInvoiceRow[];
}

const shopSettings = {
    shopName: 'ZAIN GENTS PALACE',
    address: 'CHIRAMMAL TOWER, BEHIND CANARA BANK\nRAJA ROAD, NILESHWAR',
    phone: '9037106449, 7907026827',
    gstin: '32PVGPS0686J1ZV',
    email: '',
};

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
        { id: '1', billNo: '1835', createdAt: '2026-07-01T10:00:00.000Z', customerName: 'Walk-in', subtotal: 478, discount: 0, taxableValue: 478, cgst: 11.38, sgst: 11.38, totalTax: 22.76, grandTotal: 478, paymentMethod: 'UPI' }
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
    const [reportType, setReportType] = useState<'detailed' | 'summary'>('summary');
    const [sortBy, setSortBy] = useState<'date' | 'billNo'>('date');

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

    const totals = React.useMemo(() => {
        if (!report) return null;
        const cash = report.daily.reduce((sum, d) => sum + (d.cash ?? 0), 0);
        const upi = report.daily.reduce((sum, d) => sum + (d.upi ?? 0), 0);
        const card = report.daily.reduce((sum, d) => sum + (d.card ?? 0), 0);
        return {
            ...report.summary,
            payment: { cash, upi, card }
        };
    }, [report]);

    const exportToPDF = () => {
        if (!report || !totals) return alert('No report data to export');

        const doc = new jsPDF('landscape');
        const pageWidth = doc.internal.pageSize.getWidth();
        const dateRangeText = `From ${dateRange.startDate ? format(dateRange.startDate, 'dd/MM/yyyy') : 'All Time'} To ${dateRange.endDate ? format(dateRange.endDate, 'dd/MM/yyyy') : 'All Time'}`;

        // Professional header with shop details
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        const shopNameWidth = doc.getTextWidth(shopSettings.shopName);
        doc.text(shopSettings.shopName, (pageWidth - shopNameWidth) / 2, 15);
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const addressLines = shopSettings.address.split('\n');
        let currentY = 22;
        addressLines.forEach(line => {
            const lineWidth = doc.getTextWidth(line);
            doc.text(line, (pageWidth - lineWidth) / 2, currentY);
            currentY += 4;
        });
        
        const contactInfo = `Ph: ${shopSettings.phone}  |  GSTIN: ${shopSettings.gstin}`;
        const contactWidth = doc.getTextWidth(contactInfo);
        doc.text(contactInfo, (pageWidth - contactWidth) / 2, currentY);
        currentY += 2;
        
        doc.setLineWidth(0.5);
        doc.line(14, currentY, pageWidth - 14, currentY);
        currentY += 5;
        
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        const dateWidth = doc.getTextWidth(dateRangeText);
        doc.text(dateRangeText, (pageWidth - dateWidth) / 2, currentY);
        currentY += 5;

        if (reportType === 'summary') {
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text('DAILY SALES SUMMARY', 14, currentY);
            currentY += 5;

            const summaryColumns = ['DATE', 'BILL FROM', 'BILL TO', 'BILLS', 'GROSS AMOUNT\n(incl. GST)', 'DISCOUNT', 'NET AMOUNT\n(incl. GST)', 'TAXABLE AMOUNT\n(excl. GST)', 'CGST', 'SGST', 'TOTAL GST', 'AMOUNT PAID', 'CASH', 'UPI', 'CARD'];

            const sortedSummaries = [...report.daily].sort((a, b) => {
                if (sortBy === 'billNo') {
                    return (a.billFrom || '').localeCompare(b.billFrom || '');
                }
                return a.date.localeCompare(b.date);
            });

            const a = totals;
            const grandTotalRow = [
                'GRAND TOTAL',                           
                '',                                      
                '',                                      
                a.count.toString(),                      
                a.subtotal.toFixed(2),                   
                a.discount.toFixed(2),                   
                a.taxableValue.toFixed(2),              
                (a.taxableValue - a.totalTax).toFixed(2),
                a.cgst.toFixed(2),                      
                a.sgst.toFixed(2),                      
                a.totalTax.toFixed(2),                  
                a.grandTotal.toFixed(2),                
                a.payment.cash.toFixed(2),              
                a.payment.upi.toFixed(2),               
                a.payment.card.toFixed(2),              
            ];

            autoTable(doc, {
                startY: currentY,
                head: [summaryColumns],
                body: [...sortedSummaries.map((d) => [
                    formatDate(d.date),
                    (d.billFrom || '').toString(),
                    (d.billTo || '').toString(),
                    d.bills.toString(),
                    (d.subtotal ?? 0).toFixed(2),
                    (d.discount ?? 0).toFixed(2),
                    (d.taxableValue ?? 0).toFixed(2),
                    ((d.taxableValue ?? 0) - (d.totalTax ?? 0)).toFixed(2),
                    d.cgst.toFixed(2),
                    d.sgst.toFixed(2),
                    d.totalTax.toFixed(2),
                    d.grandTotal.toFixed(2),
                    (d.cash ?? 0).toFixed(2),
                    (d.upi ?? 0).toFixed(2),
                    (d.card ?? 0).toFixed(2),
                ]), grandTotalRow],
                theme: 'grid',
                styles: { fontSize: 7, cellPadding: 1 },
                headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
                bodyStyles: { fillColor: [255, 255, 255] },
                didParseCell: function (data: any) {
                    if (data.row.index === sortedSummaries.length) {
                        data.cell.styles.fontStyle = 'bold';
                        data.cell.styles.fillColor = [200, 255, 200];
                    }
                }
            });
        } else {
            const saleColumns = ['DATE', 'BILL NO', 'GROSS AMOUNT\n(incl. GST)', 'DISCOUNT', 'NET AMOUNT\n(incl. GST)', 'TAXABLE AMOUNT\n(excl. GST)', 'CGST', 'SGST', 'TOTAL GST', 'AMOUNT PAID', 'PAYMENT'];

            const sortedSales = [...report.sales].sort((a, b) => {
                if (sortBy === 'billNo') {
                    return a.billNo.localeCompare(b.billNo);
                }
                return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            });

            const a = totals;
            const grandTotalRow = [
                'GRAND TOTAL',                          
                `${a.count} bills`,                     
                a.subtotal.toFixed(2),                  
                a.discount.toFixed(2),                   
                a.taxableValue.toFixed(2),              
                (a.taxableValue - a.totalTax).toFixed(2),
                a.cgst.toFixed(2),                      
                a.sgst.toFixed(2),                      
                a.totalTax.toFixed(2),                  
                a.grandTotal.toFixed(2),                
                'All modes',                                     
            ];

            autoTable(doc, {
                startY: currentY,
                head: [saleColumns],
                body: [...sortedSales.map((sale) => {
                    const netAmount = sale.subtotal - sale.discount;
                    const taxableAmount = parseFloat((netAmount / 1.05).toFixed(2));
                    const totalGst = parseFloat((netAmount - taxableAmount).toFixed(2));
                    const cgst = parseFloat((totalGst / 2).toFixed(2));
                    const sgst = parseFloat((totalGst / 2).toFixed(2));

                    return [
                        formatDate(sale.createdAt),
                        sale.billNo,
                        sale.subtotal.toFixed(2),
                        sale.discount.toFixed(2),
                        netAmount.toFixed(2),
                        taxableAmount.toFixed(2),
                        cgst.toFixed(2),
                        sgst.toFixed(2),
                        totalGst.toFixed(2),
                        (sale.grandTotal ?? 0).toFixed(2),
                        sale.paymentMethod,
                    ];
                }), grandTotalRow],
                theme: 'grid',
                styles: { fontSize: 8, cellPadding: 1 },
                headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold' },
                bodyStyles: { fillColor: [255, 255, 255] },
                didParseCell: function (data: any) {
                    if (data.row.index === sortedSales.length) {
                        data.cell.styles.fontStyle = 'bold';
                        data.cell.styles.fillColor = [220, 220, 220];
                    }
                }
            });
        }

        doc.save(`GST-${reportType === 'summary' ? 'Summary' : 'Detailed'}-${dateRange.startDate ? format(dateRange.startDate, 'dd-MM-yyyy') : 'AllTime'}-to-${dateRange.endDate ? format(dateRange.endDate, 'dd-MM-yyyy') : 'AllTime'}.pdf`);
    };

    const exportToExcel = () => {
        if (!report || !totals) return alert('No report data to export');

        const wb = XLSX.utils.book_new();
        const dateRangeText = `From ${dateRange.startDate ? format(dateRange.startDate, 'dd/MM/yyyy') : 'All Time'} To ${dateRange.endDate ? format(dateRange.endDate, 'dd/MM/yyyy') : 'All Time'}`;
        const a = totals;

        const sortedSales = [...report.sales].sort((x, y) => {
            if (sortBy === 'billNo') {
                return x.billNo.localeCompare(y.billNo);
            }
            return new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime();
        });

        if (reportType === 'summary') {
            const summaryHeader = ['DATE', 'BILL FROM', 'BILL TO', 'BILLS', 'GROSS AMOUNT (incl. GST)', 'DISCOUNT', 'NET AMOUNT (incl. GST)', 'TAXABLE AMOUNT (excl. GST)', 'CGST', 'SGST', 'TOTAL GST', 'AMOUNT PAID', 'CASH', 'UPI', 'CARD'];

            const sortedSummaries = [...report.daily].sort((x, y) => {
                if (sortBy === 'billNo') {
                    return (x.billFrom || '').localeCompare(y.billFrom || '');
                }
                return x.date.localeCompare(y.date);
            });

            const data = [
                [shopSettings.shopName],
                [shopSettings.address.replace('\n', ', ')],
                [`Ph: ${shopSettings.phone}  |  GSTIN: ${shopSettings.gstin}`],
                [],
                [dateRangeText],
                [],
                ['DAILY SALES SUMMARY'],
                summaryHeader,
                ...sortedSummaries.map((d) => [
                    formatDate(d.date),
                    d.billFrom || '', d.billTo || '', d.bills,
                    d.subtotal, d.discount, d.taxableValue,
                    (d.taxableValue - d.totalTax),
                    d.cgst, d.sgst, d.totalTax, d.grandTotal,
                    d.cash ?? 0, d.upi ?? 0, d.card ?? 0,
                ]),
                ['GRAND TOTAL', '', '', a.count, a.subtotal, a.discount, a.taxableValue, (a.taxableValue - a.totalTax), a.cgst, a.sgst, a.totalTax, a.grandTotal, a.payment.cash, a.payment.upi, a.payment.card],
            ];

            const ws = XLSX.utils.aoa_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Daily Summary');
        } else {
            const header = ['DATE & TIME', 'BILL NO', 'CUSTOMER', 'GROSS AMOUNT (incl. GST)', 'DISCOUNT', 'NET AMOUNT (incl. GST)', 'TAXABLE AMOUNT (excl. GST)', 'CGST', 'SGST', 'TOTAL GST', 'AMOUNT PAID', 'PAYMENT'];

            const data = [
                [shopSettings.shopName],
                [shopSettings.address.replace('\n', ', ')],
                [`Ph: ${shopSettings.phone}  |  GSTIN: ${shopSettings.gstin}`],
                [],
                [dateRangeText],
                [],
                ['DETAILED INVOICE REPORT'],
                header,
                ...sortedSales.map((sale) => {
                    const netAmount = sale.subtotal - sale.discount;
                    const taxableAmount = parseFloat((netAmount / 1.05).toFixed(2));
                    const totalGst = parseFloat((netAmount - taxableAmount).toFixed(2));
                    const cgst = parseFloat((totalGst / 2).toFixed(2));
                    const sgst = parseFloat((totalGst / 2).toFixed(2));

                    return [
                        formatDate(sale.createdAt),
                        sale.billNo,
                        sale.customerName || 'Walk-in Customer',
                        sale.subtotal,
                        sale.discount,
                        netAmount,
                        taxableAmount,
                        cgst,
                        sgst,
                        totalGst,
                        sale.grandTotal,
                        sale.paymentMethod,
                    ];
                }),
                ['GRAND TOTAL', '', '', a.subtotal, a.discount, a.taxableValue, (a.taxableValue - a.totalTax), a.cgst, a.sgst, a.totalTax, a.grandTotal, ''],
                [],
                ['PAYMENT BREAKDOWN'],
                ['Cash', a.payment.cash],
                ['UPI', a.payment.upi],
                ['Card', a.payment.card],
            ];

            const ws = XLSX.utils.aoa_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Detailed Report');
        }

        XLSX.writeFile(wb, `GST-${reportType === 'summary' ? 'Summary' : 'Detailed'}-${dateRange.startDate ? format(dateRange.startDate, 'dd-MM-yyyy') : 'AllTime'}-to-${dateRange.endDate ? format(dateRange.endDate, 'dd-MM-yyyy') : 'AllTime'}.xlsx`);
    };

    if (loading || !report) {
        return (
            <div className="flex-1 space-y-4 pt-4 w-full max-w-full min-w-0">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
                    <div>
                        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">GST Reports</h2>
                        <p className="text-muted-foreground text-xs">
                            Generate GST-compliant sales reports.
                        </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
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
        <div className="flex-1 space-y-4 w-full max-w-full pb-6 min-w-0">
            {/* Header & Controls */}
            <div className="flex flex-col gap-4 w-full">
                <div className="flex items-center justify-between gap-4 w-full">
                    <div>
                        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">GST Reports</h2>
                        <p className="text-muted-foreground text-xs hidden sm:block">
                            Generate GST-compliant sales reports.
                        </p>
                    </div>
                    <div className="shrink-0 relative z-20">
                        <DateRangePicker />
                    </div>
                </div>

                {/* Controls Container */}
                <div className="flex flex-col gap-3 w-full sm:flex-row sm:items-center sm:justify-between sm:flex-wrap">
                    {/* Toggles */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center w-full sm:w-auto">
                        <div className="grid grid-cols-2 gap-2 sm:flex sm:rounded-lg border border-slate-200 p-0.5 bg-slate-100 dark:border-slate-800 dark:bg-slate-950/40 w-full sm:w-auto">
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className={cn("h-9 sm:h-7 text-xs rounded-md", reportType === 'summary' ? "bg-white dark:bg-slate-900 shadow-sm font-semibold" : "text-muted-foreground")}
                                onClick={() => setReportType('summary')}
                            >
                                Summary
                            </Button>
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className={cn("h-9 sm:h-7 text-xs rounded-md", reportType === 'detailed' ? "bg-white dark:bg-slate-900 shadow-sm font-semibold" : "text-muted-foreground")}
                                onClick={() => setReportType('detailed')}
                            >
                                Detailed
                            </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:flex sm:rounded-lg border border-slate-200 p-0.5 bg-slate-100 dark:border-slate-800 dark:bg-slate-950/40 w-full sm:w-auto">
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className={cn("h-9 sm:h-7 text-xs rounded-md", sortBy === 'date' ? "bg-white dark:bg-slate-900 shadow-sm font-semibold" : "text-muted-foreground")}
                                onClick={() => setSortBy('date')}
                            >
                                By Date
                            </Button>
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className={cn("h-9 sm:h-7 text-xs rounded-md", sortBy === 'billNo' ? "bg-white dark:bg-slate-900 shadow-sm font-semibold" : "text-muted-foreground")}
                                onClick={() => setSortBy('billNo')}
                            >
                                By Bill No
                            </Button>
                        </div>
                    </div>

                    {/* Export Buttons */}
                    <div className="grid grid-cols-2 gap-2 w-full sm:flex sm:w-auto">
                        <Button 
                            onClick={exportToPDF}
                            className="h-9 px-3 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-xl shadow-sm w-full sm:w-auto"
                        >
                            <FileText className="mr-1.5 h-3.5 w-3.5" />
                            PDF
                        </Button>
                        <Button 
                            onClick={exportToExcel}
                            className="h-9 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl shadow-sm w-full sm:w-auto"
                        >
                            <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                            Excel
                        </Button>
                    </div>
                </div>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full max-w-full">
                {/* Total Bills */}
                <Card className="shadow-sm overflow-hidden w-full max-w-full">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-xs font-medium text-muted-foreground">Total Bills</CardDescription>
                        <CardTitle className="text-2xl font-bold">{report.summary.count}</CardTitle>
                    </CardHeader>
                </Card>

                {/* Taxable Value */}
                <Card className="shadow-sm overflow-hidden w-full max-w-full">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-xs font-medium text-muted-foreground">Taxable Value</CardDescription>
                        <CardTitle className="text-2xl font-bold">{formatCurrency(report.summary.taxableValue)}</CardTitle>
                    </CardHeader>
                </Card>

                {/* Total GST */}
                <Card className="shadow-sm overflow-hidden w-full max-w-full">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-xs font-medium text-muted-foreground">Total GST</CardDescription>
                        <CardTitle className="text-2xl font-bold">{formatCurrency(report.summary.totalTax)}</CardTitle>
                    </CardHeader>
                </Card>

                {/* Grand Total */}
                <Card className="shadow-sm overflow-hidden w-full max-w-full">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-xs font-medium text-muted-foreground">Grand Total</CardDescription>
                        <CardTitle className="text-2xl font-bold">{formatCurrency(report.summary.grandTotal)}</CardTitle>
                    </CardHeader>
                </Card>
            </div>

            {/* Daily Sales Summary */}
            <Card className="overflow-hidden w-full max-w-full">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <div className="space-y-1">
                        <CardTitle className="text-base font-semibold">Daily Sales Summary</CardTitle>
                        <CardDescription className="text-xs">Sales and payment breakdown by day.</CardDescription>
                    </div>
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="pt-4 p-0 w-full max-w-full">
                    <div className="overflow-x-auto w-full max-w-full">
                        <Table className="min-w-[900px] w-full">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-full">
                {/* Slab Partitioning */}
                <Card className="overflow-hidden w-full max-w-full">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <div className="space-y-1">
                            <CardTitle className="text-base font-semibold">Tax by Slabs</CardTitle>
                            <CardDescription className="text-xs">GST breakdown by percentage.</CardDescription>
                        </div>
                        <Layers className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent className="pt-4 p-0 w-full">
                        <div className="overflow-x-auto w-full">
                            <Table className="w-full">
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
                        </div>
                    </CardContent>
                </Card>

                {/* Cancelled Invoices */}
                <Card className="overflow-hidden w-full max-w-full">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div className="space-y-1">
                            <CardTitle className="text-base font-semibold">Cancelled Invoices</CardTitle>
                            <CardDescription className="text-xs">Voided bills listed for reference only.</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-4 p-0 w-full">
                        <div className="overflow-x-auto w-full">
                            <Table className="w-full">
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
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Transaction Matrix */}
            <Card className="overflow-hidden w-full max-w-full">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div className="space-y-1">
                        <CardTitle className="text-base font-semibold">Transactions</CardTitle>
                        <CardDescription className="text-xs">Recent sales list with tax details.</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="p-0 w-full">
                    <div className="overflow-x-auto w-full">
                        <Table className="min-w-[700px] w-full">
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="pl-6">Bill No</TableHead>
                                    <TableHead>Customer</TableHead>
                                    <TableHead className="text-right">Taxable</TableHead>
                                    <TableHead className="text-right">CGST</TableHead>
                                    <TableHead className="text-right">SGST</TableHead>
                                    <TableHead className="text-right">Tax</TableHead>
                                    <TableHead className="pr-6 text-right font-semibold text-sm">Total Amount</TableHead>
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
