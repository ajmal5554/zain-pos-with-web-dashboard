import { useAuthStore } from '../store/authStore';
import type { InventoryQuery, InventoryWorkspaceResponse } from '../types/inventoryWorkspace';

export const inventoryWorkspaceService = {
    getInventory: async (query: InventoryQuery = {}): Promise<InventoryWorkspaceResponse> => {
        const user = useAuthStore.getState().user;
        if (!user || user.isActive === false || (user.role !== 'ADMIN' && !user.permManageInventory)) {
            throw new Error('Inventory access is required.');
        }
        if (!window.electronAPI?.stock?.getInventory) {
            throw new Error('Inventory is unavailable in this environment.');
        }
        const response = await window.electronAPI.stock.getInventory(query);
        if (!response.success) throw new Error(response.error || 'Could not load inventory.');
        return response.data;
    },
};
