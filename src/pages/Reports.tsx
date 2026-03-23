import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { FileText, FileSpreadsheet, List, LayoutGrid, ArrowUpDown, Calendar, Hash } from 'lucide-react';
import { formatIndianCurrency } from '../lib/format';
import {
    format,
    startOfMonth,
    endOfMonth,
    subMonths,
    startOfQuarter,
    endOfQuarter,
} from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { db } from '../lib/db';
import { useAuthStore } from '../store/authStore';
import { ShieldAlert } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface SaleItemRow {
    productName: string;
    variantInfo?: string;
    quantity: number;
    mrp: number;
    sellingPrice: number;
    discount: number;
    taxRate: number;
    taxAmount: number;
    total: number;
    variant?: {
        barcode?: string;
        sku?: string;
        size?: string;
        color?: string;
        product?: {
            hsn?: string;
        };
    };
}

interface PaymentRow {
    paymentMode: string;
    amount: number;
}

interface SaleRow {
    id: string;
    billNo: string;
    customerName?: string;
    subtotal: number;
    discount: number;
    taxAmount: number;
    cgst: number;
    sgst: number;
    grandTotal: number;
    paymentMethod: string;
    isHistorical: boolean;
    status: string;
    createdAt: string;
    actualSaleDate?: string;
    items: SaleItemRow[];
    payments?: PaymentRow[];
}

interface TaxSlabSummary {
    rate: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    totalTax: number;
}

interface HsnSummary {
    hsn: string;
    description: string;
    quantity: number;
    taxableValue: number;
    taxRate: number;
    cgst: number;
    sgst: number;
    totalTax: number;
}

interface PaymentSummary {
    cash: number;
    upi: number;
    card: number;
}

interface ReportTotals {
    count: number;
    subtotal: number;
    discount: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    totalTax: number;
    grandTotal: number;
    payment: PaymentSummary;
    taxSlabs: TaxSlabSummary[];
    hsnSummary: HsnSummary[];
}

interface DailySummary {
    date: string;
    billFrom: string;
    billTo: string;
    billCount: number;
    subtotal: number;
    discount: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    totalTax: number;
    grandTotal: number;
    cash: number;
    upi: number;
    card: number;
}

