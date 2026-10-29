export interface StockDraftSummary {
    id: string;
    operationKind: string;
    status: 'DRAFT' | 'CANCELLED' | 'POSTED';
    batchDescription: string;
    sourceReference: string | null;
    notes: string | null;
    observedAt: string | null;
    revision: number;
    createdBy: string;
    createdByName: string;
    updatedBy: string;
    updatedByName: string;
    createdAt: string;
    updatedAt: string;
    totalLines: number;
    countedLines: number;
    totalCountedPieces: number;
}

export interface StockDraftLineDetail {
    id: string;
    draftId: string;
    variantId: string;
    countedQuantity: number | null;
    notes: string;
    sortOrder: number;
    snapshot: {
        productName: string;
        barcode: string;
        sku: string;
        description: string;
        size: string | null;
        color: string | null;
        sellingPrice: number | null;
    };
    catalogueStatus: 'OK' | 'CHANGED' | 'UNAVAILABLE';
    statusMessage: string;
    currentLiveDetails: {
        productName: string;
        barcode: string;
        sku: string;
        formattedDescription: string;
        size?: string | null;
        color?: string | null;
        attributes?: Record<string, string | null>;
        sellingPrice: number;
        isPrepared: boolean;
        isTracked?: boolean;
        stock?: number;
    } | null;
}

export interface StockDraftDetail {
    id: string;
    operationKind: string;
    status: 'DRAFT' | 'CANCELLED' | 'POSTED';
    batchDescription: string;
    sourceReference: string;
    notes: string;
    observedAt: string | null;
    revision: number;
    createdBy: string;
    createdByName: string;
    updatedBy: string;
    updatedByName: string;
    createdAt: string;
    updatedAt: string;
    postedAt?: string | null;
    totalLines: number;
    totalCountedPieces: number;
    uncountedLines: number;
    lines: StockDraftLineDetail[];
}

export interface ListDraftsResponse {
    items: StockDraftSummary[];
    totalMatching: number;
    page: number;
    pageSize: number;
    totalPages: number;
    stats: {
        totalDrafts: number;
        activeDraftCount: number;
        cancelledDraftCount: number;
        postedDraftCount?: number;
    };
}

export interface PreparedVariantSearchResult {
    id: string;
    sku: string;
    barcode: string;
    size: string | null;
    color: string | null;
    sellingPrice: number;
    stock: number;
    isPrepared: boolean;
    productId: string;
    productName: string;
    categoryName: string;
    formattedDescription: string;
}

export interface DraftLineInputPayload {
    id?: string;
    variantId: string;
    countedQuantity: number | null;
    notes?: string;
    sortOrder?: number;
}

export interface CreateDraftPayload {
    operationId: string;
    draftId?: string;
    batchDescription: string;
    observedAt?: string | null;
    sourceReference?: string | null;
    notes?: string | null;
    lines?: DraftLineInputPayload[];
}

export interface SaveDraftPayload {
    operationId: string;
    draftId: string;
    expectedRevision: number;
    batchDescription: string;
    observedAt?: string | null;
    sourceReference?: string | null;
    notes?: string | null;
    lines: DraftLineInputPayload[];
}

export interface CancelDraftPayload {
    operationId: string;
    draftId: string;
    expectedRevision: number;
    reason?: string | null;
}

/** A server rejection is different from a lost response, which may have committed. */
export class StockDraftRequestError extends Error {
    constructor(message: string, public readonly confirmedRejected: boolean) {
        super(message);
        this.name = 'StockDraftRequestError';
    }
}

export const stockDraftService = {
    listDrafts: async (params: {
        page?: number;
        pageSize?: number;
        status?: 'ALL' | 'DRAFT' | 'CANCELLED' | 'POSTED';
        search?: string;
    } = {}): Promise<ListDraftsResponse> => {
        if (!window.electronAPI?.stockDraft?.list) {
            throw new Error('Stock Draft API is unavailable in this environment');
        }
        const res = await window.electronAPI.stockDraft.list(params);
        if (!res.success) {
            throw new Error(res.error || 'Failed to list stock drafts');
        }
        return res.data;
    },

    getDraft: async (draftId: string): Promise<StockDraftDetail> => {
        if (!window.electronAPI?.stockDraft?.get) {
            throw new Error('Stock Draft API is unavailable in this environment');
        }
        const res = await window.electronAPI.stockDraft.get({ draftId });
        if (!res.success) {
            throw new Error(res.error || 'Failed to get stock draft');
        }
        return res.data;
    },

    searchPreparedVariants: async (params: {
        search?: string;
        limit?: number;
    } = {}): Promise<PreparedVariantSearchResult[]> => {
        if (!window.electronAPI?.stockDraft?.searchVariants) {
            throw new Error('Stock Draft API is unavailable in this environment');
        }
        const res = await window.electronAPI.stockDraft.searchVariants(params);
        if (!res.success) {
            throw new Error(res.error || 'Failed to search prepared variants');
        }
        return res.data;
    },

    createDraft: async (payload: CreateDraftPayload): Promise<{
        success: boolean;
        message: string;
        draftId: string;
        revision: number;
        status: string;
        totalLines: number;
    }> => {
        if (!window.electronAPI?.stockDraft?.create) {
            throw new StockDraftRequestError('Stock Draft API is unavailable in this environment', true);
        }
        const res = await window.electronAPI.stockDraft.create(payload);
        if (!res.success) {
            throw new StockDraftRequestError(res.error || 'Failed to create stock draft', (res as any).outcomeUncertain !== true);
        }
        return res.data;
    },

    saveDraft: async (payload: SaveDraftPayload): Promise<{
        success: boolean;
        message: string;
        draftId: string;
        revision: number;
        status: string;
        totalLines: number;
    }> => {
        if (!window.electronAPI?.stockDraft?.save) {
            throw new StockDraftRequestError('Stock Draft API is unavailable in this environment', true);
        }
        const res = await window.electronAPI.stockDraft.save(payload);
        if (!res.success) {
            throw new StockDraftRequestError(res.error || 'Failed to save stock draft', (res as any).outcomeUncertain !== true);
        }
        return res.data;
    },

    cancelDraft: async (payload: CancelDraftPayload): Promise<{
        success: boolean;
        message: string;
        draftId: string;
        revision: number;
        status: string;
    }> => {
        if (!window.electronAPI?.stockDraft?.cancel) {
            throw new StockDraftRequestError('Stock Draft API is unavailable in this environment', true);
        }
        const res = await window.electronAPI.stockDraft.cancel(payload);
        if (!res.success) {
            throw new StockDraftRequestError(res.error || 'Failed to cancel stock draft', (res as any).outcomeUncertain !== true);
        }
        return res.data;
    },
};
