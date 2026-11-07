import React, { useState } from 'react';
import { Printer, Sparkles, Check, Copy } from 'lucide-react';
import { Button } from '../ui/Button';
import { showToast } from '../ui/Toast';

interface LiveReceiptSimulatorProps {
    shopSettings: {
        shopName: string;
        address: string;
        phone: string;
        gstin: string;
        email?: string;
        logo?: string;
    };
    paymentMethods: Record<string, boolean>;
    printerSettings?: {
        pageSize?: string;
        fontFamily?: string;
        showPaidLine?: boolean;
        showChangeLine?: boolean;
        showRate?: boolean;
        showRateSubline?: boolean;
    };
    onTestPrint?: () => void;
}

export const LiveReceiptSimulator: React.FC<LiveReceiptSimulatorProps> = ({
    shopSettings,
    paymentMethods,
    printerSettings,
    onTestPrint,
}) => {
    const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>(() =>
        printerSettings?.pageSize === '58mm' ? '58mm' : '80mm'
    );
    const [copied, setCopied] = useState(false);

    const is80mm = paperWidth === '80mm';
    const showRate = printerSettings?.showRate !== false;
    const showRateSubline = printerSettings?.showRateSubline !== false;
    const showPaidLine = printerSettings?.showPaidLine !== false;
    const showChangeLine = printerSettings?.showChangeLine !== false;

    // Determine primary payment method to show on receipt based on enabled options
    const activePaymentMethod = (() => {
        if (paymentMethods.CASH !== false) return 'CASH';
        if (paymentMethods.UPI !== false) return 'UPI';
        if (paymentMethods.CARD !== false) return 'CARD';
        return 'CASH';
    })();

    const handleCopyText = () => {
        const lines = [
            '================================',
            shopSettings.shopName || 'ZAIN GENTS PALACE',
            shopSettings.address || 'CHIRAMMAL TOWER, BEHIND CANARA BANK\nRAJA ROAD, NILESHWAR',
            shopSettings.phone ? `Ph: ${shopSettings.phone}` : '',
            shopSettings.gstin ? `GSTIN: ${shopSettings.gstin}` : '',
            '================================',
            'TAX INVOICE / CASH BILL',
            'Bill No: #2248  |  02-Nov-2026',
            '--------------------------------',
            '1. Cotton Shirt (L)  2 x 750 = 1,500.00',
            '2. Denim Jeans (32)  1 x 1000 = 1,000.00',
            '--------------------------------',
            'Subtotal:     ₹2,380.95',
            'CGST (2.5%):     ₹59.52',
            'SGST (2.5%):     ₹59.52',
            'TOTAL:        ₹2,500.00',
            `PAID BY ${activePaymentMethod}: ₹2,500.00`,
            '================================',
            'Thank you! Visit again.',
        ].filter(Boolean).join('\n');

        navigator.clipboard.writeText(lines).then(() => {
            setCopied(true);
            showToast('Receipt text copied to clipboard', 'success');
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-5 sm:p-6 shadow-xs flex flex-col h-full space-y-4">
            {/* Top Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 dark:border-dark-border pb-4">
                <div className="flex items-center gap-2.5">
                    <div className="relative flex items-center justify-center">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping absolute opacity-75" />
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 relative" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            Live Thermal Receipt
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                Real-time
                            </span>
                        </h3>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            Re-renders instantly as you type shop details or toggle methods.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                    {/* Paper Width Toggle */}
                    <div className="inline-flex rounded-lg p-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold">
                        <button
                            type="button"
                            onClick={() => setPaperWidth('80mm')}
                            className={`px-2.5 py-1 rounded-md transition-all ${
                                is80mm
                                    ? 'bg-white dark:bg-dark-card text-gray-900 dark:text-white shadow-2xs'
                                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400'
                            }`}
                        >
                            80mm (3&quot;)
                        </button>
                        <button
                            type="button"
                            onClick={() => setPaperWidth('58mm')}
                            className={`px-2.5 py-1 rounded-md transition-all ${
                                !is80mm
                                    ? 'bg-white dark:bg-dark-card text-gray-900 dark:text-white shadow-2xs'
                                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400'
                            }`}
                        >
                            58mm (2&quot;)
                        </button>
                    </div>

                    {/* Copy Text */}
                    <button
                        type="button"
                        onClick={handleCopyText}
                        className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-800 dark:text-gray-400 transition-colors"
                        title="Copy receipt plain text"
                        aria-label="Copy receipt text"
                    >
                        {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>

                    {/* Test Print */}
                    {onTestPrint && (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={onTestPrint}
                            className="text-xs px-2.5 py-1 h-8 flex items-center gap-1.5"
                        >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Print</span>
                        </Button>
                    )}
                </div>
            </div>

            {/* Workbench Simulator Area */}
            <div className="flex-1 bg-gradient-to-b from-gray-100 to-gray-200/80 dark:from-gray-900/70 dark:to-gray-950/90 rounded-2xl p-6 sm:p-8 flex justify-center items-start min-h-[580px] overflow-y-auto border border-gray-200/80 dark:border-gray-800 shadow-inner">
                {/* Physical Thermal Receipt Slip */}
                <div
                    className={`relative bg-white text-gray-950 transition-all duration-300 shadow-2xl rounded-sm font-mono text-[11px] leading-tight select-text my-2 ${
                        is80mm ? 'w-[320px] px-5 py-6' : 'w-[250px] px-3.5 py-5'
                    }`}
                    style={{
                        boxShadow: '0 10px 30px -5px rgba(0, 0, 0, 0.15), 0 4px 10px -2px rgba(0, 0, 0, 0.08)',
                    }}
                >
                    {/* Top Serrated Tear Edge */}
                    <div
                        className="absolute -top-2 left-0 right-0 h-2 w-full overflow-hidden"
                        style={{
                            background:
                                'radial-gradient(circle, transparent, transparent 3.5px, #ffffff 4px, #ffffff)',
                            backgroundSize: '8px 8px',
                            backgroundPosition: '0 4px',
                        }}
                    />

                    {/* 1. Official Logo or Stylized Header */}
                    {shopSettings.logo ? (
                        <div className="w-20 h-14 mx-auto mb-2.5 flex items-center justify-center">
                            <img
                                src={shopSettings.logo}
                                alt="Shop Logo"
                                className="max-h-full max-w-full object-contain filter grayscale contrast-125"
                            />
                        </div>
                    ) : (
                        <div className="w-9 h-9 mx-auto mb-1.5 rounded bg-gray-900 text-white flex items-center justify-center font-black text-xs tracking-wider">
                            ZAIN
                        </div>
                    )}

                    {/* 2. Shop Title */}
                    <h2 className="font-extrabold text-sm sm:text-base text-center uppercase tracking-wider text-gray-950">
                        {shopSettings.shopName || 'ZAIN GENTS PALACE'}
                    </h2>

                    {/* 3. Shop Address */}
                    <p className="text-[10.5px] text-center whitespace-pre-line mt-1 text-gray-700 leading-tight">
                        {shopSettings.address || 'CHIRAMMAL TOWER, BEHIND CANARA BANK\nRAJA ROAD, NILESHWAR'}
                    </p>

                    {/* 4. Contact Numbers */}
                    {shopSettings.phone && (
                        <p className="text-[10.5px] text-center text-gray-700 mt-0.5">
                            Ph: {shopSettings.phone}
                        </p>
                    )}

                    {/* 5. GSTIN Badge */}
                    {shopSettings.gstin && (
                        <p className="text-[10.5px] font-bold text-center text-gray-900 mt-0.5">
                            GSTIN: {shopSettings.gstin}
                        </p>
                    )}

                    {/* Receipt Title Banner */}
                    <div className="text-center font-bold text-[10px] tracking-widest my-2.5 border-y border-dashed border-gray-400 py-1 uppercase text-gray-800">
                        Retail Tax Invoice / Cash Bill
                    </div>

                    {/* Bill Info Grid */}
                    <div className="space-y-0.5 text-[10px] text-gray-700">
                        <div className="flex justify-between">
                            <span className="font-bold text-gray-900">Bill No: #2248</span>
                            <span>Date: 02-Nov-2026</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Cashier: Staff</span>
                            <span>Time: 02:45 PM</span>
                        </div>
                        <div className="text-gray-900 font-medium pt-0.5">
                            Customer: Walk-in Customer
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-dashed border-gray-400 my-2" />

                    {/* Itemized Table */}
                    <table className="w-full text-left text-[10.5px]">
                        <thead>
                            <tr className="border-b border-dashed border-gray-400 text-gray-600 font-bold uppercase text-[9.5px]">
                                <th className="pb-1">Item</th>
                                {showRate && <th className="pb-1 text-right">Rate</th>}
                                <th className="pb-1 text-center">Qty</th>
                                <th className="pb-1 text-right">Amt</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            <tr className="align-top">
                                <td className="py-1 pr-1 font-medium">
                                    Cotton Formal Shirt (L)
                                    {showRateSubline && (
                                        <div className="text-[9px] text-gray-500 font-normal">
                                            2 @ ₹750.00
                                        </div>
                                    )}
                                </td>
                                {showRate && <td className="py-1 text-right">750.00</td>}
                                <td className="py-1 text-center font-semibold">2</td>
                                <td className="py-1 text-right font-bold">1,500.00</td>
                            </tr>
                            <tr className="align-top">
                                <td className="py-1 pr-1 font-medium">
                                    Stretch Slim Pant (32)
                                </td>
                                {showRate && <td className="py-1 text-right">1,000.00</td>}
                                <td className="py-1 text-center font-semibold">1</td>
                                <td className="py-1 text-right font-bold">1,000.00</td>
                            </tr>
                        </tbody>
                    </table>

                    {/* Divider */}
                    <div className="border-t border-dashed border-gray-400 my-2" />

                    {/* Totals & Tax Calculation */}
                    <div className="space-y-1 text-[10.5px]">
                        <div className="flex justify-between text-gray-700">
                            <span>Total Items / Qty:</span>
                            <span className="font-bold text-gray-900">2 Items (3 Pcs)</span>
                        </div>
                        <div className="flex justify-between text-gray-700">
                            <span>Sub Total:</span>
                            <span>₹2,380.95</span>
                        </div>
                        <div className="flex justify-between text-gray-600 text-[10px]">
                            <span>CGST @ 2.5%:</span>
                            <span>₹59.52</span>
                        </div>
                        <div className="flex justify-between text-gray-600 text-[10px]">
                            <span>SGST @ 2.5%:</span>
                            <span>₹59.52</span>
                        </div>

                        {/* Grand Total */}
                        <div className="border-y-2 border-dashed border-gray-900 py-1.5 my-1.5 flex justify-between items-baseline font-black text-xs sm:text-sm text-gray-950">
                            <span>NET AMOUNT:</span>
                            <span>₹2,500.00</span>
                        </div>

                        {/* Payment Method Line (Reacts dynamically to settings!) */}
                        {showPaidLine && (
                            <div className="pt-0.5 space-y-0.5 text-[10px]">
                                <div className="flex justify-between text-gray-900 font-bold">
                                    <span>PAID BY {activePaymentMethod}:</span>
                                    <span>₹2,500.00</span>
                                </div>
                                {paymentMethods.SPLIT !== false && (
                                    <div className="text-[9px] text-gray-500 italic">
                                        (Supports Split: Cash + UPI + Card)
                                    </div>
                                )}
                            </div>
                        )}

                        {showChangeLine && (
                            <div className="flex justify-between text-gray-600 text-[10px]">
                                <span>Change Returned:</span>
                                <span>₹0.00</span>
                            </div>
                        )}
                    </div>

                    {/* Divider */}
                    <div className="border-t border-dashed border-gray-400 my-2.5" />

                    {/* Footer Notice */}
                    <div className="text-center space-y-1 text-[10px] text-gray-700">
                        <p className="font-bold text-gray-900">*** THANK YOU! VISIT AGAIN ***</p>
                        <p className="text-[9.5px] leading-tight text-gray-500">
                            Exchange within 7 days with original bill and intact tags.
                        </p>
                    </div>

                    {/* Realistic Barcode Graphic */}
                    <div className="mt-3 pt-1 text-center">
                        <svg
                            className="w-40 sm:w-48 h-8 mx-auto"
                            viewBox="0 0 160 30"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <rect x="0" y="0" width="2" height="30" fill="#000" />
                            <rect x="4" y="0" width="1" height="30" fill="#000" />
                            <rect x="7" y="0" width="3" height="30" fill="#000" />
                            <rect x="12" y="0" width="1" height="30" fill="#000" />
                            <rect x="15" y="0" width="2" height="30" fill="#000" />
                            <rect x="19" y="0" width="4" height="30" fill="#000" />
                            <rect x="25" y="0" width="1" height="30" fill="#000" />
                            <rect x="28" y="0" width="3" height="30" fill="#000" />
                            <rect x="33" y="0" width="2" height="30" fill="#000" />
                            <rect x="37" y="0" width="1" height="30" fill="#000" />
                            <rect x="40" y="0" width="3" height="30" fill="#000" />
                            <rect x="45" y="0" width="2" height="30" fill="#000" />
                            <rect x="49" y="0" width="1" height="30" fill="#000" />
                            <rect x="52" y="0" width="4" height="30" fill="#000" />
                            <rect x="58" y="0" width="2" height="30" fill="#000" />
                            <rect x="62" y="0" width="1" height="30" fill="#000" />
                            <rect x="65" y="0" width="3" height="30" fill="#000" />
                            <rect x="70" y="0" width="2" height="30" fill="#000" />
                            <rect x="74" y="0" width="1" height="30" fill="#000" />
                            <rect x="77" y="0" width="3" height="30" fill="#000" />
                            <rect x="82" y="0" width="2" height="30" fill="#000" />
                            <rect x="86" y="0" width="4" height="30" fill="#000" />
                            <rect x="92" y="0" width="1" height="30" fill="#000" />
                            <rect x="95" y="0" width="3" height="30" fill="#000" />
                            <rect x="100" y="0" width="2" height="30" fill="#000" />
                            <rect x="104" y="0" width="1" height="30" fill="#000" />
                            <rect x="107" y="0" width="4" height="30" fill="#000" />
                            <rect x="113" y="0" width="2" height="30" fill="#000" />
                            <rect x="117" y="0" width="1" height="30" fill="#000" />
                            <rect x="120" y="0" width="3" height="30" fill="#000" />
                            <rect x="125" y="0" width="2" height="30" fill="#000" />
                            <rect x="129" y="0" width="4" height="30" fill="#000" />
                            <rect x="135" y="0" width="1" height="30" fill="#000" />
                            <rect x="138" y="0" width="3" height="30" fill="#000" />
                            <rect x="143" y="0" width="2" height="30" fill="#000" />
                            <rect x="147" y="0" width="1" height="30" fill="#000" />
                            <rect x="150" y="0" width="3" height="30" fill="#000" />
                            <rect x="155" y="0" width="2" height="30" fill="#000" />
                            <rect x="158" y="0" width="2" height="30" fill="#000" />
                        </svg>
                        <p className="text-[9px] tracking-widest text-gray-500 font-mono mt-0.5">
                            * 2 2 4 8 *
                        </p>
                    </div>

                    {/* Bottom Serrated Tear Edge */}
                    <div
                        className="absolute -bottom-2 left-0 right-0 h-2 w-full overflow-hidden"
                        style={{
                            background:
                                'radial-gradient(circle, transparent, transparent 3.5px, #ffffff 4px, #ffffff)',
                            backgroundSize: '8px 8px',
                            backgroundPosition: '0 0',
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