interface ReportData {
    startDate: Date;
    endDate: Date;
    taxInvoices: SaleRow[];
    allSales: SaleRow[];
    taxInvoiceTotals: ReportTotals;
    allSalesTotals: ReportTotals;
    dailySummaries: DailySummary[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPaymentBreakdown(sale: SaleRow): PaymentSummary {
    const result: PaymentSummary = { cash: 0, upi: 0, card: 0 };

    if (sale.payments && sale.payments.length > 0) {
        for (const p of sale.payments) {
            const mode = p.paymentMode.toUpperCase();
            if (mode === 'CASH') result.cash += p.amount;
            else if (mode === 'UPI') result.upi += p.amount;
            else if (mode === 'CARD') result.card += p.amount;
        }
    } else {
        const mode = sale.paymentMethod.toUpperCase();
        if (mode === 'CASH') result.cash = sale.grandTotal;
        else if (mode === 'UPI') result.upi = sale.grandTotal;
        else if (mode === 'CARD') result.card = sale.grandTotal;
    }

    return result;
}

function buildTaxSlabs(items: SaleItemRow[]): TaxSlabSummary[] {
    const slabMap = new Map<number, TaxSlabSummary>();

    for (const item of items) {
        const rate = item.taxRate;
        const taxableValue = item.sellingPrice * item.quantity - item.discount;
        const halfRate = rate / 2;
        const cgst = (taxableValue * halfRate) / 100;
        const sgst = (taxableValue * halfRate) / 100;

        const existing = slabMap.get(rate);
        if (existing) {
            existing.taxableValue += taxableValue;
            existing.cgst += cgst;
            existing.sgst += sgst;
            existing.totalTax += cgst + sgst;
        } else {
            slabMap.set(rate, { rate, taxableValue, cgst, sgst, totalTax: cgst + sgst });
        }
    }

    return Array.from(slabMap.values()).sort((a, b) => a.rate - b.rate);
}

function buildHsnSummary(items: SaleItemRow[]): HsnSummary[] {
    const hsnMap = new Map<string, HsnSummary>();

    for (const item of items) {
        const hsn = item.variant?.product?.hsn || 'N/A';
        const taxableValue = item.sellingPrice * item.quantity - item.discount;
        const halfRate = item.taxRate / 2;
        const cgst = (taxableValue * halfRate) / 100;
        const sgst = (taxableValue * halfRate) / 100;

        const existing = hsnMap.get(hsn);
        if (existing) {
            existing.quantity += item.quantity;
            existing.taxableValue += taxableValue;
            existing.cgst += cgst;
            existing.sgst += sgst;
            existing.totalTax += cgst + sgst;
        } else {
            hsnMap.set(hsn, {
                hsn,
                description: item.productName,
                quantity: item.quantity,
                taxableValue,
                taxRate: item.taxRate,
                cgst,
                sgst,
                totalTax: cgst + sgst,
            });
        }
    }

    return Array.from(hsnMap.values()).sort((a, b) => a.hsn.localeCompare(b.hsn));
}

function calculateTotals(salesList: SaleRow[]): ReportTotals {
    const allItems: SaleItemRow[] = [];
    const payment: PaymentSummary = { cash: 0, upi: 0, card: 0 };

    let subtotal = 0, discount = 0, cgst = 0, sgst = 0, totalTax = 0, grandTotal = 0;

    for (const sale of salesList) {
        subtotal += sale.subtotal;
        discount += sale.discount;
        cgst += sale.cgst || 0;
        sgst += sale.sgst || 0;
        totalTax += sale.taxAmount;
        grandTotal += sale.grandTotal;
        allItems.push(...sale.items);

        const p = getPaymentBreakdown(sale);
        payment.cash += p.cash;
        payment.upi += p.upi;
        payment.card += p.card;
    }

    return {
        count: salesList.length,
        subtotal,
        discount,
        taxableValue: subtotal - discount,
        cgst,
        sgst,
        totalTax,
        grandTotal,
        payment,
        taxSlabs: buildTaxSlabs(allItems),
        hsnSummary: buildHsnSummary(allItems),
    };
}

/** Group sales by date to create daily summaries */
function buildDailySummaries(salesList: SaleRow[]): DailySummary[] {
    const dayMap = new Map<string, SaleRow[]>();

    for (const sale of salesList) {
        const dateKey = format(new Date(sale.createdAt), 'yyyy-MM-dd');
        if (!dayMap.has(dateKey)) dayMap.set(dateKey, []);
        dayMap.get(dateKey)!.push(sale);
    }

    const summaries: DailySummary[] = [];

    for (const [dateKey, sales] of dayMap.entries()) {
        const sortedBills = sales.map((s) => String(s.billNo)).sort(compareBillNos);
        let subtotal = 0, discount = 0, cgst = 0, sgst = 0, totalTax = 0, grandTotal = 0;
        let cash = 0, upi = 0, card = 0;

        for (const sale of sales) {
            subtotal += sale.subtotal;
            discount += sale.discount;
            cgst += sale.cgst || 0;
            sgst += sale.sgst || 0;
            totalTax += sale.taxAmount;
            grandTotal += sale.grandTotal;

            const p = getPaymentBreakdown(sale);
            cash += p.cash;
            upi += p.upi;
            card += p.card;
        }

        summaries.push({
            date: dateKey,
            billFrom: sortedBills[0],
            billTo: sortedBills[sortedBills.length - 1],
            billCount: sales.length,
            subtotal,
            discount,
            taxableValue: subtotal - discount,
            cgst,
            sgst,
            totalTax,
            grandTotal,
            cash,
            upi,
            card,
        });
    }

    return summaries.sort((a, b) => a.date.localeCompare(b.date));
}

function getFinancialYearStart(date: Date): Date {
    const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
    return new Date(year, 3, 1);
}

function getFinancialYearEnd(date: Date): Date {
    const year = date.getMonth() >= 3 ? date.getFullYear() + 1 : date.getFullYear();
    return new Date(year, 2, 31);
}

/** Compare bill numbers — handles both legacy ints ("500") and date-prefix ("260316-001") */
function compareBillNos(a: string, b: string): number {
    const isNew = (s: string) => s.includes('-');
    if (isNew(a) && isNew(b)) return a.localeCompare(b);
    if (!isNew(a) && !isNew(b)) return parseInt(a, 10) - parseInt(b, 10);
    return isNew(a) ? 1 : -1; // new format always after legacy
}

// ── Component ────────────────────────────────────────────────────────────────

export const Reports: React.FC = () => {
    const { user } = useAuthStore();
    const [reportData, setReportData] = useState<ReportData | null>(null);
    const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
    const [loading, setLoading] = useState(false);
    const [reportType, setReportType] = useState<'detailed' | 'summary'>('summary');
    const [sortBy, setSortBy] = useState<'date' | 'billNo'>('date');

    if (user?.role !== 'ADMIN' && !user?.permViewGstReports) {
        return (
            <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-4">
                <div className="p-4 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-full">
                    <ShieldAlert className="w-12 h-12" />
                </div>
                <h1 className="text-2xl font-bold">Access Denied</h1>
                <p className="text-gray-500 max-w-md">
                    You do not have permission to view GST Reports.
                </p>
            </div>
        );
    }

    const generateReport = useCallback(async () => {
        try {
            setLoading(true);

            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);

            const sales: SaleRow[] = await db.sales.findMany({
                where: {
                    createdAt: { gte: start.toISOString(), lte: end.toISOString() },
                    status: 'COMPLETED',
                },
                include: {
                    items: {
                        include: {
                            variant: {
                                include: { product: { select: { hsn: true } } },
                            },
                        },
                    },
                    payments: true,
                },
                orderBy: { createdAt: 'asc' },
            });

            const taxInvoices = sales.filter((s) => !s.isHistorical);

            setReportData({
                startDate: start,
                endDate: end,
                taxInvoices,
                allSales: sales,
                taxInvoiceTotals: calculateTotals(taxInvoices),
                allSalesTotals: calculateTotals(sales),
                dailySummaries: buildDailySummaries(sales),
            });
        } catch (error) {
            console.error('Failed to generate report:', error);
            alert('Failed to generate report');
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate]);

    useEffect(() => { generateReport(); }, [generateReport]);

    // ── PDF Export ────────────────────────────────────────────────────────────

    const exportToPDF = () => {
        if (!reportData) return alert('Please generate a report first');

        const doc = new jsPDF('landscape');
        const dateRange = `From ${format(reportData.startDate, 'dd/MM/yyyy')} To ${format(reportData.endDate, 'dd/MM/yyyy')}`;

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('ZAIN GENTS PALACE', 14, 15);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(dateRange, 14, 22);

        let currentY = 30;

        if (reportType === 'summary') {
            // Summary Report
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text('DAILY SALES SUMMARY', 14, currentY);
            currentY += 5;

            const summaryColumns = ['DATE', 'BILL FROM', 'BILL TO', 'BILLS', 'SUBTOTAL', 'DISCOUNT', 'TAXABLE', 'CGST', 'SGST', 'GST', 'GRAND TOTAL', 'CASH', 'UPI', 'CARD'];

            // Sort summaries based on user selection
            const sortedSummaries = [...reportData.dailySummaries].sort((a, b) =>
                sortBy === 'billNo' ? compareBillNos(a.billFrom, b.billFrom) : a.date.localeCompare(b.date)
            );

            autoTable(doc, {
                startY: currentY,
                head: [summaryColumns],
                body: sortedSummaries.map((d) => [
                    format(new Date(d.date), 'dd/MMM/yy'),
                    d.billFrom.toString(),
                    d.billTo.toString(),
                    d.billCount.toString(),
                    d.subtotal.toFixed(2),
                    d.discount.toFixed(2),
                    d.taxableValue.toFixed(2),
                    d.cgst.toFixed(2),
                    d.sgst.toFixed(2),
                    d.totalTax.toFixed(2),
                    d.grandTotal.toFixed(2),
                    d.cash.toFixed(2),
                    d.upi.toFixed(2),
                    d.card.toFixed(2),
                ]),
                theme: 'grid',
                styles: { fontSize: 7, cellPadding: 1 },
                headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
            });

            currentY = (doc as any).lastAutoTable.finalY + 2;

            // Grand Total Row
            const a = reportData.allSalesTotals;
            autoTable(doc, {
                startY: currentY,
                body: [[
                    'GRAND TOTAL', '', '', a.count.toString(),
                    a.subtotal.toFixed(2), a.discount.toFixed(2), a.taxableValue.toFixed(2),
                    a.cgst.toFixed(2), a.sgst.toFixed(2), a.totalTax.toFixed(2),
                    a.grandTotal.toFixed(2),
                    a.payment.cash.toFixed(2), a.payment.upi.toFixed(2), a.payment.card.toFixed(2),
                ]],
                theme: 'grid',
                styles: { fontSize: 7, cellPadding: 1, fontStyle: 'bold', fillColor: [200, 255, 200] },
            });

        } else {
            // Detailed Report
            const saleColumns = ['DATE', 'BILL NO', 'SUBTOTAL', 'DISCOUNT', 'TAXABLE', 'CGST', 'SGST', 'GST', 'GRAND TOTAL', 'PAYMENT'];

            const mapSaleRow = (sale: SaleRow) => {
                const pb = getPaymentBreakdown(sale);
                const payModes: string[] = [];
                if (pb.cash > 0) payModes.push('Cash');
                if (pb.upi > 0) payModes.push('UPI');
                if (pb.card > 0) payModes.push('Card');

                return [
                    format(new Date(sale.createdAt), 'dd/MMM/yy'),
                    sale.billNo.toString(),
                    sale.subtotal.toFixed(2),
                    sale.discount.toFixed(2),
                    (sale.subtotal - sale.discount).toFixed(2),
                    (sale.cgst || 0).toFixed(2),
                    (sale.sgst || 0).toFixed(2),
                    sale.taxAmount.toFixed(2),
                    sale.grandTotal.toFixed(2),
                    payModes.join('+') || sale.paymentMethod,
                ];
            };

            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text('DETAILED INVOICE REPORT', 14, currentY);
            currentY += 5;

            // Sort sales based on user selection
            const sortedSales = [...reportData.allSales].sort((a, b) =>
                sortBy === 'billNo' ? compareBillNos(String(a.billNo), String(b.billNo)) : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );

            autoTable(doc, {
                startY: currentY,
                head: [saleColumns],
                body: sortedSales.map(mapSaleRow),
                theme: 'grid',
                styles: { fontSize: 8, cellPadding: 1 },
                headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold' },
            });

            currentY = (doc as any).lastAutoTable.finalY + 2;

            const a = reportData.allSalesTotals;
            autoTable(doc, {
                startY: currentY,
                body: [[
                    'GRAND TOTAL', '',
                    a.subtotal.toFixed(2), a.discount.toFixed(2), a.taxableValue.toFixed(2),
                    a.cgst.toFixed(2), a.sgst.toFixed(2), a.totalTax.toFixed(2),
                    a.grandTotal.toFixed(2), '',
                ]],
                theme: 'grid',
                styles: { fontSize: 8, cellPadding: 1, fontStyle: 'bold', fillColor: [220, 220, 220] },
            });

            currentY = (doc as any).lastAutoTable.finalY + 8;

            // Tax Rate Breakdown
            if (a.taxSlabs.length > 0) {
                if (currentY > 160) { doc.addPage(); currentY = 15; }
                doc.setFontSize(11);
                doc.text('TAX RATE BREAKDOWN', 14, currentY);
                currentY += 5;

                autoTable(doc, {
                    startY: currentY,
                    head: [['GST Rate', 'Taxable Value', 'CGST', 'SGST', 'Total Tax']],
                    body: a.taxSlabs.map((s) => [
                        `${s.rate}%`,
                        s.taxableValue.toFixed(2),
                        `${(s.rate / 2).toFixed(1)}% = ${s.cgst.toFixed(2)}`,
                        `${(s.rate / 2).toFixed(1)}% = ${s.sgst.toFixed(2)}`,
                        s.totalTax.toFixed(2),
                    ]),
                    theme: 'grid',
                    styles: { fontSize: 8, cellPadding: 1 },
                    headStyles: { fillColor: [230, 230, 250], textColor: [0, 0, 0], fontStyle: 'bold' },
                });
            }
        }

        doc.save(`GST-${reportType === 'summary' ? 'Summary' : 'Detailed'}-${format(reportData.startDate, 'dd-MM-yyyy')}-to-${format(reportData.endDate, 'dd-MM-yyyy')}.pdf`);
    };

    // ── Excel Export ──────────────────────────────────────────────────────────

    const exportToExcel = () => {
        if (!reportData) return alert('Please generate a report first');

        const wb = XLSX.utils.book_new();
        const dateRange = `From ${format(reportData.startDate, 'dd/MM/yyyy')} To ${format(reportData.endDate, 'dd/MM/yyyy')}`;
        const a = reportData.allSalesTotals;

        // Sorted sales used in both Detailed sheet and Items Detail sheet
        const sortedSales = [...reportData.allSales].sort((a, b) =>
            sortBy === 'billNo'
                ? compareBillNos(String(a.billNo), String(b.billNo))
                : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        if (reportType === 'summary') {
            const summaryHeader = ['DATE', 'BILL FROM', 'BILL TO', 'BILLS', 'SUBTOTAL', 'DISCOUNT', 'TAXABLE', 'CGST', 'SGST', 'GST', 'GRAND TOTAL', 'CASH', 'UPI', 'CARD'];

            const sortedSummaries = [...reportData.dailySummaries].sort((a, b) =>
                sortBy === 'billNo' ? compareBillNos(a.billFrom, b.billFrom) : a.date.localeCompare(b.date)
            );

            const data = [
                ['ZAIN GENTS PALACE'],
                [dateRange],
                [],
                ['DAILY SALES SUMMARY'],
                summaryHeader,
                ...sortedSummaries.map((d) => [
                    format(new Date(d.date), 'dd/MMM/yy'),
                    d.billFrom, d.billTo, d.billCount,
                    d.subtotal, d.discount, d.taxableValue,
                    d.cgst, d.sgst, d.totalTax, d.grandTotal,
                    d.cash, d.upi, d.card,
                ]),
                ['GRAND TOTAL', '', '', a.count, a.subtotal, a.discount, a.taxableValue, a.cgst, a.sgst, a.totalTax, a.grandTotal, a.payment.cash, a.payment.upi, a.payment.card],
            ];

            const ws = XLSX.utils.aoa_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Daily Summary');

        } else {
            const header = ['DATE & TIME', 'BILL NO', 'CUSTOMER', 'SUBTOTAL', 'DISCOUNT', 'TAXABLE', 'CGST', 'SGST', 'GST', 'GRAND TOTAL', 'PAYMENT'];

            const mapSaleExcel = (sale: SaleRow) => {
                const pb = getPaymentBreakdown(sale);
                const payModes: string[] = [];
                if (pb.cash > 0) payModes.push('Cash');
                if (pb.upi > 0) payModes.push('UPI');
                if (pb.card > 0) payModes.push('Card');

                return [
                    format(new Date(sale.createdAt), 'dd/MMM/yy HH:mm'),
                    sale.billNo,
                    sale.customerName || 'Walk-in Customer',
                    sale.subtotal,
                    sale.discount,
                    sale.subtotal - sale.discount,
                    sale.cgst || 0,
                    sale.sgst || 0,
                    sale.taxAmount,
                    sale.grandTotal,
                    payModes.join('+') || sale.paymentMethod,
                ];
            };

            const data = [
                ['ZAIN GENTS PALACE'],
                [dateRange],
                [],
                ['DETAILED INVOICE REPORT'],
                header,
                ...sortedSales.map(mapSaleExcel),
                ['GRAND TOTAL', '', '', a.subtotal, a.discount, a.taxableValue, a.cgst, a.sgst, a.totalTax, a.grandTotal, ''],
                [],
                ['TAX RATE BREAKDOWN'],
                ['GST Rate', 'Taxable Value', 'CGST Rate', 'CGST Amt', 'SGST Rate', 'SGST Amt', 'Total Tax'],
                ...a.taxSlabs.map((s) => [`${s.rate}%`, s.taxableValue, `${(s.rate / 2).toFixed(1)}%`, s.cgst, `${(s.rate / 2).toFixed(1)}%`, s.sgst, s.totalTax]),
                [],
                ['HSN-WISE SUMMARY'],
                ['HSN Code', 'Description', 'Qty', 'Taxable Value', 'GST Rate', 'CGST', 'SGST', 'Total Tax'],
                ...a.hsnSummary.map((h) => [h.hsn, h.description, h.quantity, h.taxableValue, `${h.taxRate}%`, h.cgst, h.sgst, h.totalTax]),
                [],
                ['PAYMENT BREAKDOWN'],
                ['Cash', a.payment.cash],
                ['UPI', a.payment.upi],
                ['Card', a.payment.card],
            ];

            const ws = XLSX.utils.aoa_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Detailed Report');
        }

        // ── Items Detail sheet (all modes) ────────────────────────────────────
        const itemsHeader = [
            'BILL NO', 'INVOICE DATE', 'ACTUAL SALE DATE', 'CUSTOMER', 'PAYMENT METHOD',
            'PRODUCT', 'BARCODE', 'SKU', 'SIZE', 'COLOR',
            'QTY', 'MRP', 'SELLING PRICE', 'DISCOUNT',
            'TAX %', 'CGST AMT', 'SGST AMT', 'LINE TOTAL',
        ];

        const itemsData: any[] = [
            ['ZAIN GENTS PALACE'],
            [dateRange],
            [],
            ['ITEMS DETAIL (ALL INVOICES)'],
            itemsHeader,
        ];

        for (const sale of sortedSales) {
            const invoiceDate = format(new Date(sale.createdAt), 'dd/MMM/yy HH:mm');
            const actualSaleDate = sale.actualSaleDate
                ? format(new Date(sale.actualSaleDate), 'dd/MMM/yy')
                : '-';
            const customer = sale.customerName || 'Walk-in Customer';
            const payMethod = sale.paymentMethod || 'CASH';
            if (sale.items && sale.items.length > 0) {
                for (const item of sale.items) {
                    const halfTax = item.taxRate / 2;
                    const taxable = item.sellingPrice * item.quantity - item.discount;
                    const cgstAmt = parseFloat(((taxable * halfTax) / 100).toFixed(2));
                    const sgstAmt = cgstAmt;
                    itemsData.push([
                        sale.billNo, invoiceDate, actualSaleDate, customer, payMethod,
                        item.productName,
                        item.variant?.barcode || '',
                        item.variant?.sku || '',
                        item.variant?.size || '',
                        item.variant?.color || '',
                        item.quantity, item.mrp, item.sellingPrice, item.discount,
                        item.taxRate, cgstAmt, sgstAmt, item.total,
                    ]);
                }
            } else {
                // Historical sale — no item breakdown
                itemsData.push([
                    sale.billNo, invoiceDate, actualSaleDate, customer, payMethod,
                    '(Historical — no item details)',
                    '', '', '', '',
                    '', '', '', '',
                    '', '', '', sale.grandTotal,
                ]);
            }
        }

        const wsItems = XLSX.utils.aoa_to_sheet(itemsData);
        XLSX.utils.book_append_sheet(wb, wsItems, 'Items Detail');

        XLSX.writeFile(wb, `GST-${reportType === 'summary' ? 'Summary' : 'Detailed'}-${format(reportData.startDate, 'dd-MM-yyyy')}-to-${format(reportData.endDate, 'dd-MM-yyyy')}.xlsx`);
    };

    // ── Date Presets ─────────────────────────────────────────────────────────

    const datePresets = useMemo(() => {
        const now = new Date();
        const lastMonth = subMonths(now, 1);
        const lastQuarter = subMonths(startOfQuarter(now), 1);
        const fyStart = getFinancialYearStart(now);
        const fyEnd = getFinancialYearEnd(now);
        const lastFyStart = getFinancialYearStart(subMonths(fyStart, 1));
        const lastFyEnd = getFinancialYearEnd(subMonths(fyStart, 1));

        return [
            { label: 'Today', start: format(now, 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') },
            { label: 'This Month', start: format(startOfMonth(now), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') },
            { label: 'Last Month', start: format(startOfMonth(lastMonth), 'yyyy-MM-dd'), end: format(endOfMonth(lastMonth), 'yyyy-MM-dd') },
            { label: 'This Quarter', start: format(startOfQuarter(now), 'yyyy-MM-dd'), end: format(endOfQuarter(now), 'yyyy-MM-dd') },
            { label: 'Last Quarter', start: format(startOfQuarter(lastQuarter), 'yyyy-MM-dd'), end: format(endOfQuarter(lastQuarter), 'yyyy-MM-dd') },
            { label: 'This FY', start: format(fyStart, 'yyyy-MM-dd'), end: format(fyEnd, 'yyyy-MM-dd') },
            { label: 'Last FY', start: format(lastFyStart, 'yyyy-MM-dd'), end: format(lastFyEnd, 'yyyy-MM-dd') },
        ];
    }, []);

    // ── UI ────────────────────────────────────────────────────────────────────

    const a = reportData?.allSalesTotals;

    // Sorted data based on user selection
    const sortedSales = useMemo(() => {
        if (!reportData) return [];
        const sales = [...reportData.allSales];
        if (sortBy === 'billNo') {
            return sales.sort((a, b) => compareBillNos(String(a.billNo), String(b.billNo)));
        }
        return sales.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }, [reportData, sortBy]);

    const sortedDailySummaries = useMemo(() => {
        if (!reportData) return [];
        const summaries = [...reportData.dailySummaries];
        if (sortBy === 'billNo') {
            return summaries.sort((a, b) => compareBillNos(a.billFrom, b.billFrom));
        }
        return summaries.sort((a, b) => a.date.localeCompare(b.date));
    }, [reportData, sortBy]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="card flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold">GST Sales Report</h2>
                    <p className="text-gray-600 dark:text-gray-400 text-sm">
                        Generate GST-compliant sales reports
                    </p>
                </div>
                {/* Report Type Toggle */}
                <div className="flex flex-wrap gap-2">
                    <div className="flex rounded-lg border dark:border-gray-700 overflow-hidden">
                        <button
                            onClick={() => setReportType('summary')}
                            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
                                reportType === 'summary'
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                        >
                            <LayoutGrid className="w-4 h-4" />
                            Summary
                        </button>
                        <button
                            onClick={() => setReportType('detailed')}
                            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
                                reportType === 'detailed'
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                        >
                            <List className="w-4 h-4" />
                            Detailed
                        </button>
                    </div>
                    {/* Sort Toggle */}
                    <div className="flex rounded-lg border dark:border-gray-700 overflow-hidden">
                        <button
                            onClick={() => setSortBy('date')}
                            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
                                sortBy === 'date'
                                    ? 'bg-green-500 text-white'
                                    : 'bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                        >
                            <Calendar className="w-4 h-4" />
                            By Date
                        </button>
                        <button
                            onClick={() => setSortBy('billNo')}
                            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
                                sortBy === 'billNo'
                                    ? 'bg-green-500 text-white'
                                    : 'bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                        >
                            <Hash className="w-4 h-4" />
                            By Bill No
                        </button>
                    </div>
                </div>
            </div>

            {/* Date Range Selection */}
            <div className="card">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Select Date Range</h3>
                    {loading && <span className="text-sm text-gray-500 animate-pulse">Loading...</span>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium mb-2">From Date</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-2">To Date</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800"
                        />
                    </div>
                    <div className="flex items-end gap-2">
                        <button
                            onClick={exportToPDF}
                            disabled={!reportData}
                            className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            <FileText className="w-4 h-4" />
                            PDF
                        </button>
                        <button
                            onClick={exportToExcel}
                            disabled={!reportData}
                            className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            <FileSpreadsheet className="w-4 h-4" />
                            Excel
                        </button>
                    </div>
                </div>

                {/* Quick Date Presets */}
                <div className="flex flex-wrap gap-2 mt-4">
                    {datePresets.map((preset) => (
                        <button
                            key={preset.label}
                            onClick={() => { setStartDate(preset.start); setEndDate(preset.end); }}
                            className={`px-3 py-1 text-sm rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors ${
                                startDate === preset.start && endDate === preset.end
                                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
                                    : 'bg-gray-200 dark:bg-gray-700'
                            }`}
                        >
                            {preset.label}
                        </button>
                    ))}
                    <input
                        type="month"
                        title="Pick any month"
                        value={startDate.substring(0, 7)}
                        onChange={(e) => {
                            if (!e.target.value) return;
                            const [yr, mo] = e.target.value.split('-').map(Number);
                            setStartDate(format(new Date(yr, mo - 1, 1), 'yyyy-MM-dd'));
                            setEndDate(format(new Date(yr, mo, 0), 'yyyy-MM-dd'));
                        }}
                        className="px-3 py-1 text-sm rounded border-0 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 cursor-pointer"
                    />
                </div>
            </div>

            {/* Report Preview */}
            {reportData && a && (
                <>
                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="card p-4 border-l-4 border-blue-500">
                            <p className="text-xs text-gray-500 dark:text-gray-400">Total Bills</p>
                            <p className="text-2xl font-bold">{a.count}</p>
                        </div>
                        <div className="card p-4 border-l-4 border-green-500">
                            <p className="text-xs text-gray-500 dark:text-gray-400">Taxable Value</p>
                            <p className="text-2xl font-bold">{formatIndianCurrency(a.taxableValue)}</p>
                        </div>
                        <div className="card p-4 border-l-4 border-purple-500">
                            <p className="text-xs text-gray-500 dark:text-gray-400">Total GST</p>
                            <p className="text-2xl font-bold">{formatIndianCurrency(a.totalTax)}</p>
                        </div>
                        <div className="card p-4 border-l-4 border-orange-500">
                            <p className="text-xs text-gray-500 dark:text-gray-400">Grand Total</p>
                            <p className="text-2xl font-bold">{formatIndianCurrency(a.grandTotal)}</p>
                        </div>
                    </div>

                    {/* Summary View */}
                    {reportType === 'summary' && (
                        <div className="card">
                            <h4 className="font-bold mb-3">Daily Sales Summary</h4>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                                            <th className="text-left py-2 px-3">Date</th>
                                            <th className="text-center py-2 px-3">Bill From</th>
                                            <th className="text-center py-2 px-3">Bill To</th>
                                            <th className="text-center py-2 px-3">Bills</th>
                                            <th className="text-right py-2 px-3">Taxable</th>
                                            <th className="text-right py-2 px-3">CGST</th>
                                            <th className="text-right py-2 px-3">SGST</th>
                                            <th className="text-right py-2 px-3">Grand Total</th>
                                            <th className="text-right py-2 px-3">Cash</th>
                                            <th className="text-right py-2 px-3">UPI</th>
                                            <th className="text-right py-2 px-3">Card</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedDailySummaries.map((d) => (
                                            <tr key={d.date} className="border-b dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                                <td className="py-2 px-3 font-medium">{format(new Date(d.date), 'dd/MMM/yy')}</td>
                                                <td className="py-2 px-3 text-center">{d.billFrom}</td>
                                                <td className="py-2 px-3 text-center">{d.billTo}</td>
                                                <td className="py-2 px-3 text-center">{d.billCount}</td>
                                                <td className="py-2 px-3 text-right">{formatIndianCurrency(d.taxableValue)}</td>
                                                <td className="py-2 px-3 text-right text-gray-500">{formatIndianCurrency(d.cgst)}</td>
                                                <td className="py-2 px-3 text-right text-gray-500">{formatIndianCurrency(d.sgst)}</td>
                                                <td className="py-2 px-3 text-right font-semibold">{formatIndianCurrency(d.grandTotal)}</td>
                                                <td className="py-2 px-3 text-right text-green-600">{formatIndianCurrency(d.cash)}</td>
                                                <td className="py-2 px-3 text-right text-purple-600">{formatIndianCurrency(d.upi)}</td>
                                                <td className="py-2 px-3 text-right text-blue-600">{formatIndianCurrency(d.card)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-gray-100 dark:bg-gray-800 font-bold">
                                            <td className="py-2 px-3">TOTAL</td>
                                            <td className="py-2 px-3"></td>
                                            <td className="py-2 px-3"></td>
                                            <td className="py-2 px-3 text-center">{a.count}</td>
                                            <td className="py-2 px-3 text-right">{formatIndianCurrency(a.taxableValue)}</td>
                                            <td className="py-2 px-3 text-right">{formatIndianCurrency(a.cgst)}</td>
                                            <td className="py-2 px-3 text-right">{formatIndianCurrency(a.sgst)}</td>
                                            <td className="py-2 px-3 text-right">{formatIndianCurrency(a.grandTotal)}</td>
                                            <td className="py-2 px-3 text-right text-green-600">{formatIndianCurrency(a.payment.cash)}</td>
                                            <td className="py-2 px-3 text-right text-purple-600">{formatIndianCurrency(a.payment.upi)}</td>
                                            <td className="py-2 px-3 text-right text-blue-600">{formatIndianCurrency(a.payment.card)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Detailed View */}
                    {reportType === 'detailed' && (
                        <>
                            <div className="card">
                                <h4 className="font-bold mb-3">All Invoices</h4>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                                                <th className="text-left py-2 px-3">Date</th>
                                                <th className="text-center py-2 px-3">Bill No</th>
                                                <th className="text-right py-2 px-3">Subtotal</th>
                                                <th className="text-right py-2 px-3">Discount</th>
                                                <th className="text-right py-2 px-3">Taxable</th>
                                                <th className="text-right py-2 px-3">CGST</th>
                                                <th className="text-right py-2 px-3">SGST</th>
                                                <th className="text-right py-2 px-3">Grand Total</th>
                                                <th className="text-center py-2 px-3">Payment</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedSales.map((sale) => {
                                                const pb = getPaymentBreakdown(sale);
                                                const payModes: string[] = [];
                                                if (pb.cash > 0) payModes.push('Cash');
                                                if (pb.upi > 0) payModes.push('UPI');
                                                if (pb.card > 0) payModes.push('Card');

                                                return (
                                                    <tr key={sale.id} className="border-b dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                                        <td className="py-2 px-3">{format(new Date(sale.createdAt), 'dd/MMM/yy')}</td>
                                                        <td className="py-2 px-3 text-center font-mono">{sale.billNo}</td>
                                                        <td className="py-2 px-3 text-right">{formatIndianCurrency(sale.subtotal)}</td>
                                                        <td className="py-2 px-3 text-right text-red-500">{sale.discount > 0 ? `-${formatIndianCurrency(sale.discount)}` : '-'}</td>
                                                        <td className="py-2 px-3 text-right">{formatIndianCurrency(sale.subtotal - sale.discount)}</td>
                                                        <td className="py-2 px-3 text-right text-gray-500">{formatIndianCurrency(sale.cgst || 0)}</td>
                                                        <td className="py-2 px-3 text-right text-gray-500">{formatIndianCurrency(sale.sgst || 0)}</td>
                                                        <td className="py-2 px-3 text-right font-semibold">{formatIndianCurrency(sale.grandTotal)}</td>
                                                        <td className="py-2 px-3 text-center text-xs">{payModes.join('+') || sale.paymentMethod}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot>
                                            <tr className="bg-gray-100 dark:bg-gray-800 font-bold">
                                                <td className="py-2 px-3">TOTAL</td>
                                                <td className="py-2 px-3 text-center">{a.count} bills</td>
                                                <td className="py-2 px-3 text-right">{formatIndianCurrency(a.subtotal)}</td>
                                                <td className="py-2 px-3 text-right text-red-500">-{formatIndianCurrency(a.discount)}</td>
                                                <td className="py-2 px-3 text-right">{formatIndianCurrency(a.taxableValue)}</td>
                                                <td className="py-2 px-3 text-right">{formatIndianCurrency(a.cgst)}</td>
                                                <td className="py-2 px-3 text-right">{formatIndianCurrency(a.sgst)}</td>
                                                <td className="py-2 px-3 text-right">{formatIndianCurrency(a.grandTotal)}</td>
                                                <td className="py-2 px-3"></td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>

                            {/* Tax Rate Breakdown */}
                            {a.taxSlabs.length > 0 && (
                                <div className="card">
                                    <h4 className="font-bold mb-3">Tax Rate Breakdown</h4>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b dark:border-gray-700">
                                                    <th className="text-left py-2 px-3">GST Rate</th>
                                                    <th className="text-right py-2 px-3">Taxable Value</th>
                                                    <th className="text-right py-2 px-3">CGST</th>
                                                    <th className="text-right py-2 px-3">SGST</th>
                                                    <th className="text-right py-2 px-3">Total Tax</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {a.taxSlabs.map((slab) => (
                                                    <tr key={slab.rate} className="border-b dark:border-gray-700/50">
                                                        <td className="py-2 px-3 font-medium">{slab.rate}%</td>
                                                        <td className="py-2 px-3 text-right">{formatIndianCurrency(slab.taxableValue)}</td>
                                                        <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">
                                                            {(slab.rate / 2).toFixed(1)}% = {formatIndianCurrency(slab.cgst)}
                                                        </td>
                                                        <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">
                                                            {(slab.rate / 2).toFixed(1)}% = {formatIndianCurrency(slab.sgst)}
                                                        </td>
                                                        <td className="py-2 px-3 text-right font-semibold">{formatIndianCurrency(slab.totalTax)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Payment Methods */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="card">
                                    <h4 className="font-bold mb-3">Payment Methods</h4>
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center p-3 bg-green-50 dark:bg-green-900/10 rounded border border-green-200 dark:border-green-800">
                                            <span className="text-sm">Cash</span>
                                            <span className="font-bold">{formatIndianCurrency(a.payment.cash)}</span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 bg-purple-50 dark:bg-purple-900/10 rounded border border-purple-200 dark:border-purple-800">
                                            <span className="text-sm">UPI</span>
                                            <span className="font-bold">{formatIndianCurrency(a.payment.upi)}</span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 bg-blue-50 dark:bg-blue-900/10 rounded border border-blue-200 dark:border-blue-800">
                                            <span className="text-sm">Card</span>
                                            <span className="font-bold">{formatIndianCurrency(a.payment.card)}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="card">
                                    <h4 className="font-bold mb-3">Tax Summary</h4>
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded">
                                            <span className="text-sm">CGST</span>
                                            <span className="font-bold">{formatIndianCurrency(a.cgst)}</span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded">
                                            <span className="text-sm">SGST</span>
                                            <span className="font-bold">{formatIndianCurrency(a.sgst)}</span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded border border-indigo-200 dark:border-indigo-800">
                                            <span className="text-sm font-medium">Total GST</span>
                                            <span className="font-bold text-indigo-700 dark:text-indigo-300">{formatIndianCurrency(a.totalTax)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                        Click PDF or Excel button to download the {reportType} report
                    </p>
                </>
            )}
        </div>
    );
};
