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

export interface CustomerStats {
    total: number;
    repeatBuyers: number;
    totalRevenue: number;
    gstinCount: number;
}

export interface CustomerDetailResponse {
    customer: Customer;
    sales: Array<{
        id: string;
        billNo: string;
        grandTotal: number;
        status: string;
        paymentMethod: string;
        createdAt: string;
    }>;
}

export const customerService = {
    async getCustomers(page = 1, limit = 10, search = '', sortBy = 'newest'): Promise<CustomerResponse> {
        const response = await api.get('/customers', {
            params: { page, limit, search, sortBy }
        });
        return response.data;
    },

    async getCustomerStats(): Promise<CustomerStats> {
        const response = await api.get('/customers/stats');
        return response.data;
    },

    async getCustomer(id: string): Promise<CustomerDetailResponse> {
        const response = await api.get(`/customers/${id}`);
        return response.data;
    },

    async createCustomer(data: { name: string; phone?: string; email?: string; address?: string; gstin?: string }): Promise<Customer> {
        const response = await api.post('/customers', data);
        return response.data;
    },

    async updateCustomer(id: string, data: { name: string; phone?: string; email?: string; address?: string; gstin?: string }): Promise<Customer> {
        const response = await api.put(`/customers/${id}`, data);
        return response.data;
    },

    async deleteCustomer(id: string): Promise<{ success: boolean; message: string }> {
        const response = await api.delete(`/customers/${id}`);
        return response.data;
    }
};
