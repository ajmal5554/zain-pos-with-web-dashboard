export type InventoryScope = 'TRACKED' | 'PREPARED' | 'LEGACY';
export type InventoryGroupBy = 'STYLE' | 'SIZE';
export interface InventoryQuery {
    scope?: InventoryScope;
    groupBy?: InventoryGroupBy;
    page?: number;
    pageSize?: number;
    search?: string;
    categoryId?: string;
    brand?: string;
    size?: string;
    fabric?: string;
    pattern?: string;
    quality?: string;
    attributes?: Record<string, string>;
    balanceFilter?: 'ALL' | 'POSITIVE' | 'ZERO' | 'NEGATIVE';
}
export interface InventoryVariant {
    id: string;
    productId: string;
    name: string;
    categoryId: string;
    category: string;
    sku: string;
    barcode: string;
    size: string | null;
    stock: number;
    minStock: number;
    mrp: number;
    sellingPrice: number;
    scope: InventoryScope;
    updatedAt: string;
    attributes: Record<string, string | null>;
    attributeLabels?: Record<string, string>;
}
export interface InventoryGroup {
    id: string;
    name: string;
    category: string;
    variants: InventoryVariant[];
    quantity: number;
    mrpValue: number | null;
}
export interface InventoryWorkspaceResponse {
    scope: InventoryScope;
    groupBy: InventoryGroupBy;
    items: InventoryGroup[];
    page: number;
    pageSize: number;
    totalPages: number;
    totalMatching: number;
    stats: {
        styleCount: number;
        variantCount: number;
        quantity: number;
        mrpValue: number | null;
        categoryCount: number;
    };
    facets: {
        categories: Array<{ id: string; name: string }>;
        brands: string[];
        sizes: string[];
        fabrics: string[];
        patterns: string[];
        qualities: string[];
        attributes?: Array<{ key: string; values: string[] }>;
    };
}
