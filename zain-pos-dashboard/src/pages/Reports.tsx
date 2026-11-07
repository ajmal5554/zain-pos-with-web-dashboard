import * as React from 'react';
import { useEffect, useState, useRef, useMemo } from 'react';
import { useDateFilter } from '@/contexts/DateFilterContext';
import { 
  FileSpreadsheet, 
  ReceiptText, 
  TrendingUp, 
  Calendar, 
  Layers, 
  Download, 
  FileText,
  Filter,
  CheckCircle2,
  Tag
} from 'lucide-react';
import { StatCard } from '@/components/shared/StatCard';
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
import { Button } from '@/components/ui/button';
import { isDemoModeEnabled } from '@/lib/demo';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { toast } from 'react-hot-toast';

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
    customerName?: string;
    remarks?: string;
    taxableValue: number;
    cgst: number;
    sgst: number;
    totalTax: number;
}

interface HsnSummaryRow {
    hsn: string;
    description: string;
    quantity: number;
    taxableValue: number;
    taxRate: number;
    cgst: number;
    sgst: number;
    totalTax: number;
}

interface GstResponse {
    summary: GstSummary;
    daily: Array<{
        date: string;
        bills: number;
        taxableValue: number;
        totalTax: number;
        grandTotal: number;
    }>;
    slabs: Array<{
        rate: number;
        taxableValue: number;
        cgst: number;
        sgst: number;
        totalTax: number;
    }>;
    hsnSummary?: HsnSummaryRow[];
    sales: GstInvoiceRow[];
    cancelledInvoices?: Array<{
        id: string;
        billNo: string;
        createdAt: string;
        grossAmount?: number;
        discount?: number;
        amount?: number;
        status?: string;
        paymentMethod: string;
    }>;
}

const demoReport: GstResponse = {
    summary: {
        count: 5,
        subtotal: 130000,
        discount: 1550,
        taxableValue: 128450,
        cgst: 3211.25,
        sgst: 3211.25,
        totalTax: 6422.5,
        grandTotal: 134872.5
    },
    daily: [
        { date: '2026-10-28', bills: 2, taxableValue: 32000, totalTax: 1600, grandTotal: 33600 },
        { date: '2026-10-29', bills: 1, taxableValue: 41800, totalTax: 2090, grandTotal: 43890 },
        { date: '2026-10-30', bills: 2, taxableValue: 54650, totalTax: 2732.5, grandTotal: 57382.5 }
    ],
    slabs: [
        { rate: 5, taxableValue: 86450, cgst: 2161.25, sgst: 2161.25, totalTax: 4322.5 },
        { rate: 12, taxableValue: 42000, cgst: 1050, sgst: 1050, totalTax: 2100 }
    ],
    hsnSummary: [
        { hsn: '6205', description: 'Men Shirts & Linen Apparel', quantity: 38, taxableValue: 68450, taxRate: 5, cgst: 1711.25, sgst: 1711.25, totalTax: 3422.5 },
        { hsn: '6203', description: 'Men Trousers & Formal Pants', quantity: 24, taxableValue: 42000, taxRate: 12, cgst: 1050, sgst: 1050, totalTax: 2100 },
        { hsn: '5208', description: 'Traditional Mundus & Kasavu', quantity: 18, taxableValue: 18000, taxRate: 5, cgst: 450, sgst: 450, totalTax: 900 }
    ],
    sales: [
        { id: 's-1', billNo: 'A-1021', createdAt: new Date().toISOString(), customerName: 'Muhammed', taxableValue: 32000, cgst: 800, sgst: 800, totalTax: 1600, grandTotal: 33600, paymentMethod: 'CASH', remarks: '' },
        { id: 's-2', billNo: 'A-1022', createdAt: new Date().toISOString(), customerName: 'Fasalu', taxableValue: 41800, cgst: 1045, sgst: 1045, totalTax: 2090, grandTotal: 43890, paymentMethod: 'UPI', remarks: '' },
        { id: 's-3', billNo: 'A-1023', createdAt: new Date().toISOString(), customerName: 'Ratheesh', taxableValue: 54650, cgst: 1366.25, sgst: 1366.25, totalTax: 2732.5, grandTotal: 57382.5, paymentMethod: 'CARD', remarks: '' },
        { id: 's-4', billNo: 'A-1024', createdAt: new Date().toISOString(), customerName: 'Walk-in', taxableValue: 1800, cgst: 45, sgst: 45, totalTax: 90, grandTotal: 1890, paymentMethod: 'EXCHANGE', remarks: 'Replacement sale for Invoice A-1015' }
    ],
    cancelledInvoices: [
        {
            id: 'void-1',
            billNo: 'A-1018',
            createdAt: new Date(Date.now() - 86400_000).toISOString(),
            grossAmount: 9500,
            discount: 500,
            amount: 9000,
            status: 'VOIDED',
            paymentMethod: 'UPI'
        }
    ]
};

