import type { ExcelAuditRow } from './excelAudit';

export interface PrepareAuditSelection {
    operationId: string;
    fileHash: string;
    rowIds: string[];
    productName: string;
    categoryId: string;
    categoryName?: string;
    taxRate: number;
    styleConfirmed: boolean;
}
/** Rows are supplied exclusively by Electron's validated saved Excel audit. */
export interface PrepareAuditStyleInput extends PrepareAuditSelection {
    rows: ExcelAuditRow[];
    fileName: string;
}
export interface PreparedAuditBatch {
    productId: string;
    draftId: string;
    variantIds: string[];
    sourceRowIds: string[];
}
export interface PostStockBatchInput {
    operationId: string;
    draftId: string;
    expectedRevision: number;
    held: boolean;
    labelsApplied: boolean;
    countsChecked: boolean;
}
export interface PostedStockBatch {
    draftId: string;
    status: 'POSTED';
    postedAt: string;
    totalPieces: number;
    items: Array<{ variantId: string; addedQuantity: number; stock: number }>;
}
export type StockAdjustmentKind = 'RECEIPT' | 'DAMAGE' | 'RECOUNT';
export interface AdjustTrackedStockInput {
    operationId: string;
    variantId: string;
    kind: StockAdjustmentKind;
    quantity: number;
    expectedStock?: number;
    reason: string;
}
export interface TrackedStockAdjustment {
    variantId: string;
    stock: number;
    delta: number;
    operationId: string;
}
