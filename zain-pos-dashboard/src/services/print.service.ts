import { format } from 'date-fns';

export interface ReceiptBlock {
  id: string;
  type:
    | 'header'
    | 'logo'
    | 'text'
    | 'divider'
    | 'bill_info'
    | 'items_table'
    | 'totals'
    | 'footer'
    | 'spacer'
    | 'shop_title'
    | 'shop_details'
    | 'section_shop_title';
  content?: string;
  styles: {
    align?: 'left' | 'center' | 'right';
    fontSize?: number;
    bold?: boolean;
    marginTop?: number;
    marginBottom?: number;
    fontFamily?: string;
    showVariantInfo?: boolean;
    tableHeaderBold?: boolean;
    tableRowBold?: boolean;
  };
  visible: boolean;
}

export interface ReceiptData {
  billNo: number | string;
  date: Date;
  shopName: string;
  shopAddress: string;
  shopPhone: string;
  gstin: string;
  logo?: string;
  customerName?: string;
  items: Array<{
    name: string;
    variantInfo?: string;
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
  isReplacementBill?: boolean;
  originalBillNo?: string | number;
  exchangeCreditAmount?: number;
}

export interface ReceiptPrinterConfig {
  pageSize: string;
  contentWidth: number;
  fontFamily: string;
  isBold: boolean;
  showMRP: boolean;
  showRate: boolean;
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

export function generateReceiptInnerHtml(
  data: ReceiptData,
  blocks: ReceiptBlock[],
  cfg?: Partial<ReceiptPrinterConfig>
): string {
  const printerConfig: ReceiptPrinterConfig = { ...DEFAULT_RECEIPT_PRINTER_CONFIG, ...(cfg || {}) };
  let htmlContent = '';

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

    switch (block.type) {
      case 'logo':
        {
          const logoWidth = block.styles.fontSize || 60;
          if (data.logo) {
            htmlContent += `<div style="${styleStr}"><img src="${data.logo}" style="max-width: ${logoWidth}%; height: auto;" /></div>`;
          }
        }
        break;
      case 'text':
      case 'header':
      case 'footer':
      case 'section_shop_title':
      case 'shop_title':
      case 'shop_details':
        htmlContent += `<div style="${styleStr}">${processText(block.content || '')}</div>`;
        break;
      case 'divider':
        htmlContent += `<div style="${styleStr} border-top: 1px dashed #000; margin: 10px 0;"></div>`;
        break;
      case 'spacer':
        htmlContent += `<div style="height: 20px; ${styleStr}"></div>`;
        break;
      case 'bill_info':
        htmlContent += `
          <div style="font-weight: bold; font-size: 11px; margin-bottom: 5px; ${styleStr}">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <div>Bill No: ${data.billNo}${data.isReplacementBill ? ' (REPLACEMENT)' : ''}</div>
              <div>Date: ${format(new Date(data.date), 'dd/MM/yyyy')}</div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 2px;">
              <div>Customer: ${data.customerName || 'Walk-in Customer'}</div>
              ${data.isReplacementBill && data.originalBillNo ? `<div>Ref Orig Bill: #${data.originalBillNo}</div>` : ''}
            </div>
          </div>
        `;
        break;
      case 'items_table': {
        const showItemDiscount = printerConfig.showItemDiscount === true;
        const showVariantInfo = block.styles.showVariantInfo === true;
        const tableHeaderBold = block.styles.tableHeaderBold !== false;
        const tableRowBold = block.styles.tableRowBold === true;
        const rows = data.items.map((item: any, index: number) => `
          <tr>
            <td style="text-align: center; padding: 4px 2px; font-weight: ${tableRowBold ? 'bold' : 'normal'};">${index + 1}</td>
            <td style="text-align: left; padding: 4px 2px; font-weight: ${tableRowBold ? 'bold' : 'normal'};">
              ${item.name}
              ${showVariantInfo && item.variantInfo ? `<div style="font-size: 9px; color: #555; font-weight: ${tableRowBold ? 'bold' : 'normal'};">${item.variantInfo}</div>` : ''}
            </td>
            <td style="text-align: center; padding: 4px 2px; font-weight: ${tableRowBold ? 'bold' : 'normal'};">${item.quantity}</td>
            ${printerConfig.showMRP ? `<td style="text-align: right; padding: 4px 2px; font-weight: ${tableRowBold ? 'bold' : 'normal'};">${item.mrp?.toFixed(2)}</td>` : ''}
            ${printerConfig.showRate ? `<td style="text-align: right; padding: 4px 2px; font-weight: ${tableRowBold ? 'bold' : 'normal'};">${item.rate?.toFixed(2)}</td>` : ''}
            ${showItemDiscount ? `<td style="text-align: right; padding: 4px 2px; font-weight: ${tableRowBold ? 'bold' : 'normal'};">${item.discount?.toFixed(2) || '0.00'}</td>` : ''}
            <td style="text-align: right; padding: 4px 2px; font-weight: ${tableRowBold ? 'bold' : 'normal'};">${item.total.toFixed(2)}</td>
          </tr>
        `).join('');
        htmlContent += `
          <table style="width: 100%; border-collapse: collapse; font-family: ${block.styles.fontFamily || 'inherit'}; font-size: 11px;">
            <thead>
              <tr style="border-bottom: 1px dashed #000;">
                <th align="center" style="width: 5%; padding: 4px 2px; font-weight: ${tableHeaderBold ? 'bold' : 'normal'};">#</th>
                <th align="left" style="width: auto; padding: 4px 2px; font-weight: ${tableHeaderBold ? 'bold' : 'normal'};">Item</th>
                <th align="center" style="width: 10%; padding: 4px 2px; font-weight: ${tableHeaderBold ? 'bold' : 'normal'};">Qty</th>
                ${printerConfig.showMRP ? `<th align="right" style="width: 15%; padding: 4px 2px; font-weight: ${tableHeaderBold ? 'bold' : 'normal'};">MRP</th>` : ''}
                ${printerConfig.showRate ? `<th align="right" style="width: 15%; padding: 4px 2px; font-weight: ${tableHeaderBold ? 'bold' : 'normal'};">Rate</th>` : ''}
                ${showItemDiscount ? `<th align="right" style="width: 10%; padding: 4px 2px; font-weight: ${tableHeaderBold ? 'bold' : 'normal'};">Dis</th>` : ''}
                <th align="right" style="width: 20%; padding: 4px 2px; font-weight: ${tableHeaderBold ? 'bold' : 'normal'};">Amt</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        `;
        break;
      }
      case 'totals': {
        const totalTax = (data.cgst || 0) + (data.sgst || 0);
        const afterDiscount = (data.subtotal || 0) - (data.discount || 0);
        const basicAmt = afterDiscount - totalTax;
        const hasExchangeCredit = data.isReplacementBill && (data.exchangeCreditAmount || 0) > 0;
        const exchangeCredit = data.exchangeCreditAmount || 0;
        const netPaidToday = hasExchangeCredit ? (data.grandTotal - exchangeCredit) : data.grandTotal;
        const freshPayments = (data.payments || []).filter(p => p.paymentMode !== 'EXCHANGE_CREDIT');

        htmlContent += `
          <div style="${styleStr}; font-size: 11px;">
            <table style="width: 100%; font-size: inherit;">
              <tr><td align="right">Total Items:</td><td align="right" width="80">${data.items.length}</td></tr>
              <tr style="font-weight: bold;"><td align="right">Gross Subtotal (incl. GST):</td><td align="right" width="80">${(data.subtotal || 0).toFixed(2)}</td></tr>
              <tr><td align="right">Discount:</td><td align="right" width="80">${data.discount.toFixed(2)}</td></tr>
              <tr><td align="right">Taxable Amount (Excl. GST):</td><td align="right" width="80">${basicAmt.toFixed(2)}</td></tr>
              <tr><td align="right">CGST @2.5%:</td><td align="right" width="80">${(data.cgst || 0).toFixed(2)}</td></tr>
              <tr><td align="right">SGST @2.5%:</td><td align="right" width="80">${(data.sgst || 0).toFixed(2)}</td></tr>
              <tr style="font-weight: bold; font-size: 13px; border-top: 1px dashed #000;">
                <td align="right" style="padding: 5px 0;">TOTAL:</td>
                <td align="right" style="padding: 5px 0;">₹${data.grandTotal.toFixed(2)}</td>
              </tr>
              ${hasExchangeCredit ? `
              <tr>
                <td align="right" style="padding: 2px 0;">Less Exchange Credit:</td>
                <td align="right" style="padding: 2px 0;">-₹${exchangeCredit.toFixed(2)}</td>
              </tr>
              <tr style="font-weight: bold; font-size: 14px; border-top: 1px dashed #000;">
                <td align="right" style="padding: 5px 0;">NET AMOUNT PAID:</td>
                <td align="right" style="padding: 5px 0;">₹${Math.max(0, netPaidToday).toFixed(2)}</td>
              </tr>
              ` : ''}
              ${!hasExchangeCredit ? `
              ${printerConfig.showPaidLine
                ? (data.payments && data.payments.length > 1
                  ? data.payments.map(p => `<tr><td align="right">${p.paymentMode}:</td><td align="right">${p.amount.toFixed(2)}</td></tr>`).join('')
                  : `<tr><td align="right" style="padding-top: 5px;">Paid (${data.paymentMethod}):</td><td align="right" style="padding-top: 5px;">${data.paidAmount?.toFixed(2) || '0.00'}</td></tr>`)
                : ''}
              ${printerConfig.showChangeLine ? `<tr><td align="right">Change:</td><td align="right">${data.changeAmount?.toFixed(2) || '0.00'}</td></tr>` : ''}
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
          </div>
        `;
        break;
      }
      default:
        break;
    }
  }

  return htmlContent;
}

export function generateReceiptHtml(
  data: ReceiptData,
  blocks: ReceiptBlock[],
  cfg?: Partial<ReceiptPrinterConfig>
): string {
  const printerConfig: ReceiptPrinterConfig = { ...DEFAULT_RECEIPT_PRINTER_CONFIG, ...(cfg || {}) };
  const htmlContent = generateReceiptInnerHtml(data, blocks, cfg);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        @page { margin: 0; size: auto; }
        body {
          font-family: ${printerConfig.fontFamily || 'sans-serif'};
          width: 70mm;
          margin: 0 auto;
          padding: 0;
          font-size: 13px;
          font-weight: ${printerConfig.isBold ? 'bold' : 'normal'};
          color: #000 !important;
          background: #fff;
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
    </body>
    </html>
  `;
}
