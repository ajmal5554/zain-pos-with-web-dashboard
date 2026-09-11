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
        id: 'log-demo-sale-update',
        action: 'SALE_UPDATE',
        details: JSON.stringify({
            version: 2,
            type: 'SALE_UPDATE',
            invoiceNo: '1425',
            summary: 'Bill #1425 modified: Total ₹1,200.00 → ₹1,450.00 (+₹250.00)',
            totals: {
                before: {
                    grandTotal: 1200.00,
                    subtotal: 1200.00,
                    discount: 0.00,
                    discountPercent: 0,
                    taxAmount: 0.00,
                    itemCount: 2,
                    paymentMethod: 'CASH',
                    customerName: 'Walk-in Customer'
                },
                after: {
                    grandTotal: 1450.00,
                    subtotal: 1450.00,
                    discount: 0.00,
                    discountPercent: 0,
                    taxAmount: 0.00,
                    itemCount: 3,
                    paymentMethod: 'CASH',
                    customerName: 'Walk-in Customer'
                }
            },
            itemChanges: [
                {
                    type: 'ADDED',
                    name: 'Leather Belt (Black)',
                    variant: 'Standard',
                    newQty: 1,
                    rate: 250.00
                },
                {
                    type: 'QTY_CHANGED',
                    name: 'Cotton Polo T-Shirt',
                    variant: 'M',
                    oldQty: 1,
                    newQty: 2,
                    oldRate: 450.00,
                    newRate: 450.00
                }
            ]
        }),
        userId: 'demo-cashier1',
        createdAt: new Date(Date.now() - 300_000).toISOString(),
        user: { name: 'Cashier 1', role: 'CASHIER' }
    },
    {
        id: 'log-demo-payment-update',
        action: 'PAYMENT_UPDATE',
        details: JSON.stringify({
            version: 2,
            type: 'PAYMENT_UPDATE',
            invoiceNo: '1422',
            payment: {
                before: {
                    method: 'CASH',
                    paidAmount: 850.00
                },
                after: {
                    method: 'UPI',
                    paidAmount: 850.00
                }
            }
        }),
        userId: 'demo-cashier2',
        createdAt: new Date(Date.now() - 450_000).toISOString(),
        user: { name: 'Cashier 2', role: 'CASHIER' }
    },
    {
        id: 'log-1',
        action: 'USER_LOGIN',
        details: 'User "admin" successfully authenticated from POS Terminal #1.',
        userId: 'demo-admin',
        createdAt: new Date(Date.now() - 600_000).toISOString(),
        user: { name: 'Admin User', role: 'ADMIN' }
    },
    {
        id: 'log-2',
        action: 'DISCOUNT_APPLIED',
        details: 'Discretionary discount of ₹150.00 (12%) applied on Bill #1420 by Cashier 1.',
        userId: 'demo-cashier1',
        createdAt: new Date(Date.now() - 1200_000).toISOString(),
        user: { name: 'Cashier 1', role: 'CASHIER' }
    },
    {
        id: 'log-3',
        action: 'SALE_VOID',
        details: 'Sale #1418 voided. Amount: ₹1,250.00. Reason: Customer changed mind before payment completion.',
        userId: 'demo-admin',
        createdAt: new Date(Date.now() - 2400_000).toISOString(),
        user: { name: 'Admin User', role: 'ADMIN' }
    },
    {
        id: 'log-4',
        action: 'SALE_REFUND',
        details: 'Sale #1412 refunded. Amount: ₹650.00. Reason: Product defect on Linen Shirt (XL).',
        userId: 'demo-cashier1',
        createdAt: new Date(Date.now() - 3600_000).toISOString(),
        user: { name: 'Cashier 1', role: 'CASHIER' }
    },
    {
        id: 'log-5',
        action: 'INVENTORY_ADJUSTMENT',
        details: 'Manual stock adjustment for "Casual Polo" - Added 50 units due to warehouse recount.',
        userId: 'demo-manager',
        createdAt: new Date(Date.now() - 5400_000).toISOString(),
        user: { name: 'Store Manager', role: 'MANAGER' }
    },
    {
        id: 'log-6',
        action: 'PRICE_OVERRIDE',
        details: 'Price override applied to Sale #1410. Original: ₹500, Override: ₹450. Manager authorization granted.',
        userId: 'demo-cashier2',
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        user: { name: 'Cashier 2', role: 'CASHIER' }
    },
    {
        id: 'log-7',
        action: 'CASH_DRAWER_OPEN',
        details: 'Cash drawer opened manually outside transaction for petty cash disbursement (₹200).',
        userId: 'demo-cashier1',
        createdAt: new Date(Date.now() - 9000_000).toISOString(),
        user: { name: 'Cashier 1', role: 'CASHIER' }
    },
    {
        id: 'log-8',
        action: 'EXCHANGE',
        details: JSON.stringify({
            version: 2,
            type: 'EXCHANGE',
            originalBillNo: '1405',
            replacementBillNo: '1406',
            returnedItems: [
                {
                    name: 'Slim Jeans',
                    variant: '32',
                    qty: 1,
                    rate: 850.00,
                    total: 850.00
                }
            ],
            replacementItems: [
                {
                    name: 'Slim Jeans',
                    variant: '34',
                    qty: 1,
                    rate: 850.00,
                    total: 850.00
                }
            ],
            returnedTotal: 850.00,
            replacementTotal: 850.00,
            differenceAmount: 0.00,
            netPayable: 0.00,
            paymentMethod: 'EXCHANGE',
            summary: 'Exchange processed: Returned Slim Jeans (32) x1 (₹850.00) from Bill #1405 for Slim Jeans (34) x1 (₹850.00) on Bill #1406. Diff: ₹0.00 (Equal Value)'
        }),
        userId: 'demo-cashier2',
        createdAt: new Date(Date.now() - 14400_000).toISOString(),
        user: { name: 'Cashier 2', role: 'CASHIER' }
    },
    {
        id: 'log-9',
        action: 'DATA_SYNC',
        details: 'Cloud database synchronization completed successfully. 142 records synced to cloud.',
        userId: 'system',
        createdAt: new Date(Date.now() - 18000_000).toISOString(),
        user: { name: 'System', role: 'AUTOMATION' }
    },
    {
        id: 'log-10',
        action: 'SHIFT_END',
        details: 'Morning shift ended. Cash collected: ₹32,450. Card: ₹14,200. UPI: ₹18,900. Zero variance.',
        userId: 'demo-cashier1',
        createdAt: new Date(Date.now() - 86400_000 + 3600_000).toISOString(), // Yesterday
        user: { name: 'Cashier 1', role: 'CASHIER' }
    },
    {
        id: 'log-11',
        action: 'PERMISSION_CHANGE',
        details: 'Permissions updated for user "Cashier 2". Max discount cap set to 15%.',
        userId: 'demo-admin',
        createdAt: new Date(Date.now() - 86400_000 - 1800_000).toISOString(), // Yesterday
        user: { name: 'Admin User', role: 'ADMIN' }
    },
    {
        id: 'log-12',
        action: 'PRODUCT_DELETE',
        details: 'Discontinued SKU "OLD-TSHIRT-01" deleted from catalog by Store Manager.',
        userId: 'demo-manager',
        createdAt: new Date(Date.now() - 86400_000 - 7200_000).toISOString(), // Yesterday
        user: { name: 'Store Manager', role: 'MANAGER' }
    },
    {
        id: 'log-13',
        action: 'USER_LOGIN',
        details: 'User "Cashier 2" logged in from POS Terminal #2.',
        userId: 'demo-cashier2',
        createdAt: new Date(Date.now() - 172800_000).toISOString(), // 2 days ago
        user: { name: 'Cashier 2', role: 'CASHIER' }
    },
    {
        id: 'log-14',
        action: 'SALE_RETURN',
        details: 'Customer returned 2 items from Bill #1389. Restocked into inventory. Refund: ₹1,890.00.',
        userId: 'demo-cashier1',
        createdAt: new Date(Date.now() - 259200_000).toISOString(), // 3 days ago
        user: { name: 'Cashier 1', role: 'CASHIER' }
    },
    {
        id: 'log-15',
        action: 'STOCK_ADD',
        details: 'Bulk stock arrival recorded: 120 units added across Men Formal Shirts category.',
        userId: 'demo-manager',
        createdAt: new Date(Date.now() - 345600_000).toISOString(), // 4 days ago
        user: { name: 'Store Manager', role: 'MANAGER' }
    },
    {
        id: 'log-16',
        action: 'BACKUP_CREATED',
        details: 'Automated weekly system and SQLite database backup completed. Archive: backup-2026-09-01.zip.',
        userId: 'system',
        createdAt: new Date(Date.now() - 432000_000).toISOString(), // 5 days ago
        user: { name: 'System', role: 'AUTOMATION' }
    },
    {
        id: 'log-17',
        action: 'USER_CREATED',
        details: 'New user "john_doe" created with role: CASHIER.',
        userId: 'demo-admin',
        createdAt: new Date(Date.now() - 518400_000).toISOString(), // 6 days ago
        user: { name: 'Admin User', role: 'ADMIN' }
    },
    {
        id: 'log-18',
        action: 'CASH_RECONCILIATION',
        details: 'Monthly cash drawer audit. System expectation: ₹45,230. Physical count: ₹45,230. Variance: ₹0.00.',
        userId: 'demo-admin',
        createdAt: new Date(Date.now() - 864000_000).toISOString(), // 10 days ago
        user: { name: 'Admin User', role: 'ADMIN' }
    },
    {
        id: 'log-19',
        action: 'SETTINGS_CHANGE',
        details: 'Store GST profile updated: Default SGST (2.5%) and CGST (2.5%) re-verified for clothing items.',
        userId: 'demo-admin',
        createdAt: new Date(Date.now() - 1296000_000).toISOString(), // 15 days ago
        user: { name: 'Admin User', role: 'ADMIN' }
    },
    {
        id: 'log-20',
        action: 'LOGIN_FAILED',
        details: 'Failed login attempt for username "unknown_user" from IP 192.168.1.45 (Bad password).',
        userId: 'system',
        createdAt: new Date(Date.now() - 1728000_000).toISOString(), // 20 days ago
        user: { name: 'Security Monitor', role: 'SECURITY' }
    },
    {
        id: 'log-21',
        action: 'PASSWORD_CHANGE',
        details: 'Password changed for user "Cashier 1" following 90-day security rotation policy.',
        userId: 'demo-cashier1',
        createdAt: new Date(Date.now() - 2160000_000).toISOString(), // 25 days ago
        user: { name: 'Cashier 1', role: 'CASHIER' }
    },
    {
        id: 'log-22',
        action: 'REPORT_GENERATED',
        details: 'Monthly GST filing report (GSTR-1) exported in Excel format.',
        userId: 'demo-admin',
        createdAt: new Date(Date.now() - 2592000_000).toISOString(), // 30 days ago
        user: { name: 'Admin User', role: 'ADMIN' }
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
    })),
    gst: {
        cancelledInvoices: [
            {
                id: 'void-1',
                billNo: 'A-1018',
                createdAt: new Date(Date.now() - 7200_000).toISOString(),
                grossAmount: 9500,
                discount: 500,
                amount: 9000,
                status: 'VOIDED',
                paymentMethod: 'UPI'
            }
        ]
    }
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
