import type {ExpenseInput,ExpenseAction,ExpenseQuery} from '../src/types/expenses';
import type { PurchaseInput, PurchasePaymentInput, PurchaseAdjustmentInput, PurchaseRefundInput } from '../src/types/purchases';
import { contextBridge, ipcRenderer } from 'electron';
import type { ExcelAuditListInput, ExcelAuditUploadInput } from '../src/types/excelAudit';
import type { InventoryQuery } from '../src/types/inventoryWorkspace';
import type { PrepareAuditSelection, PostStockBatchInput, AdjustTrackedStockInput } from '../src/types/stockConversion';
import type { StockEntryInput } from '../src/types/stockEntry';
import type { SaveAuditSetupInput } from '../src/types/stockAuditSetup';
import type { SaveLabelTemplateInput } from '../src/lib/labelTemplate';

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
        bulkSyncAll: (progressCallback?: (progress: any) => void) => {
            if (progressCallback) {
                ipcRenderer.on('cloud:bulkSyncProgress', (_event, progress) => {
                    progressCallback(progress);
                });
            }
            return ipcRenderer.invoke('cloud:bulkSyncAll');
        },
    },

    // Settings
    settings: {
        saveLabelTemplate: (input: SaveLabelTemplateInput) => ipcRenderer.invoke('settings:saveLabelTemplate', input),
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
        getSaleById: (saleId: string) => ipcRenderer.invoke('sales:getSaleById', saleId),
        updatePayment: (data: { saleId: string, paymentData: any, userId: string }) =>
            ipcRenderer.invoke('sales:updatePayment', data),
        updateSale: (data: { saleId: string, saleData: any, userId: string }) =>
            ipcRenderer.invoke('sales:updateSale', data),
        exchange: (data: any) => ipcRenderer.invoke('sales:exchange', data),
        refund: (data: any) => ipcRenderer.invoke('sales:refund', data),
        getReturnStockOptions: (input: { sourceVariantId: string; search?: string }) => ipcRenderer.invoke('sales:getReturnStockOptions', input),
        getExchangeDetails: (data: { billNo?: string; saleId?: string; remarks?: string; isOriginal?: boolean; isReplacement?: boolean }) =>
            ipcRenderer.invoke('sales:getExchangeDetails', data),
        voidSale: (data: { saleId: string, reason: string, userId: string }) =>
            ipcRenderer.invoke('sales:voidSale', data),
    },

    // Printing
    print: {
        listPrinters: () => ipcRenderer.invoke('print:listPrinters'),
        receipt: (data: any) => ipcRenderer.invoke('print:receipt', data),
        label: (data: any) => ipcRenderer.invoke('print:label', data),
        testReceipt: (data: any) => ipcRenderer.invoke('print:testReceipt', data),
        testLabel: (data: any) => ipcRenderer.invoke('print:testLabel', data),
        testConnection: (data: any) => ipcRenderer.invoke('print:testConnection', data),
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
        logout: () => ipcRenderer.invoke('auth:logout'),
    },

    // Devices
    devices: {
        list: () => ipcRenderer.invoke('devices:list'),
    },

    // App
    app: {
        quit: () => ipcRenderer.invoke('app:quit'),
        minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
        toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
        closeWindow: () => ipcRenderer.invoke('window:close'),
        getWindowState: () => ipcRenderer.invoke('window:getState'),
        onWindowStateChange: (callback: (state: { isMaximized: boolean }) => void) => {
            const listener = (_event: Electron.IpcRendererEvent, state: { isMaximized: boolean }) => {
                callback(state);
            };

            ipcRenderer.on('window:stateChanged', listener);

            return () => {
                ipcRenderer.off('window:stateChanged', listener);
            };
        },
    },

    // Network Status
    network: {
        getStatus: () => ipcRenderer.invoke('network:getStatus'),
        forceCheck: () => ipcRenderer.invoke('network:forceCheck'),
        onChange: (callback: (status: { online: boolean; lastChecked: Date; checkMethod: 'navigator' | 'ping' | 'initial' }) => void) => {
            const listener = (_event: Electron.IpcRendererEvent, status: { online: boolean; lastChecked: Date; checkMethod: 'navigator' | 'ping' | 'initial' }) => {
                callback(status);
            };

            void ipcRenderer.invoke('network:subscribe');
            ipcRenderer.on('network:statusChanged', listener);

            const unsubscribe = () => {
                ipcRenderer.off('network:statusChanged', listener);
            };

            return unsubscribe;
        },
    },

    // Cash Register / Daily Reconciliation
    register: {
        getCurrent: () => ipcRenderer.invoke('register:get-current'),
        addTx: (data: { type: string; category: string; amount: number; note: string; userId?: string }) =>
            ipcRenderer.invoke('register:add-tx', data),
        deleteTx: (txId: string, userId?: string) => ipcRenderer.invoke('register:delete-tx', { txId, userId }),
        adjustOpeningFloat: (openingFloat: number, userId?: string) =>
            ipcRenderer.invoke('register:adjust-opening-float', { openingFloat, userId }),
        close: (data: { actualCashCounted: number; notes?: string; registerId?: string; userId?: string }) =>
            ipcRenderer.invoke('register:close', data),
        reopen: (registerId?: string, userId?: string) => ipcRenderer.invoke('register:reopen', { registerId, userId }),
        getHistory: (limit?: number) => ipcRenderer.invoke('register:get-history', { limit }),
    },

    // Stock / Inventory (ST-01)
    stock: {
        getInventory: (args: InventoryQuery = {}) => ipcRenderer.invoke('stock:getInventory', args),
        getOverview: (args: {
            page?: number;
            pageSize?: number;
            search?: string;
            categoryId?: string;
            balanceFilter?: 'ALL' | 'POSITIVE' | 'ZERO' | 'NEGATIVE';
            userId: string;
        }) => ipcRenderer.invoke('stock:getOverview', args),
        getMovements: (args: {
            variantId: string;
            fromDate?: string;
            toDate?: string;
            limit?: number;
            offset?: number;
            userId: string;
        }) => ipcRenderer.invoke('stock:getMovements', args),
    },

    // Catalogue & Labels (ST-02)
    catalogue: {
        saveProduct: (data: any) => ipcRenderer.invoke('catalogue:saveProduct', data),
        getProduct: (id: string, userId?: string) => ipcRenderer.invoke('catalogue:getProduct', { id, userId }),
        listProducts: (args?: any) => ipcRenderer.invoke('catalogue:listProducts', args),
        listVariants: (args?: any) => ipcRenderer.invoke('catalogue:listVariants', args),
        generateBarcode: (args: { draftId: string; excludeCodes?: string[]; userId?: string }) =>
            ipcRenderer.invoke('catalogue:generateBarcode', args),
        checkBarcode: (barcode: string, excludeVariantId?: string, userId?: string) =>
            ipcRenderer.invoke('catalogue:checkBarcode', { barcode, excludeVariantId, userId }),
    },

    // Stock Count Drafts (ST-03A)
    stockDraft: {
        list: (args?: any) => ipcRenderer.invoke('stockDraft:list', args),
        get: (args: { draftId: string }) => ipcRenderer.invoke('stockDraft:get', args),
        searchVariants: (args?: { search?: string; limit?: number }) => ipcRenderer.invoke('stockDraft:searchVariants', args),
        create: (data: any) => ipcRenderer.invoke('stockDraft:create', data),
        save: (data: any) => ipcRenderer.invoke('stockDraft:save', data),
        cancel: (data: any) => ipcRenderer.invoke('stockDraft:cancel', data),
    },

    // Explicit preparation and posting; uploading an audit alone never activates stock.
    expenses: {
        create:(input:ExpenseInput)=>ipcRenderer.invoke('expenses:create',input),
        act:(input:ExpenseAction)=>ipcRenderer.invoke('expenses:act',input),
        list:(input:ExpenseQuery)=>ipcRenderer.invoke('expenses:list',input),
        detail:(id:string)=>ipcRenderer.invoke('expenses:detail',{id}),
        export:(input:ExpenseQuery)=>ipcRenderer.invoke('expenses:export',input),
    },
    insights: { get:()=>ipcRenderer.invoke('insights:get') as Promise<{success:boolean;data?:import('../src/types/insights').BusinessInsights;error?:string}> },
    profit: { get:(input:{from:string;to:string})=>ipcRenderer.invoke('profit:get',input) as Promise<{success:boolean;data?:Awaited<ReturnType<typeof import('./profit.service').getProfitReport>>;error?:string}> },
    saleCosts: { get: (saleId:string) => ipcRenderer.invoke('sales:getCosts',{saleId}) },
    purchases: {
        adjust: (input: PurchaseAdjustmentInput) => ipcRenderer.invoke('purchases:adjust', input),
        refund: (input: PurchaseRefundInput) => ipcRenderer.invoke('purchases:refund', input),
        receive: (input: PurchaseInput) => ipcRenderer.invoke('purchases:receive', input),
        pay: (input: PurchasePaymentInput) => ipcRenderer.invoke('purchases:pay', input),
        list: (input: {search: string; page: number}) => ipcRenderer.invoke('purchases:list', input),
        detail: (input: {id: string}) => ipcRenderer.invoke('purchases:detail', input),
        items: (input: {search: string}) => ipcRenderer.invoke('purchases:items', input),
    },
    stockConversion: {
        saveEntry: (input: StockEntryInput) => ipcRenderer.invoke('stockConversion:saveEntry', input),
        prepare: (input: PrepareAuditSelection) => ipcRenderer.invoke('stockConversion:prepare', input),
        postBatch: (input: PostStockBatchInput) => ipcRenderer.invoke('stockConversion:postBatch', input),
        adjust: (input: AdjustTrackedStockInput) => ipcRenderer.invoke('stockConversion:adjust', input),
    },
    stockAuditSetup: {
        get: () => ipcRenderer.invoke('stockAuditSetup:get'),
        save: (input: SaveAuditSetupInput) => ipcRenderer.invoke('stockAuditSetup:save', input),
    },

    // Excel audit snapshots are separate from products, stock balances and count drafts.
    excelAudit: {
        status: () => ipcRenderer.invoke('excelAudit:status'),
        list: (input: ExcelAuditListInput = {}) => ipcRenderer.invoke('excelAudit:list', input),
        preview: (input: ExcelAuditUploadInput) => ipcRenderer.invoke('excelAudit:preview', input),
        commit: (input: { token: string }) => ipcRenderer.invoke('excelAudit:commit', input),
    },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;


