/**
 * Browser Bridge (Web Preview Fallback)
 * When the POS frontend is accessed via regular web browser on another computer,
 * window.electronAPI is not provided natively by Electron.
 * This bridge transparently routes calls over HTTP to the dev server backend.
 */

// Kept only in this document's memory: a reload requires a password login again.
let browserSessionToken: string | null = null;

async function callIpc(channel: string, args: any = {}) {
    const token = browserSessionToken;
    const isDraftWrite = ['stockDraft:create', 'stockDraft:save', 'stockDraft:cancel'].includes(channel);
    if (channel === 'auth:logout') browserSessionToken = null;
    try {
        const res = await fetch('/api/ipc', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ channel, args }),
        });
        if (!res.ok) {
            if (res.status === 401 || channel === 'auth:login') browserSessionToken = null;
            const err = await res.json().catch(() => null);
            return {
                success: false,
                error: err?.error || res.statusText || 'Server error',
                // A malformed/proxy error is not proof that an already sent write failed.
                ...(isDraftWrite && (!err || (res.status >= 500 && err.success !== false))
                    ? { outcomeUncertain: true } : {}),
            };
        }
        const result = await res.json();
        if (channel === 'auth:login') {
            browserSessionToken = result.success && typeof result.sessionToken === 'string'
                ? result.sessionToken : null;
        }
        const { sessionToken: _sessionToken, ...response } = result;
        return response;
    } catch (e: any) {
        if (channel === 'auth:login') browserSessionToken = null;
        return {
            success: false, error: e.message || 'Network error',
            ...(isDraftWrite ? { outcomeUncertain: true } : {}),
        };
    }
}

