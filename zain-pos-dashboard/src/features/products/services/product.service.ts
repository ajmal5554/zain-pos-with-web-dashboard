import api from '@/lib/api';

export interface ProductVariantForm {
    id?: string;
    sku: string;
    size: string;
    color: string;
    barcode: string;
    mrp: number;
    sellingPrice: number;
    costPrice: number;
    stock: number;
    minStock: number;
}

export interface ManagedProduct {
    id: string;
    name: string;
    categoryId: string;
    category?: {
        id: string;
        name: string;
    };
    hsn?: string | null;
    taxRate: number;
    description?: string | null;
    variants: ProductVariantForm[];
    updatedAt?: string;
}

export interface ProductCategory {
    id: string;
    name: string;
    _count?: {
        products: number;
    };
}

export const productService = {
    async getProducts(search?: string) {
        const response = await api.get<ManagedProduct[]>('/inventory/products/manage', {
            params: search ? { search } : undefined
        });
        return response.data;
    },

    async getCategories() {
        const response = await api.get<ProductCategory[]>('/inventory/categories');
        return response.data;
    },

    async createProduct(data: Omit<ManagedProduct, 'id'>) {
        const response = await api.post<ManagedProduct>('/inventory/products', data);
        return response.data;
    },

    async updateProduct(id: string, data: Omit<ManagedProduct, 'id'>) {
        const response = await api.patch<ManagedProduct>(`/inventory/products/${id}`, data);
        return response.data;
    },

    async deleteProduct(id: string) {
        const response = await api.delete<{ success: boolean }>(`/inventory/products/${id}`);
        return response.data;
    }
};
