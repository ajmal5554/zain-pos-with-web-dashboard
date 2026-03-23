import { contextBridge, ipcRenderer } from 'electron';

const api = {
    // Database operations
    db: {
        secureQuery: (args: { model: string, method: string, args?: any, userId: string }) =>
            ipcRenderer.invoke('db:secureQuery', args),
        backup: () => ipcRenderer.invoke('db:backup'),
        restore: () => ipcRenderer.invoke('db:restore'),
        configureBackup: (config: any) => ipcRenderer.invoke('backup:configure', config),
        syncNow: () => ipcRenderer.invoke('cloud:syncNow'),
        configureSync: (config: { intervalMinutes: number }) => ipcRenderer.invoke('cloud:configure', config),
    },

    // Settings
    settings: {
        get: (args: { key: string, userId?: string }) => ipcRenderer.invoke('settings:get', args),
        set: (args: { key: string, value: string, userId: string }) => ipcRenderer.invoke('settings:set', args),
    },

    // Data Management (Import/Export)
    data: {
        downloadProductTemplate: () => ipcRenderer.invoke('products:importTemplate'),
        importProducts: () => ipcRenderer.invoke('products:import'),
        importAll: () => ipcRenderer.invoke('data:importAll'),
        exportAll: () => ipcRenderer.invoke('data:exportAll'),
        restoreFromExcelBackup: () => ipcRenderer.invoke('data:restoreFromExcelBackup'),
    },

    // Sales
    sales: {
        getNextBillNo: (dateStr?: string) => ipcRenderer.invoke('sales:getNextBillNo', dateStr),
        checkout: (data: any) => ipcRenderer.invoke('sales:checkout', data),
        updatePayment: (data: { saleId: string, paymentData: any, userId: string }) =>
            ipcRenderer.invoke('sales:updatePayment', data),
        updateSale: (data: { saleId: string, saleData: any, userId: string }) =>
            ipcRenderer.invoke('sales:updateSale', data),
        exchange: (data: any) => ipcRenderer.invoke('sales:exchange', data),
        refund: (data: any) => ipcRenderer.invoke('sales:refund', data),
        voidSale: (data: { saleId: string, reason: string, userId: string }) =>
            ipcRenderer.invoke('sales:voidSale', data),
    },

    // Printing
    print: {
        receipt: (data: any) => ipcRenderer.invoke('print:receipt', data),
        label: (data: any) => ipcRenderer.invoke('print:label', data),
    },

    // Users
    users: {
        listForLogin: () => ipcRenderer.invoke('users:listForLogin'),
        list: (args?: { requestingUserId?: string }) => ipcRenderer.invoke('users:list', args || {}),
        create: (args: { userData: any; createdBy: string }) => ipcRenderer.invoke('users:create', args),
        update: (id: string, args: { data: any; updatedBy: string }) => ipcRenderer.invoke('users:update', { id, ...args }),
        changePassword: (args: { id: string; password: string; changedBy: string }) => ipcRenderer.invoke('users:changePassword', args),
        delete: (args: { id: string; deletedBy: string }) => ipcRenderer.invoke('users:delete', args),
    },

    auth: {
        login: (args: { username: string; password: string }) => ipcRenderer.invoke('auth:login', args),
    },

    // Devices
    devices: {
        list: () => ipcRenderer.invoke('devices:list'),
    },

    // App
    app: {
        quit: () => ipcRenderer.invoke('app:quit'),
    },

    // Network Status
    network: {
        getStatus: () => ipcRenderer.invoke('network:getStatus'),
        forceCheck: () => ipcRenderer.invoke('network:forceCheck'),
        onChange: (callback: (status: { online: boolean; lastChecked: Date; checkMethod: string }) => void) => {
            // Subscribe to network status changes
            ipcRenderer.invoke('network:subscribe');

            // Listen for status changes
            const unsubscribe = () => {
                ipcRenderer.removeAllListeners('network:statusChanged');
            };

            ipcRenderer.on('network:statusChanged', (_event, status) => {
                callback(status);
            });

            return unsubscribe;
        },
    },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
