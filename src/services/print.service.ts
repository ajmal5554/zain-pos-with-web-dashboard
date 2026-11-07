import { format } from 'date-fns';
import { barcodeService } from './barcode.service';
import type { ReceiptBlock } from '../components/settings/ReceiptDesigner';
import { LabelBlock } from '../components/settings/LabelDesigner';
import { db } from '../lib/db';

export interface ReceiptData {
  billNo: number | string;
  date: Date;
  shopName: string;
  shopAddress: string;
  shopPhone: string;
  gstin: string;
  logo?: string; // Add optional logo
  customerName?: string;
  customerPhone?: string;
  items: Array<{
    variantId?: string;
    name: string;
    variantInfo?: string;
    categoryName?: string;
    quantity: number;
    mrp: number;
    rate: number;
    discount?: number;
    taxRate?: number;
    total: number;
  }>;
  subtotal: number;
  discount: number;
  cgst: number;
  sgst: number;
  grandTotal: number;
  paymentMethod: string;
  paidAmount: number;
  changeAmount: number;
  payments?: Array<{
    paymentMode: string;
    amount: number;
  }>;
  userName: string;
  // Exchange/Replacement bill fields
  isReplacementBill?: boolean;
  originalBillNo?: string | number;
  exchangeCreditAmount?: number;
  // Store Credit fields
  storeCreditAmount?: number;
  creditNoteCodes?: string;
  // Refund fields
  totalRefundAmount?: number;
  refundStatus?: 'REFUNDED' | 'PARTIALLY_REFUNDED';
}

export interface ReceiptPrinterConfig {
  pageSize: string;
  contentWidth: number;
  fontFamily: string;
  isBold: boolean;
  showMRP: boolean;
  showRate: boolean;
  showRateSubline?: boolean;
  showItemDiscount: boolean;
  showPaidLine: boolean;
  showChangeLine: boolean;
}

export const DEFAULT_RECEIPT_PRINTER_CONFIG: ReceiptPrinterConfig = {
  pageSize: '80mm',
  contentWidth: 72,
  fontFamily: 'sans-serif',
  isBold: false,
  showMRP: false,
  showRate: false,
  showRateSubline: false,
  showItemDiscount: false,
  showPaidLine: false,
  showChangeLine: false,
};

export const DEFAULT_RECEIPT_LAYOUT: ReceiptBlock[] = [
  { id: '1', type: 'header', content: 'TAX INVOICE', styles: { align: 'center', fontSize: 14, bold: true, marginBottom: 5 }, visible: true },
  { id: '2', type: 'text', content: '{{shopName}}', styles: { align: 'center', fontSize: 16, bold: true }, visible: true },
  { id: '3', type: 'text', content: '{{address}}\nPh: {{phone}}\nGSTIN: {{gstin}}', styles: { align: 'center', fontSize: 10 }, visible: true },
  { id: '4', type: 'divider', styles: {}, visible: true },
  { id: '5', type: 'bill_info', styles: {}, visible: true },
  { id: '6', type: 'divider', styles: {}, visible: true },
  { id: '7', type: 'items_table', styles: { showVariantInfo: false, tableHeaderBold: true, tableRowBold: false }, visible: true },
  { id: '8', type: 'divider', styles: {}, visible: true },
  { id: '9', type: 'totals', styles: { align: 'right' }, visible: true },
  { id: '10', type: 'divider', styles: {}, visible: true },
  { id: '11', type: 'footer', content: 'Thank You! Visit Again', styles: { align: 'center', fontSize: 10, marginBottom: 10 }, visible: true },
  { id: '12', type: 'text', content: 'Authorised Signatory', styles: { align: 'right', fontSize: 10, marginTop: 20 }, visible: true },
];

