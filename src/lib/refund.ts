// Shared by the renderer and Electron. All allocation arithmetic uses paise.
export interface ReturnSale {
    status?: string;
    grandTotal: number;
    paymentMethod?: string;
    paidAmount?: number;
    items: Array<{ variantId: string; quantity: number; sellingPrice: number; productName?: string }>;
    payments?: Array<{ paymentMode: string; amount: number }>;
    refunds?: Array<{ totalRefundAmount: number; items: Array<{ variantId: string; quantity: number; amount: number }> }>;
    exchanges?: Array<{ items: Array<{ returnedItemId?: string | null; returnedQty: number }> }>;
}

export const toPaise = (value: number): number => {
    if (!Number.isFinite(value) || value < 0) throw new Error('Amounts must be finite and non-negative.');
    const result = Math.round((value + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(result)) throw new Error('Amount is too large.');
    return result;
};

export function getReturnableItems(sale: ReturnSale) {
    const grouped = new Map<string, { variantId: string; quantity: number; sellingPrice: number; productName?: string; availableQty: number }>();
    for (const item of sale.items) {
        const existing = grouped.get(item.variantId);
        if (existing && toPaise(existing.sellingPrice) !== toPaise(item.sellingPrice)) {
            throw new Error('This bill has different prices for the same variant. Review it before processing a return.');
        }
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('Invalid original item quantity.');
        grouped.set(item.variantId, { ...item, quantity: (existing?.quantity || 0) + item.quantity, availableQty: 0 });
    }
    for (const item of grouped.values()) {
        const refunded = (sale.refunds || []).flatMap(r => r.items).filter(r => r.variantId === item.variantId).reduce((s, r) => s + r.quantity, 0);
        const exchanged = (sale.exchanges || []).flatMap(e => e.items).filter(e => e.returnedItemId === item.variantId).reduce((s, e) => s + e.returnedQty, 0);
        item.availableQty = Math.max(0, item.quantity - refunded - exchanged);
    }
    return [...grouped.values()];
}

export function validateReturnQuantities(sale: ReturnSale, requested: Array<{ id: string; qty: number }>) {
    if (sale.status === 'VOIDED') throw new Error('Voided invoices cannot be returned.');
    if (!requested.length) throw new Error('Select at least one item to return.');
    const available = getReturnableItems(sale);
    const seen = new Set<string>();
    return requested.map(request => {
        if (seen.has(request.id)) throw new Error('Select each returned variant only once.');
        seen.add(request.id);
        const item = available.find(i => i.variantId === request.id);
        if (!item) throw new Error('Returned item is not on the original invoice.');
        if (!Number.isInteger(request.qty) || request.qty <= 0 || request.qty > item.availableQty) {
            throw new Error(`Return quantity exceeds the remaining quantity for ${item.productName || request.id}.`);
        }
        return { ...item, qty: request.qty, grossPaise: toPaise(item.sellingPrice) * request.qty };
    });
}

export function quoteRefund(sale: ReturnSale, requested: Array<{ id: string; qty: number }>, discount?: number) {
    const selected = validateReturnQuantities(sale, requested);
    const available = getReturnableItems(sale);
    const gross = selected.reduce((sum, item) => sum + item.grossPaise, 0);
    const originalGross = sale.items.reduce((sum, item) => sum + toPaise(item.sellingPrice) * item.quantity, 0);
    const originalNet = toPaise(sale.grandTotal);
    const priorRefunds = (sale.refunds || []).reduce((sum, refund) => sum + toPaise(refund.totalRefundAmount), 0);
    const priorRefundGross = (sale.refunds || []).flatMap(r => r.items).reduce((sum, item) => {
        const original = available.find(i => i.variantId === item.variantId);
        if (!original) throw new Error('Previous return history requires review.');
        return sum + toPaise(original.sellingPrice) * item.quantity;
    }, 0);
    const exchangeFunding = (sale.payments || []).filter(p => ['EXCHANGE_CREDIT', 'EXCHANGE'].includes(p.paymentMode.toUpperCase()))
        .reduce((sum, p) => sum + toPaise(p.amount), 0);
    // A store-credit-funded replacement must not convert that credit into cash.
    const cashBasis = sale.paymentMethod === 'EXCHANGE' && !sale.payments?.length ? 0 : Math.max(0, originalNet - exchangeFunding);
    const remainingPayment = Math.max(0, cashBasis - priorRefunds);
    const hasExchanges = (sale.exchanges || []).some(e => e.items.some(i => i.returnedQty > 0));
    const allRemaining = available.every(item => item.availableQty === 0 || selected.some(s => s.variantId === item.variantId && s.qty === item.availableQty));
    const automatic = allRemaining && !hasExchanges && exchangeFunding === 0 && cashBasis === originalNet;
    const remainingDiscount = Math.max(0, originalGross - originalNet - Math.max(0, priorRefundGross - priorRefunds));
    const maxDiscount = Math.min(gross, remainingDiscount);
    const minDiscount = Math.max(0, gross - remainingPayment);
    if (minDiscount > maxDiscount) throw new Error('Remaining cash paid cannot cover this return. Exchange credit or previous refunds require review.');
    const automaticDiscount = Math.max(0, gross - remainingPayment);
    const requiresDiscount = !automatic && discount === undefined;
    const chosenDiscount = automatic ? automaticDiscount : discount === undefined ? minDiscount : toPaise(discount);
    if (chosenDiscount < minDiscount || chosenDiscount > maxDiscount) {
        throw new Error(`Original discount must be between ₹${(minDiscount / 100).toFixed(2)} and ₹${(maxDiscount / 100).toFixed(2)} for this return.`);
    }
    const total = gross - chosenDiscount;
    // Spread the confirmed total discount over selected lines, retaining every paisa.
    // This is an allocation for this refund, not an assertion about historic bargaining.
    let allocated = 0;
    let runningGross = 0;
    const items = selected.map(item => {
        runningGross += item.grossPaise;
        const target = gross > 0 ? Math.round(chosenDiscount * runningGross / gross) : 0;
        const itemDiscount = target - allocated;
        allocated = target;
        return { id: item.variantId, qty: item.qty, amount: (item.grossPaise - itemDiscount) / 100, originalDiscount: itemDiscount / 100 };
    });
    return { items, gross: gross / 100, discount: chosenDiscount / 100, total: total / 100,
        automatic, requiresDiscount, minDiscount: minDiscount / 100, maxDiscount: maxDiscount / 100,
        remainingPayment: remainingPayment / 100, originalDiscount: Math.max(0, originalGross - originalNet) / 100 };
}

export function validateRefundPayments(payments: Array<{ paymentMode: string; amount: number }>, total: number) {
    if (!Array.isArray(payments)) throw new Error('Refund payments are required.');
    let sum = 0;
    for (const payment of payments) {
        if (!['CASH', 'UPI', 'CARD'].includes(payment.paymentMode) || typeof payment.amount !== 'number' || payment.amount <= 0) {
            throw new Error('Choose a valid refund payment mode and positive amount.');
        }
        sum += toPaise(payment.amount);
    }
    if (sum !== toPaise(total)) throw new Error('Refund payments do not match the refund total.');
}
