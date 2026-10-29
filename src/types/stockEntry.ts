export interface StockEntryRow {
    sourceRowId?: string;
    name: string;
    category: string;
    brand: string;
    size: string;
    mrp: number;
    quantity: number;
    attributes: Record<string, string | null>;
    attributeLabels?: Record<string, string>;
}
export interface StockEntryInput {
    operationId: string;
    batchName: string;
    fileHash?: string;
    mergeMatching?: boolean;
    rows: StockEntryRow[];
}
export interface StockEntryResult {
    batchId: string;
    batchName: string;
    totalPieces: number;
    items: Array<{ variantId: string; barcode: string; stock: number }>;
}
