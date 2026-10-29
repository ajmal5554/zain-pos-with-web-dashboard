/**
 * Shared catalogue description formatter and garment attribute helpers (ST-02)
 * Ensures consistent, readable descriptions across Products, POS, Labels, and Receipts
 * without including price or destroying distinct model/quality references.
 */

export interface GarmentAttributes {
    brand?: string | null;
    size?: string | null;
    color?: string | null;
    fabric?: string | null;
    quality?: string | null;
    pattern?: string | null;
    sleeve?: string | null;
    fit?: string | null;
    collar?: string | null;
    pocket?: string | null;
    styleRef?: string | null;
    [key: string]: any;
}

export interface DescriptionParams extends GarmentAttributes {
    productName?: string | null;
    categoryName?: string | null;
}

/**
 * Normalizes text: trims leading/trailing whitespace and collapses internal multiple spaces.
 * Preserves casing as entered by the user.
 */
export function normalizeText(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).trim().replace(/\s+/g, ' ');
}

/**
 * Compares two strings case-insensitively with normalized whitespace.
 */
export function areNormalizedStringsEqual(a: unknown, b: unknown): boolean {
    return normalizeText(a).toLowerCase() === normalizeText(b).toLowerCase();
}

/** Avoid repeating a brand or pattern already written as whole words in the name. */
function nameContainsAttribute(productName: string, attribute: string): boolean {
    const name = normalizeText(productName).toLowerCase();
    const value = normalizeText(attribute).toLowerCase();
    if (!value) return false;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'u').test(name);
}

/**
 * Formats structured garment fields into a human-readable catalogue description.
 * Example output:
 *   `Shirt | Crazy Heart | XL | Full Sleeve | Checks | Cotton`
 *
 * Rules:
 * 1. Price is strictly omitted (price is not part of identity).
 * 2. Fabric and Quality are kept distinct.
 * 3. Empty or undefined fields are omitted cleanly without redundant separators.
 * 4. Preserves style/model/quality reference when provided.
 * 5. Omits brand and pattern when already present as whole words in the product name.
 */
export function formatVariantDescription(
    productNameOrParams: string | DescriptionParams,
    maybeAttributes?: GarmentAttributes
): string {
    const params: DescriptionParams =
        typeof productNameOrParams === 'string'
            ? { productName: productNameOrParams, ...(maybeAttributes || {}) }
            : (productNameOrParams || {});

    const parts: string[] = [];

    const productName = normalizeText(params.productName);
    if (productName) {
        parts.push(productName);
    }

    const brand = normalizeText(params.brand);
    if (brand && !nameContainsAttribute(productName, brand)) {
        parts.push(brand);
    }

    const size = normalizeText(params.size);
    if (size) {
        parts.push(size);
    }

    const sleeve = normalizeText(params.sleeve);
    if (sleeve) {
        parts.push(sleeve);
    }

    const pattern = normalizeText(params.pattern);
    if (pattern && !nameContainsAttribute(productName, pattern)) {
        parts.push(pattern);
    }

    const fabric = normalizeText(params.fabric);
    if (fabric) {
        parts.push(fabric);
    }

    const quality = normalizeText(params.quality);
    if (quality && !areNormalizedStringsEqual(quality, fabric)) {
        parts.push(quality);
    }

    const fit = normalizeText(params.fit);
    if (fit) {
        parts.push(fit);
    }

    const color = normalizeText(params.color);
    if (color && !parts.some(p => areNormalizedStringsEqual(p, color))) {
        parts.push(color);
    }

    const collar = normalizeText(params.collar);
    if (collar) {
        parts.push(`Collar: ${collar}`);
    }

    const pocket = normalizeText(params.pocket);
    if (pocket) {
        parts.push(`Pocket: ${pocket}`);
    }

    const styleRef = normalizeText(params.styleRef);
    if (styleRef) {
        parts.push(`Ref: ${styleRef}`);
    }

    if (parts.length === 0) {
        return 'Standard Garment';
    }

    return parts.join(' | ');
}

/**
 * Safely escapes HTML special characters for print layouts and previews.
 */
export function escapeHtml(str: unknown): string {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Determines relevant attribute fields based on category name.
 * Provides guidance for concise, appropriate forms without hardcoding rigid restrictions.
 */
export function getCategoryGarmentFields(categoryName?: string | null): {
    common: Array<'size' | 'brand' | 'fabric' | 'quality' | 'pattern'>;
    optional: Array<'sleeve' | 'fit' | 'collar' | 'pocket' | 'color' | 'styleRef'>;
} {
    const norm = (categoryName || '').toLowerCase();

    if (norm.includes('shirt')) {
        return {
            common: ['size', 'brand', 'fabric', 'quality', 'pattern'],
            optional: ['sleeve', 'fit', 'collar', 'pocket', 'styleRef', 'color'],
        };
    }

    if (norm.includes('trouser') || norm.includes('pant') || norm.includes('jean')) {
        return {
            common: ['size', 'brand', 'fabric', 'quality', 'pattern'],
            optional: ['fit', 'pocket', 'styleRef', 'color'],
        };
    }

    if (norm.includes('t-shirt') || norm.includes('tshirt') || norm.includes('polo')) {
        return {
            common: ['size', 'brand', 'fabric', 'quality', 'pattern'],
            optional: ['sleeve', 'fit', 'collar', 'pocket', 'styleRef', 'color'],
        };
    }

    // Default garment fields
    return {
        common: ['size', 'brand', 'fabric', 'quality', 'pattern'],
        optional: ['fit', 'styleRef'],
    };
}
