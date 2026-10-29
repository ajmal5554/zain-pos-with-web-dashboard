export type PurchasePaymentMode = 'UPI' | 'BANK' | 'CASH_DRAWER' | 'PERSONAL_CASH';
export interface PurchaseTaxInput {
    supplierGstin:string; cgst:number; sgst:number; igst:number; roundOff:number; itcStatus:'PENDING';
}
export interface PurchaseTaxSnapshot {
    supplierGstin:string; cgstPaise:number; sgstPaise:number; igstPaise:number; roundOffPaise:number;
    taxablePaise:number; totalTaxPaise:number; itcStatus:'PENDING';
}
export interface PurchaseLineInput {
    hsn?:string;
    variantId: string;
    quantity: number;
    unitCost: number;
    sellingPrice: number;
    mrp: number;
    expectedSellingPrice: number;
    expectedMrp: number;
}
export interface PurchaseInput {
    tax?:PurchaseTaxInput;
    operationId: string;
    supplier: string;
    invoiceNumber: string;
    invoiceDate: string;
    batchName: string;
    discount: number;
    charges: number;
    paid: number;
    paymentMode: PurchasePaymentMode;
    lines: PurchaseLineInput[];
}
export interface PurchaseItemOption {
    id: string; name: string; barcode: string; size: string | null;
    description: string | null; sellingPrice: number; mrp: number; stock: number;
}
export interface PurchaseRecord {
    id: string; supplier: string; invoiceNumber: string; invoiceDate: string; batchName: string;
    totalPaise: number; paidPaise: number; duePaise: number; createdAt: string;
    status: 'ACTIVE' | 'CANCELLED'; creditDuePaise: number;
}
export interface PurchaseDetail extends PurchaseRecord {
    tax?:PurchaseTaxSnapshot;
    discountPaise: number; chargesPaise: number; revision: number;
    original: {supplier: string; invoiceNumber: string; totalPaise: number; lines: Array<{id:string;name:string;barcode:string;quantity:number;unitCostPaise:number}>};
    adjustments: Array<{id:string;kind:string;reason:string;creditPaise:number;createdAt:string;createdBy:string;createdByName?:string;replacementJson:string|null;lines?:Array<{lineId:string;quantity:number;name:string;barcode:string}>}>;
    lines: Array<{ id: string; variantId: string; sourceVariantId: string; name: string; barcode: string;
        size: string | null; description: string | null; quantity: number; unitCostPaise: number;
        landedTotalPaise: number; sellingPricePaise: number; mrpPaise: number; returnedQuantity:number; stock:number; batchQuantityAvailable?:number|null;hsn?:string }>;
    payments: Array<{ id: string; amountPaise: number; mode: PurchasePaymentMode; createdAt: string;reason?:string|null }>;
}
export interface PurchaseAdjustmentInput {
    tax?:PurchaseTaxInput;
    operationId: string; purchaseId: string; expectedRevision: number;
    kind: 'RETURN' | 'CANCEL' | 'CORRECTION'; reason: string;
    credit?: number;
    lines?: Array<{lineId:string;quantity:number;unitCost?:number;hsn?:string}>;
    supplier?:string; invoiceNumber?:string; invoiceDate?:string; batchName?:string; discount?:number; charges?:number;
}
export interface PurchaseRefundInput {
    operationId:string; purchaseId:string; amount:number; mode:PurchasePaymentMode; reason:string;
}
export interface PurchasePaymentInput {
    operationId: string; purchaseId: string; amount: number; mode: PurchasePaymentMode;
}
