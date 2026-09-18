import React, { useEffect, useState, useMemo } from 'react';
import { Printer, Copy, Check, X, RotateCcw } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { Invoice } from '@/features/invoices/services/invoice.service';
import {
  DEFAULT_RECEIPT_LAYOUT,
  DEFAULT_RECEIPT_PRINTER_CONFIG,
  generateReceiptInnerHtml,
  type ReceiptBlock,
  type ReceiptData,
  type ReceiptPrinterConfig
} from '@/services/print.service';
import { adminService } from '@/features/admin/services/admin.service';

interface ThermalReceiptModalProps {
  invoice: Invoice | null;
  open: boolean;
  onClose: () => void;
  loading?: boolean;
}

const DEFAULT_SHOP_DETAILS = {
  shopName: 'ZAIN GENTS PALACE',
  address: 'CHIRAMMAL TOWER, BEHIND CANARA BANK\nRAJA ROAD, NILESHWAR',
  phone: '9037106449, 7907026827',
  gstin: '32PVGPS0686J1ZV'
};

export function ThermalReceiptModal({ invoice, open, onClose, loading }: ThermalReceiptModalProps) {
  const [copied, setCopied] = useState(false);
  const [blocks, setBlocks] = useState<ReceiptBlock[]>(DEFAULT_RECEIPT_LAYOUT);
  const [printerConfig, setPrinterConfig] = useState<ReceiptPrinterConfig>(DEFAULT_RECEIPT_PRINTER_CONFIG);
  const [shopDetails, setShopDetails] = useState(DEFAULT_SHOP_DETAILS);
  const [printKey, setPrintKey] = useState(0);
  const [isPrinting, setIsPrinting] = useState(true);

  // Trigger printer feed animation when opening or replaying
  useEffect(() => {
    if (open) {
      setIsPrinting(true);
      const timer = setTimeout(() => setIsPrinting(false), 1400);
      return () => clearTimeout(timer);
    }
  }, [open, printKey]);

  // Fetch store configuration from admin settings if available
  useEffect(() => {
    if (!open) return;

    adminService.getSettings(['RECEIPT_LAYOUT', 'SHOP_SETTINGS', 'PRINTER_CONFIG'])
      .then((settings) => {
        const layoutSetting = settings.find((s) => s.key === 'RECEIPT_LAYOUT');
        if (layoutSetting?.value) {
          try {
            const parsed = JSON.parse(layoutSetting.value);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setBlocks(parsed);
            }
          } catch { }
        }

        const shopSetting = settings.find((s) => s.key === 'SHOP_SETTINGS');
        if (shopSetting?.value) {
          try {
            const parsed = JSON.parse(shopSetting.value);
            if (parsed && typeof parsed === 'object') {
              setShopDetails((prev) => ({
                ...prev,
                shopName: parsed.shopName || parsed.name || prev.shopName,
                address: parsed.address || parsed.branch || prev.address,
                phone: parsed.phone || parsed.supportPhone || prev.phone,
                gstin: parsed.gstin || prev.gstin
              }));
            }
          } catch { }
        }

        const printerSetting = settings.find((s) => s.key === 'PRINTER_CONFIG');
        if (printerSetting?.value) {
          try {
            const parsed = JSON.parse(printerSetting.value);
            if (parsed && typeof parsed === 'object') {
              setPrinterConfig((prev) => ({ ...prev, ...parsed }));
            }
          } catch { }
        }
      })
      .catch(() => { });
  }, [open]);

  const handleCopy = () => {
    if (!invoice?.billNo) return;
    navigator.clipboard.writeText(String(invoice.billNo));
    setCopied(true);
    toast.success(`Bill #${invoice.billNo} copied!`);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleReplay = () => {
    setPrintKey((prev) => prev + 1);
  };

  // Convert Invoice to POS ReceiptData (excluding any logo)
  const receiptData: ReceiptData | null = useMemo(() => {
    if (!invoice) return null;

    const rawTotal = Number(invoice.total || 0);
    const rawSubtotal = Number(invoice.subtotal ?? rawTotal);
    const rawDiscount = Number(invoice.discount ?? 0);
    const rawTaxAmount = Number(invoice.taxAmount ?? (rawTotal * 0.05));
    const rawCgst = Number(invoice.cgst ?? (rawTaxAmount / 2));
    const rawSgst = Number(invoice.sgst ?? (rawTaxAmount / 2));

    const invoiceItems = (invoice.items || []).map((item: any) => ({
      name: item.product?.name || item.productName || item.name || 'Item',
      variantInfo: item.variantInfo,
      quantity: Number(item.quantity || 1),
      mrp: Number(item.mrp || 0),
      rate: Number(item.sellingPrice || item.rate || 0),
      discount: Number(item.discount || 0),
      taxRate: Number(item.taxRate || 0),
      total: Number(item.total ?? (item.sellingPrice * item.quantity - (item.discount || 0)))
    }));

    return {
      billNo: invoice.billNo,
      date: invoice.createdAt ? new Date(invoice.createdAt) : new Date(),
      shopName: shopDetails.shopName,
      shopAddress: shopDetails.address,
      shopPhone: shopDetails.phone,
      gstin: shopDetails.gstin,
      logo: '', // Explicitly no logo as requested
      customerName: invoice.customer?.name || 'Walk-in Customer',
      items: invoiceItems,
      subtotal: rawSubtotal,
      discount: rawDiscount,
      cgst: rawCgst,
      sgst: rawSgst,
      grandTotal: rawTotal,
      paymentMethod: invoice.paymentMethod || 'CASH',
      paidAmount: Number(invoice.paidAmount ?? rawTotal),
      changeAmount: Number(invoice.changeAmount ?? 0),
      payments: (invoice.payments || []).map((p: any) => ({
        paymentMode: p.paymentMode,
        amount: Number(p.amount || 0)
      })),
      userName: invoice.cashierName || 'Staff',
      isReplacementBill: (invoice as any).isReplacementBill,
      originalBillNo: (invoice as any).originalBillNo,
      exchangeCreditAmount: (invoice as any).exchangeCreditAmount
    };
  }, [invoice, shopDetails]);

  if (!open || !invoice || !receiptData) return null;

  // Filter out any logo block completely
  const filteredBlocks = blocks.filter((b) => b.type !== 'logo');
  const receiptInnerHtml = generateReceiptInnerHtml(receiptData, filteredBlocks, printerConfig);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-3 sm:p-6 overflow-y-auto bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Top Floating Action Toolbar (Non-printable) */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 sm:gap-2 bg-slate-900/95 text-white px-3.5 py-2 rounded-full shadow-2xl border border-slate-700/70 backdrop-blur-md print:hidden">
        <span className="text-xs font-mono font-medium text-slate-300 hidden sm:inline mr-1">
          Bill #{invoice.billNo}
        </span>
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-500 hover:bg-sky-600 active:scale-95 text-white text-xs font-semibold rounded-full transition-all shadow-sm"
          title="Print to thermal roll"
        >
          <Printer className="w-3.5 h-3.5" />
          <span>Print Bill</span>
        </button>
        <button
          onClick={handleReplay}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-medium rounded-full transition-all"
          title="Replay printer feed animation"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${isPrinting ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Feed</span>
        </button>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-medium rounded-full transition-all"
          title="Copy Bill Number"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors ml-1"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Click backdrop to close */}
      <div className="fixed inset-0 -z-10" onClick={onClose} />

      {/* PRINTER STAGE: The receipt feeds out from the dispenser slot at the bottom */}
      <div className="relative flex flex-col items-center justify-center my-auto pt-14 pb-4">
        
        {/* Paper Masking Container */}
        <div className="relative overflow-hidden pb-1 max-w-[92vw]">
          
          {/* THERMAL RECEIPT PAPER */}
          <div
            key={printKey}
            id="thermal-receipt-printable"
            className="receipt-feed-animation relative w-[310px] sm:w-[325px] max-w-full origin-bottom"
            style={{
              filter: 'drop-shadow(0 15px 25px rgba(0,0,0,0.5)) drop-shadow(0 4px 6px rgba(0,0,0,0.25))'
            }}
          >
            {/* TOP OF RECEIPT: Smooth, flat horizontal edge with rounded corners (No tear on top) */}
            <div className="bg-white rounded-t-2xl pt-4 pb-1 px-4 sm:px-5 text-black">
              {loading ? (
                <div className="py-12 text-center text-gray-500 italic animate-pulse font-sans text-xs">
                  Loading bill details...
                </div>
              ) : (
                <div
                  className="receipt-pos-body select-text"
                  dangerouslySetInnerHTML={{ __html: receiptInnerHtml }}
                />
              )}
            </div>

            {/* BOTTOM OF RECEIPT: Jagged triangular sawtooth tear edge (Matching reference photo) */}
            <div className="w-full h-3.5 select-none -mt-[1px] relative overflow-hidden receipt-tear-edge">
              <svg className="w-full h-full block" preserveAspectRatio="none">
                <defs>
                  <pattern id="thermal-tear-bottom" width="18" height="14" patternUnits="userSpaceOnUse">
                    <polygon points="0,0 9,14 18,0" fill="#ffffff" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#thermal-tear-bottom)" />
              </svg>
            </div>
          </div>
        </div>

        {/* PRINTER DISPENSER SLOT AT THE BOTTOM (Where the paper emerges from) */}
        <div className="w-[335px] sm:w-[350px] max-w-[96vw] -mt-1 relative z-20 flex flex-col items-center select-none print:hidden">
          <div className="w-full h-7 bg-gradient-to-b from-neutral-800 via-neutral-900 to-black rounded-lg border border-neutral-700/80 shadow-2xl flex items-center justify-between px-3">
            {/* Dispenser Slit */}
            <div className="flex-1 h-1.5 bg-black rounded-full border-t border-neutral-800 shadow-inner mr-3" />
            
            {/* Status LED */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`w-2 h-2 rounded-full ${isPrinting ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'} shadow-sm`} />
              <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-400 font-bold">
                {isPrinting ? 'PRINTING...' : 'DISPENSED'}
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* Animation & Print CSS */}
      <style>{`
        /* Realistic Printer Feed Animation: emerges upwards from the bottom slot */
        @keyframes receiptFeedUp {
          0% {
            transform: translateY(100%);
            opacity: 0.6;
          }
          20% {
            transform: translateY(70%);
            opacity: 1;
          }
          45% {
            transform: translateY(40%);
          }
          70% {
            transform: translateY(18%);
          }
          90% {
            transform: translateY(0);
          }
          95% {
            /* Subtle cutter blade release bounce */
            transform: translateY(-4px);
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }

        .receipt-feed-animation {
          animation: receiptFeedUp 1.35s cubic-bezier(0.25, 1, 0.35, 1) forwards;
          will-change: transform;
        }

        /* Screen typography matching POS print service */
        @media screen {
          .receipt-pos-body {
            font-family: ${printerConfig.fontFamily || 'sans-serif'};
            font-size: 13px;
            color: #000000;
            line-height: 1.3;
          }
          .receipt-pos-body * {
            color: #000000 !important;
          }
          .receipt-pos-body table {
            width: 100% !important;
            border-collapse: collapse !important;
          }
          .receipt-pos-body td, .receipt-pos-body th {
            padding: 2px 0 !important;
          }
        }

        /* Direct Print rules */
        @media print {
          body * {
            visibility: hidden !important;
          }
          #thermal-receipt-printable, #thermal-receipt-printable * {
            visibility: visible !important;
          }
          #thermal-receipt-printable {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 70mm !important;
            max-width: 70mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            filter: none !important;
            box-shadow: none !important;
            animation: none !important;
            transform: none !important;
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
