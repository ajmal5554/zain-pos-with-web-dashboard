export const EXPENSE_CATEGORIES = {
    RENT:'Rent', ELECTRICITY:'Electricity', WAGES:'Staff wages', TRANSPORT:'Transport',
    FEES:'Local fees / licences', REPAIRS:'Repairs / maintenance', SUPPLIES:'Shop supplies',
    COMMUNICATION:'Phone / internet', REFRESHMENTS:'Tea / refreshments', OTHER:'Other business expense',
} as const;
export type ExpenseCategory=keyof typeof EXPENSE_CATEGORIES;
export type ExpenseSource='CASH_DRAWER'|'UPI'|'BANK'|'PERSONAL_CASH';
export type ExpenseStatus='ACTIVE'|'REVIEW'|'EXCLUDED'|'VOIDED';
export interface ExpenseInput {operationId:string;date:string;category:ExpenseCategory;amount:number;note:string;paymentSource:ExpenseSource}
export interface ExpenseAction {operationId:string;id:string;expectedRevision:number;action:'CLASSIFY'|'EXCLUDE'|'VOID';category?:ExpenseCategory;reason:string}
export interface ExpenseQuery {from:string;to:string;search?:string;status?:ExpenseStatus|'ALL';paymentSource?:ExpenseSource|'ALL';page?:number}
export interface ExpenseRecord {
    id:string;expenseDate:string;category:string;amountPaise:number;note:string;paymentSource:ExpenseSource;
    status:ExpenseStatus;revision:number;drawerTxId:string|null;createdAt:string;createdBy:string|null;
}
export interface ExpenseList {items:ExpenseRecord[];total:number;page:number;totals:{expensePaise:number;reviewPaise:number;reviewCount:number}}
export interface ExpenseDetail extends ExpenseRecord {history:Array<{id:string;action:string;reason:string;actor:string;createdAt:string}>}
