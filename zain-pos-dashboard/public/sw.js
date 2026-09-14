self.addEventListener('push', function (event) {
    var data = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data = { body: event.data.text() };
        }
    }

    var rawType = (data.data && data.data.type) || data.type || '';
    var title = data.title || 'New Sale';
    // Strip leading emojis so Android does not truncate header
    title = title.replace(/^[\s\uFE0F\u200D\u2600-\u27BF\uD83C-\uDBFF\uDC00-\uDFFF]+/g, '').trim() || title;

    // Extract dynamic bill number and amount from payload
    var billNumber = (data.data && data.data.billNo) || data.billNo || (data.data && data.data.metadata && data.data.metadata.billNo);
    var rawAmount = (data.data && data.data.amount !== undefined) ? data.data.amount : (data.amount !== undefined ? data.amount : (data.data && data.data.metadata ? data.data.metadata.amount : undefined));

    var body = data.body || 'New notification';

    var isSale = rawType === 'sale' || title.toLowerCase().indexOf('sale') !== -1;
    var isUpdate = rawType === 'invoice_updated' || title.toLowerCase().indexOf('update') !== -1 || title.toLowerCase().indexOf('exchanged') !== -1;
    var isVoid = rawType === 'invoice_deleted' || title.toLowerCase().indexOf('void') !== -1;
    var isProductAdded = rawType === 'product_added' || title.toLowerCase().indexOf('product') !== -1;
    var isLowStock = rawType === 'low_stock' || title.toLowerCase().indexOf('low stock') !== -1 || title.toLowerCase().indexOf('stock') !== -1;

    var actionTitle = 'View Details';

    if (isSale) {
        title = 'New Sale';
        if (billNumber) {
            if (rawAmount !== undefined && rawAmount !== null) {
                var num = Number(rawAmount);
                var formatted = isNaN(num) ? String(rawAmount) : (num % 1 === 0 ? num.toFixed(0) : num.toFixed(2));
                body = 'Bill #' + billNumber + ' • ₹' + formatted;
            } else {
                body = 'Bill #' + billNumber;
            }
        }
        actionTitle = 'View Bill';
    } else if (isUpdate) {
        title = 'Invoice Updated';
        if (billNumber) {
            if (rawAmount !== undefined && rawAmount !== null) {
                var num = Number(rawAmount);
                var formatted = isNaN(num) ? String(rawAmount) : (num % 1 === 0 ? num.toFixed(0) : num.toFixed(2));
                body = 'Bill #' + billNumber + ' was updated. New Total: ₹' + formatted;
            } else {
                body = 'Bill #' + billNumber + ' was updated';
            }
        }
        actionTitle = 'View Bill';
    } else if (isVoid) {
        title = 'Invoice Voided';
        if (billNumber) {
            body = 'Bill #' + billNumber + ' was voided';
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
    var tag = data.tag || (billNumber ? ((rawType || 'notif') + '-' + billNumber) : (rawType ? (rawType + '-' + Date.now()) : undefined));

    // Deep link target URL
    var defaultUrl = isProductAdded ? '/products' : (isLowStock ? '/inventory' : (billNumber ? ('/sales?billNo=' + encodeURIComponent(billNumber)) : '/sales'));
    var targetUrl = (data.data && data.data.url) || data.url || defaultUrl;

    var options = {
        body: body,
        icon: data.icon || '/icons/icon-192.png',
        badge: data.badge || '/icons/badge.png',
        tag: tag,
        renotify: true,
        sound: isSale ? '/sounds/cash-register.wav' : '/sounds/notification.mp3',
        data: Object.assign({}, data.data || {}, {
            url: targetUrl,
            billNo: billNumber
        }),
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

self.addEventListener('notificationclick', function (event) {
    event.notification.close();

    var targetUrl = (event.notification.data && event.notification.data.url) || '/sales';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
            // Find existing open window on the same origin
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                var clientOrigin = new URL(client.url, self.location.origin).origin;
                if (clientOrigin === self.location.origin) {
                    if ('focus' in client) {
                        client.focus();
                    }
                    if ('navigate' in client) {
                        return client.navigate(targetUrl);
                    }
                    client.postMessage({ type: 'NAVIGATE', url: targetUrl });
                    return;
                }
            }
            // If no window open, open new window
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
