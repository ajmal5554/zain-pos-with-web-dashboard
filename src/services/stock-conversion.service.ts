import type {
    AdjustTrackedStockInput, PostStockBatchInput, PrepareAuditSelection,
    PreparedAuditBatch, PostedStockBatch, TrackedStockAdjustment,
} from '../types/stockConversion';
import type { StockEntryInput, StockEntryResult } from '../types/stockEntry';

function api() {
    const bridge = window.electronAPI?.stockConversion;
    if (!bridge) throw new Error('Audit and relabelling is available in the desktop POS app.');
    return bridge;
}
/** A lost IPC response may already have committed; keep the same operation ID for retries. */
export class StockConversionRequestError extends Error {
    constructor(message: string, public readonly confirmedRejected: boolean) {
        super(message);
        this.name = 'StockConversionRequestError';
    }
}
async function result<T>(request: Promise<{ success: boolean; data?: T; error?: string }>): Promise<T> {
    const response = await request;
    if (!response.success) throw new StockConversionRequestError(response.error || 'The stock operation could not be completed.', (response as any).outcomeUncertain !== true);
    if (!response.data || typeof response.data !== 'object') throw new StockConversionRequestError('The saved stock result could not be confirmed. Retry this same request.', false);
    return response.data as T;
}
export const stockConversionService = {
    saveEntry: (input: StockEntryInput): Promise<StockEntryResult> => result(api().saveEntry(input)),
    prepare: (input: PrepareAuditSelection): Promise<PreparedAuditBatch> => result(api().prepare(input)),
    postBatch: (input: PostStockBatchInput): Promise<PostedStockBatch> => result(api().postBatch(input)),
    adjust: (input: AdjustTrackedStockInput): Promise<TrackedStockAdjustment> => result(api().adjust(input)),
};
