import express from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getShopId } from '../lib/runtime';

const router = express.Router();
const prisma = new PrismaClient();

function requireSyncAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const configuredSecret = process.env.CLOUD_SYNC_SECRET;
    if (!configuredSecret) {
        console.error('Sync auth is not configured: CLOUD_SYNC_SECRET is missing.');
        return res.status(503).json({ error: 'Sync authentication is not configured on the server.' });
    }

    const providedSecret = req.header('x-sync-secret');
    if (!providedSecret) {
        return res.status(401).json({ error: 'Missing sync authentication.' });
    }

    const expected = Buffer.from(configuredSecret, 'utf8');
    const provided = Buffer.from(providedSecret, 'utf8');
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
        return res.status(401).json({ error: 'Invalid sync authentication.' });
    }

    next();
}

router.use(requireSyncAuth);

const asDate = (value: any) => {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

async function ensureVariantExists(variantId: string, itemInfo: any = {}) {
    const existing = await prisma.productVariant.findUnique({ where: { id: variantId } });
    if (existing) return existing;

    const fallbackCategory = await prisma.category.upsert({
        where: { name: 'Unsynced Inventory' },
        update: {},
        create: { name: 'Unsynced Inventory' }
    });

    const product = await prisma.product.create({
        data: {
            name: `${itemInfo.productName || itemInfo.name || 'Unknown Product'} (Sync Placeholder)`,
            categoryId: fallbackCategory.id,
            taxRate: itemInfo.taxRate || 0,
            description: 'Created automatically during sync'
        }
    });

    return prisma.productVariant.create({
        data: {
            id: variantId,
            productId: product.id,
            sku: itemInfo.sku || `SYNC-${variantId.substring(0, 8)}`,
            barcode: itemInfo.barcode || `SYNC-${variantId.substring(0, 8)}`,
            mrp: itemInfo.mrp || 0,
            sellingPrice: itemInfo.sellingPrice || 0,
            costPrice: itemInfo.costPrice || 0,
            stock: itemInfo.stock || 0,
            minStock: itemInfo.minStock ?? 5,
            isActive: itemInfo.isActive ?? true
        }
    });
}

// Sync Sales from Desktop
router.post('/sales', async (req, res) => {
    try {
        const { sales } = req.body;
        if (!Array.isArray(sales)) return res.status(400).json({ error: 'Invalid data' });

        console.log(`ðŸ“¡ Cloud receiving ${sales.length} sales...`);

        // ---------------------------------------------------------
        // PRE-PROCESS: Ensure all referenced Products exist
        // ---------------------------------------------------------
        const allVariantIds = new Set<string>();
        sales.forEach(sale => {
            sale.items?.forEach((item: any) => {
                if (item.variantId) allVariantIds.add(item.variantId);
            });
        });

        if (allVariantIds.size > 0) {
            const existingVariants = await prisma.productVariant.findMany({
                where: { id: { in: Array.from(allVariantIds) } },
                select: { id: true }
            });

            const existingVariantIds = new Set(existingVariants.map((v: any) => v.id));
            const missingVariantIds = Array.from(allVariantIds).filter(id => !existingVariantIds.has(id));

            if (missingVariantIds.length > 0) {
                console.log(`âš ï¸ Found ${missingVariantIds.length} missing variants. Creating placeholders...`);

                // 1. Ensure a fallback category exists
                const fallbackCategory = await prisma.category.upsert({
                    where: { name: 'Unsynced Inventory' },
                    update: {},
                    create: { name: 'Unsynced Inventory' }
                });

                // 2. Create Placeholder Products & Variants
                for (const variantId of missingVariantIds) {
                    // Find the item details from the payload to make the placeholder meaningful
                    let itemInfo: any = null;
                    for (const s of sales) {
                        itemInfo = s.items?.find((i: any) => i.variantId === variantId);
                        if (itemInfo) break;
                    }

                    if (!itemInfo) continue; // Should not happen

                    // Create/Find a placeholder product
                    const productName = itemInfo.productName || 'Unknown Product';

                    // We try to find a product by name first to avoid duplicates if possible, 
                    // but since we don't have the original productId, we might create a duplicate if names match.
                    // Ideally we should assume it's a new placeholder product relative to this variant.

                    const product = await prisma.product.create({
                        data: {
                            name: productName + ' (Sync Placeholder)',
                            categoryId: fallbackCategory.id,
                            taxRate: itemInfo.taxRate || 0,
                            description: 'Created automatically during sales sync'
                        }
                    });

                    await prisma.productVariant.create({
                        data: {
                            id: variantId, // CRITICAL: Use the exact ID from desktop
                            productId: product.id,
                            sku: `SYNC-${variantId.substring(0, 8)}`,
                            barcode: `SYNC-${variantId.substring(0, 8)}`, // Temporary barcode
                            mrp: itemInfo.mrp || 0,
                            sellingPrice: itemInfo.sellingPrice || 0,
                            costPrice: 0,
                            stock: 0
                        }
                    });
                }
                console.log('âœ… Placeholders created.');
            }
        }
        // ---------------------------------------------------------

        // First, load existing statuses from DB to detect what actually changed BEFORE the upsert loop
        const saleIds = sales.map((s: any) => s.id);
        const existingSales = await prisma.sale.findMany({
            where: { id: { in: saleIds } },
            select: { id: true, status: true, grandTotal: true, paymentMethod: true }
        });
        const existingSalesMap = new Map(existingSales.map(s => [s.id, s]));

        for (const sale of sales) {
            // 1. Sync User first (to satisfy FK)
            let finalUserId = sale.userId;

            if (sale.user) {
                try {
                    // Start by trying to ensure the user exists with the SAME ID as desktop
                    const existingSyncedUser = await prisma.user.findUnique({
                        where: { username: sale.user.username }
                    });
                    let syncedUser;
                    if (existingSyncedUser) {
                        syncedUser = await prisma.user.update({
                            where: { username: sale.user.username },
                            data: {
                                name: sale.user.name,
                                role: sale.user.role,
                                isActive: sale.user.isActive
                            }
                        });
                    } else {
                        syncedUser = await prisma.user.create({
                            data: {
                                id: sale.user.id, // Try to force ID
                                username: sale.user.username,
                                password: sale.user.password,
                                name: sale.user.name,
                                role: sale.user.role,
                                isActive: sale.user.isActive
                            }
                        });
                    }
                    finalUserId = syncedUser.id;
                } catch (e) {
                    console.warn(`Failed to sync user ${sale.user.username} for sale ${sale.billNo}, trying fallback...`);
                }
            } else {
                console.warn(`Warning: Sale ${sale.billNo} has no user data attached.`);
            }

            // Verify if finalUserId exists, if not, fallback to any Admin
            const userExists = await prisma.user.findUnique({ where: { id: finalUserId } });
            if (!userExists) {
                console.warn(`User ID ${finalUserId} not found for sale ${sale.billNo}. Assigning to fallback Admin.`);
                let admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
                if (!admin) {
                    // Create a default admin if absolutely no users exist
                    admin = await prisma.user.create({
                        data: {
                            username: 'admin',
                            password: 'admin123',
                            name: 'System Admin',
                            role: 'ADMIN',
                            isActive: true
                        }
                    });
                }
                finalUserId = admin.id;
            }

            // 2. Sync Sale
            await prisma.sale.upsert({
                where: { id: sale.id },
                update: {
                    billNo: String(sale.billNo),
                    userId: finalUserId,
                    customerName: sale.customerName ?? null,
                    customerPhone: sale.customerPhone ?? null,
                    subtotal: sale.subtotal ?? 0,
                    discount: sale.discount ?? 0,
                    discountPercent: sale.discountPercent ?? 0,
                    taxAmount: sale.taxAmount ?? 0,
                    cgst: sale.cgst ?? 0,
                    sgst: sale.sgst ?? 0,
                    grandTotal: sale.grandTotal ?? 0,
                    paymentMethod: sale.paymentMethod ?? 'CASH',
                    paidAmount: sale.paidAmount ?? 0,
                    changeAmount: sale.changeAmount ?? 0,
                    status: sale.status ?? 'COMPLETED',
                    remarks: sale.remarks ?? null,
                    isHistorical: sale.isHistorical ?? true,
                    importedFrom: sale.importedFrom ?? null,
                    actualSaleDate: asDate(sale.actualSaleDate) ?? null,
                    createdAt: asDate(sale.createdAt) ?? new Date(),
                    updatedAt: asDate(sale.updatedAt) ?? new Date(),
                    items: {
                        deleteMany: {}
                    },
                    payments: {
                        deleteMany: {}
                    }
                },
                create: {
                    id: sale.id,
                    billNo: String(sale.billNo),
                    userId: finalUserId,
                    customerName: sale.customerName ?? null,
                    customerPhone: sale.customerPhone ?? null,
                    subtotal: sale.subtotal ?? 0,
                    discount: sale.discount ?? 0,
                    discountPercent: sale.discountPercent ?? 0,
                    taxAmount: sale.taxAmount ?? 0,
                    cgst: sale.cgst ?? 0,
                    sgst: sale.sgst ?? 0,
                    grandTotal: sale.grandTotal ?? 0,
                    paidAmount: sale.paidAmount ?? 0,
                    changeAmount: sale.changeAmount ?? 0,
                    paymentMethod: sale.paymentMethod ?? 'CASH',
                    status: sale.status ?? 'COMPLETED',
                    remarks: sale.remarks ?? null,
                    isHistorical: sale.isHistorical ?? true,
                    importedFrom: sale.importedFrom ?? null,
                    actualSaleDate: asDate(sale.actualSaleDate) ?? null,
                    createdAt: asDate(sale.createdAt) ?? new Date(),
                    updatedAt: asDate(sale.updatedAt) ?? new Date(),
                    items: {
                        create: []
                    },
                    payments: {
                        create: []
                    }
                }
            });

            if (Array.isArray(sale.items) && sale.items.length > 0) {
                await prisma.saleItem.createMany({
                    data: sale.items.map((item: any) => ({
                        id: item.id,
                        saleId: sale.id,
                        variantId: item.variantId,
                        productName: item.productName,
                        variantInfo: item.variantInfo ?? null,
                        quantity: item.quantity ?? 0,
                        mrp: item.mrp ?? 0,
                        sellingPrice: item.sellingPrice ?? 0,
                        discount: item.discount ?? 0,
                        taxRate: item.taxRate ?? 0,
                        taxAmount: item.taxAmount ?? 0,
                        total: item.total ?? 0,
                        createdAt: asDate(item.createdAt) ?? asDate(sale.createdAt) ?? new Date()
                    }))
                });
            }

            if (Array.isArray(sale.payments) && sale.payments.length > 0) {
                await prisma.invoicePayment.createMany({
                    data: sale.payments.map((payment: any) => ({
                        id: payment.id,
                        saleId: sale.id,
                        paymentMode: payment.paymentMode,
                        amount: payment.amount ?? 0,
                        createdAt: asDate(payment.createdAt) ?? asDate(sale.createdAt) ?? new Date()
                    }))
                });
            }
        }

        // Separate into new sales, status-changed voids, and updated completed sales
        const newSales: any[] = [];
        const newlyVoided: any[] = [];
        const newlyUpdated: any[] = [];
        // 24 hour window to prevent timezone/clock-drift issues from blocking real-time notifications
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        for (const sale of sales) {
            const prevSale = existingSalesMap.get(sale.id);
            const isNew = !prevSale;
            
            // Voided check: either it's voided in this sync and wasn't voided before, OR it is a brand-new voided invoice synced for the first time
            const isNowVoided = sale.status === 'VOIDED' && 
                                (!prevSale || prevSale.status !== 'VOIDED') && 
                                (sales.length === 1 || new Date(sale.updatedAt || sale.createdAt) > twentyFourHoursAgo);

            // Updated check: was COMPLETED, is still COMPLETED, but grandTotal, paymentMethod, or other key fields changed
            const isUpdated = prevSale && 
                              prevSale.status === 'COMPLETED' && 
                              sale.status === 'COMPLETED' && 
                              (prevSale.grandTotal !== sale.grandTotal || prevSale.paymentMethod !== sale.paymentMethod) &&
                              (sales.length === 1 || new Date(sale.updatedAt || sale.createdAt) > twentyFourHoursAgo);

            if (isNew && sale.status === 'COMPLETED' && !sale.isHistorical && (sales.length === 1 || new Date(sale.createdAt) > twentyFourHoursAgo)) {
                newSales.push(sale);
            } else if (isNowVoided) {
                newlyVoided.push(sale);
            } else if (isUpdated) {
                newlyUpdated.push(sale);
            }
        }

        try {
            const { getIO } = require('../socket');
            const { notificationService } = require('../services/notificationService');
            const io = getIO();
            const shopId = getShopId();

            // Emit batch update for realtime charts/stats
            io.to(`shop_${shopId}`).emit('sale:batch', { count: sales.length, sales, timestamp: new Date() });

            // Notify for genuinely NEW completed sales only
            for (const sale of newSales) {
                await notificationService.send({
                    shopId,
                    type: 'sale',
                    title: '🛍️ New Sale',
                    message: `Bill #${sale.billNo} - ₹${sale.grandTotal.toFixed(2)}`,
                    referenceId: sale.id,
                    metadata: {
                        billNo: sale.billNo,
                        amount: sale.grandTotal,
                        paymentMode: sale.paymentMethod,
                        items: sale.items?.length || 0,
                        cashier: sale.user?.name || 'Staff'
                    }
                });
                console.log(`📱 New sale notification: Bill #${sale.billNo}`);
            }

            // Notify for sales that JUST changed to VOIDED
            for (const sale of newlyVoided) {
                io.to(`shop_${shopId}`).emit('sale:voided', {
                    id: sale.id,
                    billNo: sale.billNo,
                    timestamp: new Date()
                });
                await notificationService.send({
                    shopId,
                    type: 'invoice_deleted',
                    title: '🚫 Invoice Voided',
                    message: `Bill #${sale.billNo} was voided.`,
                    referenceId: sale.id,
                    metadata: {
                        billNo: sale.billNo,
                        reason: sale.remarks || 'No reason provided'
                    }
                });
                console.log(`🚫 Void notification: Bill #${sale.billNo}`);
            }

            // Notify for sales that were UPDATED
            for (const sale of newlyUpdated) {
                io.to(`shop_${shopId}`).emit('sale:updated', {
                    id: sale.id,
                    billNo: sale.billNo,
                    timestamp: new Date()
                });
                await notificationService.send({
                    shopId,
                    type: 'invoice_updated',
                    title: '✏️ Invoice Updated',
                    message: `Bill #${sale.billNo} was updated. New Total: ₹${sale.grandTotal.toFixed(2)} (${sale.paymentMethod})`,
                    referenceId: sale.id,
                    metadata: {
                        billNo: sale.billNo,
                        amount: sale.grandTotal,
                        paymentMode: sale.paymentMethod
                    }
                });
                console.log(`✏️ Update notification: Bill #${sale.billNo}`);
            }

            console.log(`📢 Realtime: ${newSales.length} new, ${newlyVoided.length} voids, ${newlyUpdated.length} updates processed.`);
        } catch (e) {
            console.error("Socket/Push error:", e);
        }

        // Log the sync
        await prisma.auditLog.create({
            data: {
                action: 'SYNC_SALES',
                details: `Synced ${sales.length} sales from desktop`,
                userId: null // System action
            }
        });

        res.json({ success: true, count: sales.length });
    } catch (error: any) {
        console.error('Sync error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Sync Users from Desktop
router.post('/users', async (req, res) => {
    try {
        const { users } = req.body;
        if (!Array.isArray(users)) return res.status(400).json({ error: 'Invalid data' });

        console.log(`Cloud receiving ${users.length} users...`);

        let synced = 0;
        const skipped: string[] = [];
        for (const user of users) {
            const username = (user?.username || '').toString().trim();
            if (!username) {
                skipped.push('missing_username');
                continue;
            }

            const rawPassword = typeof user?.password === 'string' ? user.password : '';
            if (!rawPassword) {
                skipped.push(username);
                continue;
            }

            const isBcrypt = rawPassword.startsWith('$2a$') || rawPassword.startsWith('$2b$') || rawPassword.startsWith('$2y$');
            const passwordToStore = isBcrypt ? rawPassword : await bcrypt.hash(rawPassword, 10);

            const existingUser = await prisma.user.findUnique({ where: { username } });
            if (existingUser) {
                await prisma.user.update({
                    where: { username },
                    data: {
                        name: user.name || username,
                        role: user.role || 'CASHIER',
                        password: passwordToStore,
                        isActive: user.isActive !== false
                    }
                });
            } else {
                await prisma.user.create({
                    data: {
                        username,
                        name: user.name || username,
                        role: user.role || 'CASHIER',
                        password: passwordToStore,
                        isActive: user.isActive !== false
                    }
                });
            }
            synced++;
        }
        console.log(`Users synced: ${synced}/${users.length}`);

        // Log the sync
        await prisma.auditLog.create({
            data: {
                action: 'SYNC_USERS',
                details: `Synced ${synced}/${users.length} users from desktop${skipped.length ? `, skipped: ${skipped.join(', ')}` : ''}`,
                userId: null
            }
        });

        res.json({ success: true, synced, total: users.length, skipped });
    } catch (error: any) {
        console.error('User Sync Error:', error);
        res.status(500).json({ error: error?.message || 'Sync failed' });
    }
});

// Sync Customers from Desktop
router.post('/customers', async (req, res) => {
    try {
        const { customers } = req.body;
        if (!Array.isArray(customers)) return res.status(400).json({ error: 'Invalid data' });

        let synced = 0;
        for (const customer of customers) {
            const data = {
                name: customer.name || 'Walk-in Customer',
                phone: customer.phone || null,
                email: customer.email || null,
                address: customer.address || null,
                gstin: customer.gstin || null,
                createdAt: asDate(customer.createdAt) ?? new Date(),
                updatedAt: asDate(customer.updatedAt) ?? new Date()
            };

            if (customer.id) {
                await prisma.customer.upsert({
                    where: { id: customer.id },
                    update: data,
                    create: { id: customer.id, ...data }
                });
            } else if (customer.phone) {
                await prisma.customer.upsert({
                    where: { phone: customer.phone },
                    update: data,
                    create: data
                });
            } else {
                await prisma.customer.create({ data });
            }
            synced++;
        }

        await prisma.auditLog.create({
            data: {
                action: 'SYNC_CUSTOMERS',
                details: `Synced ${synced}/${customers.length} customers from desktop`,
                userId: null
            }
        });

        res.json({ success: true, synced, total: customers.length });
    } catch (error: any) {
        console.error('Customer sync error:', error);
        res.status(500).json({ error: error?.message || 'Customer sync failed' });
    }
});

// Set/reset one dedicated dashboard login from POS
router.post('/dashboard-user', async (req, res) => {
    try {
        const username = (req.body?.username || '').toString().trim();
        const password = (req.body?.password || '').toString();
        const name = (req.body?.name || username || 'Dashboard Admin').toString().trim();
        const role = (req.body?.role || 'ADMIN').toString().toUpperCase();

        if (!username || !password) {
            return res.status(400).json({ error: 'username and password are required' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const existingDashboardUser = await prisma.user.findUnique({ where: { username } });
        const user = existingDashboardUser
            ? await prisma.user.update({
                where: { username },
                data: {
                    name,
                    role: role === 'ADMIN' ? 'ADMIN' : 'CASHIER',
                    password: passwordHash,
                    isActive: true
                }
            })
            : await prisma.user.create({
                data: {
                    username,
                    name,
                    role: role === 'ADMIN' ? 'ADMIN' : 'CASHIER',
                    password: passwordHash,
                    isActive: true
                }
            });

        await prisma.auditLog.create({
            data: {
                action: 'DASHBOARD_USER_SET',
                details: `Dashboard credentials set for ${username}`,
                userId: user.id
            }
        });

        res.json({ success: true, username: user.username });
    } catch (error: any) {
        console.error('Dashboard user set error:', error);
        res.status(500).json({ error: error?.message || 'Failed to set dashboard user' });
    }
});
// Sync Inventory from Desktop
router.post('/inventory', async (req, res) => {
    try {
        const { products } = req.body;
        if (!Array.isArray(products)) return res.status(400).json({ error: 'Invalid data' });

        console.log(`ðŸ“¦ Syncing ${products.length} products...`);
        for (const p of products) {
            // 1. Sync Category
            const category = await prisma.category.upsert({
                where: { name: p.category.name },
                update: {},
                create: { name: p.category.name }
            });

            // 2. Sync Product by stable desktop ID when available.
            const productId = typeof p.id === 'string' && p.id.trim() ? p.id : undefined;
            let product;

            if (productId) {
                product = await prisma.product.upsert({
                    where: { id: productId },
                    update: {
                        name: p.name,
                        description: p.description ?? null,
                        categoryId: category.id,
                        taxRate: p.taxRate,
                        hsn: p.hsn,
                        isActive: p.isActive ?? true
                    },
                    create: {
                        id: productId,
                        name: p.name,
                        description: p.description ?? null,
                        categoryId: category.id,
                        taxRate: p.taxRate,
                        hsn: p.hsn,
                        isActive: p.isActive ?? true
                    }
                });
            } else {
                const existingProduct = await prisma.product.findFirst({
                    where: { name: p.name, categoryId: category.id }
                });

                product = existingProduct
                    ? await prisma.product.update({
                        where: { id: existingProduct.id },
                        data: {
                            name: p.name,
                            description: p.description ?? null,
                            categoryId: category.id,
                            taxRate: p.taxRate,
                            hsn: p.hsn,
                            isActive: p.isActive ?? true
                        }
                    })
                    : await prisma.product.create({
                        data: {
                            name: p.name,
                            description: p.description ?? null,
                            categoryId: category.id,
                            taxRate: p.taxRate,
                            hsn: p.hsn,
                            isActive: p.isActive ?? true
                        }
                    });
            }

            // 3. Sync Variants
            for (const v of p.variants) {
                await prisma.productVariant.upsert({
                    where: { id: v.id },
                    update: {
                        productId: product.id,
                        stock: v.stock,
                        sellingPrice: v.sellingPrice,
                        mrp: v.mrp,
                        barcode: v.barcode,
                        sku: v.sku,
                        size: v.size,
                        color: v.color,
                        costPrice: v.costPrice,
                        minStock: v.minStock ?? 5,
                        isActive: v.isActive // Respect Desktop status
                    },
                    create: {
                        id: v.id,
                        productId: product.id,
                        sku: v.sku,
                        barcode: v.barcode,
                        size: v.size,
                        color: v.color,
                        mrp: v.mrp,
                        sellingPrice: v.sellingPrice,
                        costPrice: v.costPrice || 0,
                        stock: v.stock,
                        minStock: v.minStock ?? 5,
                        isActive: v.isActive ?? true
                    }
                });
            }
        }

        // Log the sync
        await prisma.auditLog.create({
            data: {
                action: 'SYNC_INVENTORY',
                details: `Synced ${products.length} products from desktop`,
                userId: null
            }
        });

        res.json({ success: true, count: products.length });
    } catch (error: any) {
        console.error('Inventory sync error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Sync Inventory Movements from Desktop
router.post('/inventory-movements', async (req, res) => {
    try {
        const { movements } = req.body;
        if (!Array.isArray(movements)) return res.status(400).json({ error: 'Invalid data' });

        let synced = 0;
        const skipped: string[] = [];
        for (const movement of movements) {
            if (!movement.id || !movement.variantId) {
                skipped.push(movement.id || 'missing_variant');
                continue;
            }

            await ensureVariantExists(movement.variantId, movement);
            await prisma.inventoryMovement.upsert({
                where: { id: movement.id },
                update: {
                    variantId: movement.variantId,
                    type: movement.type || 'ADJUSTMENT',
                    quantity: movement.quantity ?? 0,
                    reason: movement.reason ?? null,
                    reference: movement.reference ?? null,
                    createdBy: movement.createdBy || 'sync',
                    createdAt: asDate(movement.createdAt) ?? new Date()
                },
                create: {
                    id: movement.id,
                    variantId: movement.variantId,
                    type: movement.type || 'ADJUSTMENT',
                    quantity: movement.quantity ?? 0,
                    reason: movement.reason ?? null,
                    reference: movement.reference ?? null,
                    createdBy: movement.createdBy || 'sync',
                    createdAt: asDate(movement.createdAt) ?? new Date()
                }
            });
            synced++;
        }

        await prisma.auditLog.create({
            data: {
                action: 'SYNC_INVENTORY_MOVEMENTS',
                details: `Synced ${synced}/${movements.length} inventory movements from desktop${skipped.length ? `, skipped: ${skipped.join(', ')}` : ''}`,
                userId: null
            }
        });

        res.json({ success: true, synced, total: movements.length, skipped });
    } catch (error: any) {
        console.error('Inventory movement sync error:', error);
        res.status(500).json({ error: error?.message || 'Inventory movement sync failed' });
    }
});

// Sync Exchanges from Desktop
router.post('/exchanges', async (req, res) => {
    try {
        const { exchanges } = req.body;
        if (!Array.isArray(exchanges)) return res.status(400).json({ error: 'Invalid data' });

        // Load existing exchanges to avoid duplicate notifications on re-syncs
        const exchangeIds = exchanges.map((e: any) => e.id).filter(Boolean);
        const existingExchanges = await prisma.exchange.findMany({
            where: { id: { in: exchangeIds } },
            select: { id: true }
        });
        const existingExchangeIds = new Set(existingExchanges.map(e => e.id));

        let synced = 0;
        const skipped: string[] = [];
        for (const exchange of exchanges) {
            const originalInvoiceId = exchange.originalInvoiceId || exchange.saleId || exchange.invoiceId;
            if (!exchange.id || !originalInvoiceId) {
                skipped.push(exchange.id || 'missing_invoice');
                continue;
            }

            const sale = await prisma.sale.findUnique({ where: { id: originalInvoiceId } });
            if (!sale) {
                skipped.push(exchange.id);
                continue;
            }

            const isNewExchange = !existingExchangeIds.has(exchange.id);

            await prisma.exchangeItem.deleteMany({ where: { exchangeId: exchange.id } });
            await prisma.exchangePayment.deleteMany({ where: { exchangeId: exchange.id } });
            await prisma.exchange.upsert({
                where: { id: exchange.id },
                update: {
                    originalInvoiceId,
                    exchangeDate: asDate(exchange.exchangeDate || exchange.createdAt) ?? new Date(),
                    differenceAmount: exchange.differenceAmount ?? 0,
                    notes: exchange.notes ?? null,
                    createdBy: exchange.createdBy || 'sync'
                },
                create: {
                    id: exchange.id,
                    originalInvoiceId,
                    exchangeDate: asDate(exchange.exchangeDate || exchange.createdAt) ?? new Date(),
                    differenceAmount: exchange.differenceAmount ?? 0,
                    notes: exchange.notes ?? null,
                    createdBy: exchange.createdBy || 'sync'
                }
            });

            if (Array.isArray(exchange.items) && exchange.items.length > 0) {
                await prisma.exchangeItem.createMany({
                    data: exchange.items.map((item: any) => ({
                        id: item.id,
                        exchangeId: exchange.id,
                        returnedItemId: item.returnedItemId ?? null,
                        returnedQty: item.returnedQty ?? 0,
                        newItemId: item.newItemId ?? null,
                        newQty: item.newQty ?? 0,
                        priceDiff: item.priceDiff ?? 0
                    }))
                });
            }

            if (Array.isArray(exchange.payments) && exchange.payments.length > 0) {
                await prisma.exchangePayment.createMany({
                    data: exchange.payments.map((payment: any) => ({
                        id: payment.id,
                        exchangeId: exchange.id,
                        paymentMode: payment.paymentMode || 'CASH',
                        amount: payment.amount ?? 0,
                        createdAt: asDate(payment.createdAt) ?? new Date()
                    }))
                });
            }

            if (isNewExchange) {
                try {
                    const { getIO } = require('../socket');
                    const { notificationService } = require('../services/notificationService');
                    const io = getIO();
                    const shopId = getShopId();

                    // Emit live socket to refresh dashboard pages
                    io.to(`shop_${shopId}`).emit('sale:updated', {
                        id: sale.id,
                        billNo: sale.billNo,
                        timestamp: new Date()
                    });

                    // Send OS-level push notification
                    await notificationService.send({
                        shopId,
                        type: 'invoice_updated',
                        title: '🔄 Invoice Exchanged',
                        message: `Bill #${sale.billNo} - Exchanged. Difference: ₹${exchange.differenceAmount.toFixed(2)}`,
                        referenceId: sale.id,
                        metadata: {
                            billNo: sale.billNo,
                            differenceAmount: exchange.differenceAmount,
                            notes: exchange.notes
                        }
                    });
                } catch (e) {
                    console.error("Exchange notification trigger error:", e);
                }
            }

            synced++;
        }

        res.json({ success: true, synced, total: exchanges.length, skipped });
    } catch (error: any) {
        console.error('Exchange sync error:', error);
        res.status(500).json({ error: error?.message || 'Exchange sync failed' });
    }
});

// Sync Refunds from Desktop
router.post('/refunds', async (req, res) => {
    try {
        const { refunds } = req.body;
        if (!Array.isArray(refunds)) return res.status(400).json({ error: 'Invalid data' });

        // Load existing refunds to avoid duplicate notifications on re-syncs
        const refundIds = refunds.map((r: any) => r.id).filter(Boolean);
        const existingRefunds = await prisma.refund.findMany({
            where: { id: { in: refundIds } },
            select: { id: true }
        });
        const existingRefundIds = new Set(existingRefunds.map(r => r.id));

        let synced = 0;
        const skipped: string[] = [];
        for (const refund of refunds) {
            const originalInvoiceId = refund.originalInvoiceId || refund.saleId || refund.invoiceId;
            if (!refund.id || !originalInvoiceId) {
                skipped.push(refund.id || 'missing_invoice');
                continue;
            }

            const sale = await prisma.sale.findUnique({ where: { id: originalInvoiceId } });
            if (!sale) {
                skipped.push(refund.id);
                continue;
            }

            const isNewRefund = !existingRefundIds.has(refund.id);

            await prisma.refundItem.deleteMany({ where: { refundId: refund.id } });
            await prisma.refundPayment.deleteMany({ where: { refundId: refund.id } });
            await prisma.refund.upsert({
                where: { id: refund.id },
                update: {
                    originalInvoiceId,
                    refundDate: asDate(refund.refundDate || refund.createdAt) ?? new Date(),
                    totalRefundAmount: refund.totalRefundAmount ?? refund.amount ?? 0,
                    reason: refund.reason || 'Synced refund',
                    createdBy: refund.createdBy || 'sync'
                },
                create: {
                    id: refund.id,
                    originalInvoiceId,
                    refundDate: asDate(refund.refundDate || refund.createdAt) ?? new Date(),
                    totalRefundAmount: refund.totalRefundAmount ?? refund.amount ?? 0,
                    reason: refund.reason || 'Synced refund',
                    createdBy: refund.createdBy || 'sync'
                }
            });

            if (Array.isArray(refund.items) && refund.items.length > 0) {
                for (const item of refund.items) {
                    if (item.variantId) await ensureVariantExists(item.variantId, item);
                }
                await prisma.refundItem.createMany({
                    data: refund.items
                        .filter((item: any) => item.variantId)
                        .map((item: any) => ({
                            id: item.id,
                            refundId: refund.id,
                            variantId: item.variantId,
                            quantity: item.quantity ?? 0,
                            amount: item.amount ?? 0
                        }))
                });
            }

            if (Array.isArray(refund.payments) && refund.payments.length > 0) {
                await prisma.refundPayment.createMany({
                    data: refund.payments.map((payment: any) => ({
                        id: payment.id,
                        refundId: refund.id,
                        paymentMode: payment.paymentMode || 'CASH',
                        amount: payment.amount ?? 0,
                        createdAt: asDate(payment.createdAt) ?? new Date()
                    }))
                });
            }

            if (isNewRefund) {
                try {
                    const { getIO } = require('../socket');
                    const { notificationService } = require('../services/notificationService');
                    const io = getIO();
                    const shopId = getShopId();

                    // Emit live socket to refresh dashboard pages
                    io.to(`shop_${shopId}`).emit('sale:updated', {
                        id: sale.id,
                        billNo: sale.billNo,
                        timestamp: new Date()
                    });

                    // Send OS-level push notification
                    await notificationService.send({
                        shopId,
                        type: 'invoice_updated',
                        title: '↩️ Invoice Refunded',
                        message: `Bill #${sale.billNo} - Refunded ₹${refund.totalRefundAmount.toFixed(2)}`,
                        referenceId: sale.id,
                        metadata: {
                            billNo: sale.billNo,
                            refundAmount: refund.totalRefundAmount,
                            reason: refund.reason
                        }
                    });
                } catch (e) {
                    console.error("Refund notification trigger error:", e);
                }
            }

            synced++;
        }

        res.json({ success: true, synced, total: refunds.length, skipped });
    } catch (error: any) {
        console.error('Refund sync error:', error);
        res.status(500).json({ error: error?.message || 'Refund sync failed' });
    }
});

// Cleanup Empty Placeholders
router.post('/cleanup-placeholders', async (req, res) => {
    try {
        console.log('ðŸ§¹ Cleanup: checking for empty placeholders...');

        // 1. Find all Placeholder Products
        const placeholders = await prisma.product.findMany({
            where: {
                name: { contains: '(Sync Placeholder)' }
            },
            include: {
                variants: true
            }
        });

        let deletedCount = 0;

        for (const p of placeholders) {
            if (p.variants.length === 0) {
                await prisma.product.delete({ where: { id: p.id } });
                deletedCount++;
            }
        }

        console.log(`âœ… Cleanup complete. Deleted ${deletedCount} placeholders.`);
        res.json({ success: true, deleted: deletedCount, totalChecked: placeholders.length });

    } catch (error: any) {
        console.error('Cleanup error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Sync Settings from Desktop
router.post('/settings', async (req, res) => {
    try {
        const { settings } = req.body;
        if (!Array.isArray(settings)) return res.status(400).json({ error: 'Invalid data' });

        console.log(`ðŸ“¡ Cloud receiving ${settings.length} settings...`);

        for (const setting of settings) {
            await prisma.setting.upsert({
                where: { key: setting.key },
                update: {
                    value: setting.value
                },
                create: {
                    key: setting.key,
                    value: setting.value
                }
            });
        }

        res.json({ success: true, count: settings.length });
    } catch (error: any) {
        console.error('Settings sync error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Sync Audit Logs from Desktop
router.post('/audit', async (req, res) => {
    try {
        const { logs } = req.body;
        if (!Array.isArray(logs)) return res.status(400).json({ error: 'Invalid data' });

        console.log(`📡 Cloud receiving ${logs.length} audit logs...`);

        // Load existing logs to prevent duplicate notifications on re-syncs
        const logIds = logs.map((l: any) => l.id).filter(Boolean);
        const existingLogs = await prisma.auditLog.findMany({
            where: { id: { in: logIds } },
            select: { id: true }
        });
        const existingLogIds = new Set(existingLogs.map(l => l.id));

        const newlyAddedSecurityLogs: any[] = [];

        // Security relevant actions pattern matching
        const SECURITY_ACTIONS = [
            'VOID', 'DELETE', 'REFUND', 'RETURN', 'OVERRIDE', 'ADJUSTMENT', 
            'PASSWORD', 'PERMISSION', 'DRAWER', 'SHIFT', 'RECONCILIATION'
        ];

        for (const log of logs) {
            let finalUserId: string | null = null;

            if (log.userId) {
                const existingById = await prisma.user.findUnique({
                    where: { id: log.userId }
                });
                if (existingById) {
                    finalUserId = existingById.id;
                }
            }

            // Ensure User exists (if linked), then use the cloud user's ID.
            if (log.user) {
                const username = (log.user.username || '').toString().trim();
                if (username) {
                    const existingAuditUser = await prisma.user.findUnique({
                        where: { username }
                    });
                    const auditUser = existingAuditUser
                        ? await prisma.user.update({
                            where: { username },
                            data: {
                                name: log.user.name || username,
                                role: log.user.role || existingAuditUser.role || 'CASHIER',
                                isActive: log.user.isActive !== false
                            }
                        })
                        : await prisma.user.create({
                            data: {
                                id: log.user.id || undefined,
                                username,
                                name: log.user.name || username,
                                role: log.user.role || 'CASHIER', // Fallback
                                password: log.user.password || 'cloud_synced', // Fallback
                                isActive: true
                            }
                        });

                    finalUserId = auditUser.id;
                }
            }

            const isNewLog = !existingLogIds.has(log.id);

            await prisma.auditLog.upsert({
                where: { id: log.id },
                update: {},
                create: {
                    id: log.id,
                    action: log.action,
                    details: log.details,
                    userId: finalUserId,
                    createdAt: new Date(log.createdAt)
                }
            });

            if (isNewLog) {
                const isSecurityAction = SECURITY_ACTIONS.some(act => 
                    log.action.toUpperCase().includes(act)
                );
                if (isSecurityAction) {
                    newlyAddedSecurityLogs.push(log);
                }
            }
        }

        // Trigger notifications and sockets
        if (newlyAddedSecurityLogs.length > 0) {
            try {
                const { getIO } = require('../socket');
                const { notificationService } = require('../services/notificationService');
                const io = getIO();
                const shopId = getShopId();

                // Emit live socket to refresh Activity Log page
                io.to(`shop_${shopId}`).emit('audit:new', {
                    count: newlyAddedSecurityLogs.length,
                    timestamp: new Date()
                });

                for (const log of newlyAddedSecurityLogs) {
                    const userName = log.user?.name || 'Staff';
                    // Format action name nicely (e.g. SALE_VOID -> Sale Void)
                    const formattedAction = log.action
                        .replace(/_/g, ' ')
                        .toLowerCase()
                        .replace(/\b\w/g, (c: string) => c.toUpperCase());

                    await notificationService.send({
                        shopId,
                        type: 'invoice_deleted', // standard type for dashboard alerts
                        title: `⚠️ ${formattedAction}`,
                        message: `${userName}: ${log.details}`,
                        referenceId: log.id,
                        metadata: {
                            action: log.action,
                            details: log.details,
                            userName
                        }
                    });
                    console.log(`📱 Audit notification triggered: ${log.action} - ${log.details}`);
                }
            } catch (e) {
                console.error("Audit log notification trigger error:", e);
            }
        }

        res.json({ success: true, count: logs.length });
    } catch (error: any) {
        console.error('Audit Log Sync Error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
