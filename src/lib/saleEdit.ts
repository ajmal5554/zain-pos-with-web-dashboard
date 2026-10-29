export function getSaleEditLockReason(sale: {
    status?: string;
    refunds?: unknown[];
    exchanges?: unknown[];
    paymentMethod?: string;
    payments?: Array<{ paymentMode: string }>;
    remarks?: string | null;
}): string | null {
    if (sale.status === 'VOIDED') return 'This bill has been voided and cannot be edited in POS.';
    if (sale.exchanges?.length) return 'This bill has an exchange and cannot be edited in POS.';
    if (sale.refunds?.length) return 'This bill has a refund and cannot be edited in POS.';
    if (sale.paymentMethod === 'EXCHANGE' || sale.payments?.some(p => p.paymentMode === 'EXCHANGE_CREDIT') ||
        sale.remarks?.includes('Replacement sale for Invoice')) {
        return 'This replacement bill uses exchange credit. Use Sales History for further returns or payment-mode corrections.';
    }
    return null;
}
