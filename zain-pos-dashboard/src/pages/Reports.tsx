import { useEffect, useState } from 'react';
import { FileSpreadsheet, ReceiptText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/format';
import api from '@/lib/api';
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
        return <div className="dashboard-surface rounded-[1.5rem] px-6 py-16 text-center text-sm text-slate-500 dark:text-slate-400">Loading GST reports...</div>;
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="dashboard-section-title">GST Reports</h1>
                <p className="dashboard-section-copy">Remote GST summary, slab breakdown, and bill-level tax visibility.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
                <Stat label="Taxable Value" value={formatCurrency(report.summary.taxableValue)} />
                <Stat label="CGST" value={formatCurrency(report.summary.cgst)} />
                <Stat label="SGST" value={formatCurrency(report.summary.sgst)} />
                <Stat label="Grand Total" value={formatCurrency(report.summary.grandTotal)} />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-xl">GST Slabs</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50/80 text-slate-400 dark:bg-slate-900/50 dark:text-slate-500">
                                <tr>
                                    <th className="px-4 py-4 text-left font-semibold uppercase tracking-[0.18em]">Rate</th>
                                    <th className="px-4 py-4 text-right font-semibold uppercase tracking-[0.18em]">Taxable</th>
                                    <th className="px-4 py-4 text-right font-semibold uppercase tracking-[0.18em]">CGST</th>
                                    <th className="px-4 py-4 text-right font-semibold uppercase tracking-[0.18em]">SGST</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {report.slabs.map((slab) => (
                                    <tr key={slab.rate}>
                                        <td className="px-4 py-4 font-medium">{slab.rate}%</td>
                                        <td className="px-4 py-4 text-right">{formatCurrency(slab.taxableValue)}</td>
                                        <td className="px-4 py-4 text-right">{formatCurrency(slab.cgst)}</td>
                                        <td className="px-4 py-4 text-right">{formatCurrency(slab.sgst)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-xl">Daily GST Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50/80 text-slate-400 dark:bg-slate-900/50 dark:text-slate-500">
                                <tr>
                                    <th className="px-4 py-4 text-left font-semibold uppercase tracking-[0.18em]">Date</th>
                                    <th className="px-4 py-4 text-right font-semibold uppercase tracking-[0.18em]">Bills</th>
                                    <th className="px-4 py-4 text-right font-semibold uppercase tracking-[0.18em]">Taxable</th>
                                    <th className="px-4 py-4 text-right font-semibold uppercase tracking-[0.18em]">Tax</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {report.daily.map((day) => (
                                    <tr key={day.date}>
                                        <td className="px-4 py-4 font-medium">{day.date}</td>
                                        <td className="px-4 py-4 text-right">{day.bills}</td>
                                        <td className="px-4 py-4 text-right">{formatCurrency(day.taxableValue)}</td>
                                        <td className="px-4 py-4 text-right">{formatCurrency(day.totalTax)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-xl">Bill-Level GST Sales</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50/80 text-slate-400 dark:bg-slate-900/50 dark:text-slate-500">
                                <tr>
                                    <th className="px-4 py-4 text-left font-semibold uppercase tracking-[0.18em]">Bill</th>
                                    <th className="px-4 py-4 text-left font-semibold uppercase tracking-[0.18em]">Customer</th>
                                    <th className="px-4 py-4 text-right font-semibold uppercase tracking-[0.18em]">Taxable</th>
                                    <th className="px-4 py-4 text-right font-semibold uppercase tracking-[0.18em]">Tax</th>
                                    <th className="px-4 py-4 text-right font-semibold uppercase tracking-[0.18em]">Grand</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {report.sales.map((sale) => (
                                    <tr key={sale.id}>
                                        <td className="px-4 py-4 font-mono font-medium">{sale.billNo}</td>
                                        <td className="px-4 py-4">{sale.customerName || 'Walk-in'}</td>
                                        <td className="px-4 py-4 text-right">{formatCurrency(sale.taxableValue)}</td>
                                        <td className="px-4 py-4 text-right">{formatCurrency(sale.totalTax)}</td>
                                        <td className="px-4 py-4 text-right font-medium">{formatCurrency(sale.grandTotal)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <Card>
            <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    {label.includes('Tax') ? <ReceiptText className="h-5 w-5" /> : <FileSpreadsheet className="h-5 w-5" />}
                </div>
                <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
                    <p className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{value}</p>
                </div>
            </CardContent>
        </Card>
    );
}
