/** Uploaded audit observations, kept separate from shop inventory and count drafts. */
export interface ExcelAuditRow {
    id: string;
    sourceRow: number;
    name: string;
    barcode: string | null;
    size: string | null;
    category: string | null;
    brand: string | null;
    mrp: number | null;
    countedQuantity: number | null;
    attributes: Record<string, string | null>;
    lastUpdated: string | null;
    stockStatus?: 'PREPARED' | 'POSTED' | 'CANCELLED';
    stockDraftId?: string;
    stockVariantId?: string;
}

export interface ExcelAuditStatus {
    imported: boolean;
    fileName: string | null;
    sheetName: string | null;
    importedAt: string | null;
    fileHash: string | null;
    rowCount: number;
    countedRows: number;
    uncountedRows: number;
    totalQuantity: number;
}

export interface ExcelAuditUploadInput {
    fileName: string;
    bytes: Uint8Array;
}

export interface ExcelAuditPreview {
    token: string;
    status: ExcelAuditStatus;
    items: ExcelAuditRow[];
    warnings: string[];
    alreadyImported: boolean;
    replacesExisting: boolean;
}

export interface ExcelAuditListInput {
    page?: number;
    pageSize?: number;
    search?: string;
}

export interface ExcelAuditListResult {
    items: ExcelAuditRow[];
    totalMatching: number;
    page: number;
    pageSize: number;
    totalPages: number;
    status: ExcelAuditStatus;
}
