import { format as formatDate } from 'date-fns';
import { DEFAULT_MESSAGING_CONFIG } from '../types/messaging';
import type {
    MessagingConfig,
    InvoiceMessagePayload,
    StoreCreditMessagePayload,
} from '../types/messaging';

export { DEFAULT_MESSAGING_CONFIG };

/**
 * Normalizes phone numbers:
 * - Strips all non-digit chars
 * - Extracts last 10 digits for Indian numbers if prefixed with 91 or 0
 * - Returns clean 10-digit number and full international number with country code
 */
export function normalizePhoneNumber(rawPhone: string, defaultCountryCode: string = '91'): {
    digits: string;
    tenDigit: string;
    international: string;
    waFormat: string;
    e164: string;
} {
    if (!rawPhone) {
        return { digits: '', tenDigit: '', international: '', waFormat: '', e164: '' };
    }
    const clean = rawPhone.replace(/\D/g, '');
    let tenDigit = clean;

    if (clean.length > 10) {
        if (clean.startsWith(defaultCountryCode)) {
            tenDigit = clean.slice(defaultCountryCode.length);
        } else if (clean.startsWith('0') && clean.length === 11) {
            tenDigit = clean.slice(1);
        } else {
            tenDigit = clean.slice(-10);
        }
    }

    const international = `${defaultCountryCode}${tenDigit}`;
    const e164 = `+${international}`;
    const waFormat = international;

    return {
        digits: clean,
        tenDigit,
        international,
        waFormat,
        e164,
    };
}

/**
 * Format timestamp into readable localized date and time
 */
export function formatReadableDate(dateInput?: string | Date): string {
    try {
        const d = dateInput ? new Date(dateInput) : new Date();
        return formatDate(d, 'dd MMM yyyy, hh:mm a');
    } catch {
        return new Date().toLocaleString();
    }
}

/**
 * Build a rich WhatsApp invoice message
 */
export function buildInvoiceMessageWhatsApp(payload: InvoiceMessagePayload): string {
    const shopName = payload.shopName || 'ZAIN GENTS PALACE';
    const lines: string[] = [];

    lines.push(`*${shopName}*`);
    if (payload.shopAddress) {
        lines.push(payload.shopAddress.replace(/\n+/g, ', '));
    }
    const metaParts: string[] = [];
    if (payload.shopPhone) metaParts.push(`Ph: ${payload.shopPhone}`);
    if (payload.gstin) metaParts.push(`GSTIN: ${payload.gstin}`);
    if (metaParts.length > 0) {
        lines.push(metaParts.join(' | '));
    }
    lines.push('────────────────────────');
    lines.push(`*TAX INVOICE #${payload.billNo}*`);
    lines.push(`Date: ${formatReadableDate(payload.date)}`);
    if (payload.customerName && payload.customerName.toLowerCase() !== 'walk-in customer') {
        lines.push(`Customer: ${payload.customerName} (${payload.customerPhone})`);
    } else {
        lines.push(`Customer: ${payload.customerPhone}`);
    }
    lines.push('────────────────────────');

    lines.push('*PURCHASED ITEMS:*');
    (payload.items || []).forEach((item, index) => {
        const variantSuffix = item.variantInfo ? ` (${item.variantInfo})` : '';
        const itemLine = `${index + 1}. ${item.name}${variantSuffix} x ${item.quantity} = ₹${Number(item.total).toFixed(2)}`;
        lines.push(itemLine);
    });

    lines.push('────────────────────────');
    lines.push(`Subtotal: ₹${Number(payload.subtotal || 0).toFixed(2)}`);
    if (payload.discount && Number(payload.discount) > 0) {
        lines.push(`Discount: -₹${Number(payload.discount).toFixed(2)}`);
    }
    lines.push(`*GRAND TOTAL: ₹${Number(payload.grandTotal || 0).toFixed(2)}*`);

    const pmt = payload.paymentMethod || 'CASH';
    let pmtLine = `Payment: *${pmt}*`;
    if (payload.paidAmount !== undefined && Number(payload.paidAmount) > 0) {
        pmtLine += ` (Paid: ₹${Number(payload.paidAmount).toFixed(2)}`;
        if (payload.changeAmount && Number(payload.changeAmount) > 0) {
            pmtLine += ` | Change: ₹${Number(payload.changeAmount).toFixed(2)}`;
        }
        pmtLine += ')';
    }
    lines.push(pmtLine);

    // Store credit redeemed in this invoice
    if (payload.appliedStoreCredit && payload.appliedStoreCredit.length > 0) {
        const totalRedeemed = payload.appliedStoreCredit.reduce((sum, c) => sum + c.amount, 0);
        const codes = payload.appliedStoreCredit.map(c => c.code).filter(Boolean).join(', ');
        lines.push('────────────────────────');
        lines.push(`*Store Credit Redeemed: ₹${totalRedeemed.toFixed(2)}*`);
        if (codes) lines.push(`Voucher: ${codes}`);
    }

    // Active store credit balance notification
    if (payload.activeStoreCreditBalance && payload.activeStoreCreditBalance > 0) {
        lines.push('────────────────────────');
        lines.push(`*STORE CREDIT BALANCE: ₹${payload.activeStoreCreditBalance.toFixed(2)}*`);
        if (payload.activeStoreCreditCodes && payload.activeStoreCreditCodes.length > 0) {
            lines.push(`Voucher Code(s): *${payload.activeStoreCreditCodes.join(', ')}*`);
        }
        lines.push(`_(You have ₹${payload.activeStoreCreditBalance.toFixed(2)} available to redeem on your next visit!)_`);
    }

    lines.push('────────────────────────');
    lines.push('Thank you for shopping with us! Visit again.');

    return lines.join('\n');
}

