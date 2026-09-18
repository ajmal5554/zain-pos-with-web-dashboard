import React, { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
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

// Cached settings across modal opens for instant 0ms rendering
let cachedBlocks: ReceiptBlock[] = DEFAULT_RECEIPT_LAYOUT;
let cachedPrinterConfig: ReceiptPrinterConfig = DEFAULT_RECEIPT_PRINTER_CONFIG;
let cachedShopDetails = DEFAULT_SHOP_DETAILS;
let settingsFetched = false;

export function ThermalReceiptModal({ invoice, open, onClose, loading }: ThermalReceiptModalProps) {
  // Sync Android / mobile status-bar (notification bar) color with the dark modal overlay
  // This eliminates the jarring "big white block" at the top of the phone screen
  useEffect(() => {
    if (!open) return;

    const metaThemeColor = document.querySelector("meta[name='theme-color']");
    const originalColor = metaThemeColor?.getAttribute('content') || '#ffffff';

    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', '#090d16');
    }

    return () => {
      if (metaThemeColor) {
        metaThemeColor.setAttribute('content', originalColor);
      }
    };
  }, [open]);

  // Load custom settings once in background without blocking immediate render
  useEffect(() => {
    if (settingsFetched) return;
    settingsFetched = true;

    adminService.getSettings(['RECEIPT_LAYOUT', 'SHOP_SETTINGS', 'PRINTER_CONFIG'])
      .then((settings) => {
        const layoutSetting = settings.find((s) => s.key === 'RECEIPT_LAYOUT');
        if (layoutSetting?.value) {
          try {
            const parsed = JSON.parse(layoutSetting.value);
            if (Array.isArray(parsed) && parsed.length > 0) {
              cachedBlocks = parsed;
            }
          } catch { }
        }

        const shopSetting = settings.find((s) => s.key === 'SHOP_SETTINGS');
        if (shopSetting?.value) {
          try {
            const parsed = JSON.parse(shopSetting.value);
            if (parsed && typeof parsed === 'object') {
              cachedShopDetails = {
                ...cachedShopDetails,
                shopName: parsed.shopName || parsed.name || cachedShopDetails.shopName,
                address: parsed.address || parsed.branch || cachedShopDetails.address,
                phone: parsed.phone || parsed.supportPhone || cachedShopDetails.phone,
                gstin: parsed.gstin || cachedShopDetails.gstin
              };
            }
          } catch { }
        }

        const printerSetting = settings.find((s) => s.key === 'PRINTER_CONFIG');
        if (printerSetting?.value) {
          try {
            const parsed = JSON.parse(printerSetting.value);
            if (parsed && typeof parsed === 'object') {
              cachedPrinterConfig = { ...cachedPrinterConfig, ...parsed };
            }
          } catch { }
        }
      })
      .catch(() => { });
  }, []);

  // Convert Invoice to POS ReceiptData instantaneously
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
      shopName: cachedShopDetails.shopName,
      shopAddress: cachedShopDetails.address,
      shopPhone: cachedShopDetails.phone,
      gstin: cachedShopDetails.gstin,
      logo: '', // No logo as requested
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
  }, [invoice]);

  if (!open || !invoice || !receiptData) return null;

  // Filter out any logo block completely
  const filteredBlocks = cachedBlocks.filter((b) => b.type !== 'logo');
  const receiptInnerHtml = generateReceiptInnerHtml(receiptData, filteredBlocks, cachedPrinterConfig);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      {/* Clean Receipt Card (No buttons above it, no tear edge, no printer slot) */}
      <div
        id="thermal-receipt-printable"
        onClick={(e) => e.stopPropagation()}
        className="relative w-[320px] sm:w-[340px] max-w-[92vw] bg-white text-black rounded-2xl shadow-2xl p-5 sm:p-6 select-text my-auto transition-all"
        style={{
          fontFamily: cachedPrinterConfig.fontFamily || 'sans-serif',
          fontSize: '13px',
          color: '#000000',
          lineHeight: 1.3
        }}
      >
        {/* Subtle top-right close icon inside the card */}
        <button
          onClick={onClose}
          className="absolute right-3.5 top-3.5 p-1 rounded-full text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition-colors print:hidden"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Exact POS Print Receipt Content */}
        {loading ? (
          <div className="py-8 text-center text-gray-400 italic text-xs">
            Loading bill details...
          </div>
        ) : (
          <div
            className="receipt-pos-body select-text"
            dangerouslySetInnerHTML={{ __html: receiptInnerHtml }}
          />
        )}
      </div>

      {/* Embedded Print & Rendering Styles */}
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
            width: 70mm !important;
            max-width: 70mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            box-shadow: none !important;
            border-radius: 0 !important;
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
