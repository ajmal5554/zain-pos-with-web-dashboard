import type { DashboardStats } from '@/features/dashboard/services/dashboard.service';
import type { Product } from '@/features/inventory/services/inventory.service';
import type { Invoice, PaginatedResponse } from '@/features/invoices/services/invoice.service';

export const DEMO_MODE_KEY = 'dashboard_demo_mode';
export const DEMO_TOKEN = 'demo-token';

export function isDemoModeEnabled() {
    return typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true';
}

export const demoDashboardStats: DashboardStats = {
    summary: {
        totalSales: 128450,
        totalOrders: 86,
        averageOrderValue: 1494,
        range: {
            start: new Date().toISOString(),
            end: new Date().toISOString()
        }
    },
    salesTrend: [
        { label: '18 Mar', sales: 14200, orders: 11 },
        { label: '19 Mar', sales: 18950, orders: 13 },
        { label: '20 Mar', sales: 17400, orders: 12 },
        { label: '21 Mar', sales: 22600, orders: 16 },
        { label: '22 Mar', sales: 55300, orders: 34 }
    ],
    paymentAudit: {
        CASH: [
            { id: 'cash-1', billNo: 'A-1021', grandTotal: 2400 },
            { id: 'cash-2', billNo: 'A-1025', grandTotal: 1350 }
        ],
        UPI: [
            { id: 'upi-1', billNo: 'A-1022', grandTotal: 1980 },
            { id: 'upi-2', billNo: 'A-1027', grandTotal: 4260 }
        ],
        CARD: [
            { id: 'card-1', billNo: 'A-1023', grandTotal: 3250 }
        ]
    },
    topProducts: [
        { product: { id: '1', name: 'Premium Linen Shirt' }, totalQuantity: 18, totalRevenue: 32400 },
        { product: { id: '2', name: 'Slim Fit Trousers' }, totalQuantity: 14, totalRevenue: 19600 },
        { product: { id: '3', name: 'Formal Blazer' }, totalQuantity: 8, totalRevenue: 28800 }
    ],
    lowStock: [
        { id: 'p4', name: 'Casual Polo', stock: 2, minStock: 6 },
        { id: 'p6', name: 'Leather Belt', stock: 1, minStock: 5 }
    ]
};

export const demoProducts: Product[] = [
    {
        id: 1,
        name: 'Premium Linen Shirt',
        description: 'Breathable slim-fit shirt',
        price: 1800,
        stock: 16,
        minStock: 5,
        barcode: 'LINEN-001',
        category: { name: 'Shirts' },
        updatedAt: new Date().toISOString()
    },
    {
        id: 2,
        name: 'Slim Fit Trousers',
        description: 'Tailored office trousers',
        price: 1400,
        stock: 9,
        minStock: 4,
        barcode: 'TROUSER-002',
        category: { name: 'Trousers' },
        updatedAt: new Date().toISOString()
    },
    {
        id: 3,
        name: 'Formal Blazer',
        description: 'Evening blazer with premium lining',
        price: 3600,
        stock: 4,
        minStock: 3,
        barcode: 'BLAZER-003',
        category: { name: 'Outerwear' },
        updatedAt: new Date().toISOString()
    },
    {
        id: 4,
        name: 'Casual Polo',
        description: 'Weekend cotton polo',
        price: 950,
        stock: 2,
        minStock: 6,
        barcode: 'POLO-004',
        category: { name: 'T-Shirts' },
        updatedAt: new Date().toISOString()
    }
];

export const demoInvoices: Invoice[] = [
    {
        id: 'inv-1',
        billNo: 'A-1021',
        total: 2400,
        createdAt: new Date().toISOString(),
        customer: { name: 'Arun Menon', phone: '9876543210' },
        itemCount: 2,
        items: [
            { quantity: 1, sellingPrice: 1500, product: { name: 'Premium Linen Shirt' } },
            { quantity: 1, sellingPrice: 900, product: { name: 'Leather Belt' } }
        ]
    },
    {
        id: 'inv-2',
        billNo: 'A-1022',
        total: 1980,
        createdAt: new Date(Date.now() - 3600_000).toISOString(),
        customer: { name: 'Rahul Iyer', phone: '9988776655' },
        itemCount: 2,
        items: [
            { quantity: 1, sellingPrice: 800, product: { name: 'Casual Polo' } },
            { quantity: 1, sellingPrice: 1180, product: { name: 'Slim Fit Trousers' } }
        ]
    }
];

export const demoSales = [
    {
        id: 'sale-1',
        billNo: 'A-1021',
        createdAt: new Date().toISOString(),
        customerName: 'Arun Menon',
        customerPhone: '9876543210',
        items: [{}, {}],
        grandTotal: 2400,
        status: 'COMPLETED',
        user: { name: 'Demo Admin' }
    },
    {
        id: 'sale-2',
        billNo: 'A-1022',
        createdAt: new Date(Date.now() - 3600_000).toISOString(),
        customerName: 'Rahul Iyer',
        customerPhone: '9988776655',
        items: [{}, {}, {}],
        grandTotal: 1980,
        status: 'COMPLETED',
        user: { name: 'Demo Admin' }
    },
    {
        id: 'sale-3',
        billNo: 'A-1018',
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        customerName: 'Walk-in',
        customerPhone: '',
        items: [{}],
        grandTotal: 850,
        status: 'VOIDED',
        user: { name: 'Demo Admin' }
    }
];

