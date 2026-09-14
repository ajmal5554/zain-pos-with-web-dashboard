import { PrismaClient } from '@prisma/client';
import webPush from 'web-push';
import { getIO } from '../socket';

const prisma = new PrismaClient();

// Setup Web Push — keys must match the public key baked into the frontend PWA
const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'BDJxTZeB4JeyjNGNYEVBzMcOL2GbbeqK_zT86JaoH23gqrxVtOJMeVUuroZ_yiL8Ay2t8y1KM6Fm273kNC34XPY';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || 'hTqqfDXf4-8JjWFlsc84QXsa_QHh1exzE-iPbZQcDbo';
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@zainpos.com';

webPush.setVapidDetails(vapidSubject, publicVapidKey, privateVapidKey);

interface NotificationPayload {
    shopId: string;
    type: 'sale' | 'invoice_deleted' | 'invoice_updated' | 'product_added' | 'low_stock' | string;
    title: string;
    message: string;
    referenceId?: string;
    metadata?: any;
}

export const notificationService = {
    async send({ shopId, type, title, message, referenceId, metadata }: NotificationPayload) {
        try {
            // 1. Save to Database
            const notification = await prisma.notification.create({
                data: {
                    shopId,
                    type,
                    title,
                    message,
                    referenceId,
                    // metadata column is String? in schema — must stringify the object
                    metadata: metadata ? JSON.stringify(metadata) : null,
                    read: false
                }
            });

            // 2. Emit Socket Event
            try {
                const io = getIO();
                // Emit to specific shop room
                io.to(`shop_${shopId}`).emit('notification', notification);
            } catch (error) {
                console.warn('Socket.io not initialized or error emitting:', error);
            }

            // 3. Send Web Push
            // Find all subscriptions for this shop (conceptually, users in this shop)
            const subscriptions = await prisma.pushSubscription.findMany();

            const billNumber = metadata?.billNo;
            const amount = metadata?.amount !== undefined ? metadata.amount : undefined;

            let finalTitle = title;
            let finalBody = message;
            let tag: string | undefined;
            let targetUrl = '/sales';
            let actionTitle = 'View Details';

            if (type === 'sale') {
                finalTitle = 'New Sale';
                if (billNumber && amount !== undefined && amount !== null) {
                    const num = Number(amount);
                    const formatted = isNaN(num) ? String(amount) : (num % 1 === 0 ? num.toFixed(0) : num.toFixed(2));
                    finalBody = `Bill #${billNumber} • ₹${formatted}`;
                }
                tag = billNumber ? `sale-${billNumber}` : `sale-${referenceId || Date.now()}`;
                targetUrl = billNumber ? `/sales?billNo=${encodeURIComponent(billNumber)}` : '/sales';
                actionTitle = 'View Bill';
            } else if (type === 'invoice_updated') {
                finalTitle = 'Invoice Updated';
                if (billNumber && amount !== undefined && amount !== null) {
                    const num = Number(amount);
                    const formatted = isNaN(num) ? String(amount) : (num % 1 === 0 ? num.toFixed(0) : num.toFixed(2));
                    finalBody = `Bill #${billNumber} was updated. New Total: ₹${formatted}`;
                } else if (billNumber) {
                    finalBody = `Bill #${billNumber} was updated`;
                }
                tag = billNumber ? `invoice-update-${billNumber}` : `update-${referenceId || Date.now()}`;
                targetUrl = billNumber ? `/sales?billNo=${encodeURIComponent(billNumber)}` : '/sales';
                actionTitle = 'View Bill';
            } else if (type === 'invoice_deleted') {
                finalTitle = 'Invoice Voided';
                if (billNumber) {
                    finalBody = `Bill #${billNumber} was voided`;
                }
                tag = billNumber ? `invoice-void-${billNumber}` : `void-${referenceId || Date.now()}`;
                targetUrl = billNumber ? `/sales?billNo=${encodeURIComponent(billNumber)}` : '/sales';
                actionTitle = 'View Sales';
            } else if (type === 'product_added') {
                finalTitle = title || 'New Product Added';
                const pName = metadata?.name || metadata?.productName;
                const pPrice = metadata?.sellingPrice !== undefined ? metadata.sellingPrice : metadata?.price;
                if (pName && pPrice !== undefined && pPrice !== null) {
                    finalBody = `${pName} • ₹${pPrice}`;
                } else if (pName) {
                    finalBody = `${pName} added to inventory`;
                }
                tag = `product-${referenceId || metadata?.productId || Date.now()}`;
                targetUrl = '/products';
                actionTitle = 'View Products';
            } else if (type === 'low_stock') {
                finalTitle = title || '⚠️ Low Stock Alert';
                const pName = metadata?.productName || metadata?.name || 'Product';
                const vInfo = metadata?.variantInfo ? ` (${metadata.variantInfo})` : '';
                const stock = metadata?.stock ?? 0;
                const minStock = metadata?.minStock ?? 5;
                finalBody = `${pName}${vInfo}: only ${stock} left (Min: ${minStock})`;
                tag = `lowstock-${referenceId || metadata?.variantId || Date.now()}`;
                targetUrl = '/inventory';
                actionTitle = 'View Inventory';
            } else {
                targetUrl = '/activity';
                actionTitle = 'View Activity';
            }

            const pushPayload = JSON.stringify({
                title: finalTitle,
                body: finalBody,
                icon: '/icons/icon-192.png',
                badge: '/icons/badge.png',
                tag,
                data: {
                    type,
                    referenceId,
                    billNo: billNumber,
                    amount,
                    url: targetUrl,
                    metadata
                },
                actions: [
                    {
                        action: 'view',
                        title: actionTitle
                    }
                ]
            });

            const sendPromises = subscriptions.map(async (sub) => {
                // keys is stored as a JSON string in the DB — parse it back to an object
                const keysObj = typeof sub.keys === 'string' ? JSON.parse(sub.keys) : sub.keys;
                const pushConfig = {
                    endpoint: sub.endpoint,
                    keys: keysObj
                };

                const pushOptions = {
                    TTL: 86400, // 24 hours
                    urgency: 'high' as const,
                    headers: {
                        'Urgency': 'high'
                    }
                };

                try {
                    await webPush.sendNotification(pushConfig, pushPayload, pushOptions);
                } catch (error: any) {
                    if (error.statusCode === 410 || error.statusCode === 404) {
                        // Expired subscription, delete it
                        await prisma.pushSubscription.delete({ where: { id: sub.id } });
                    } else {
                        console.error('Push error:', error);
                    }
                }
            });

            await Promise.all(sendPromises);

            return notification;
        } catch (error) {
            console.error('Error in notificationService.send:', error);
            throw error;
        }
    },

    async subscribe(userId: string, subscription: any) {
        // keys must be stored as a JSON string since the DB column is String
        const keysJson = typeof subscription.keys === 'string'
            ? subscription.keys
            : JSON.stringify(subscription.keys);

        return prisma.pushSubscription.upsert({
            where: { endpoint: subscription.endpoint },
            update: {
                userId,
                keys: keysJson,
                updatedAt: new Date()
            },
            create: {
                userId,
                endpoint: subscription.endpoint,
                keys: keysJson
            }
        });
    }
};
