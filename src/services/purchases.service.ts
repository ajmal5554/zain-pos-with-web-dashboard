import type { PurchaseInput, PurchasePaymentInput, PurchaseAdjustmentInput, PurchaseRefundInput, PurchaseDetail, PurchaseRecord, PurchaseItemOption } from '../types/purchases';
export class PurchaseRequestError extends Error {
    constructor(message: string, public readonly confirmedRejected: boolean) { super(message); }
}
async function request<T>(call: Promise<any>): Promise<T> {
    let response;
    try { response = await call; } catch { throw new PurchaseRequestError('The result could not be confirmed. Retry the same request.', false); }
    if (!response?.success) throw new PurchaseRequestError(response?.error || 'Purchase request failed.', response?.outcomeUncertain !== true);
    if (!response.data) throw new PurchaseRequestError('The result could not be confirmed. Retry the same request.', false);
    return response.data;
}
export const purchasesService = {
    adjust: (input: PurchaseAdjustmentInput) => request<{id:string}>(window.electronAPI.purchases.adjust(input)),
    refund: (input: PurchaseRefundInput) => request<{id:string}>(window.electronAPI.purchases.refund(input)),
    list: (input: { search: string; page: number }) => request<{ items: PurchaseRecord[]; total: number; page: number; totals: {totalPaise: number; paidPaise: number; duePaise: number; creditDuePaise:number} }>(window.electronAPI.purchases.list(input)),
    items: (search: string) => request<PurchaseItemOption[]>(window.electronAPI.purchases.items({ search })),
    detail: (id: string) => request<PurchaseDetail>(window.electronAPI.purchases.detail({ id })),
    receive: (input: PurchaseInput) => request<{ id: string; barcodes: string[]; totalPaise: number }>(window.electronAPI.purchases.receive(input)),
    pay: (input: PurchasePaymentInput) => request<{ id: string }>(window.electronAPI.purchases.pay(input)),
};
