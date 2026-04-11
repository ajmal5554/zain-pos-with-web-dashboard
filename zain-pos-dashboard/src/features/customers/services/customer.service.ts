import api from '@/lib/api';

export interface Customer {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    gstin: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface CustomerResponse {
    customers: Customer[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        pages: number;
    };
}

export const customerService = {
    async getCustomers(page = 1, limit = 10, search = ''): Promise<CustomerResponse> {
        const response = await api.get('/customers', {
            params: { page, limit, search }
        });
        return response.data;
    }
};
