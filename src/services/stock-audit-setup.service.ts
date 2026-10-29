import type { StockAuditSetup, SaveAuditSetupInput } from '../types/stockAuditSetup';
import { StockConversionRequestError } from './stock-conversion.service';
const result = async (request: Promise<any>): Promise<StockAuditSetup> => {
    const response = await request;
    if (!response?.success) throw new StockConversionRequestError(response?.error || 'Could not save audit setup.', response?.outcomeUncertain !== true);
    if (!response.data || !Array.isArray(response.data.categories)) throw new StockConversionRequestError('The setup result could not be confirmed. Retry the same request.', false);
    return response.data;
};
export const stockAuditSetupService = {
    get: () => result(window.electronAPI.stockAuditSetup.get()),
    save: (input: SaveAuditSetupInput) => result(window.electronAPI.stockAuditSetup.save(input)),
};
