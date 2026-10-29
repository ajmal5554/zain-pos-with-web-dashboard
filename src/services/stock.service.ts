import { useAuthStore } from '../store/authStore';

export interface StockOverviewItem {
    id: string; // stable variant ID
    sku: string;
    barcode: string;
    size: string | null;
    color: string | null;
    stock: number;
    minStock: number;
    isActive: boolean;
    updatedAt: string | Date;
    product: {
        id: string;
        name: string;
        isActive: boolean;
        category: {
            id: string;
            name: string;
        };
    };
}

export interface StockOverviewStats {
    totalMatching: number;
    totalInFilter: number;
    positiveCount: number;
    zeroCount: number;
    negativeCount: number;
}

export interface StockOverviewResponse {
    items: StockOverviewItem[];
    totalMatching: number;
    page: number;
    pageSize: number;
    totalPages: number;
    stats: StockOverviewStats;
    categories: Array<{ id: string; name: string }>;
}

export interface InventoryMovementItem {
    id: string;
    variantId: string;
    type: string;
    quantity: number;
    reason: string | null;
    reference: string | null;
    createdBy: string;
    createdAt: string | Date;
    operatorName?: string;
}

export interface StockMovementsResponse {
    variant: {
        id: string;
        sku: string;
        barcode: string;
        size: string | null;
        color: string | null;
        stock: number;
        minStock: number;
        isActive: boolean;
        product: {
            id: string;
            name: string;
            isActive: boolean;
            category: {
                id: string;
                name: string;
            };
        };
    };
    movements: InventoryMovementItem[];
    totalMovements: number;
    limit: number;
    offset: number;
}

export const stockService = {
    getOverview: async (params: {
        page?: number;
        pageSize?: number;
        search?: string;
        categoryId?: string;
        balanceFilter?: 'ALL' | 'POSITIVE' | 'ZERO' | 'NEGATIVE';
    }): Promise<StockOverviewResponse> => {
        const userId = useAuthStore.getState().user?.id;
        if (!userId) {
            throw new Error('Authentication required');
        }
        if (!window.electronAPI?.stock?.getOverview) {
            throw new Error('Stock API is unavailable in this environment');
        }
        const res = await window.electronAPI.stock.getOverview({
            ...params,
            userId,
        });
        if (!res.success) {
            throw new Error(res.error || 'Failed to load stock overview');
        }
        return res.data;
    },

    getMovements: async (params: {
        variantId: string;
        fromDate?: string;
        toDate?: string;
        limit?: number;
        offset?: number;
    }): Promise<StockMovementsResponse> => {
        const userId = useAuthStore.getState().user?.id;
        if (!userId) {
            throw new Error('Authentication required');
        }
        if (!window.electronAPI?.stock?.getMovements) {
            throw new Error('Stock API is unavailable in this environment');
        }
        const res = await window.electronAPI.stock.getMovements({
            ...params,
            userId,
        });
        if (!res.success) {
            throw new Error(res.error || 'Failed to load movement history');
        }
        return res.data;
    },
};
