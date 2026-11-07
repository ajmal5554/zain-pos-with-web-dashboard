export interface CreditNoteRecord {
    id: string;
    code: string;
    customerName: string | null;
    customerPhone: string | null;
    originalInvoiceId: string | null;
    originalBillNo: string | null;
    amountPaise: number;
    remainingPaise: number;
    amount: number; // in Rupees
    remainingAmount: number; // in Rupees
    reason: string | null;
    status: 'ACTIVE' | 'EXHAUSTED' | 'CANCELLED';
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    redemptions?: CreditNoteRedemptionRecord[];
}

export interface CreditNoteRedemptionRecord {
    id: string;
    creditNoteId: string;
    saleId: string;
    billNo: string;
    amountPaise: number;
    amount: number; // in Rupees
    createdBy: string;
    createdAt: string;
}

export interface IssueCreditNoteInput {
    customerName?: string | null;
    customerPhone?: string | null;
    amount: number;
    reason?: string | null;
    originalInvoiceId?: string | null;
    originalBillNo?: string | null;
}

export interface CreditNoteQuery {
    search?: string;
    status?: 'ALL' | 'ACTIVE' | 'EXHAUSTED' | 'CANCELLED';
    customerPhone?: string;
}

export interface CreditNoteRedemptionInput {
    creditNoteId: string;
    code?: string;
    amount: number;
}
