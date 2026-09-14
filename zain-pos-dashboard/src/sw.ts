/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.skipWaiting();
clientsClaim();

// Handle Push Notification
self.addEventListener('push', (event) => {
    let data: any = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch {
            data = { body: event.data.text() };
        }
    }

    const rawType = data.data?.type || data.type || '';
    let title = data.title || 'New Sale';
    // Strip leading emojis from title so Android does not truncate the header
    title = title.replace(/^[\p{Emoji}\s]+/u, '').trim() || title;

    // Extract dynamic bill number and amount from payload if available
    const billNumber = data.data?.billNo || data.billNo || data.data?.metadata?.billNo;
    const rawAmount = data.data?.amount ?? data.amount ?? data.data?.metadata?.amount;

    let body = data.body || 'New notification';

    const isSale = rawType === 'sale' || title.toLowerCase().includes('sale');
    const isUpdate = rawType === 'invoice_updated' || title.toLowerCase().includes('update') || title.toLowerCase().includes('exchanged');
    const isVoid = rawType === 'invoice_deleted' || title.toLowerCase().includes('void');
    const isProductAdded = rawType === 'product_added' || title.toLowerCase().includes('product');
    const isLowStock = rawType === 'low_stock' || title.toLowerCase().includes('low stock') || title.toLowerCase().includes('stock');

    let actionTitle = 'View Details';

    if (isSale) {
        title = 'New Sale';
        if (billNumber) {
            if (rawAmount !== undefined && rawAmount !== null) {
                const num = Number(rawAmount);
                const formatted = isNaN(num) ? String(rawAmount) : (num % 1 === 0 ? num.toFixed(0) : num.toFixed(2));
                body = `Bill #${billNumber} • ₹${formatted}`;
            } else {
                body = `Bill #${billNumber}`;
            }
        }
        actionTitle = 'View Bill';
    } else if (isUpdate) {
        title = 'Invoice Updated';
        if (billNumber) {
            if (rawAmount !== undefined && rawAmount !== null) {
                const num = Number(rawAmount);
                const formatted = isNaN(num) ? String(rawAmount) : (num % 1 === 0 ? num.toFixed(0) : num.toFixed(2));
                body = `Bill #${billNumber} was updated. New Total: ₹${formatted}`;
            } else {
                body = `Bill #${billNumber} was updated`;
            }
        }
        actionTitle = 'View Bill';
    } else if (isVoid) {
        title = 'Invoice Voided';
        if (billNumber) {
            body = `Bill #${billNumber} was voided`;
        }
        actionTitle = 'View Sales';
    } else if (isProductAdded) {
        title = data.title || 'New Product Added';
        actionTitle = 'View Products';
    } else if (isLowStock) {
        title = data.title || '⚠️ Low Stock Alert';
        actionTitle = 'View Inventory';
    }

    // Stable tag per event type
    const tag = data.tag || (billNumber ? `${rawType || 'notif'}-${billNumber}` : (rawType ? `${rawType}-${Date.now()}` : undefined));

    // Deep link target URL
    const defaultUrl = isProductAdded ? '/products' : (isLowStock ? '/inventory' : (billNumber ? `/sales?billNo=${encodeURIComponent(billNumber)}` : '/sales'));
    const targetUrl = data.data?.url || data.url || defaultUrl;

    const options: any = {
        body,
        icon: data.icon || '/icons/icon-192.png',
        badge: data.badge || '/icons/badge.png',
        tag,
        renotify: true,
        sound: isSale ? '/sounds/cash-register.wav' : '/sounds/notification.mp3',
        data: {
            url: targetUrl,
            billNo: billNumber,
            ...(data.data || {})
        },
        actions: [
            {
                action: 'view',
                title: actionTitle
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// Handle Notification Click
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = event.notification.data?.url || '/sales';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Find if there's already an open tab on the same origin
            for (const client of windowClients) {
                const windowClient = client as WindowClient;
                const clientOrigin = new URL(windowClient.url, self.location.origin).origin;
                if (clientOrigin === self.location.origin) {
                    if (windowClient.focus) {
                        void windowClient.focus();
                    }
                    if (windowClient.navigate) {
                        return windowClient.navigate(targetUrl);
                    }
                    return;
                }
            }
            // If no window is currently open, open a new window
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});
