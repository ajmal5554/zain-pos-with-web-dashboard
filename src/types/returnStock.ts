export interface ReturnStockChoice {
    disposition: 'ORIGINAL' | 'TRACKED' | 'HOLD';
    targetVariantId?: string;
    confirmed: boolean;
    reason?: string;
}
export interface ReturnStockOptions {
    sourceTracked: boolean;
    requiresChoice: boolean;
    items: Array<{ id: string; barcode: string; name: string; description: string; stock: number }>;
}
export interface ReturnStockRoute {
    sourceVariantId: string;
    targetVariantId: string | null;
    quantity: number;
    disposition: 'ORIGINAL' | 'TRACKED' | 'HOLD';
    reason: string | null;
}
