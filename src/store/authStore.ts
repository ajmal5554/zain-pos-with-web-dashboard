import { create } from 'zustand';

interface User {
    id: string;
    username: string;
    name: string;
    role: string;
    permPrintSticker: boolean;
    permAddItem: boolean;
    permDeleteProduct: boolean;
    permVoidSale: boolean;
    permViewReports: boolean;
    permViewSales: boolean;
    permViewGstReports: boolean;
    permManageProducts: boolean;
    permEditSettings: boolean;
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

interface AuthState {
    user: User | null;
    isAuthenticated: boolean;
    login: (user: User) => void;
    logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    isAuthenticated: false,
    login: (user) => set({ user, isAuthenticated: true }),
    logout: () => set({ user: null, isAuthenticated: false }),
}));
