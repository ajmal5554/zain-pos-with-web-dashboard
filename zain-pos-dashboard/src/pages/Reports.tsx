import * as React from 'react';
import { useEffect, useState } from 'react';
import { FileSpreadsheet, ReceiptText, Activity, TrendingUp, Calendar, Layers } from 'lucide-react';
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
    sales: Array<{
        id: string;
        billNo: string;
        createdAt: string;
        customerName?: string;
        taxableValue: number;
        cgst: number;
        sgst: number;
        totalTax: number;
        grandTotal: number;
        paymentMethod: string;
    }>;
}

const demoReport: GstResponse = {
    summary: {
        count: 3,
        subtotal: 130000,
        discount: 1550,
        taxableValue: 128450,
        cgst: 3211.25,
        sgst: 3211.25,
        totalTax: 6422.5,
        grandTotal: 134872.5
    },
    daily: [
        { date: '2026-03-20', bills: 1, taxableValue: 32000, totalTax: 1600, grandTotal: 33600 },
        { date: '2026-03-21', bills: 1, taxableValue: 41800, totalTax: 2090, grandTotal: 43890 },
        { date: '2026-03-22', bills: 1, taxableValue: 54650, totalTax: 2732.5, grandTotal: 57382.5 }
    ],
    slabs: [
        { rate: 5, taxableValue: 86450, cgst: 2161.25, sgst: 2161.25, totalTax: 4322.5 },
        { rate: 12, taxableValue: 42000, cgst: 1050, sgst: 1050, totalTax: 2100 }
    ],
    sales: [
        { id: '1', billNo: 'A-1020', createdAt: new Date().toISOString(), customerName: 'Walk-in', taxableValue: 32000, cgst: 800, sgst: 800, totalTax: 1600, grandTotal: 33600, paymentMethod: 'CASH' }
    ]
};

export default function Reports() {
    const [report, setReport] = useState<GstResponse | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void loadReport();
    }, []);

    async function loadReport() {
        try {
            setLoading(true);
            if (isDemoModeEnabled()) {
                setReport(demoReport);
                return;
            }
            const response = await api.get<GstResponse>('/reports/gst');
            setReport(response.data);
        } finally {
            setLoading(false);
        }
    }

    if (loading || !report) {
        return (
            <div className="flex items-center justify-center p-24 text-muted-foreground">
                Loading reports...
            </div>
        );
    }

    return (
        <div className="flex-1 space-y-4 pt-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Reports & Taxes</h2>
                    <p className="text-muted-foreground text-sm">
                        View your sales and tax reports.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard title="Taxable Value" value={formatCurrency(report.summary.taxableValue)} icon={<FileSpreadsheet className="h-4 w-4" />}  />
                <StatCard title="Central GST" value={formatCurrency(report.summary.cgst)} icon={<ReceiptText className="h-4 w-4" />} />
                <StatCard title="State GST" value={formatCurrency(report.summary.sgst)} icon={<ReceiptText className="h-4 w-4" />} />
                <Card className="bg-primary text-primary-foreground shadow">
                     <CardContent className="p-6">
                         <div className="flex justify-between items-start">
                             <div className="space-y-2">
                                 <p className="text-sm font-medium opacity-80">Total Sales</p>
                                 <h4 className="text-2xl font-bold">{formatCurrency(report.summary.grandTotal)}</h4>
                             </div>
                             <TrendingUp className="h-5 w-5 opacity-80" />
                         </div>
                         <div className="mt-4 flex items-center gap-2 text-xs opacity-80">
                             <span>Including tax</span>
                         </div>
                     </CardContent>
                </Card>
            </div>

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
                    <CardContent className="pt-4">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Tax Rate</TableHead>
                                    <TableHead className="text-right">Taxable Amount</TableHead>
                                    <TableHead className="text-right">CGST / SGST</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {report.slabs.map((slab) => (
                                    <TableRow key={slab.rate}>
                                        <TableCell>
                                            <Badge variant="secondary" className="font-normal text-xs">
                                                {slab.rate}%
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">{formatCurrency(slab.taxableValue)}</TableCell>
                                        <TableCell className="text-right text-muted-foreground text-xs">
                                            {formatCurrency(slab.cgst)} / {formatCurrency(slab.sgst)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* Daily Accumulation */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <div className="space-y-1">
                            <CardTitle className="text-base font-semibold">Daily Sales</CardTitle>
                            <CardDescription className="text-xs">Sales breakdown by day.</CardDescription>
                        </div>
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent className="pt-4">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead className="text-center">Bills</TableHead>
                                    <TableHead className="text-right">Total Tax</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {report.daily.map((day) => (
                                    <TableRow key={day.date}>
                                        <TableCell>
                                            <span className="text-sm">{day.date}</span>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className="text-xs text-muted-foreground">{day.bills}</span>
                                        </TableCell>
                                        <TableCell className="text-right font-medium">
                                            {formatCurrency(day.totalTax)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* Transaction Matrix */}
                <Card className="col-span-1 md:col-span-2">
                    <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
                        <div className="space-y-1">
                            <CardTitle className="text-base font-semibold">Recent Transactions</CardTitle>
                            <CardDescription className="text-xs">List of recent sales and their tax details.</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="pl-6">Bill No</TableHead>
                                    <TableHead>Customer</TableHead>
                                    <TableHead className="text-right">Taxable</TableHead>
                                    <TableHead className="text-right">CGST / SGST</TableHead>
                                    <TableHead className="pr-6 text-right">Total Amount</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {report.sales.map((sale) => (
                                    <TableRow key={sale.id}>
                                        <TableCell className="pl-6">
                                             <div className="flex items-center gap-2">
                                                 <ReceiptText className="h-4 w-4 text-muted-foreground" />
                                                 <span className="font-medium text-sm">#{sale.billNo}</span>
                                             </div>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-sm">{sale.customerName || 'Walk-in'}</span>
                                        </TableCell>
                                        <TableCell className="text-right text-sm">{formatCurrency(sale.taxableValue)}</TableCell>
                                        <TableCell className="text-right text-xs text-muted-foreground">
                                            {formatCurrency(sale.cgst)} / {formatCurrency(sale.sgst)}
                                        </TableCell>
                                        <TableCell className="pr-6 text-right font-medium">
                                            {formatCurrency(sale.grandTotal)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
