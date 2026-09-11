self.addEventListener('push', function (event) {
    var data = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data = { body: event.data.text() };
        }
    }

    var title = data.title || 'New Sale';

    // Extract dynamic bill number and amount from payload
    var billNumber = (data.data && data.data.billNo) || data.billNo || (data.data && data.data.metadata && data.data.metadata.billNo);
    var rawAmount = (data.data && data.data.amount !== undefined) ? data.data.amount : (data.amount !== undefined ? data.amount : (data.data && data.data.metadata ? data.data.metadata.amount : undefined));

    var body = data.body || 'New sale recorded';

    // Format sale body: "Bill #1865 • ₹570"
    var isSale = (data.data && data.data.type === 'sale') || data.type === 'sale' || title.toLowerCase().indexOf('sale') !== -1;
    if (isSale && billNumber) {
        if (rawAmount !== undefined && rawAmount !== null) {
            var num = Number(rawAmount);
            var formatted = isNaN(num) ? String(rawAmount) : (num % 1 === 0 ? num.toFixed(0) : num.toFixed(2));
            body = 'Bill #' + billNumber + ' • ₹' + formatted;
        } else {
            body = 'Bill #' + billNumber;
        }
    }

    // Stable tag per sale to prevent duplicates on retries
    var tag = data.tag || (billNumber ? ('sale-' + billNumber) : (data.data && data.data.type ? (data.data.type + '-' + Date.now()) : undefined));

    // Deep link target URL
    var targetUrl = (data.data && data.data.url) || data.url || (billNumber ? ('/sales?billNo=' + encodeURIComponent(billNumber)) : '/sales');

    var options = {
        body: body,
        icon: data.icon || '/icons/icon-192.png',
        badge: data.badge || '/icons/badge.png',
        tag: tag,
        renotify: true,
        sound: isSale ? '/sounds/cash-register.wav' : undefined,
        data: Object.assign({}, data.data || {}, {
            url: targetUrl,
            billNo: billNumber
        }),
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
