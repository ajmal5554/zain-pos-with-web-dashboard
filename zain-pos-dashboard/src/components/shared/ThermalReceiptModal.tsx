import React, { useEffect, useState, useMemo } from 'react';
import { Printer, Copy, Check, X } from 'lucide-react';
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
  gstin: '32PVGPS0686J1ZV',
  logo: ''
};

export function ThermalReceiptModal({ invoice, open, onClose, loading }: ThermalReceiptModalProps) {
  const [copied, setCopied] = useState(false);
  const [blocks, setBlocks] = useState<ReceiptBlock[]>(DEFAULT_RECEIPT_LAYOUT);
  const [printerConfig, setPrinterConfig] = useState<ReceiptPrinterConfig>(DEFAULT_RECEIPT_PRINTER_CONFIG);
  const [shopDetails, setShopDetails] = useState(DEFAULT_SHOP_DETAILS);

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
                gstin: parsed.gstin || prev.gstin,
                logo: parsed.logo || prev.logo
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

  // Convert Invoice to POS ReceiptData exactly like POS Sales.tsx
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
      logo: shopDetails.logo,
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

  // Generate exact inner HTML using POS app logic
  const receiptInnerHtml = generateReceiptInnerHtml(receiptData, blocks, printerConfig);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Top Action Toolbar (Floating, non-printable) */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-slate-900/90 text-white px-4 py-2 rounded-full shadow-2xl border border-slate-700/60 backdrop-blur-md print:hidden">
        <span className="text-xs font-mono font-medium text-slate-300 hidden sm:inline">
          Receipt #{invoice.billNo}
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

      {/* THERMAL RECEIPT CONTAINER (Width matches POS 80mm thermal roll preview: ~320px) */}
      <div
        id="thermal-receipt-printable"
        className="relative w-[320px] max-w-[92vw] my-auto pt-14 pb-8 transition-all"
        style={{
          filter: 'drop-shadow(0 20px 30px rgba(0,0,0,0.5)) drop-shadow(0 4px 6px rgba(0,0,0,0.25))'
        }}
      >
        {/* TOP SERRATED TEAR EDGE */}
        <div className="w-full h-3 select-none -mb-[1px] relative overflow-hidden receipt-tear-edge">
          <svg className="w-full h-full block" preserveAspectRatio="none">
            <defs>
              <pattern id="thermal-tear-top" width="12" height="10" patternUnits="userSpaceOnUse">
                <polygon points="0,10 6,0 12,10" fill="#ffffff" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#thermal-tear-top)" />
          </svg>
        </div>

        {/* THERMAL PAPER BODY - EXACT POS PRINT HTML */}
        <div
          className="bg-white text-black px-4 py-3 shadow-inner"
          style={{
            fontFamily: printerConfig.fontFamily || 'sans-serif',
            fontSize: '13px',
            color: '#000000',
            lineHeight: 1.3
          }}
        >
          {loading ? (
            <div className="py-12 text-center text-gray-500 italic animate-pulse">
              Loading bill details...
            </div>
          ) : (
            <div
              className="receipt-pos-body"
              dangerouslySetInnerHTML={{ __html: receiptInnerHtml }}
            />
          )}
        </div>

        {/* BOTTOM SERRATED TEAR EDGE */}
        <div className="w-full h-3 select-none -mt-[1px] relative overflow-hidden receipt-tear-edge">
          <svg className="w-full h-full block" preserveAspectRatio="none">
            <defs>
              <pattern id="thermal-tear-bottom" width="12" height="10" patternUnits="userSpaceOnUse">
                <polygon points="0,0 6,10 12,0" fill="#ffffff" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#thermal-tear-bottom)" />
          </svg>
        </div>
      </div>

      {/* Exact Thermal Print Styles matching Desktop POS */}
      <style>{`
        @media screen {
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

        @media print {
          /* Hide whole app */
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
            width: 70mm !important;
            max-width: 70mm !important;
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