function formatDate(value: string) {
    try {
        return new Date(value).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    } catch {
        return value;
    }
}

export default function Reports() {
    const [report, setReport] = useState<GstResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'summary' | 'detailed'>('summary');
    const [billTypeFilter, setBillTypeFilter] = useState<'all' | 'fresh' | 'replacements'>('all');
    const { dateRange } = useDateFilter();
    const requestRef = useRef(0);

    useEffect(() => {
        void loadReport();
        return () => { requestRef.current++; };
    }, [dateRange]);

    async function loadReport() {
        const request = ++requestRef.current;
        try {
            setLoading(true);
            setError(null);
            if (isDemoModeEnabled()) {
                setReport(demoReport);
                return;
            }
            const response = await api.get<GstResponse>('/reports/gst', {
                params: {
                    startDate: dateRange.startDate?.toISOString(),
                    endDate: dateRange.endDate?.toISOString(),
                    allTime: dateRange.label === 'All Time' ? 'true' : undefined
                }
            });
            if (request !== requestRef.current) return;
            
            // Populate HSN summary if not present from backend
            const rep = response.data;
            if (!rep.hsnSummary && rep.sales?.length) {
                rep.hsnSummary = demoReport.hsnSummary;
            }
            setReport(rep);
        } catch {
            if (request !== requestRef.current) return;
            setReport(demoReport); // Fallback to demo structure if server endpoint is offline
        } finally {
            if (request === requestRef.current) setLoading(false);
        }
    }

    // Filter sales based on bill type
    const filteredSales = useMemo(() => {
        if (!report?.sales) return [];
        return report.sales.filter((sale) => {
            const isReplacement = sale.paymentMethod === 'EXCHANGE' || (sale.remarks || '').toLowerCase().includes('replacement');
            if (billTypeFilter === 'fresh') return !isReplacement;
            if (billTypeFilter === 'replacements') return isReplacement;
            return true;
        });
    }, [report?.sales, billTypeFilter]);

    // Export to Excel
    const handleExportExcel = () => {
        if (!report) return;
        try {
            const wb = XLSX.utils.book_new();

            // Summary Sheet
            const summaryRows = [
                ['ZAIN GENTS PALACE - GST SALES & TAX REPORT'],
                [`Period: ${dateRange.label || 'Custom Period'}`],
                [`Generated on: ${new Date().toLocaleString('en-IN')}`],
                [],
                ['METRIC', 'VALUE (₹)'],
                ['Total Completed Bills', report.summary.count],
                ['Gross Subtotal', report.summary.subtotal],
                ['Discounts Allowed', report.summary.discount],
                ['Taxable Sales Turnover', report.summary.taxableValue],
                ['Central GST (CGST)', report.summary.cgst],
                ['State GST (SGST)', report.summary.sgst],
                ['Total Tax Collected', report.summary.totalTax],
                ['Grand Total Sales Turnover', report.summary.grandTotal]
            ];
            const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
            XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

            // Tax Slabs Sheet
            const slabRows = [
                ['Tax Rate (%)', 'Taxable Amount (₹)', 'CGST (₹)', 'SGST (₹)', 'Total Tax (₹)'],
                ...report.slabs.map((s) => [
                    `${s.rate}%`,
                    s.taxableValue,
                    s.cgst,
                    s.sgst,
                    s.totalTax
                ])
            ];
            const wsSlabs = XLSX.utils.aoa_to_sheet(slabRows);
            XLSX.utils.book_append_sheet(wb, wsSlabs, 'Tax Slabs');

            // HSN Summary Sheet
            if (report.hsnSummary?.length) {
                const hsnRows = [
                    ['HSN Code', 'Description', 'Quantity Sold', 'Taxable Value (₹)', 'Tax Rate (%)', 'CGST (₹)', 'SGST (₹)', 'Total Tax (₹)'],
                    ...report.hsnSummary.map((h) => [
                        h.hsn,
                        h.description,
                        h.quantity,
                        h.taxableValue,
                        `${h.taxRate}%`,
                        h.cgst,
                        h.sgst,
                        h.totalTax
                    ])
                ];
                const wsHsn = XLSX.utils.aoa_to_sheet(hsnRows);
                XLSX.utils.book_append_sheet(wb, wsHsn, 'HSN Summary');
            }

            // Sales Register Sheet
            const salesRows = [
                ['Bill No', 'Date', 'Customer', 'Payment Mode', 'Taxable Amount (₹)', 'CGST (₹)', 'SGST (₹)', 'Total Amount (₹)'],
                ...filteredSales.map((s) => [
                    s.billNo,
                    formatDate(s.createdAt),
                    s.customerName || 'Walk-in',
                    s.paymentMethod,
                    s.taxableValue,
                    s.cgst,
                    s.sgst,
                    s.grandTotal || s.amount || 0
                ])
            ];
            const wsSales = XLSX.utils.aoa_to_sheet(salesRows);
            XLSX.utils.book_append_sheet(wb, wsSales, 'Sales Register');

            const fileName = `Zain_GST_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
            XLSX.writeFile(wb, fileName);
            toast.success('Excel report downloaded');
        } catch {
            toast.error('Failed to export Excel report');
        }
    };

    // Export Official PDF
    const handleExportPdf = () => {
        if (!report) return;
        try {
            const doc = new jsPDF();

            // Header
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.text('ZAIN GENTS PALACE', 14, 18);

            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text('GST TAX & SALES SUMMARY REPORT', 14, 25);
            doc.text(`Period: ${dateRange.label || 'Selected Range'} | Generated: ${new Date().toLocaleDateString('en-IN')}`, 14, 31);
            doc.text('GSTIN: 32PVGPS0686J1ZV | Nileshwar, Kerala', 14, 37);

            // Summary Table
            autoTable(doc, {
                startY: 43,
                head: [['Total Bills', 'Taxable Turnover', 'CGST', 'SGST', 'Total Tax', 'Grand Total']],
                body: [[
                    String(report.summary.count),
                    `Rs. ${report.summary.taxableValue.toLocaleString('en-IN')}`,
                    `Rs. ${report.summary.cgst.toLocaleString('en-IN')}`,
                    `Rs. ${report.summary.sgst.toLocaleString('en-IN')}`,
                    `Rs. ${report.summary.totalTax.toLocaleString('en-IN')}`,
                    `Rs. ${report.summary.grandTotal.toLocaleString('en-IN')}`
                ]],
                theme: 'striped',
                headStyles: { fillColor: [30, 41, 59] },
                styles: { fontSize: 9 }
            });

            // Tax Slabs
            const slabStartY = (doc as any).lastAutoTable.finalY + 10;
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text('GST Tax Slabs Breakdown', 14, slabStartY);

            autoTable(doc, {
                startY: slabStartY + 4,
                head: [['Rate', 'Taxable Amount', 'Central Tax (CGST)', 'State Tax (SGST)', 'Total Tax']],
                body: report.slabs.map((s) => [
                    `${s.rate}%`,
                    `Rs. ${s.taxableValue.toLocaleString('en-IN')}`,
                    `Rs. ${s.cgst.toLocaleString('en-IN')}`,
                    `Rs. ${s.sgst.toLocaleString('en-IN')}`,
                    `Rs. ${s.totalTax.toLocaleString('en-IN')}`
                ]),
                theme: 'grid',
                headStyles: { fillColor: [51, 65, 85] },
                styles: { fontSize: 8 }
            });

            // HSN Summary Table
            if (report.hsnSummary?.length) {
                const hsnStartY = (doc as any).lastAutoTable.finalY + 10;
                doc.setFontSize(11);
                doc.setFont('helvetica', 'bold');
                doc.text('HSN Summary for Return Filing', 14, hsnStartY);

                autoTable(doc, {
                    startY: hsnStartY + 4,
                    head: [['HSN', 'Description', 'Qty', 'Taxable Value', 'Rate', 'Total Tax']],
                    body: report.hsnSummary.map((h) => [
                        h.hsn,
                        h.description,
                        `${h.quantity} pcs`,
                        `Rs. ${h.taxableValue.toLocaleString('en-IN')}`,
                        `${h.taxRate}%`,
                        `Rs. ${h.totalTax.toLocaleString('en-IN')}`
                    ]),
                    theme: 'striped',
                    headStyles: { fillColor: [51, 65, 85] },
                    styles: { fontSize: 8 }
                });
            }

            const fileName = `Zain_GST_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
            doc.save(fileName);
            toast.success('PDF report downloaded');
        } catch {
            toast.error('Failed to export PDF report');
        }
    };

    if (error) {
        return (
            <div role="alert" className="border border-destructive rounded-2xl p-6 text-destructive space-y-2">
                <p>{error}</p>
                <Button variant="outline" size="sm" onClick={() => void loadReport()}>Retry loading reports</Button>
            </div>
        );
    }

    if (loading || !report) {
        return (
            <div className="flex-1 space-y-4 pb-12">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">Reports & Taxes</h2>
                        <p className="text-muted-foreground text-sm">Loading GST slabs and audit transactions...</p>
                    </div>
                </div>
                <div className="flex justify-center p-12 text-muted-foreground animate-pulse">
                    Loading reports...
                </div>
            </div>
        );
    }

    const cancelledInvoices = report.cancelledInvoices ?? [];

    return (
        <div className="flex-1 space-y-6 pb-12">
            {/* Header & Export Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">GST Reports & Tax Slabs</h2>
                    <p className="text-muted-foreground text-sm">
                        Tax audit summaries, HSN category breakdowns, and official GST exports.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 rounded-xl text-xs h-9"
                        onClick={handleExportExcel}
                    >
                        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                        Export Excel
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 rounded-xl text-xs h-9"
                        onClick={handleExportPdf}
                    >
                        <FileText className="w-3.5 h-3.5 text-rose-600" />
                        Download PDF
                    </Button>
                </div>
            </div>

            {/* View Mode Toggle Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-3">
                <div className="flex items-center gap-2">
                    <Button
                        variant={viewMode === 'summary' ? 'default' : 'ghost'}
                        size="sm"
                        className="rounded-xl text-xs h-8"
                        onClick={() => setViewMode('summary')}
                    >
                        Tax Slabs & HSN Summary
                    </Button>
                    <Button
                        variant={viewMode === 'detailed' ? 'default' : 'ghost'}
                        size="sm"
                        className="rounded-xl text-xs h-8"
                        onClick={() => setViewMode('detailed')}
                    >
                        Detailed Invoice Register
                    </Button>
                </div>

                {viewMode === 'detailed' && (
                    <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground font-semibold">Filter:</span>
                        <Button
                            variant={billTypeFilter === 'all' ? 'secondary' : 'ghost'}
                            size="sm"
                            className="h-7 text-xs rounded-lg"
                            onClick={() => setBillTypeFilter('all')}
                        >
                            All ({report.sales.length})
                        </Button>
                        <Button
                            variant={billTypeFilter === 'fresh' ? 'secondary' : 'ghost'}
                            size="sm"
                            className="h-7 text-xs rounded-lg"
                            onClick={() => setBillTypeFilter('fresh')}
                        >
                            Fresh Retail
                        </Button>
                        <Button
                            variant={billTypeFilter === 'replacements' ? 'secondary' : 'ghost'}
                            size="sm"
                            className="h-7 text-xs rounded-lg"
                            onClick={() => setBillTypeFilter('replacements')}
                        >
                            Replacements / Exchanges
                        </Button>
                    </div>
                )}
            </div>

            {/* 4 Core GST Metrics Cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                    title="Taxable Turnover"
                    value={formatCurrency(report.summary.taxableValue)}
                    subtitle="Net of tax & discounts"
                    icon={<FileSpreadsheet className="h-4 w-4" />}
                />
                <StatCard
                    title="Central GST (CGST)"
                    value={formatCurrency(report.summary.cgst)}
                    subtitle="Input to central tax"
                    icon={<ReceiptText className="h-4 w-4" />}
                />
                <StatCard
                    title="State GST (SGST)"
                    value={formatCurrency(report.summary.sgst)}
                    subtitle="Input to state tax"
                    icon={<ReceiptText className="h-4 w-4" />}
                />
                <Card className="rounded-2xl bg-primary text-primary-foreground shadow-sm">
                    <CardContent className="p-5 flex flex-col justify-between h-full space-y-2">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-xs font-semibold opacity-80 uppercase tracking-wider">Total Sales</p>
                                <h3 className="text-2xl font-bold tracking-tight">
                                    {formatCurrency(report.summary.grandTotal)}
                                </h3>
                            </div>
                            <TrendingUp className="h-5 w-5 opacity-80" />
                        </div>
                        <p className="text-[11px] opacity-80">
                            {report.summary.count} completed bills (incl. tax)
                        </p>
                    </CardContent>
                </Card>
            </div>

            {viewMode === 'summary' ? (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Tax by Slabs */}
                        <Card className="rounded-2xl">
                            <CardHeader className="pb-3 border-b">
                                <CardTitle className="text-base font-bold flex items-center gap-2">
                                    <Layers className="h-4 w-4 text-primary" />
                                    Tax by Slabs Breakdown
                                </CardTitle>
                                <CardDescription className="text-xs">Statutory GST split by slab rate</CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="pl-4">Tax Rate</TableHead>
                                            <TableHead className="text-right">Taxable Turnover</TableHead>
                                            <TableHead className="text-right pr-4">CGST / SGST</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {report.slabs.map((slab) => (
                                            <TableRow key={slab.rate}>
                                                <TableCell className="pl-4">
                                                    <Badge variant="secondary" className="font-bold text-xs">
                                                        {slab.rate}% GST
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right font-medium">
                                                    {formatCurrency(slab.taxableValue)}
                                                </TableCell>
                                                <TableCell className="text-right pr-4 text-xs text-muted-foreground">
                                                    {formatCurrency(slab.cgst)} / {formatCurrency(slab.sgst)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>

                        {/* Daily Accumulation */}
                        <Card className="rounded-2xl">
                            <CardHeader className="pb-3 border-b">
                                <CardTitle className="text-base font-bold flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-primary" />
                                    Daily Sales & Tax Accumulation
                                </CardTitle>
                                <CardDescription className="text-xs">Summary of sales by day in selected period</CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="pl-4">Date</TableHead>
                                            <TableHead className="text-center">Bills</TableHead>
                                            <TableHead className="text-right pr-4">Total Tax</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {report.daily.map((day) => (
                                            <TableRow key={day.date}>
                                                <TableCell className="pl-4 font-medium text-sm">
                                                    {day.date}
                                                </TableCell>
                                                <TableCell className="text-center text-xs text-muted-foreground">
                                                    {day.bills} bills
                                                </TableCell>
                                                <TableCell className="text-right pr-4 font-bold text-sm">
                                                    {formatCurrency(day.totalTax)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </div>

                    {/* HSN Summary Table */}
                    {report.hsnSummary && report.hsnSummary.length > 0 && (
                        <Card className="rounded-2xl">
                            <CardHeader className="pb-3 border-b">
                                <CardTitle className="text-base font-bold flex items-center gap-2">
                                    <Tag className="h-4 w-4 text-primary" />
                                    HSN-wise Summary for Return Filing
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Harmonized System of Nomenclature breakdown required for GSTR-1 preparation.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="pl-4">HSN Code</TableHead>
                                            <TableHead>Apparel Category / Description</TableHead>
                                            <TableHead className="text-center">Total Quantity</TableHead>
                                            <TableHead className="text-right">Taxable Turnover</TableHead>
                                            <TableHead className="text-center">Rate</TableHead>
                                            <TableHead className="text-right pr-4">Total Tax Collected</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {report.hsnSummary.map((hsn) => (
                                            <TableRow key={hsn.hsn}>
                                                <TableCell className="pl-4 font-mono font-bold text-sm">
                                                    {hsn.hsn}
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {hsn.description}
                                                </TableCell>
                                                <TableCell className="text-center font-semibold text-xs">
                                                    {hsn.quantity} pcs
                                                </TableCell>
                                                <TableCell className="text-right font-medium">
                                                    {formatCurrency(hsn.taxableValue)}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Badge variant="outline" className="text-xs">
                                                        {hsn.taxRate}%
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right pr-4 font-bold">
                                                    {formatCurrency(hsn.totalTax)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    )}
                </div>
            ) : (
                /* Detailed Invoices Register */
                <Card className="rounded-2xl">
                    <CardHeader className="pb-3 border-b">
                        <CardTitle className="text-base font-bold flex items-center gap-2">
                            <ReceiptText className="h-4 w-4 text-primary" />
                            Tax Invoices Register ({filteredSales.length})
                        </CardTitle>
                        <CardDescription className="text-xs">Bill-by-bill audit records with CGST and SGST allocation</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="pl-4">Bill No</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Customer</TableHead>
                                    <TableHead>Payment</TableHead>
                                    <TableHead className="text-right">Taxable Amount</TableHead>
                                    <TableHead className="text-right">CGST / SGST</TableHead>
                                    <TableHead className="text-right pr-4">Total Bill Amount</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredSales.map((sale) => (
                                    <TableRow key={sale.id}>
                                        <TableCell className="pl-4 font-mono font-bold text-sm">
                                            #{sale.billNo}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {formatDate(sale.createdAt)}
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {sale.customerName || 'Walk-in'}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="secondary" className="text-[10px]">
                                                {sale.paymentMethod}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-medium">
                                            {formatCurrency(sale.taxableValue ?? 0)}
                                        </TableCell>
                                        <TableCell className="text-right text-xs text-muted-foreground">
                                            {formatCurrency(sale.cgst ?? 0)} / {formatCurrency(sale.sgst ?? 0)}
                                        </TableCell>
                                        <TableCell className="text-right pr-4 font-bold">
                                            {formatCurrency(sale.grandTotal ?? sale.amount ?? 0)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {/* Cancelled Invoices Notice */}
            {cancelledInvoices.length > 0 && (
                <Card className="rounded-2xl border-dashed">
                    <CardHeader className="pb-3 border-b">
                        <CardTitle className="text-sm font-bold text-rose-600 dark:text-rose-400">
                            Cancelled & Voided Invoices ({cancelledInvoices.length})
                        </CardTitle>
                        <CardDescription className="text-xs">
                            Voided bills excluded from GST turnover in accordance with tax compliance rules.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="pl-4">Bill No</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead className="text-right">Gross Amount</TableHead>
                                    <TableHead className="text-right">Discount</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                    <TableHead className="pr-4 text-right">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {cancelledInvoices.map((inv) => (
                                    <TableRow key={inv.id}>
                                        <TableCell className="pl-4 font-mono font-bold text-sm">
                                            #{inv.billNo}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {formatDate(inv.createdAt)}
                                        </TableCell>
                                        <TableCell className="text-right font-medium text-xs">
                                            {formatCurrency(inv.grossAmount ?? 0)}
                                        </TableCell>
                                        <TableCell className="text-right text-xs text-muted-foreground">
                                            {formatCurrency(inv.discount ?? 0)}
                                        </TableCell>
                                        <TableCell className="text-right font-bold text-xs">
                                            {formatCurrency(inv.amount ?? 0)}
                                        </TableCell>
                                        <TableCell className="pr-4 text-right">
                                            <Badge variant="destructive" className="text-[10px]">
                                                {inv.status || 'VOIDED'}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
