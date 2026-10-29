/**
 * Universal RFC4122 v4 UUID generator & crypto.randomUUID polyfill
 *
 * In web browsers, window.crypto.randomUUID() is restricted by W3C specification
 * to "Secure Contexts" (HTTPS and localhost). When accessing the POS over a local
 * network IP address (e.g. http://192.168.1.x:5173), browsers omit crypto.randomUUID,
 * causing runtime exceptions ("crypto.randomUUID is not a function").
 *
 * This module ensures crypto.randomUUID is safely polyfilled across all browsers,
 * platforms, and non-secure LAN environments.
 */

export function polyfillRandomUUID(): string {
    const cryptoObj =
        typeof globalThis !== 'undefined' && globalThis.crypto
            ? globalThis.crypto
            : typeof window !== 'undefined'
            ? window.crypto
            : undefined;

    // Fast-path: crypto.getRandomValues is available in virtually all browsers even over HTTP
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
        try {
            const buf = new Uint8Array(16);
            cryptoObj.getRandomValues(buf);

            // Per RFC 4122 section 4.4:
            // set bits 6-7 of clock_seq_hi_and_reserved to 01 (variant 1)
            buf[6] = (buf[6] & 0x0f) | 0x40; // Version 4
            buf[8] = (buf[8] & 0x3f) | 0x80; // Variant 10xxxxxx

            const hex: string[] = [];
            for (let i = 0; i < 16; i++) {
                hex.push((buf[i] < 16 ? '0' : '') + buf[i].toString(16));
            }

            return (
                hex.slice(0, 4).join('') +
                '-' +
                hex.slice(4, 6).join('') +
                '-' +
                hex.slice(6, 8).join('') +
                '-' +
                hex.slice(8, 10).join('') +
                '-' +
                hex.slice(10, 16).join('')
            );
        } catch {
            // Fall through to high-entropy fallback
        }
    }

    // High-entropy fallback using performance.now and Date.now
    let d = Date.now();
    let d2 = (typeof performance !== 'undefined' && performance.now && performance.now() * 1000) || 0;

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        let r = Math.random() * 16;
        if (d > 0) {
            r = (d + r) % 16 | 0;
            d = Math.floor(d / 16);
        } else if (d2 > 0) {
            r = (d2 + r) % 16 | 0;
            d2 = Math.floor(d2 / 16);
        } else {
            r = r | 0;
        }
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

// ── Install Polyfill Immediately ─────────────────────────────────────────────

function installPolyfill() {
    // 1. Prototype polyfill for browsers where window.Crypto is defined
    if (typeof Crypto !== 'undefined' && Crypto.prototype && typeof Crypto.prototype.randomUUID !== 'function') {
        try {
            Object.defineProperty(Crypto.prototype, 'randomUUID', {
                value: polyfillRandomUUID,
                configurable: true,
                writable: true,
            });
        } catch {
            // ignore
        }
    }

    // 2. Patch all global scope targets (window, globalThis, self, global)
    const targets = [
        typeof window !== 'undefined' ? window : null,
        typeof globalThis !== 'undefined' ? globalThis : null,
        typeof self !== 'undefined' ? self : null,
        typeof global !== 'undefined' ? global : null,
    ];

    for (const target of targets) {
        if (!target) continue;
        try {
            if (!target.crypto) {
                try {
                    (target as any).crypto = {};
                } catch {
                    // ignore
                }
            }

            if (target.crypto && typeof target.crypto.randomUUID !== 'function') {
                try {
                    Object.defineProperty(target.crypto, 'randomUUID', {
                        value: polyfillRandomUUID,
                        configurable: true,
                        writable: true,
                    });
                } catch {
                    try {
                        (target.crypto as any).randomUUID = polyfillRandomUUID;
                    } catch {
                        // ignore
                    }
                }
            }
        } catch {
            // ignore
        }
    }
}

installPolyfill();

/**
 * Returns a guaranteed valid RFC4122 v4 UUID, safe across all environments.
 */
export function safeRandomUUID(): string {
    const cryptoObj =
        typeof globalThis !== 'undefined' && globalThis.crypto
            ? globalThis.crypto
            : typeof window !== 'undefined'
            ? window.crypto
            : undefined;

    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
        try {
            return cryptoObj.randomUUID();
        } catch {
            // ignore
        }
    }

    return polyfillRandomUUID();
}