export function initBrowserBridge() {
    if (typeof window === 'undefined') return;
    if (window.electronAPI) return; // Already running natively in Electron desktop app

    console.info('[BrowserBridge] Initializing web preview bridge for browser access');

    window.addEventListener('pagehide', () => {
        const token = browserSessionToken;
        browserSessionToken = null;
        if (token) {
            void fetch('/api/ipc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ channel: 'auth:logout', args: {} }),
                keepalive: true,
            }).catch(() => undefined);
        }
    });

    window.electronAPI = {
        db: {
            secureQuery: (args: any) => callIpc('db:secureQuery', args),
            backup: async () => ({ success: false, error: 'Not supported in browser preview' }),
            restore: async () => ({ success: false, error: 'Not supported in browser preview' }),
            configureBackup: async () => ({ success: false }),
            syncNow: async () => ({ success: false }),
            configureSync: async () => ({ success: false }),
            bulkSyncAll: async () => ({ success: false }),
        },
        insights: {get:()=>callIpc('insights:get')},
        settings: {
            get: (args: any) => callIpc('settings:get', args),
            set: (args: any) => callIpc('settings:set', args),
        },
        data: {
            downloadProductTemplate: async () => ({ success: false }),
            importProducts: async () => ({ success: false }),
            importAll: async () => ({ success: false }),
            exportAll: async () => ({ success: false }),
            restoreFromExcelBackup: async () => ({ success: false }),
        },
        sales: {
            getNextBillNo: (dateStr?: string) => callIpc('sales:getNextBillNo', { dateStr }),
            checkout: (data: any) => callIpc('sales:checkout', data),
            getSaleById: (saleId: string) => callIpc('sales:getSaleById', { saleId }),
            updatePayment: (data: any) => callIpc('sales:updatePayment', data),
            updateSale: (data: any) => callIpc('sales:updateSale', data),
            exchange: (data: any) => callIpc('sales:exchange', data),
            refund: (data: any) => callIpc('sales:refund', data),
            getExchangeDetails: (data: any) => callIpc('sales:getExchangeDetails', data),
            voidSale: (data: any) => callIpc('sales:voidSale', data),
        },
        print: {
            listPrinters: async () => ({ success: false, error: 'Printer discovery requires the desktop app.' }),
            receipt: async () => ({ success: false, error: 'Hardware printing not available in web browser' }),
            label: (data: any) => callIpc('print:label', data),
            testReceipt: async () => ({ success: false }),
            testLabel: (data: any) => callIpc('print:testLabel', data),
            testConnection: async () => ({ success: false }),
        },
        users: {
            listForLogin: () => callIpc('users:listForLogin', {}),
            list: (args?: any) => callIpc('users:list', args || {}),
            create: (args: any) => callIpc('users:create', args),
            update: (id: string, args: any) => callIpc('users:update', { id, ...args }),
            changePassword: (args: any) => callIpc('users:changePassword', args),
            delete: (args: any) => callIpc('users:delete', args),
        },
        auth: {
            login: (args: any) => callIpc('auth:login', args),
            logout: () => callIpc('auth:logout', {}),
        },
        devices: {
            list: async () => ({ success: true, data: [] }),
        },
        app: {
            quit: () => {},
            minimizeWindow: () => {},
            toggleMaximizeWindow: async () => ({ isMaximized: false }),
            closeWindow: () => {},
            getWindowState: async () => ({ success: true, isMaximized: false }),
            onWindowStateChange: () => () => {},
        },
        network: {
            getStatus: async () => ({
                online: typeof navigator !== 'undefined' ? navigator.onLine : true,
                lastChecked: new Date(),
                checkMethod: 'navigator' as const,
            }),
            forceCheck: async () => ({
                online: typeof navigator !== 'undefined' ? navigator.onLine : true,
                lastChecked: new Date(),
                checkMethod: 'navigator' as const,
            }),
            onChange: (callback: any) => {
                const handleOnline = () => callback({ online: true, lastChecked: new Date(), checkMethod: 'navigator' });
                const handleOffline = () => callback({ online: false, lastChecked: new Date(), checkMethod: 'navigator' });
                window.addEventListener('online', handleOnline);
                window.addEventListener('offline', handleOffline);
                return () => {
                    window.removeEventListener('online', handleOnline);
                    window.removeEventListener('offline', handleOffline);
                };
            },
        },
        register: {
            getCurrent: () => callIpc('register:get-current', {}),
            addTx: (data: any) => callIpc('register:add-tx', data),
            deleteTx: (txId: string, userId?: string) => callIpc('register:delete-tx', { txId, userId }),
            adjustOpeningFloat: (openingFloat: number, userId?: string) => callIpc('register:adjust-opening-float', { openingFloat, userId }),
            close: (data: any) => callIpc('register:close', data),
            reopen: (registerId?: string, userId?: string) => callIpc('register:reopen', { registerId, userId }),
            getHistory: (limit?: number) => callIpc('register:get-history', { limit }),
        },
        stock: {
            getOverview: (args: any) => callIpc('stock:getOverview', args),
            getMovements: (args: any) => callIpc('stock:getMovements', args),
        },
        catalogue: {
            saveProduct: (data: any) => callIpc('catalogue:saveProduct', data),
            getProduct: (id: string, userId?: string) => callIpc('catalogue:getProduct', { id, userId }),
            listProducts: (args?: any) => callIpc('catalogue:listProducts', args),
            listVariants: (args?: any) => callIpc('catalogue:listVariants', args),
            generateBarcode: (args: { draftId: string; excludeCodes?: string[] }) =>
                callIpc('catalogue:generateBarcode', args),
            checkBarcode: (barcode: string, excludeVariantId?: string, userId?: string) =>
                callIpc('catalogue:checkBarcode', { barcode, excludeVariantId, userId }),
        },
        stockDraft: {
            list: (args: any) => callIpc('stockDraft:list', args),
            get: (args: any) => callIpc('stockDraft:get', args),
            searchVariants: (args: any) => callIpc('stockDraft:searchVariants', args),
            create: (data: any) => callIpc('stockDraft:create', data),
            save: (data: any) => callIpc('stockDraft:save', data),
            cancel: (data: any) => callIpc('stockDraft:cancel', data),
        },
    } as any;
}

