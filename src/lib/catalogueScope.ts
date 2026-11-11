/**
 * Shared classification helpers for separating Audited / Prepared catalogue items
 * from the Legacy Old Item Chart on the Products page.
 */

export type CatalogueTab = 'AUDITED' | 'LEGACY';
export type AuditedStockFilter = 'ALL' | 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'PREPARED';

export interface AuditedStockStats {
    total: number;
    inStock: number;
    lowStock: number;
    outOfStock: number;
    prepared: number;
}

/**
 * Returns true if the product belongs to the New / Audited catalogue
 * (has at least one tracked or prepared variant).
 * Pure legacy items without tracking or preparation return false.
 */
export function isAuditedOrPreparedProduct(product: any): boolean {
    if (!product) return false;
    if (product.hasTrackedVariant === true || product.hasPreparedVariant === true) {
        return true;
    }
    if (product.hasTrackedVariant === false && product.hasPreparedVariant === false) {
        return false;
    }
    const variants = Array.isArray(product.variants) ? product.variants : [];
    return variants.some((v: any) => Boolean(v?.isTracked || v?.isPrepared));
}

/**
 * Returns true when a product has prepared (uncounted) variants and no active tracked variants yet.
 */
export function isPreparedOnlyProduct(product: any): boolean {
    if (!product) return false;
    const hasTracked =
        typeof product.hasTrackedVariant === 'boolean'
            ? product.hasTrackedVariant
            : (Array.isArray(product.variants) ? product.variants : []).some((v: any) => Boolean(v?.isTracked));
    const hasPrepared =
        typeof product.hasPreparedVariant === 'boolean'
            ? product.hasPreparedVariant
            : (Array.isArray(product.variants) ? product.variants : []).some((v: any) => Boolean(v?.isPrepared));
    return Boolean(hasPrepared && !hasTracked);
}

export function getProductTotalStock(product: any): number {
    if (product?.totalStock !== undefined && product?.totalStock !== null && Number.isFinite(Number(product.totalStock))) {
        return Number(product.totalStock);
    }
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    return variants.reduce((sum: number, v: any) => sum + (Number(v?.stock) || 0), 0);
}

export function getProductMinStock(product: any): number {
    return product?.variants?.[0]?.minStock || 3;
}

export function computeAuditedStockStats(auditedProducts: any[]): AuditedStockStats {
    let inStock = 0;
    let lowStock = 0;
    let outOfStock = 0;
    let prepared = 0;

    for (const product of auditedProducts) {
        if (isPreparedOnlyProduct(product)) {
            prepared++;
            continue;
        }
        const stock = getProductTotalStock(product);
        const min = getProductMinStock(product);
        if (stock <= 0) {
            outOfStock++;
        } else if (stock <= min) {
            lowStock++;
        } else {
            inStock++;
        }
    }

    return {
        total: auditedProducts.length,
        inStock,
        lowStock,
        outOfStock,
        prepared,
    };
}

