import api from '@/lib/api';

export interface AdminUser {
    id: string;
    username: string;
    name: string;
    role: 'ADMIN' | 'CASHIER';
    isActive: boolean;
    permPrintSticker: boolean;
    permAddItem: boolean;
    permDeleteProduct: boolean;
    permVoidSale: boolean;
    permViewReports: boolean;
    permEditSettings: boolean;
    permManageProducts: boolean;
    permViewSales: boolean;
    permViewGstReports: boolean;
    permEditSales: boolean;
    permManageInventory: boolean;
    permManageUsers: boolean;
    permViewCostPrice: boolean;
    permChangePayment: boolean;
    permDeleteAudit: boolean;
    permBulkUpdate: boolean;
    permBackDateSale: boolean;
    permViewInsights: boolean;
    maxDiscount: number;
}

export interface AdminSetting {
    id: string;
    key: string;
    value: string;
    updatedAt: string;
}

export const adminService = {
    async getUsers() {
        const response = await api.get<AdminUser[]>('/admin/users');
        return response.data;
    },

    async createUser(data: { username: string; password: string; name: string; role: 'ADMIN' | 'CASHIER' }) {
        const response = await api.post<AdminUser>('/admin/users', data);
        return response.data;
    },

    async updateUser(id: string, data: Partial<AdminUser>) {
        const response = await api.patch<AdminUser>(`/admin/users/${id}`, data);
        return response.data;
    },

    async updatePassword(id: string, password: string) {
        const response = await api.patch(`/admin/users/${id}/password`, { password });
        return response.data;
    },

    async getSettings(keys?: string[]) {
        const response = await api.get<AdminSetting[]>('/admin/settings', {
            params: keys?.length ? { keys: keys.join(',') } : undefined
        });
        return response.data;
    },

    async setSetting(key: string, value: string) {
        const response = await api.put<AdminSetting>(`/admin/settings/${key}`, { value });
        return response.data;
    }
};
