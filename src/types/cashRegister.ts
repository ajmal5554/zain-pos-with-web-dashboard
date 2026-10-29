// Types for the Cash Drawer / Daily Register Reconciliation feature

export type TxType = 'CASH_OUT' | 'CASH_IN' | 'CASH_SALE' | 'CASH_REFUND';

export type TxCategory =
    | 'OWNER_WITHDRAWAL'
    | 'FREIGHT'
    | 'MUNICIPALITY'
    | 'EXPENSE'
    | 'CHANGE_FLOAT'
    | 'TOP_UP'
    | 'POS_SALE'
    | 'SUPPLIER_PAYMENT'
    | 'SUPPLIER_REFUND'
    | 'BUSINESS_EXPENSE'
    | 'EXPENSE_REVERSAL'
    | 'REFUND';

export interface CashDrawerTx {
    id: string;
    registerId?: string;
    type: TxType;
    category: TxCategory | string;
    amount: number;
    note: string;
    createdAt: string;
    isSale?: boolean;
    isRefund?: boolean;
    billNo?: string;
}

export interface CashRegister {
    id: string;
    date: string; // YYYY-MM-DD
    openedAt: string;
    closedAt?: string | null;
    openingFloat: number;
    closingExpected?: number | null;
    closingActual?: number | null;
    difference?: number | null;
    status: 'OPEN' | 'CLOSED';
    notes?: string | null;
    transactions?: CashDrawerTx[];
}

export interface RegisterSummary {
    register: CashRegister;
    openingFloat: number;
    cashSales: number; // Net cash sales (gross - refunds)
    grossCashSales?: number;
    cashRefunds?: number;
    cashOut: number;
    cashIn: number;
    expectedCashInDrawer: number;
    transactions: CashDrawerTx[];
    isPreviousDayUnclosed?: boolean;
    unclosedRegisterDate?: string;
}

export const TX_CATEGORY_LABELS: Record<TxCategory, string> = {
    OWNER_WITHDRAWAL: 'Owner Withdrawal / Taken Home',
    MUNICIPALITY: 'Municipality / Tax',
    FREIGHT: 'Freight / Transport',
    EXPENSE: 'Tea / Snacks / Other Expense',
    CHANGE_FLOAT: 'Change Float',
    TOP_UP: 'Cash Top-Up',
    POS_SALE: 'POS Cash Sale',
    SUPPLIER_PAYMENT: 'Supplier Payment',
    SUPPLIER_REFUND: 'Supplier Refund Received',
    BUSINESS_EXPENSE: 'Business Expense',
    EXPENSE_REVERSAL: 'Expense Entry Reversal',
    REFUND: 'Customer Refund',
};

export const CASH_OUT_CATEGORIES: TxCategory[] = [
    'OWNER_WITHDRAWAL',
    'MUNICIPALITY',
    'FREIGHT',
    'EXPENSE',
    'CHANGE_FLOAT',
];

export const CASH_IN_CATEGORIES: TxCategory[] = ['TOP_UP', 'CHANGE_FLOAT'];
