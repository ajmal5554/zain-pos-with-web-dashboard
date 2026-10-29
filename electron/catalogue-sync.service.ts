import { enrichCatalogueVariants } from './catalogue.service';

export const CATALOGUE_METADATA_VERSION = 1;

const GARMENT_FIELDS = ['brand', 'fabric', 'quality', 'pattern', 'sleeve', 'fit', 'collar', 'pocket', 'styleRef'];

/** Preserve ST-02 metadata in the outgoing representation. Old servers must not
 * acknowledge records whose preparation/identity fields they cannot store. */
export async function prepareCatalogueSync(prisma: any, products: any[], cloudStatus: any) {
    const variants = await enrichCatalogueVariants(
        prisma, products.flatMap(product => (product.variants || []).map((variant: any) => ({
            ...variant, product: { name: product.name },
        }))), { role: 'ADMIN', isActive: true, permViewCostPrice: true }
    );
    const byId = new Map<string, any>(variants.map((variant: any) => [variant.id, variant]));
    const supportsMetadata = Number(cloudStatus?.capabilities?.catalogueMetadataVersion || 0) >= CATALOGUE_METADATA_VERSION;
    const ready: any[] = [];
    const pending: any[] = [];
    for (const product of products) {
        const enriched = { ...product, variants: (product.variants || []).map((variant: any) => byId.get(variant.id) || variant) };
        const requiresMetadata = enriched.variants.some((variant: any) => variant.isPrepared
            || GARMENT_FIELDS.some(field => variant[field] !== undefined && variant[field] !== null && variant[field] !== '')
            || variant.metadata !== undefined && variant.metadata !== null);
        (requiresMetadata && !supportsMetadata ? pending : ready).push(enriched);
    }
    return { ready, pending, supportsMetadata };
}

/** Mark only the exact uploaded revisions. A concurrent sale/catalogue save must
 * remain unsynced instead of being acknowledged by an older upload. */
export async function acknowledgeCatalogueSync(prisma: any, products: any[]) {
    await prisma.$transaction(async (tx: any) => {
        for (const product of products) {
            if (product.updatedAt) {
                await tx.product.updateMany({
                    where: { id: product.id, updatedAt: product.updatedAt },
                    data: { isSynced: true, lastSyncedAt: new Date(), updatedAt: product.updatedAt },
                });
            }
            for (const variant of product.variants || []) {
                if (!variant.updatedAt) continue;
                await tx.productVariant.updateMany({
                    where: { id: variant.id, updatedAt: variant.updatedAt },
                    data: { isSynced: true, lastSyncedAt: new Date(), updatedAt: variant.updatedAt },
                });
            }
        }
    });
}
