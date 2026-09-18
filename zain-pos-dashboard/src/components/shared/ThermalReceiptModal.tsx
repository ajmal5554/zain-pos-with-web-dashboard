import React, { useRef } from 'react';
import { Printer, Copy, Check, X, Download, Share2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { formatCurrency } from '@/lib/format';
import type { Invoice } from '@/features/invoices/services/invoice.service';

interface ThermalReceiptModalProps {
    invoice: Invoice | null;
    open: boolean;
    onClose: () => void;
    loading?: boolean;
}

export function ThermalReceiptModal({ invoice, open, onClose, loading }: ThermalReceiptModalProps) {
    const [copied, setCopied] = React.useState(false);
    const receiptRef = useRef<HTMLDivElement>(null);

    if (!open || !invoice) return null;

    const handleCopy = () => {
        if (!invoice?.billNo) return;
        navigator.clipboard.writeText(String(invoice.billNo));
        setCopied(true);
        toast.success(`Bill #${invoice.billNo} copied to clipboard!`);
        setTimeout(() => setCopied(false), 2000);
    };

    const handlePrint = () => {
        window.print();
    };

    // Calculate amounts and taxes with fallback if not present
    const rawTotal = Number(invoice.total || 0);
    const rawSubtotal = Number(invoice.subtotal ?? rawTotal);
    const rawDiscount = Number(invoice.discount ?? 0);
    const rawTaxAmount = Number(invoice.taxAmount ?? (rawTotal * 0.05));
    const rawCgst = Number(invoice.cgst ?? (rawTaxAmount / 2));
    const rawSgst = Number(invoice.sgst ?? (rawTaxAmount / 2));
    const taxableAmount = Math.max(0, (rawSubtotal - rawDiscount) - (rawCgst + rawSgst));
    const rawPaid = Number(invoice.paidAmount ?? rawTotal);
    const rawChange = Number(invoice.changeAmount ?? 0);

    const invoiceDate = invoice.createdAt ? new Date(invoice.createdAt) : new Date();
    const formattedDate = invoiceDate.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    const formattedTime = invoiceDate.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    const items = invoice.items || [];
    const totalQty = items.reduce((sum, it) => sum + (it.quantity || 1), 0);
    const itemCount = invoice.itemCount || items.length || 1;

    // Generate deterministic barcode bars from the billNo string
    const billStr = String(invoice.billNo || '0000');
    const barcodeBars = Array.from(billStr).flatMap((char, i) => {
        const code = char.charCodeAt(0);
        return [
            (code % 3) + 1,
            ((code >> 1) % 2) + 1,
            ((code >> 2) % 4) + 1,
            1,
            ((code >> 3) % 3) + 1,
            1
        ];
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
            {/* Top Toolbar (Non-printable) */}
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-slate-900/90 text-white px-4 py-2 rounded-full shadow-xl border border-slate-700/60 backdrop-blur-md print:hidden">
                <span className="text-xs font-mono font-medium text-slate-300 hidden sm:inline">
                    Thermal Receipt #{invoice.billNo}
                </span>
                <span className="text-slate-500 hidden sm:inline">|</span>
                <button
                    onClick={handlePrint}
                    className="flex items-center gap-1.5 px-3 py-1 bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold rounded-full transition-colors shadow-sm"
                >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print Bill</span>
                </button>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-full transition-colors"
                    title="Copy Bill Number"
                >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy #'}</span>
                </button>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors ml-1"
                    aria-label="Close receipt"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Click backdrop to close */}
            <div className="fixed inset-0 -z-10" onClick={onClose} />

            {/* Thermal Receipt Outer Paper Container with Realistic Tear Edges and Drop-Shadow */}
            <div
                ref={receiptRef}
                id="thermal-receipt-printable"
                className="relative w-full max-w-[370px] sm:max-w-[390px] my-auto pt-14 pb-8 transition-all"
                style={{
                    filter: 'drop-shadow(0 20px 30px rgba(0,0,0,0.5)) drop-shadow(0 4px 8px rgba(0,0,0,0.2))'
                }}
            >
                {/* TOP SERRATED TEAR EDGE */}
                <div className="w-full h-3 select-none -mb-[1px] relative overflow-hidden receipt-tear-edge">
                    <svg className="w-full h-full block" preserveAspectRatio="none">
                        <defs>
                            <pattern id="thermal-tear-top" width="14" height="12" patternUnits="userSpaceOnUse">
                                <polygon points="0,12 7,0 14,12" fill="#faf8f2" />
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#thermal-tear-top)" />
                    </svg>
                </div>

                {/* THERMAL PAPER BODY */}
                <div className="bg-gradient-to-b from-[#fbf9f4] via-[#faf8f2] to-[#f7f4ec] text-[#1c1917] font-mono px-5 sm:px-6 py-4 shadow-inner text-[12px] sm:text-[13px] leading-tight selection:bg-amber-200 selection:text-neutral-900">
                    
                    {/* Header */}
                    <div className="text-center space-y-1">
                        <p className="text-[10px] sm:text-[11px] font-bold tracking-[0.25em] uppercase text-neutral-600">
                            *** TAX INVOICE ***
                        </p>
                        <h2 className="text-xl sm:text-2xl font-black tracking-wider uppercase text-neutral-950 pt-0.5">
                            ZAIN GENTS PALACE
                        </h2>
                        <p className="text-[11px] text-neutral-700 font-medium">
                            Opp. Town Hall, Main Road, Calicut
                        </p>
                        <p className="text-[11px] text-neutral-700">
                            Ph: +91 98765 43210 &bull; GSTIN: 32AABCU9603R1ZM
                        </p>
                    </div>

                    {/* Perforated Divider */}
                    <div className="border-t-2 border-dashed border-neutral-400 my-3" />

                    {/* Bill Info Grid */}
                    <div className="space-y-1 text-[11px] sm:text-[12px]">
                        <div className="flex justify-between items-baseline font-bold">
                            <span>BILL NO: #{invoice.billNo}</span>
                            <span>DATE: {formattedDate}</span>
                        </div>
                        <div className="flex justify-between items-baseline text-neutral-700">
                            <span>TIME: {formattedTime}</span>
                            <span>CASHIER: {invoice.cashierName || 'Staff'}</span>
                        </div>
                        <div className="flex justify-between items-baseline pt-1">
                            <span className="font-semibold truncate max-w-[200px]">
                                CUST: {invoice.customer.name}
                            </span>
                            {invoice.customer.phone && invoice.customer.phone !== 'N/A' && (
                                <span className="text-neutral-600 font-normal">
                                    {invoice.customer.phone}
                                </span>
                            )}
                        </div>
                        <div className="flex justify-between items-center pt-0.5">
                            <span className="text-neutral-600">PAY MODE: {invoice.paymentMethod || 'CASH'}</span>
                            <span className="px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-neutral-200 text-neutral-800 rounded">
                                {invoice.status || 'PAID'}
                            </span>
                        </div>
                    </div>

                    {/* Perforated Divider */}
                    <div className="border-t-2 border-dashed border-neutral-400 my-3" />

                    {/* Items Table */}
                    <div>
                        {/* Table Header */}
                        <div className="grid grid-cols-12 text-[11px] font-bold text-neutral-800 pb-1 border-b border-dashed border-neutral-400">
                            <span className="col-span-1 text-left">#</span>
                            <span className="col-span-6 text-left">ITEM</span>
                            <span className="col-span-2 text-center">QTY</span>
                            <span className="col-span-3 text-right">TOTAL</span>
                        </div>

                        {/* Items Rows */}
                        <div className="py-1 divide-y divide-dotted divide-neutral-300">
                            {loading ? (
                                <div className="py-6 text-center text-neutral-500 italic animate-pulse">
                                    Printing bill items...
                                </div>
                            ) : items.length > 0 ? (
                                items.map((item, idx) => {
                                    const itemPrice = Number(item.sellingPrice || 0);
                                    const itemQty = Number(item.quantity || 1);
                                    const itemTotal = Number(item.total ?? (itemPrice * itemQty));
                                    return (
                                        <div key={idx} className="grid grid-cols-12 py-1.5 items-baseline text-[11.5px] sm:text-[12px]">
                                            <span className="col-span-1 text-neutral-600">{idx + 1}</span>
                                            <div className="col-span-6 pr-1">
                                                <p className="font-semibold text-neutral-900 leading-snug break-words">
                                                    {item.product.name}
                                                </p>
                                                <p className="text-[10px] text-neutral-600 font-normal">
                                                    @{formatCurrency(itemPrice)}
                                                    {item.discount && item.discount > 0 ? ` (off ₹${item.discount})` : ''}
                                                </p>
                                            </div>
                                            <span className="col-span-2 text-center font-medium">
                                                {itemQty}
                                            </span>
                                            <span className="col-span-3 text-right font-bold text-neutral-950">
                                                {formatCurrency(itemTotal)}
                                            </span>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="py-2 text-center text-neutral-600 italic">
                                    General Merchandise / Counter Sale
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Perforated Divider */}
                    <div className="border-t-2 border-dashed border-neutral-400 my-2.5" />

                    {/* Totals & Tax Calculation Breakdown */}
                    <div className="space-y-1 text-[11.5px] sm:text-[12px]">
                        <div className="flex justify-between text-neutral-700">
                            <span>Total Items: {itemCount}</span>
                            <span>Total Qty: {totalQty}</span>
                        </div>
                        <div className="flex justify-between text-neutral-800">
                            <span>Gross Subtotal:</span>
                            <span>{formatCurrency(rawSubtotal)}</span>
                        </div>
                        {rawDiscount > 0 && (
                            <div className="flex justify-between text-emerald-700 font-medium">
                                <span>Discount:</span>
                                <span>-{formatCurrency(rawDiscount)}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-neutral-600 text-[11px]">
                            <span>Taxable Value:</span>
                            <span>{formatCurrency(taxableAmount)}</span>
                        </div>
                        <div className="flex justify-between text-neutral-600 text-[11px]">
                            <span>CGST @ 2.5%:</span>
                            <span>{formatCurrency(rawCgst)}</span>
                        </div>
                        <div className="flex justify-between text-neutral-600 text-[11px]">
                            <span>SGST @ 2.5%:</span>
                            <span>{formatCurrency(rawSgst)}</span>
                        </div>

                        {/* GRAND TOTAL BOX */}
                        <div className="border-y-2 border-dashed border-neutral-950 py-2 my-2 flex justify-between items-baseline font-black">
                            <span className="text-sm sm:text-base tracking-wider uppercase">GRAND TOTAL</span>
                            <span className="text-base sm:text-lg text-neutral-950">{formatCurrency(rawTotal)}</span>
                        </div>

                        {/* Payment Breakdown */}
                        <div className="flex justify-between text-neutral-700 text-[11px] pt-0.5">
                            <span>Paid ({invoice.paymentMethod || 'CASH'}):</span>
                            <span className="font-semibold text-neutral-900">{formatCurrency(rawPaid)}</span>
                        </div>
                        {rawChange > 0 && (
                            <div className="flex justify-between text-neutral-700 text-[11px]">
                                <span>Change Returned:</span>
                                <span className="font-semibold text-neutral-900">{formatCurrency(rawChange)}</span>
                            </div>
                        )}
                    </div>

                    {/* Perforated Divider */}
                    <div className="border-t-2 border-dashed border-neutral-400 my-3" />

                    {/* Barcode Section */}
                    <div className="flex flex-col items-center justify-center my-2 select-none">
                        <div className="flex items-center gap-[2px] h-9 max-w-[200px] overflow-hidden">
                            {barcodeBars.map((width, i) => (
                                <span
                                    key={i}
                                    className="h-full bg-neutral-900 block"
                                    style={{ width: `${Math.max(1, width)}px` }}
                                />
                            ))}
                        </div>
                        <p className="text-[11px] tracking-[0.35em] text-neutral-700 font-mono mt-1 font-semibold">
                            * {invoice.billNo} *
                        </p>
                    </div>

                    {/* Perforated Divider */}
                    <div className="border-t-2 border-dashed border-neutral-400 my-2.5" />

                    {/* Footer Messages */}
                    <div className="text-center text-[10px] sm:text-[10.5px] text-neutral-600 space-y-1">
                        <p className="font-bold text-neutral-800 tracking-wider">
                            *** THANK YOU! VISIT AGAIN ***
                        </p>
                        <p>Goods once sold can be exchanged within 7 days.</p>
                        <p>Please bring this original bill for any exchange.</p>
                        <p className="pt-1.5 text-[9px] text-neutral-500 tracking-widest uppercase">
                            -- POWERED BY ZAIN POS --
                        </p>
                    </div>
                </div>

                {/* BOTTOM SERRATED TEAR EDGE */}
                <div className="w-full h-3 select-none -mt-[1px] relative overflow-hidden receipt-tear-edge">
                    <svg className="w-full h-full block" preserveAspectRatio="none">
                        <defs>
                            <pattern id="thermal-tear-bottom" width="14" height="12" patternUnits="userSpaceOnUse">
                                <polygon points="0,0 7,12 14,0" fill="#f7f4ec" />
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#thermal-tear-bottom)" />
                    </svg>
                </div>
            </div>

            {/* Embedded Print Styling */}
            <style>{`
                @media print {
                    /* Hide whole application UI */
                    body * {
                        visibility: hidden !important;
                    }
                    /* Show only the thermal receipt */
                    #thermal-receipt-printable, #thermal-receipt-printable * {
                        visibility: visible !important;
                    }
                    #thermal-receipt-printable {
                        position: absolute !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 78mm !important;
                        max-width: 78mm !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        background: #ffffff !important;
                        filter: none !important;
                        box-shadow: none !important;
                    }
                    .receipt-tear-edge {
                        display: none !important;
                    }
                    @page {
                        size: auto;
                        margin: 0mm;
                    }
                }
            `}</style>
        </div>
    );
}