export function generateReceiptHtml(
  data: ReceiptData,
  blocks: ReceiptBlock[],
  cfg?: Partial<ReceiptPrinterConfig>,
  opts?: { interactive?: boolean; selectedBlockId?: string }
) {
  const printerConfig: ReceiptPrinterConfig = { ...DEFAULT_RECEIPT_PRINTER_CONFIG, ...(cfg || {}) };
  let htmlContent = '';
  const interactive = opts?.interactive === true;
  const selectedBlockId = opts?.selectedBlockId || '';

  const processText = (text: string) => {
    let processed = text || '';
    const replacements: Record<string, string> = {
      '{{shopName}}': data.shopName || '',
      '{{address}}': data.shopAddress || '',
      '{{phone}}': data.shopPhone || '',
      '{{gstin}}': data.gstin || '',
      '{{billNo}}': data.billNo?.toString() || '',
      '{{date}}': data.date ? format(new Date(data.date), 'dd/MM/yyyy hh:mm a') : format(new Date(), 'dd/MM/yyyy hh:mm a'),
      '{{userName}}': data.userName || '',
    };
    for (const [key, value] of Object.entries(replacements)) {
      processed = processed.replace(new RegExp(key, 'g'), value);
    }
    return processed.replace(/\n/g, '<br>');
  };

  for (const block of blocks) {
    if (!block.visible) continue;

    const styleStr = `
      text-align: ${block.styles.align || 'left'};
      font-size: ${block.styles.fontSize || 12}px;
      font-weight: ${block.styles.bold ? 'bold' : 'normal'};
      margin-top: ${block.styles.marginTop || 0}px;
      margin-bottom: ${block.styles.marginBottom || 0}px;
      font-family: ${block.styles.fontFamily || 'inherit'};
      width: 100%;
    `;

    const isSelected = interactive && selectedBlockId === block.id;
    const blockOpen = interactive
      ? `<div data-block-id="${block.id}" style="position: relative; outline: ${isSelected ? '2px solid #3b82f6' : '1px dashed transparent'}; outline-offset: 1px; cursor: pointer;">`
      : '';
    const blockClose = interactive ? `</div>` : '';

    switch (block.type) {
      case 'logo':
        {
          const logoWidth = block.styles.fontSize || 60;
          if (data.logo) {
            htmlContent += `${blockOpen}<div style="${styleStr}"><img src="${data.logo}" style="max-width: ${logoWidth}%; height: auto;" /></div>${blockClose}`;
          } else if (interactive) {
            htmlContent += `${blockOpen}<div style="${styleStr}"><div style="width: ${logoWidth}%; margin: 0 auto; height: 64px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #6b7280; border: 1px dashed #9ca3af; background: #e5e7eb;">[LOGO ${logoWidth}%]</div></div>${blockClose}`;
          }
        }
        break;
      case 'text':
      case 'header':
      case 'footer':
      case 'section_shop_title':
      case 'shop_title':
      case 'shop_details':
        htmlContent += `${blockOpen}<div style="${styleStr}">${processText(block.content || '')}</div>${blockClose}`;
        break;
      case 'divider':
        htmlContent += `${blockOpen}<div style="${styleStr} border-top: 1px dashed #000; margin: 10px 0;"></div>${blockClose}`;
        break;
      case 'spacer':
        htmlContent += `${blockOpen}<div style="height: 20px; ${styleStr}"></div>${blockClose}`;
        break;
      case 'bill_info':
        htmlContent += `${blockOpen}
          <div style="font-weight: bold; font-size: 11px; margin-bottom: 5px; ${styleStr}">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <div>Bill No: ${data.billNo}${data.isReplacementBill ? ' (REPLACEMENT)' : ''}${data.refundStatus === 'REFUNDED' ? ' (REFUNDED)' : data.refundStatus === 'PARTIALLY_REFUNDED' ? ' (PARTIAL REFUND)' : ''}</div>
              <div>Date: ${format(new Date(data.date), 'dd/MM/yyyy')}</div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 2px;">
              <div>Customer: ${data.customerName || 'Walk-in Customer'}${data.customerPhone ? ` (${data.customerPhone})` : ''}</div>
              ${data.isReplacementBill && data.originalBillNo ? `<div>Ref Orig Bill: #${data.originalBillNo}</div>` : ''}
            </div>
          </div>
        ${blockClose}`;
        break;
      case 'items_table': {
        const showItemDiscount = printerConfig.showItemDiscount === true;

        const tableHeaderBold = block.styles.tableHeaderBold !== false;
        const tableRowBold = block.styles.tableRowBold === true;
        const showMRP = block.styles.showMRP !== undefined ? block.styles.showMRP === true : printerConfig.showMRP;
        const showRate = block.styles.showRate !== undefined ? block.styles.showRate === true : printerConfig.showRate;
        const showRateSubline = block.styles.showRateSubline !== undefined ? block.styles.showRateSubline === true : (printerConfig.showRateSubline === true);

        const rows = data.items.map((item: any, index: number) => {
          const qty = Number(item.quantity) || 0;
          const rateVal = item.rate !== undefined && item.rate !== null && !isNaN(Number(item.rate))
            ? Number(item.rate)
            : (qty > 0 ? Number(item.total || 0) / qty : 0);

          return `
          <tr>
            <td style="text-align: center; padding: 4px 2px; font-weight: ${tableRowBold ? 'bold' : 'normal'}; vertical-align: top;">${index + 1}</td>
            <td style="text-align: left; padding: 4px 2px; font-weight: ${tableRowBold ? 'bold' : 'normal'}; vertical-align: top;">
              <div>${String(item.name || '').split(' | ')[0]}${item.categoryName ? ` (${item.categoryName})` : ''}</div>
              ${showRateSubline && qty > 1 ? `<div style="font-size: 9px; color: #555; font-weight: normal; margin-top: 1px;">${qty} @ ₹${rateVal.toFixed(2)}</div>` : ''}
            </td>
            ${showMRP ? `<td style="text-align: right; padding: 4px 2px; font-weight: ${tableRowBold ? 'bold' : 'normal'}; vertical-align: top;">${Number(item.mrp || 0).toFixed(2)}</td>` : ''}
            ${showRate ? `<td style="text-align: right; padding: 4px 2px; font-weight: ${tableRowBold ? 'bold' : 'normal'}; vertical-align: top;">${rateVal.toFixed(2)}</td>` : ''}
            <td style="text-align: center; padding: 4px 2px; font-weight: ${tableRowBold ? 'bold' : 'normal'}; vertical-align: top;">${qty}</td>
            ${showItemDiscount ? `<td style="text-align: right; padding: 4px 2px; font-weight: ${tableRowBold ? 'bold' : 'normal'}; vertical-align: top;">${Number(item.discount || 0).toFixed(2)}</td>` : ''}
            <td style="text-align: right; padding: 4px 2px; font-weight: ${tableRowBold ? 'bold' : 'normal'}; vertical-align: top;">${Number(item.total || 0).toFixed(2)}</td>
          </tr>
        `;
        }).join('');
        htmlContent += `${blockOpen}
          <table style="width: 100%; border-collapse: collapse; font-family: ${block.styles.fontFamily || 'inherit'}; font-size: 11px;">
            <thead>
              <tr style="border-bottom: 1px dashed #000;">
                <th align="center" style="width: 5%; padding: 4px 2px; font-weight: ${tableHeaderBold ? 'bold' : 'normal'};">#</th>
                <th align="left" style="width: auto; padding: 4px 2px; font-weight: ${tableHeaderBold ? 'bold' : 'normal'};">Item</th>
                ${showMRP ? `<th align="right" style="width: 15%; padding: 4px 2px; font-weight: ${tableHeaderBold ? 'bold' : 'normal'};">MRP</th>` : ''}
                ${showRate ? `<th align="right" style="width: 15%; padding: 4px 2px; font-weight: ${tableHeaderBold ? 'bold' : 'normal'};">Rate</th>` : ''}
                <th align="center" style="width: 10%; padding: 4px 2px; font-weight: ${tableHeaderBold ? 'bold' : 'normal'};">Qty</th>
                ${showItemDiscount ? `<th align="right" style="width: 10%; padding: 4px 2px; font-weight: ${tableHeaderBold ? 'bold' : 'normal'};">Dis</th>` : ''}
                <th align="right" style="width: 20%; padding: 4px 2px; font-weight: ${tableHeaderBold ? 'bold' : 'normal'};">Amt</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        ${blockClose}`;
        break;
      }
      case 'totals': {
        const hasExchangeCredit = data.isReplacementBill && (data.exchangeCreditAmount || 0) > 0;
        const exchangeCredit = data.exchangeCreditAmount || 0;

        const storeCreditPmt = (data.payments || []).find(p => p.paymentMode === 'STORE_CREDIT');
        const storeCreditAmount = (data.storeCreditAmount !== undefined && data.storeCreditAmount > 0)
          ? data.storeCreditAmount
          : (storeCreditPmt ? Number(storeCreditPmt.amount || 0) : (data.paymentMethod === 'STORE_CREDIT' ? data.grandTotal : 0));
        const hasStoreCredit = !hasExchangeCredit && storeCreditAmount > 0;

        const netPaidToday = hasExchangeCredit
          ? (data.grandTotal - exchangeCredit)
          : (hasStoreCredit ? (data.grandTotal - storeCreditAmount) : data.grandTotal);

        // Determine fresh / non-credit payments for the footer breakdown
        const freshPayments = (data.payments || []).filter(
          p => p.paymentMode !== 'EXCHANGE_CREDIT' && p.paymentMode !== 'STORE_CREDIT'
        );

        // For exchange/replacement bills, recalculate GST on the NET amount paid
        // (mirrors processSaleForReport in Reports.tsx so receipt and report always match)
        let displayCgst: number;
        let displaySgst: number;
        let basicAmt: number;

        if (hasExchangeCredit && netPaidToday > 0) {
          // GST is inclusive at 5% → taxable = netPaid / 1.05, tax = netPaid - taxable
          const GST_INCLUSIVE_FACTOR = 1.05;
          const netTaxable = parseFloat((Math.max(0, netPaidToday) / GST_INCLUSIVE_FACTOR).toFixed(2));
          const netTotalTax = parseFloat((Math.max(0, netPaidToday) - netTaxable).toFixed(2));
          displayCgst = parseFloat((netTotalTax / 2).toFixed(2));
          displaySgst = parseFloat((netTotalTax / 2).toFixed(2));
          basicAmt = netTaxable;
        } else if (hasExchangeCredit && netPaidToday <= 0) {
          // Fully covered by exchange credit — zero tax
          displayCgst = 0;
          displaySgst = 0;
          basicAmt = 0;
        } else {
          // Normal or Store Credit bill — use standard gross tax
          const totalTax = (data.cgst || 0) + (data.sgst || 0);
          const afterDiscount = (data.subtotal || 0) - (data.discount || 0);
          displayCgst = data.cgst || 0;
          displaySgst = data.sgst || 0;
          basicAmt = afterDiscount - totalTax;
        }

        htmlContent += `${blockOpen}
          <div style="${styleStr}; font-size: 11px;">
            <table style="width: 100%; font-size: inherit;">
              <tr><td align="right">Total Items:</td><td align="right" width="80">${data.items.length}</td></tr>
              <tr style="font-weight: bold;"><td align="right">Gross Subtotal (incl. GST):</td><td align="right" width="80">${(data.subtotal || 0).toFixed(2)}</td></tr>
              <tr><td align="right">Discount:</td><td align="right" width="80">${data.discount.toFixed(2)}</td></tr>

              ${hasStoreCredit ? `
              <tr style="font-weight: bold; border-top: 1px dashed #000;">
                <td align="right" style="padding: 3px 0;">INVOICE TOTAL:</td>
                <td align="right" width="80" style="padding: 3px 0;">₹${data.grandTotal.toFixed(2)}</td>
              </tr>
              <tr><td align="right" style="color: #4b5563;">Taxable Value (Excl. GST):</td><td align="right" width="80" style="color: #4b5563;">${basicAmt.toFixed(2)}</td></tr>
              <tr><td align="right" style="color: #4b5563;">CGST @ 2.5%:</td><td align="right" width="80" style="color: #4b5563;">${displayCgst.toFixed(2)}</td></tr>
              <tr><td align="right" style="color: #4b5563;">SGST @ 2.5%:</td><td align="right" width="80" style="color: #4b5563;">${displaySgst.toFixed(2)}</td></tr>
              <tr style="font-weight: bold; border-top: 1px dashed #000;">
                <td align="right" style="padding: 3px 0;">Less Store Credit${data.creditNoteCodes ? ` (${data.creditNoteCodes})` : ''}:</td>
                <td align="right" width="80" style="padding: 3px 0;">-₹${storeCreditAmount.toFixed(2)}</td>
              </tr>
              <tr style="font-weight: bold; font-size: 14px; border-top: 1px dashed #000;">
                <td align="right" style="padding: 5px 0;">NET AMOUNT TO PAY:</td>
                <td align="right" style="padding: 5px 0;">₹${Math.max(0, netPaidToday).toFixed(2)}</td>
              </tr>
              ` : ''}

              ${hasExchangeCredit ? `
              <tr><td align="right" style="padding: 2px 0;">Less Exchange Credit:</td><td align="right" style="padding: 2px 0;">-${exchangeCredit.toFixed(2)}</td></tr>
              <tr style="font-weight: bold;"><td align="right">Net Amt (incl. GST):</td><td align="right" width="80">${Math.max(0, netPaidToday).toFixed(2)}</td></tr>
              <tr><td align="right">Taxable Amount (Excl. GST):</td><td align="right" width="80">${basicAmt.toFixed(2)}</td></tr>
              <tr><td align="right">CGST @2.5%:</td><td align="right" width="80">${displayCgst.toFixed(2)}</td></tr>
              <tr><td align="right">SGST @2.5%:</td><td align="right" width="80">${displaySgst.toFixed(2)}</td></tr>
              <tr style="font-weight: bold; font-size: 14px; border-top: 1px dashed #000;">
                <td align="right" style="padding: 5px 0;">NET AMOUNT PAID:</td>
                <td align="right" style="padding: 5px 0;">₹${Math.max(0, netPaidToday).toFixed(2)}</td>
              </tr>
              ` : ''}

              ${!hasExchangeCredit && !hasStoreCredit ? `
              <tr><td align="right">Taxable Amount (Excl. GST):</td><td align="right" width="80">${basicAmt.toFixed(2)}</td></tr>
              <tr><td align="right">CGST @2.5%:</td><td align="right" width="80">${displayCgst.toFixed(2)}</td></tr>
              <tr><td align="right">SGST @2.5%:</td><td align="right" width="80">${displaySgst.toFixed(2)}</td></tr>
              <tr style="font-weight: bold; font-size: 13px; border-top: 1px dashed #000;">
                <td align="right" style="padding: 5px 0;">TOTAL:</td>
                <td align="right" style="padding: 5px 0;">₹${data.grandTotal.toFixed(2)}</td>
              </tr>
              ${printerConfig.showPaidLine
                ? (data.payments && data.payments.length > 1
                  ? data.payments.map(p => `<tr><td align="right">${p.paymentMode}:</td><td align="right">${p.amount.toFixed(2)}</td></tr>`).join('')
                  : `<tr><td align="right" style="padding-top: 5px;">Paid (${data.paymentMethod}):</td><td align="right" style="padding-top: 5px;">${data.paidAmount?.toFixed(2) || '0.00'}</td></tr>`)
                : ''}
              ${printerConfig.showChangeLine ? `<tr><td align="right">Change:</td><td align="right">${data.changeAmount?.toFixed(2) || '0.00'}</td></tr>` : ''}
              ` : ''}
              ${data.totalRefundAmount && data.totalRefundAmount > 0 ? `
              <tr><td align="right" style="padding: 2px 0; color: #b91c1c; font-weight: bold;">Less Refunded:</td><td align="right" style="padding: 2px 0; color: #b91c1c; font-weight: bold;">-${data.totalRefundAmount.toFixed(2)}</td></tr>
              <tr style="font-weight: bold; font-size: 13px; border-top: 1px dashed #b91c1c; color: #b91c1c;"><td align="right" style="padding: 4px 0;">NET RETAINED:</td><td align="right" style="padding: 4px 0;">₹${Math.max(0, data.grandTotal - data.totalRefundAmount).toFixed(2)}</td></tr>
              ` : ''}
            </table>
            ${hasExchangeCredit ? `
            <div style="border-top: 1px dashed #000; margin-top: 5px; padding-top: 5px; font-size: 11px;">
              <div style="font-weight: bold; font-size: 10px; margin-bottom: 3px;">PAYMENT BREAKDOWN:</div>
              <table style="width: 100%; font-size: inherit;">
                <tr><td>Exchange Credit:</td><td align="right">₹${exchangeCredit.toFixed(2)}</td></tr>
                ${freshPayments.map(p => `<tr><td>${p.paymentMode}:</td><td align="right">₹${p.amount.toFixed(2)}</td></tr>`).join('')}
                ${freshPayments.length === 0 && netPaidToday > 0 ? `<tr><td>${data.paymentMethod}:</td><td align="right">₹${netPaidToday.toFixed(2)}</td></tr>` : ''}
                ${netPaidToday <= 0 ? `<tr><td colspan="2" style="font-size: 10px;">No additional payment required</td></tr>` : ''}
              </table>
            </div>
            ` : ''}
            ${hasStoreCredit ? `
            <div style="border-top: 1px dashed #000; margin-top: 5px; padding-top: 5px; font-size: 11px;">
              <div style="font-weight: bold; font-size: 10px; margin-bottom: 3px;">PAYMENT BREAKDOWN:</div>
              <table style="width: 100%; font-size: inherit;">
                <tr><td>Store Credit${data.creditNoteCodes ? ` (${data.creditNoteCodes})` : ''}:</td><td align="right">₹${storeCreditAmount.toFixed(2)}</td></tr>
                ${freshPayments.map(p => `<tr><td>${p.paymentMode}:</td><td align="right">₹${p.amount.toFixed(2)}</td></tr>`).join('')}
                ${freshPayments.length === 0 && netPaidToday > 0 ? `<tr><td>${data.paymentMethod}:</td><td align="right">₹${netPaidToday.toFixed(2)}</td></tr>` : ''}
                ${netPaidToday <= 0 ? `<tr><td colspan="2" style="font-size: 10px; font-weight: bold;">(Fully Covered by Store Credit)</td></tr>` : ''}
              </table>
            </div>
            ` : ''}
          </div>
        ${blockClose}`;
        break;
      }
      default:
        break;
    }
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        @page { margin: 0; size: auto; }
        body {
          font-family: ${printerConfig.fontFamily || 'sans-serif'};
          width: 70mm;
          margin: 0 0 0 5mm;
          padding: 0;
          font-size: 13px;
          font-weight: ${printerConfig.isBold ? 'bold' : 'normal'};
          color: #000 !important;
          overflow-x: hidden;
        }
        * { box-sizing: border-box; }
        div, span, td, th, p { color: #000 !important; }
        table { width: 100% !important; border-collapse: collapse; }
        td, th { padding: 2px 0; }
      </style>
    </head>
    <body>
      ${htmlContent}
      ${interactive ? `
      <script>
        document.addEventListener('click', function (e) {
          var node = e.target && e.target.closest ? e.target.closest('[data-block-id]') : null;
          if (!node) return;
          e.preventDefault();
          e.stopPropagation();
          var blockId = node.getAttribute('data-block-id');
          if (blockId && window.parent) {
            window.parent.postMessage({ type: 'receipt-preview-select', blockId: blockId }, '*');
          }
        }, true);
      </script>` : ''}
    </body>
    </html>
  `;
}

interface LabelData {
  shopName: string;
  productName: string;
  barcode: string;
  productCode: string;
  price: number;
}

export const printService = {
  async printReceipt(data: ReceiptData, testConfig?: Partial<ReceiptPrinterConfig> & { receiptPrinter?: string }) {
    try {
      // 1. Fetch Layout JSON using settings API
      const layoutResult = await window.electronAPI.settings.get({ key: 'RECEIPT_LAYOUT' });
      const printerConfigResult = testConfig ? { success: true, data: JSON.stringify(testConfig) } : await window.electronAPI.settings.get({ key: 'PRINTER_CONFIG' });

      if (layoutResult?.success === false) {
        throw new Error(layoutResult.error || 'Failed to load receipt layout');
      }
      if (printerConfigResult?.success === false) {
        throw new Error(printerConfigResult.error || 'Failed to load printer configuration');
      }

      const printerConfig: ReceiptPrinterConfig = printerConfigResult?.data
        ? { ...DEFAULT_RECEIPT_PRINTER_CONFIG, ...JSON.parse(printerConfigResult.data as string) }
        : { ...DEFAULT_RECEIPT_PRINTER_CONFIG };

      const blocks: ReceiptBlock[] = layoutResult?.data
        ? JSON.parse(layoutResult.data as string)
        : DEFAULT_RECEIPT_LAYOUT;

      const variantIds = [...new Set(data.items.filter(item => item.variantId && !item.categoryName).map(item => item.variantId!))];
      const variants = variantIds.length ? await db.productVariants.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, product: { select: { category: { select: { name: true } } } } }
      }) : [];
      const categories = new Map<string, string>(variants.map((variant: any) => [variant.id, variant.product?.category?.name || '']));
      const receiptData = { ...data, items: data.items.map(item => ({ ...item, categoryName: item.categoryName || categories.get(item.variantId || '') || undefined })) };
      const finalHtml = generateReceiptHtml(receiptData, blocks, printerConfig);

      const receiptPrinterName = printerConfigResult?.data
        ? (() => {
            try {
              const parsed = JSON.parse(printerConfigResult.data as string);
              return typeof parsed?.receiptPrinter === 'string'
                ? parsed.receiptPrinter.trim()
                : undefined;
            } catch {
              return undefined;
            }
          })()
        : undefined;

      const result = await window.electronAPI.print.receipt({
        html: finalHtml,
        options: { deviceName: receiptPrinterName, pageSize: printerConfig.pageSize }
      });

      if (!result?.success) {
        throw new Error(result?.error || 'Receipt print failed');
      }

    } catch (error) {
      console.error('Print service error:', error);
      // Fallback or error reporting
      console.error('Printing failed:', error);
      throw error;
    }
  },

  async printLabel(data: LabelData, copies: number = 1): Promise<void> {
    try {
      // 1. Fetch Layout JSON using settings API
      const result = await window.electronAPI.settings.get({ key: 'LABEL_LAYOUT' });
      const printerConfigResult = await window.electronAPI.settings.get({ key: 'PRINTER_CONFIG' });

      if (result?.success === false) {
        throw new Error(result.error || 'Failed to load label layout');
      }
      if (printerConfigResult?.success === false) {
        throw new Error(printerConfigResult.error || 'Failed to load printer configuration');
      }

      // Parse layout or use default
      let blocks: LabelBlock[] = [];
      if (result?.data) {
        blocks = JSON.parse(result.data as string);
      } else {
        blocks = [
          { id: '1', type: 'shop_name', styles: { align: 'left', fontSize: 10, bold: true, marginBottom: 0 }, visible: true },
          { id: '2', type: 'product_name', styles: { align: 'left', fontSize: 8, marginBottom: 2 }, visible: true },
          { id: '3', type: 'barcode', styles: { align: 'left', height: 40, marginBottom: 0 }, visible: true },
          { id: '4', type: 'product_code', styles: { align: 'left', fontSize: 8, marginBottom: 0 }, visible: true },
          { id: '5', type: 'price', styles: { align: 'left', fontSize: 12, bold: true, marginBottom: 0 }, visible: true },
        ];
      }

      const barcodeImage = barcodeService.generateBarcodeImage(data.barcode);

      let htmlContent = '';
      for (const block of blocks) {
        if (!block.visible) continue;

        const styleStr = `
                    text-align: ${block.styles.align || 'center'};
                    font-size: ${block.styles.fontSize || 10}pt;
                    font-weight: ${block.styles.bold ? 'bold' : 'normal'};
                    margin-top: ${block.styles.marginTop || 0}px;
                    margin-bottom: ${block.styles.marginBottom || 0}px;
                    line-height: 1.1;
                `;

        switch (block.type) {
          case 'shop_name':
            htmlContent += `<div style="${styleStr}">${block.content || data.shopName}</div>`;
            break;
          case 'product_name':
            htmlContent += `<div style="${styleStr}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${block.content || data.productName}</div>`;
            break;
          case 'price':
            htmlContent += `<div style="${styleStr}">₹${data.price.toFixed(2)}</div>`;
            break;
          case 'product_code':
            htmlContent += `<div style="${styleStr}">${data.productCode}</div>`;
            break;
          case 'text':
            htmlContent += `<div style="${styleStr}">${block.content || ''}</div>`;
            break;
          case 'barcode':
            htmlContent += `<div style="${styleStr}"><img src="${barcodeImage}" style="height: ${block.styles.height || 30}px; max-width: 100%;"></div>`;
            break;
          case 'meta_row':
            htmlContent += `
                            <div style="display: flex; justify-content: space-between; ${styleStr}">
                                <span>${data.productCode}</span>
                                <span>₹${data.price.toFixed(2)}</span>
                            </div>
                         `;
            break;
          case 'divider':
            htmlContent += `<div style="border-top: 1px dashed black; margin: 2px 0;"></div>`;
            break;
          case 'spacer':
            htmlContent += `<div style="height: ${block.styles.height || 5}px;"></div>`;
            break;
        }
      }

      let html = `
                <html>
                <body style="font-family: Arial, sans-serif; width: 50mm; height: 25mm; margin: 0; padding: 1mm; box-sizing: border-box; overflow: hidden;">
                    ${htmlContent}
                </body>
                </html>`;
      let labelPrinterName: string | undefined;
      if (printerConfigResult?.data) {
        const parsed = JSON.parse(printerConfigResult.data as string);
        if (parsed?.labelPrinter && typeof parsed.labelPrinter === 'string') {
          labelPrinterName = parsed.labelPrinter.trim();
        }
      }

      for (let i = 0; i < copies; i++) {
        const labelResult = await window.electronAPI.print.label({
          html,
          options: { deviceName: labelPrinterName }
        });
        if (!labelResult?.success) {
          throw new Error(labelResult?.error || 'Label print failed');
        }
        if (copies > 1) await new Promise(r => setTimeout(r, 500));
      }
    } catch (error) {
      console.error('Print label error:', error);
      throw error;
    }
  },

  async printCreditNote(cn: {
    code: string;
    customerName?: string | null;
    customerPhone?: string | null;
    originalBillNo?: string | null;
    amount: number;
    remainingAmount: number;
    reason?: string | null;
    createdAt?: string;
  }): Promise<void> {
    try {
      const printerConfigResult = await window.electronAPI.settings.get({ key: 'PRINTER_CONFIG' });
      const shopInfoResult = await window.electronAPI.settings.get({ key: 'SHOP_INFO' });

      let shopInfo: any = {};
      if (shopInfoResult?.data) {
        try { shopInfo = JSON.parse(shopInfoResult.data as string); } catch {}
      }

      const printerConfig: ReceiptPrinterConfig = {
        ...DEFAULT_RECEIPT_PRINTER_CONFIG,
        ...(printerConfigResult?.data ? (() => {
          try { return JSON.parse(printerConfigResult.data as string); } catch { return {}; }
        })() : {})
      };

      const finalHtml = generateCreditNoteSlipHtml(cn, {
        name: shopInfo.name || 'ZAIN GENTS PALACE',
        address: shopInfo.address || '',
        phone: shopInfo.phone || '',
        gstin: shopInfo.gstin || ''
      });

      const receiptPrinterName = printerConfigResult?.data
        ? (() => {
            try {
              const parsed = JSON.parse(printerConfigResult.data as string);
              return typeof parsed?.receiptPrinter === 'string'
                ? parsed.receiptPrinter.trim()
                : undefined;
            } catch {
              return undefined;
            }
          })()
        : undefined;

      const result = await window.electronAPI.print.receipt({
        html: finalHtml,
        options: { deviceName: receiptPrinterName, pageSize: printerConfig.pageSize }
      });

      if (!result?.success) {
        if (typeof window !== 'undefined' && typeof window.print === 'function') {
          const printWindow = window.open('', '_blank');
          if (printWindow) {
            printWindow.document.write(finalHtml);
            printWindow.document.close();
            printWindow.focus();
            printWindow.print();
            printWindow.close();
            return;
          }
        }
        throw new Error(result?.error || 'Credit note print failed');
      }
    } catch (error) {
      console.error('Print credit note error:', error);
      throw error;
    }
  }
};

