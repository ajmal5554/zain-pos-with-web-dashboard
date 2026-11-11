export const DISMISSED_SALE_CUSTOMERS_KEY = 'DISMISSED_SALE_CUSTOMERS';

export type DismissedCustomerMap = Record<string, number>;

export interface CustomerDirectoryKeyInput {
    id?: string | null;
    name?: string | null;
    phone?: string | null;
}

const ANON_NAMES = new Set(['walk-in customer', 'walk-in', '']);

export function sanitizeCustomerNameInput(rawValue: string, maxLength: number = 50): string {
    return String(rawValue || '')
        .replace(/\d+/g, '')
        .slice(0, maxLength);
}

/**
 * Normalize a phone string to a stable lookup token (last 10 digits for >=10-digit numbers).
 */
export function normalizeCustomerPhoneToken(phone?: string | null): string {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length >= 10) return digits.slice(-10);
    return digits;
}

/**
 * Build canonical dismissal keys for a customer entry.
 * Prefers normalized phone; falls back to lowercased non-anonymous name when phone is absent,
 * plus parses legacy synthetic IDs (`sale-cust-...` / `cust-phone-...`) when present.
 */
export function buildCustomerDismissalKeys(input: CustomerDirectoryKeyInput): string[] {
    const keys = new Set<string>();
    const phoneToken = normalizeCustomerPhoneToken(input.phone);
    if (phoneToken) {
        keys.add(`phone:${phoneToken}`);
    }

    const rawId = String(input.id || '').trim();
    if (rawId.startsWith('sale-cust-') || rawId.startsWith('cust-phone-')) {
        const suffix = rawId.replace(/^sale-cust-|^cust-phone-/, '');
        let decoded = suffix;
        try {
            decoded = decodeURIComponent(suffix);
        } catch {
            // Keep raw suffix if not URI-encoded
        }
        const suffixDigits = normalizeCustomerPhoneToken(decoded);
        if (suffixDigits && /^\d{7,}$/.test(decoded.replace(/[\s+-]/g, ''))) {
            keys.add(`phone:${suffixDigits}`);
        } else if (!phoneToken) {
            const lowerDecoded = decoded.trim().toLowerCase();
            if (!ANON_NAMES.has(lowerDecoded)) {
                keys.add(`name:${lowerDecoded}`);
            }
        }
    }

    if (!phoneToken) {
        const lowerName = String(input.name || '').trim().toLowerCase();
        if (!ANON_NAMES.has(lowerName)) {
            keys.add(`name:${lowerName}`);
        }
    }

    return Array.from(keys);
}

/**
 * Parse the persisted DISMISSED_SALE_CUSTOMERS setting value safely.
 */
export function parseDismissedCustomerMap(rawValue?: string | null): DismissedCustomerMap {
    if (!rawValue) return {};
    try {
        const parsed = JSON.parse(rawValue);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const clean: DismissedCustomerMap = {};
        for (const [k, v] of Object.entries(parsed)) {
            const ts = Number(v);
            if (typeof k === 'string' && k && Number.isFinite(ts) && ts > 0) {
                clean[k] = ts;
            }
        }
        return clean;
    } catch {
        return {};
    }
}

/**
 * Check whether an invoice-derived customer entry should be suppressed because it was
 * explicitly deleted/dismissed after (or at) that sale's timestamp.
 */
export function isSaleCustomerDismissed(
    sale: { customerPhone?: string | null; customerName?: string | null; createdAt?: string | number | Date | null },
    dismissedMap?: DismissedCustomerMap | null
): boolean {
    if (!dismissedMap) return false;
    const keys = buildCustomerDismissalKeys({
        phone: sale.customerPhone,
        name: sale.customerName,
    });
    if (keys.length === 0) return false;

    let saleMs = 0;
    if (typeof sale.createdAt === 'number') {
        saleMs = sale.createdAt;
    } else if (sale.createdAt) {
        const str = String(sale.createdAt).trim();
        const parsed = /^\d+$/.test(str) ? Number(str) : new Date(sale.createdAt).getTime();
        saleMs = Number.isFinite(parsed) ? parsed : 0;
    }

    return keys.some((key) => {
        const dismissedAt = dismissedMap[key];
        return typeof dismissedAt === 'number' && dismissedAt >= saleMs;
    });
}

export interface SearchableCustomerLike {
    id?: string;
    name?: string | null;
    phone?: string | null;
    gstin?: string | null;
}

export type CustomerMatchType =
    | 'EXACT_PHONE'
    | 'EXACT_GSTIN'
    | 'EXACT_NAME'
    | 'PARTIAL_PHONE'
    | 'SIMILAR_NAME';

export interface CustomerMatchResult<T extends SearchableCustomerLike = SearchableCustomerLike> {
    customer: T;
    matchType: CustomerMatchType;
    score: number;
    isExact: boolean;
}

/**
 * Find existing customers matching a candidate name, phone, or GSTIN so POS/Store Credit
 * forms warn staff when a customer is already in the database and offer quick selection.
 */
export function findExistingCustomerMatches<T extends SearchableCustomerLike>(
    customers: T[],
    query: { name?: string | null; phone?: string | null; gstin?: string | null; excludeId?: string | null }
): { exactMatch: CustomerMatchResult<T> | null; matches: CustomerMatchResult<T>[] } {
    const rawName = String(query.name || '').trim().toLowerCase();
    const isAnonName = !rawName || ANON_NAMES.has(rawName);
    const rawDigits = String(query.phone || '').replace(/\D/g, '');
    const phoneToken = normalizeCustomerPhoneToken(query.phone);
    const rawGstin = String(query.gstin || '').trim().toUpperCase();

    if (isAnonName && rawDigits.length < 4 && rawGstin.length < 6) {
        return { exactMatch: null, matches: [] };
    }

    const results: CustomerMatchResult<T>[] = [];

    for (const c of customers) {
        if (query.excludeId && c.id === query.excludeId) continue;

        const cPhoneDigits = String(c.phone || '').replace(/\D/g, '');
        const cPhoneToken = normalizeCustomerPhoneToken(c.phone);
        const cName = String(c.name || '').trim().toLowerCase();
        const cGstin = String(c.gstin || '').trim().toUpperCase();

        let matchType: CustomerMatchType | null = null;
        let score = 0;
        let isExact = false;

        if (phoneToken && rawDigits.length >= 10 && cPhoneToken && cPhoneToken === phoneToken) {
            matchType = 'EXACT_PHONE';
            score = 100;
            isExact = true;
        } else if (rawGstin && rawGstin.length >= 10 && cGstin && cGstin === rawGstin) {
            matchType = 'EXACT_GSTIN';
            score = 95;
            isExact = true;
        } else if (!isAnonName && cName && cName === rawName) {
            matchType = 'EXACT_NAME';
            score = 90;
            isExact = true;
        } else if (rawDigits.length >= 4 && cPhoneDigits && cPhoneDigits.includes(rawDigits)) {
            matchType = 'PARTIAL_PHONE';
            score = 70;
        } else if (!isAnonName && rawName.length >= 2 && cName && (cName.includes(rawName) || rawName.includes(cName))) {
            matchType = 'SIMILAR_NAME';
            score = cName.startsWith(rawName) ? 60 : 50;
        }

        if (matchType) {
            results.push({ customer: c, matchType, score, isExact });
        }
    }

    results.sort((a, b) => b.score - a.score);
    const trimmed = results.slice(0, 5);
    const exactMatch = trimmed.find((m) => m.isExact) || null;
    return { exactMatch, matches: trimmed };
}
