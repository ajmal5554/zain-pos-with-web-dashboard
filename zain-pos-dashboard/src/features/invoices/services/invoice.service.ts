import api from '@/lib/api';

export interface InvoiceItem {
    id?: string;
    quantity: number;
    mrp?: number;
    sellingPrice: number;
    discount?: number;
    taxRate?: number;
    total?: number;
    product: {
        name: string;
    };
}

export interface InvoicePayment {
    paymentMode: string;
    amount: number;
}

export interface Invoice {
    id: string;
    billNo: string | number;
    total: number;
    subtotal?: number;
    discount?: number;
    taxAmount?: number;
    cgst?: number;
    sgst?: number;
    paymentMethod?: string;
    paidAmount?: number;
    changeAmount?: number;
    status?: string;
    cashierName?: string;
    payments?: InvoicePayment[];
    createdAt: string;
    customer: {
        name: string;
        phone: string;
    };
    itemCount: number; // always present (from list query)
    items: InvoiceItem[]; // populated on detail fetch (GET /invoices/:id)
}

export interface InvoiceParams {
    page?: number;
    limit?: number;
    search?: string;
    startDate?: string; // ISO string
    endDate?: string;   // ISO string
}

export interface PaginatedResponse<T> {
    invoices: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
}

export const invoiceService = {
    getInvoices: async (params: InvoiceParams): Promise<PaginatedResponse<Invoice>> => {
        const response = await api.get('/invoices', { params });
        return response.data;
    },

    getInvoiceById: async (id: string): Promise<Invoice> => {
        const response = await api.get(`/invoices/${id}`);
        return response.data;
    }
};
