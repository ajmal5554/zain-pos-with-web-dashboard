import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { FileText, FileSpreadsheet, List, LayoutGrid, ArrowUpDown, Calendar, Hash, ShieldAlert } from 'lucide-react';
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

// ── Types ────────────────────────────────────────────────────────────────────

interface SaleItemRow {
    variantId?: string;
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

interface RefundItemRow {
    variantId: string;
    quantity: number;
    amount: number;
}

interface RefundPaymentRow {
    paymentMode: string;
    amount: number;
}

interface RefundRow {
    totalRefundAmount: number;
    items?: RefundItemRow[];
    payments?: RefundPaymentRow[];
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
    remarks?: string;
    items: SaleItemRow[];
    payments?: PaymentRow[];
    refunds?: RefundRow[];
    reportStatus?: 'COMPLETED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
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
    cancelledSales: SaleRow[];
    exchangeReplacementSales: SaleRow[];
    taxInvoiceTotals: ReportTotals;
    allSalesTotals: ReportTotals;
    exchangeReplacementTotals: ReportTotals;
    dailySummaries: DailySummary[];
}

const formatDateInputValue = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseDateInputValue = (value: string, endOfDay = false): Date => {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(year, (month || 1) - 1, day || 1);
    parsed.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    return parsed;
};

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

function getRefundPaymentBreakdown(sale: SaleRow): PaymentSummary {
    const result: PaymentSummary = { cash: 0, upi: 0, card: 0 };

    for (const refund of sale.refunds || []) {
        if (refund.payments && refund.payments.length > 0) {
            for (const payment of refund.payments) {
                const mode = (payment.paymentMode || '').toUpperCase();
                if (mode === 'CASH') result.cash += Number(payment.amount || 0);
                else if (mode === 'UPI') result.upi += Number(payment.amount || 0);
                else if (mode === 'CARD') result.card += Number(payment.amount || 0);
            }
        }
    }

    return result;
}

function clampRatio(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function getNetSaleForReport(sale: SaleRow): SaleRow {
    const refunds = sale.refunds || [];
    if (refunds.length === 0) {
        return {
            ...sale,
            reportStatus: 'COMPLETED',
        };
    }

    const totalRefundAmount = refunds.reduce((sum, refund) => sum + Number(refund.totalRefundAmount || 0), 0);
    const refundRatio = clampRatio(totalRefundAmount / Math.max(Number(sale.grandTotal || 0), 0.01));

    const refundByVariant = new Map<string, { qty: number; amount: number }>();
    for (const refund of refunds) {
        for (const item of refund.items || []) {
            const existing = refundByVariant.get(item.variantId) || { qty: 0, amount: 0 };
            existing.qty += Number(item.quantity || 0);
            existing.amount += Number(item.amount || 0);
            refundByVariant.set(item.variantId, existing);
        }
    }

    const netItems = (sale.items || []).flatMap((item) => {
        const refunded = refundByVariant.get(item.variantId || '') || { qty: 0, amount: 0 };
        const originalQty = Number(item.quantity || 0);
        const refundedQty = Math.min(originalQty, Number(refunded.qty || 0));
        const remainingQty = Math.max(0, originalQty - refundedQty);

        if (remainingQty <= 0) {
            return [];
        }

        const originalLineTotal = Number(
            item.total ?? ((Number(item.sellingPrice || 0) * Number(item.quantity || 0)) - Number(item.discount || 0))
        );
        const refundedAmount = Math.min(originalLineTotal, Number(refunded.amount || 0));
        const remainingLineTotal = Math.max(0, originalLineTotal - refundedAmount);
        const remainingBaseAmount = Number(item.sellingPrice || 0) * remainingQty;
        const remainingDiscount = Math.max(0, remainingBaseAmount - remainingLineTotal);
        const remainingTaxAmount = item.taxRate > 0
            ? (remainingLineTotal * item.taxRate) / (100 + item.taxRate)
            : 0;

        return [{
            ...item,
            quantity: remainingQty,
            discount: remainingDiscount,
            taxAmount: remainingTaxAmount,
            total: remainingLineTotal,
        }];
    });

    const originalPayments = getPaymentBreakdown(sale);
    const refundPayments = getRefundPaymentBreakdown(sale);
    const netPayments: PaymentRow[] = [
        { paymentMode: 'CASH', amount: Math.max(0, originalPayments.cash - refundPayments.cash) },
        { paymentMode: 'UPI', amount: Math.max(0, originalPayments.upi - refundPayments.upi) },
        { paymentMode: 'CARD', amount: Math.max(0, originalPayments.card - refundPayments.card) },
    ].filter((payment) => payment.amount > 0);

    const netSale: SaleRow = {
        ...sale,
        subtotal: Math.max(0, Number(sale.subtotal || 0) * (1 - refundRatio)),
        discount: Math.max(0, Number(sale.discount || 0) * (1 - refundRatio)),
        taxAmount: Math.max(0, Number(sale.taxAmount || 0) * (1 - refundRatio)),
        cgst: Math.max(0, Number(sale.cgst || 0) * (1 - refundRatio)),
        sgst: Math.max(0, Number(sale.sgst || 0) * (1 - refundRatio)),
        grandTotal: Math.max(0, Number(sale.grandTotal || 0) - totalRefundAmount),
        items: netItems,
        payments: netPayments,
        reportStatus: totalRefundAmount >= Number(sale.grandTotal || 0) - 0.009 ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    };

    return netSale;
}

function buildTaxSlabs(salesList: SaleRow[]): TaxSlabSummary[] {
    const slabMap = new Map<number, TaxSlabSummary>();

    for (const sale of salesList) {
        const saleSubtotal = Number(sale.subtotal || 0);
        const saleDiscount = Number(sale.discount || 0);

        for (const item of sale.items || []) {
            const rate = item.taxRate;
            const lineGross = Number(item.total ?? ((Number(item.sellingPrice || 0) * Number(item.quantity || 0)) - Number(item.discount || 0)));
            const discountShare = saleSubtotal > 0 ? (lineGross / saleSubtotal) : 0;
            const lineNet = Math.max(0, lineGross - (saleDiscount * discountShare));
            const taxableValue = parseFloat((lineNet / (1 + rate / 100)).toFixed(2));
            const taxAmount = parseFloat((lineNet - taxableValue).toFixed(2));
            const cgst = parseFloat((taxAmount / 2).toFixed(2));
            const sgst = parseFloat((taxAmount / 2).toFixed(2));

            const existing = slabMap.get(rate);
            if (existing) {
                existing.taxableValue += taxableValue;
                existing.cgst += cgst;
                existing.sgst += sgst;
                existing.totalTax += taxAmount;
            } else {
                slabMap.set(rate, { rate, taxableValue, cgst, sgst, totalTax: taxAmount });
            }
        }
    }

    return Array.from(slabMap.values()).sort((a, b) => a.rate - b.rate);
}

function buildHsnSummary(items: SaleItemRow[]): HsnSummary[] {
    const hsnMap = new Map<string, HsnSummary>();

    for (const item of items) {
        const hsn = item.variant?.product?.hsn || 'N/A';
        // Tax-inclusive pricing: Extract tax from the after-discount amount
        const amountWithTax = item.sellingPrice * item.quantity - item.discount;
        const taxAmount = (amountWithTax * item.taxRate) / (100 + item.taxRate);
        const taxableValue = amountWithTax - taxAmount;
        const cgst = taxAmount / 2;
        const sgst = taxAmount / 2;

        const existing = hsnMap.get(hsn);
        if (existing) {
            existing.quantity += item.quantity;
            existing.taxableValue += taxableValue;
            existing.cgst += cgst;
            existing.sgst += sgst;
            existing.totalTax += taxAmount;
        } else {
            hsnMap.set(hsn, {
                hsn,
                description: item.productName,
                quantity: item.quantity,
                taxableValue,
                taxRate: item.taxRate,
                cgst,
                sgst,
                totalTax: taxAmount,
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
        taxSlabs: buildTaxSlabs(salesList),
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

function isReplacementSale(sale: SaleRow): boolean {
    return sale.paymentMethod === 'EXCHANGE' || (sale.remarks || '').includes('Replacement sale for Invoice');
}

function formatGstBillLabel(sale: SaleRow): string {
    if (isReplacementSale(sale)) {
        return `${sale.billNo} (REPLACEMENT BILL)`;
    }
    if (sale.reportStatus === 'REFUNDED') {
        return `${sale.billNo} (REFUNDED)`;
    }
    if (sale.reportStatus === 'PARTIALLY_REFUNDED') {
        return `${sale.billNo} (PARTIAL REFUND)`;
    }
    return String(sale.billNo);
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
    
    // Shop settings for PDF header
    const [shopSettings, setShopSettings] = useState({
        shopName: 'ZAIN GENTS PALACE',
        address: 'CHIRAMMAL TOWER, BEHIND CANARA BANK\nRAJA ROAD, NILESHWAR',
        phone: '9037106449, 7907026827',
        gstin: '32PVGPS0686J1ZV',
        email: '',
    });

    // Load shop settings from the persisted settings table
    useEffect(() => {
        const loadShopSettings = async () => {
            try {
                const result = await db.settings.findUnique({ where: { key: 'SHOP_SETTINGS' } });
                if (!result?.value) return;

                const parsed = JSON.parse(result.value);
                setShopSettings(prev => ({
                    ...prev,
                    shopName: parsed.shopName || prev.shopName,
                    address: parsed.address || prev.address,
                    phone: parsed.phone || prev.phone,
                    gstin: parsed.gstin || prev.gstin,
                    email: parsed.email || prev.email,
                }));
            } catch (error) {
                console.error('Failed to load shop settings:', error);
            }
        };

        loadShopSettings();
    }, []);

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

            const start = parseDateInputValue(startDate);
            const end = parseDateInputValue(endDate, true);

            const sales: SaleRow[] = await db.sales.findMany({
                where: {
                    createdAt: { gte: start, lte: end },
                    status: { in: ['COMPLETED', 'VOIDED'] },
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
                    refunds: {
                        include: {
                            items: true,
                            payments: true,
                        },
                    },
                },
                orderBy: { createdAt: 'asc' },
            });

            const cancelledSales = sales.filter((sale) => sale.status === 'VOIDED');
            const activeSales = sales.filter((sale) => sale.status !== 'VOIDED');
            const nettedSales = activeSales.map((sale) => getNetSaleForReport(sale));

            const exchangeReplacementSales = nettedSales.filter(isReplacementSale);
            const regularSales = nettedSales.filter((s) => !isReplacementSale(s));
            const taxInvoices = regularSales.filter((s) => !s.isHistorical);

            setReportData({
                startDate: start,
                endDate: end,
                taxInvoices,
                allSales: nettedSales,
                cancelledSales,
                exchangeReplacementSales,
                taxInvoiceTotals: calculateTotals(taxInvoices),
                allSalesTotals: calculateTotals(regularSales),
                exchangeReplacementTotals: calculateTotals(exchangeReplacementSales),
                dailySummaries: buildDailySummaries(regularSales),
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
        const pageWidth = doc.internal.pageSize.getWidth();
        const dateRange = `From ${format(reportData.startDate, 'dd/MM/yyyy')} To ${format(reportData.endDate, 'dd/MM/yyyy')}`;

        // Professional header with shop details
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        // Center the shop name
        const shopNameWidth = doc.getTextWidth(shopSettings.shopName);
        doc.text(shopSettings.shopName, (pageWidth - shopNameWidth) / 2, 15);
        
        // Shop address (centered)
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const addressLines = shopSettings.address.split('\n');
        let currentY = 22;
        addressLines.forEach(line => {
            const lineWidth = doc.getTextWidth(line);
            doc.text(line, (pageWidth - lineWidth) / 2, currentY);
            currentY += 4;
        });
        
        // Phone and GSTIN on same line (centered)
        const contactInfo = `Ph: ${shopSettings.phone}  |  GSTIN: ${shopSettings.gstin}`;
        const contactWidth = doc.getTextWidth(contactInfo);
        doc.text(contactInfo, (pageWidth - contactWidth) / 2, currentY);
        currentY += 2;
        
        // Separator line
        doc.setLineWidth(0.5);
        doc.line(14, currentY, pageWidth - 14, currentY);
        currentY += 5;
        
        // Date range (centered)
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        const dateWidth = doc.getTextWidth(dateRange);
        doc.text(dateRange, (pageWidth - dateWidth) / 2, currentY);
        currentY += 5;

        if (reportType === 'summary') {
            // Summary Report
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text('DAILY SALES SUMMARY', 14, currentY);
            currentY += 5;

            const summaryColumns = ['DATE', 'BILL FROM', 'BILL TO', 'BILLS', 'GROSS AMOUNT\n(incl. GST)', 'DISCOUNT', 'NET AMOUNT\n(incl. GST)', 'TAXABLE AMOUNT\n(excl. GST)', 'CGST', 'SGST', 'TOTAL GST', 'AMOUNT PAID', 'CASH', 'UPI', 'CARD'];

            // Sort summaries based on user selection
            const sortedSummaries = [...reportData.dailySummaries].sort((a, b) =>
                sortBy === 'billNo' ? compareBillNos(a.billFrom, b.billFrom) : a.date.localeCompare(b.date)
            );

            // Include Grand Total row directly in the summary table
            const a = reportData.allSalesTotals;
            const totalTaxableAmount = a.taxableValue - a.totalTax; // Tax-exclusive amount
            const grandTotalRow = [
                'GRAND TOTAL',                           
                '',                                      
                '',                                      
                a.count.toString(),                      
                a.subtotal.toFixed(2),                   
                a.discount.toFixed(2),                   
                a.taxableValue.toFixed(2),              
                totalTaxableAmount.toFixed(2),          // New taxable amount column
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
                    format(new Date(d.date), 'dd/MMM/yy'),
                    d.billFrom.toString(),
                    d.billTo.toString(),
                    d.billCount.toString(),
                    d.subtotal.toFixed(2),
                    d.discount.toFixed(2),
                    d.taxableValue.toFixed(2),
                    (d.taxableValue - d.totalTax).toFixed(2), // Tax-exclusive taxable amount
                    d.cgst.toFixed(2),
                    d.sgst.toFixed(2),
                    d.totalTax.toFixed(2),
                    d.grandTotal.toFixed(2),
                    d.cash.toFixed(2),
                    d.upi.toFixed(2),
                    d.card.toFixed(2),
                ]), grandTotalRow],
                theme: 'grid',
                styles: { fontSize: 7, cellPadding: 1 },
                headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
                bodyStyles: { fillColor: [255, 255, 255] },
                // Style the last row (Grand Total) differently
                didParseCell: function (data: any) {
                    if (data.row.index === sortedSummaries.length) { // Last row is Grand Total
                        data.cell.styles.fontStyle = 'bold';
                        data.cell.styles.fillColor = [200, 255, 200];
                    }
                }
            });

        } else {
            // Detailed Report
            const saleColumns = ['DATE', 'BILL NO', 'GROSS AMOUNT\n(incl. GST)', 'DISCOUNT', 'NET AMOUNT\n(incl. GST)', 'TAXABLE AMOUNT\n(excl. GST)', 'CGST', 'SGST', 'TOTAL GST', 'AMOUNT PAID', 'PAYMENT'];

            const mapSaleRow = (sale: SaleRow) => {
                const pb = getPaymentBreakdown(sale);
                const payModes: string[] = [];
                if (pb.cash > 0) payModes.push('Cash');
                if (pb.upi > 0) payModes.push('UPI');
                if (pb.card > 0) payModes.push('Card');

                const netAmount = sale.subtotal - sale.discount;
                const taxableAmount = parseFloat((netAmount / 1.05).toFixed(2));
                const totalGst = parseFloat((netAmount - taxableAmount).toFixed(2));
                const cgst = parseFloat((totalGst / 2).toFixed(2));
                const sgst = parseFloat((totalGst / 2).toFixed(2));

                return [
                    format(new Date(sale.createdAt), 'dd/MMM/yy'),
                    formatGstBillLabel(sale),
                    sale.subtotal.toFixed(2),
                    sale.discount.toFixed(2),
                    netAmount.toFixed(2),
                    taxableAmount.toFixed(2),
                    cgst.toFixed(2),
                    sgst.toFixed(2),
                    totalGst.toFixed(2),
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

            // Include Grand Total row directly in the table body
            const a = reportData.allSalesTotals;
            const totalTaxableAmount = a.taxableValue - a.totalTax; // Tax-exclusive amount
            const grandTotalRow = [
                'GRAND TOTAL',                          
                `${a.count} bills`,                     
                a.subtotal.toFixed(2),                  
                a.discount.toFixed(2),                   
                a.taxableValue.toFixed(2),              
                totalTaxableAmount.toFixed(2),         // New taxable amount column
                a.cgst.toFixed(2),                      
                a.sgst.toFixed(2),                      
                a.totalTax.toFixed(2),                  
                a.grandTotal.toFixed(2),                
                'All modes',                                     
            ];

            autoTable(doc, {
                startY: currentY,
                head: [saleColumns],
                body: [...sortedSales.map(mapSaleRow), grandTotalRow],
                theme: 'grid',
                styles: { fontSize: 8, cellPadding: 1 },
                headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold' },
                bodyStyles: { fillColor: [255, 255, 255] },
                // Style the last row (Grand Total) differently
                didParseCell: function (data: any) {
                    if (data.row.index === sortedSales.length) { // Last row is Grand Total
                        data.cell.styles.fontStyle = 'bold';
                        data.cell.styles.fillColor = [220, 220, 220];
                    }
                }
            });

            if (reportData.cancelledSales.length > 0) {
                const cancelledStartY = ((doc as any).lastAutoTable?.finalY || currentY) + 8;
                doc.setFontSize(11);
                doc.setFont('helvetica', 'bold');
                doc.text('CANCELLED INVOICES', 14, cancelledStartY);

                const cancelledColumns = ['Bill No', 'Date', 'Gross Amount', 'Discount', 'Amount', 'Status', 'Payment'];
                const cancelledBody = reportData.cancelledSales
                    .slice()
                    .sort((a, b) =>
                        sortBy === 'billNo'
                            ? compareBillNos(String(a.billNo), String(b.billNo))
                            : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                    )
                    .map((sale) => {
                        const pb = getPaymentBreakdown(sale);
                        const payModes: string[] = [];
                        if (pb.cash > 0) payModes.push('Cash');
                        if (pb.upi > 0) payModes.push('UPI');
                        if (pb.card > 0) payModes.push('Card');

                        return [
                            formatGstBillLabel(sale),
                            format(new Date(sale.createdAt), 'dd/MMM/yy'),
                            sale.subtotal.toFixed(2),
                            sale.discount.toFixed(2),
                            sale.grandTotal.toFixed(2),
                            sale.status,
                            payModes.join('+') || sale.paymentMethod,
                        ];
                    });

                autoTable(doc, {
                    startY: cancelledStartY + 4,
                    head: [cancelledColumns],
                    body: cancelledBody,
                    theme: 'grid',
                    styles: { fontSize: 8, cellPadding: 1 },
                    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold' },
                    bodyStyles: { fillColor: [255, 255, 255] },
                });

                const noteY = ((doc as any).lastAutoTable?.finalY || cancelledStartY) + 6;
                doc.setFontSize(9);
                doc.setFont('helvetica', 'italic');
                doc.text('Note: Cancelled invoices are excluded from GST calculations', 14, noteY);
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
            const summaryHeader = ['DATE', 'BILL FROM', 'BILL TO', 'BILLS', 'GROSS AMOUNT (incl. GST)', 'DISCOUNT', 'NET AMOUNT (incl. GST)', 'TAXABLE AMOUNT (excl. GST)', 'CGST', 'SGST', 'TOTAL GST', 'AMOUNT PAID', 'CASH', 'UPI', 'CARD'];

            const sortedSummaries = [...reportData.dailySummaries].sort((a, b) =>
                sortBy === 'billNo' ? compareBillNos(a.billFrom, b.billFrom) : a.date.localeCompare(b.date)
            );

            const data = [
                [shopSettings.shopName],
                [shopSettings.address.replace('\n', ', ')],
                [`Ph: ${shopSettings.phone}  |  GSTIN: ${shopSettings.gstin}`],
                [],
                [dateRange],
                [],
                ['DAILY SALES SUMMARY'],
                summaryHeader,
                ...sortedSummaries.map((d) => [
                    format(new Date(d.date), 'dd/MMM/yy'),
                    d.billFrom, d.billTo, d.billCount,
                    d.subtotal, d.discount, d.taxableValue,
                    (d.taxableValue - d.totalTax), // Tax-exclusive taxable amount
                    d.cgst, d.sgst, d.totalTax, d.grandTotal,
                    d.cash, d.upi, d.card,
                ]),
                ['GRAND TOTAL', '', '', a.count, a.subtotal, a.discount, a.taxableValue, (a.taxableValue - a.totalTax), a.cgst, a.sgst, a.totalTax, a.grandTotal, a.payment.cash, a.payment.upi, a.payment.card],
            ];

            const ws = XLSX.utils.aoa_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Daily Summary');

        } else {
            const header = ['DATE & TIME', 'BILL NO', 'CUSTOMER', 'GROSS AMOUNT (incl. GST)', 'DISCOUNT', 'NET AMOUNT (incl. GST)', 'TAXABLE AMOUNT (excl. GST)', 'CGST', 'SGST', 'TOTAL GST', 'AMOUNT PAID', 'PAYMENT'];

            const mapSaleExcel = (sale: SaleRow) => {
                const pb = getPaymentBreakdown(sale);
                const payModes: string[] = [];
                if (pb.cash > 0) payModes.push('Cash');
                if (pb.upi > 0) payModes.push('UPI');
                if (pb.card > 0) payModes.push('Card');

                const netAmount = sale.subtotal - sale.discount;
                const taxableAmount = parseFloat((netAmount / 1.05).toFixed(2));
                const totalGst = parseFloat((netAmount - taxableAmount).toFixed(2));
                const cgst = parseFloat((totalGst / 2).toFixed(2));
                const sgst = parseFloat((totalGst / 2).toFixed(2));

                return [
                    format(new Date(sale.createdAt), 'dd/MMM/yy HH:mm'),
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
                    payModes.join('+') || sale.paymentMethod,
                ];
            };

            const data = [
                [shopSettings.shopName],
                [shopSettings.address.replace('\n', ', ')],
                [`Ph: ${shopSettings.phone}  |  GSTIN: ${shopSettings.gstin}`],
                [],
                [dateRange],
                [],
                ['DETAILED INVOICE REPORT'],
                header,
                ...sortedSales.map(mapSaleExcel),
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

        // ── Items Detail sheet (all modes) ────────────────────────────────────
        const itemsHeader = [
            'BILL NO', 'INVOICE DATE', 'ACTUAL SALE DATE', 'CUSTOMER', 'PAYMENT METHOD',
            'PRODUCT', 'BARCODE', 'SKU', 'SIZE', 'COLOR',
            'QTY', 'MRP', 'SELLING PRICE', 'DISCOUNT',
            'TAX %', 'CGST AMT', 'SGST AMT', 'LINE TOTAL',
        ];

        const itemsData: any[] = [
            [shopSettings.shopName],
            [shopSettings.address.replace('\n', ', ')],
            [`Ph: ${shopSettings.phone}  |  GSTIN: ${shopSettings.gstin}`],
            [],
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
                    {reportData.exchangeReplacementTotals.count > 0 && (
                        <div className="card p-4 border-l-4 border-amber-500 bg-amber-50/40 dark:bg-amber-900/10">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm font-bold text-amber-800 dark:text-amber-300">Exchange Replacement Bills</p>
                                    <p className="text-xs text-amber-700/80 dark:text-amber-400/80">
                                        These bills stay visible in Sales History, but are excluded from the normal GST sales totals below.
                                    </p>
                                </div>
                                <div className="flex gap-6 text-sm">
                                    <div>
                                        <span className="text-xs text-amber-700/80 block">Bills</span>
                                        <span className="font-bold">{reportData.exchangeReplacementTotals.count}</span>
                                    </div>
                                    <div>
                                        <span className="text-xs text-amber-700/80 block">Taxable</span>
                                        <span className="font-bold">{formatIndianCurrency(reportData.exchangeReplacementTotals.taxableValue)}</span>
                                    </div>
                                    <div>
                                        <span className="text-xs text-amber-700/80 block">Grand Total</span>
                                        <span className="font-bold">{formatIndianCurrency(reportData.exchangeReplacementTotals.grandTotal)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

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

                    {reportType === 'summary' && reportData.cancelledSales.length > 0 && (
                        <div className="card">
                            <h4 className="font-bold mb-3">Cancelled Invoices</h4>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                                            <th className="text-left py-2 px-3">Bill No</th>
                                            <th className="text-left py-2 px-3">Date</th>
                                            <th className="text-right py-2 px-3">Gross Amount</th>
                                            <th className="text-right py-2 px-3">Discount</th>
                                            <th className="text-right py-2 px-3">Amount</th>
                                            <th className="text-center py-2 px-3">Status</th>
                                            <th className="text-center py-2 px-3">Payment</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reportData.cancelledSales
                                            .slice()
                                            .sort((a, b) =>
                                                sortBy === 'billNo'
                                                    ? compareBillNos(String(a.billNo), String(b.billNo))
                                                    : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                                            )
                                            .map((sale) => {
                                                const pb = getPaymentBreakdown(sale);
                                                const payModes: string[] = [];
                                                if (pb.cash > 0) payModes.push('Cash');
                                                if (pb.upi > 0) payModes.push('UPI');
                                                if (pb.card > 0) payModes.push('Card');

                                                return (
                                                    <tr key={sale.id} className="border-b dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                                        <td className="py-2 px-3 font-mono">{formatGstBillLabel(sale)}</td>
                                                        <td className="py-2 px-3">{format(new Date(sale.createdAt), 'dd/MMM/yy')}</td>
                                                        <td className="py-2 px-3 text-right">{formatIndianCurrency(sale.subtotal)}</td>
                                                        <td className="py-2 px-3 text-right text-red-500">{sale.discount > 0 ? `-${formatIndianCurrency(sale.discount)}` : '-'}</td>
                                                        <td className="py-2 px-3 text-right font-semibold">{formatIndianCurrency(sale.grandTotal)}</td>
                                                        <td className="py-2 px-3 text-center">
                                                            <span className="badge py-1 px-3 bg-red-100 text-red-800">
                                                                {sale.status}
                                                            </span>
                                                        </td>
                                                        <td className="py-2 px-3 text-center text-xs">{payModes.join('+') || sale.paymentMethod}</td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                </table>
                            </div>
                            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                                Note: Cancelled invoices are excluded from GST calculations
                            </p>
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
                                                        <td className="py-2 px-3 text-center font-mono">{formatGstBillLabel(sale)}</td>
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

                            {reportData.cancelledSales.length > 0 && (
                                <div className="card">
                                    <h4 className="font-bold mb-3">Cancelled Invoices</h4>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                                                    <th className="text-left py-2 px-3">Bill No</th>
                                                    <th className="text-left py-2 px-3">Date</th>
                                                    <th className="text-right py-2 px-3">Gross Amount</th>
                                                    <th className="text-right py-2 px-3">Discount</th>
                                                    <th className="text-right py-2 px-3">Amount</th>
                                                    <th className="text-center py-2 px-3">Status</th>
                                                    <th className="text-center py-2 px-3">Payment</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {reportData.cancelledSales
                                                    .slice()
                                                    .sort((a, b) =>
                                                        sortBy === 'billNo'
                                                            ? compareBillNos(String(a.billNo), String(b.billNo))
                                                            : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                                                    )
                                                    .map((sale) => {
                                                        const pb = getPaymentBreakdown(sale);
                                                        const payModes: string[] = [];
                                                        if (pb.cash > 0) payModes.push('Cash');
                                                        if (pb.upi > 0) payModes.push('UPI');
                                                        if (pb.card > 0) payModes.push('Card');

                                                        return (
                                                            <tr key={sale.id} className="border-b dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                                                <td className="py-2 px-3 font-mono">{formatGstBillLabel(sale)}</td>
                                                                <td className="py-2 px-3">{format(new Date(sale.createdAt), 'dd/MMM/yy')}</td>
                                                                <td className="py-2 px-3 text-right">{formatIndianCurrency(sale.subtotal)}</td>
                                                                <td className="py-2 px-3 text-right text-red-500">{sale.discount > 0 ? `-${formatIndianCurrency(sale.discount)}` : '-'}</td>
                                                                <td className="py-2 px-3 text-right font-semibold">{formatIndianCurrency(sale.grandTotal)}</td>
                                                                <td className="py-2 px-3 text-center">
                                                                    <span className="badge py-1 px-3 bg-red-100 text-red-800">
                                                                        {sale.status}
                                                                    </span>
                                                                </td>
                                                                <td className="py-2 px-3 text-center text-xs">{payModes.join('+') || sale.paymentMethod}</td>
                                                            </tr>
                                                        );
                                                    })}
                                            </tbody>
                                        </table>
                                    </div>
                                    <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                                        Note: Cancelled invoices are excluded from GST calculations
                                    </p>
                                </div>
                            )}
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