export const demoActivityLogs = [
    {
        id: 'log-1',
        action: 'USER_LOGIN',
        details: 'User "admin" logged in from POS terminal.',
        userId: 'demo-user',
        createdAt: new Date().toISOString(),
        user: { name: 'Admin User', role: 'ADMIN' }
    },
    {
        id: 'log-2',
        action: 'SALE_REFUND',
        details: 'Sale #1412 refunded. Amount: ₹650.00. Reason: Product defect.',
        userId: 'demo-user',
        createdAt: new Date(Date.now() - 1800_000).toISOString(),
        user: { name: 'Cashier 1', role: 'CASHIER' }
    },
    {
        id: 'log-3',
        action: 'INVENTORY_ADJUSTMENT',
        details: 'Manual stock adjustment for "Casual Polo" - Added 50 units due to warehouse recount.',
        userId: 'demo-user',
        createdAt: new Date(Date.now() - 3600_000).toISOString(),
        user: { name: 'Store Manager', role: 'MANAGER' }
    },
    {
        id: 'log-4',
        action: 'DATA_SYNC',
        details: 'Cloud sync completed successfully. 127 records synchronized to server.',
        userId: 'system',
        createdAt: new Date(Date.now() - 5400_000).toISOString(),
        user: { name: 'System', role: 'AUTOMATION' }
    },
    {
        id: 'log-5',
        action: 'REPORT_GENERATED',
        details: 'Sales summary report generated for period: 01-Apr-2026 to 04-Apr-2026.',
        userId: 'demo-user',
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        user: { name: 'Admin User', role: 'ADMIN' }
    },
    {
        id: 'log-6',
        action: 'PRICE_OVERRIDE',
        details: 'Price override applied to Sale #1410. Original: ₹500, Override: ₹450. Approved by manager.',
        userId: 'demo-user',
        createdAt: new Date(Date.now() - 9000_000).toISOString(),
        user: { name: 'Cashier 2', role: 'CASHIER' }
    },
    {
        id: 'log-7',
        action: 'SHIFT_END',
        details: 'Day shift ended. Cash collected: ₹45,230. Variance: +₹50.',
        userId: 'demo-user',
        createdAt: new Date(Date.now() - 86400_000).toISOString(),
        user: { name: 'Cashier 1', role: 'CASHIER' }
    },
    {
        id: 'log-8',
        action: 'USER_CREATED',
        details: 'New user "john_doe" created with role: CASHIER.',
        userId: 'demo-user',
        createdAt: new Date(Date.now() - 172800_000).toISOString(),
        user: { name: 'Admin User', role: 'ADMIN' }
    },
    {
        id: 'log-9',
        action: 'INVENTORY_ALERT',
        details: 'Low stock alert: "Casual Polo" reached reorder threshold (10 units remaining).',
        userId: 'system',
        createdAt: new Date(Date.now() - 259200_000).toISOString(),
        user: { name: 'System', role: 'AUTOMATION' }
    }
];

export const demoReports = {
    revenue: {
        totalRevenue: 284500,
        averageRevenue: 1494,
        totalOrders: 190,
        period: 'Last 30 days'
    },
    topProducts: demoDashboardStats.topProducts.map((item, index) => ({
        product: {
            id: String(index + 1),
            name: item.product.name,
            category: { name: index === 0 ? 'Shirts' : index === 1 ? 'Trousers' : 'Outerwear' }
        },
        totalQuantity: item.totalQuantity,
        totalRevenue: item.totalRevenue
    }))
};

export const demoSettings = [
    {
        id: 's1',
        key: 'SHOP_SETTINGS',
        value: JSON.stringify({
            name: 'Zain POS Flagship',
            branch: 'Calicut Main',
            currency: 'INR',
            taxLabel: 'GST',
            taxRate: 18,
            supportPhone: '+91 98765 43210'
        }, null, 4),
        updatedAt: new Date().toISOString()
    },
    {
        id: 's2',
        key: 'PAYMENT_METHODS',
        value: JSON.stringify({
            enabled: ['CASH', 'UPI', 'CARD', 'NET_BANKING'],
            defaultSelection: 'CASH',
            upiProvider: 'Paytm/Razorpay',
            allowDraft: true
        }, null, 4),
        updatedAt: new Date().toISOString()
    },
    {
        id: 's3',
        key: 'PRINTER_CONFIG',
        value: JSON.stringify({
            type: 'THERMAL',
            paperWidth: '80mm',
            showLogo: true,
            headerText: 'Thank you for shopping at Zain!',
            footerText: 'GST Input Credit Available'
        }, null, 4),
        updatedAt: new Date().toISOString()
    },
    {
        id: 's4',
        key: 'CLOUD_API_URL',
        value: '"https://api.zainpos.com/v3"',
        updatedAt: new Date().toISOString()
    },
    {
        id: 's5',
        key: 'CLOUD_SYNC_CONFIG',
        value: JSON.stringify({
            frequency: 'REALTIME',
            retrycount: 3,
            compression: true,
            encryption: 'AES-256'
        }, null, 4),
        updatedAt: new Date().toISOString()
    },
    {
        id: 's6',
        key: 'BACKUP_CONFIG',
        value: JSON.stringify({
            location: 'S3_BUCKET',
            retention: '90_DAYS',
            automatic: true,
            schedule: '00:00 UTC'
        }, null, 4),
        updatedAt: new Date().toISOString()
    }
];

export function getDemoInvoicesPage(page = 1, limit = 20): PaginatedResponse<Invoice> {
    const start = (page - 1) * limit;
    const invoices = demoInvoices.slice(start, start + limit);

    return {
        invoices,
        pagination: {
            page,
            limit,
            total: demoInvoices.length,
            pages: Math.max(1, Math.ceil(demoInvoices.length / limit))
        }
    };
}