/**
 * Build a compact SMS invoice message
 */
export function buildInvoiceMessageSMS(payload: InvoiceMessagePayload): string {
    const shopName = payload.shopName || 'ZAIN GENTS PALACE';
    const itemsCount = (payload.items || []).reduce((sum, item) => sum + item.quantity, 0);
    const totalStr = `Rs.${Number(payload.grandTotal || 0).toFixed(2)}`;

    let msg = `Thanks for shopping at ${shopName}! Inv #${payload.billNo} for ${totalStr} (${itemsCount} items) paid via ${payload.paymentMethod}.`;

    if (payload.appliedStoreCredit && payload.appliedStoreCredit.length > 0) {
        const totalRedeemed = payload.appliedStoreCredit.reduce((sum, c) => sum + c.amount, 0);
        msg += ` Redeemed Credit: Rs.${totalRedeemed.toFixed(2)}.`;
    }

    if (payload.activeStoreCreditBalance && payload.activeStoreCreditBalance > 0) {
        const codesStr = (payload.activeStoreCreditCodes || []).join(',');
        msg += ` Avail Store Credit: Rs.${payload.activeStoreCreditBalance.toFixed(2)}${codesStr ? ` (Code: ${codesStr})` : ''}.`;
    }

    if (payload.shopPhone) {
        msg += ` Ph: ${payload.shopPhone}.`;
    }
    msg += ` Visit again!`;

    return msg;
}

/**
 * Build WhatsApp Store Credit Voucher message
 */
export function buildStoreCreditMessageWhatsApp(payload: StoreCreditMessagePayload): string {
    const shopName = payload.shopName || 'ZAIN GENTS PALACE';
    const lines: string[] = [];

    lines.push(`*${shopName} - Store Credit Voucher*`);
    lines.push('────────────────────────');
    if (payload.customerName && payload.customerName.toLowerCase() !== 'walk-in customer') {
        lines.push(`Hello *${payload.customerName}*,`);
    } else {
        lines.push('Hello,');
    }
    lines.push(`A store credit voucher has been issued to your mobile number (${payload.customerPhone}).`);
    lines.push('────────────────────────');
    lines.push(`Voucher Code: *${payload.code}*`);
    lines.push(`Credit Amount: *₹${Number(payload.amount).toFixed(2)}*`);
    lines.push(`Remaining Balance: *₹${Number(payload.remainingAmount).toFixed(2)}*`);
    if (payload.reason) {
        lines.push(`Reason: ${payload.reason}`);
    }
    if (payload.totalActiveBalance && payload.totalActiveBalance > payload.remainingAmount) {
        lines.push(`Total Available Credit: *₹${Number(payload.totalActiveBalance).toFixed(2)}*`);
    }
    lines.push('────────────────────────');
    lines.push('Show this voucher code at checkout to redeem against your purchase.');
    if (payload.shopPhone) {
        lines.push(`Inquiries: ${payload.shopPhone}`);
    }
    lines.push('Thank you!');

    return lines.join('\n');
}

/**
 * Build SMS Store Credit Voucher message
 */
export function buildStoreCreditMessageSMS(payload: StoreCreditMessagePayload): string {
    const shopName = payload.shopName || 'ZAIN GENTS PALACE';
    let msg = `${shopName}: Store Credit ${payload.code} of Rs.${Number(payload.remainingAmount).toFixed(2)} issued. Show code at checkout to redeem.`;
    if (payload.totalActiveBalance && payload.totalActiveBalance > payload.remainingAmount) {
        msg += ` Total Credit Balance: Rs.${Number(payload.totalActiveBalance).toFixed(2)}.`;
    }
    if (payload.shopPhone) {
        msg += ` Ph: ${payload.shopPhone}.`;
    }
    return msg;
}