export function generateCreditNoteSlipHtml(
  cn: {
    code: string;
    customerName?: string | null;
    customerPhone?: string | null;
    originalBillNo?: string | null;
    amount: number;
    remainingAmount: number;
    reason?: string | null;
    createdAt?: string;
  },
  shopInfo?: {
    name?: string;
    address?: string;
    phone?: string;
    gstin?: string;
  }
) {
  const shopName = shopInfo?.name || 'ZAIN GENTS PALACE';
  const shopAddress = shopInfo?.address || 'Near Town Square, Main Road';
  const shopPhone = shopInfo?.phone || '';
  const dateFormatted = cn.createdAt ? new Date(cn.createdAt).toLocaleString('en-IN') : new Date().toLocaleString('en-IN');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: 'Courier New', monospace;
          margin: 0;
          padding: 8px;
          color: #000;
          width: 72mm;
          font-size: 13px;
        }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .bold { font-weight: bold; }
        .divider { border-bottom: 1px dashed #000; margin: 8px 0; }
        .title { font-size: 16px; font-weight: bold; margin: 4px 0; letter-spacing: 1px; }
        .amount-box {
          border: 2px solid #000;
          padding: 6px;
          text-align: center;
          margin: 8px 0;
          font-size: 18px;
          font-weight: bold;
        }
        .code-box {
          font-size: 18px;
          font-weight: 900;
          letter-spacing: 2px;
          text-align: center;
          margin: 6px 0;
        }
        .footer { font-size: 11px; text-align: center; margin-top: 10px; }
        table { width: 100%; font-size: 12px; }
        td { padding: 2px 0; }
      </style>
    </head>
    <body>
      <div class="text-center">
        <div class="title">${shopName}</div>
        ${shopAddress ? `<div>${shopAddress}</div>` : ''}
        ${shopPhone ? `<div>Tel: ${shopPhone}</div>` : ''}
        <div class="divider"></div>
        <div class="bold" style="font-size: 15px; text-decoration: underline;">STORE CREDIT VOUCHER</div>
        <div class="code-box">${cn.code}</div>
      </div>
      <div class="divider"></div>
      <table>
        <tr>
          <td>Date:</td>
          <td class="text-right">${dateFormatted}</td>
        </tr>
        ${cn.customerName ? `<tr><td>Customer:</td><td class="text-right bold">${cn.customerName}</td></tr>` : ''}
        ${cn.customerPhone ? `<tr><td>Phone:</td><td class="text-right bold">${cn.customerPhone}</td></tr>` : ''}
        ${cn.originalBillNo ? `<tr><td>Ref Bill:</td><td class="text-right">#${cn.originalBillNo}</td></tr>` : ''}
      </table>
      <div class="amount-box">
        CREDIT AMOUNT: ₹${cn.remainingAmount.toFixed(2)}
      </div>
      ${cn.reason ? `<div style="font-size: 11px; margin-bottom: 6px;">Note: ${cn.reason}</div>` : ''}
      <div class="divider"></div>
      <div class="footer">
        <div>Please present this voucher or quote code at checkout.</div>
        <div style="margin-top: 4px;">* Valid for purchases at this store *</div>
        <div style="margin-top: 2px;">* Not redeemable for cash *</div>
        <div style="margin-top: 8px; font-weight: bold;">Thank You!</div>
      </div>
    </body>
    </html>
  `;
}
