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

    const title = data.title || 'New Sale';

    // Extract dynamic bill number and amount from payload if available
    const billNumber = data.data?.billNo || data.billNo || data.data?.metadata?.billNo;
    const rawAmount = data.data?.amount ?? data.amount ?? data.data?.metadata?.amount;

    let body = data.body || 'New sale recorded';

    // Format sale body concisely: "Bill #1865 • ₹570"
    const isSale = data.data?.type === 'sale' || data.type === 'sale' || title.toLowerCase().includes('sale');
    if (isSale && billNumber) {
        if (rawAmount !== undefined && rawAmount !== null) {
            const num = Number(rawAmount);
            const formatted = isNaN(num) ? String(rawAmount) : (num % 1 === 0 ? num.toFixed(0) : num.toFixed(2));
            body = `Bill #${billNumber} • ₹${formatted}`;
        } else {
            body = `Bill #${billNumber}`;
        }
    }

    // Stable tag per sale to prevent duplicate notifications on network retries
    const tag = data.tag || (billNumber ? `sale-${billNumber}` : (data.data?.type ? `${data.data.type}-${Date.now()}` : undefined));

    // Deep link target URL
    const targetUrl = data.data?.url || data.url || (billNumber ? `/sales?billNo=${encodeURIComponent(billNumber)}` : '/sales');

    const options: any = {
        body,
        icon: data.icon || '/icons/icon-192.png',
        badge: data.badge || '/icons/badge.png',
        tag,
        renotify: true,
        data: {
            url: targetUrl,
            billNo: billNumber,
            ...(data.data || {})
        },
        actions: [
            {
                action: 'view',
                title: 'View Bill'
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
