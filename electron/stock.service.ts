/**
 * Stock & Inventory Read Service (ST-01)
 * Provides bounded, secure, read-only queries for variant stock overview and movement history.
 * Explicitly omits cost prices and any sensitive financial data.
 */

export interface GetStockOverviewArgs {
    page?: number;
    pageSize?: number;
    search?: string;
    categoryId?: string;
    balanceFilter?: 'ALL' | 'POSITIVE' | 'ZERO' | 'NEGATIVE';
}

export interface GetStockMovementsArgs {
    variantId: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
}

export async function getStockOverview(prisma: any, args: GetStockOverviewArgs = {}) {
    try {
        const requestedPage = Math.max(1, Math.floor(Number(args.page) || 1));
        const pageSize = Math.min(Math.max(1, Math.floor(Number(args.pageSize) || 50)), 100);

        // Base filter: active variants of active products
        const baseWhere: any = {
            isActive: true,
            product: {
                isActive: true,
            },
        };

        // Category filter
        if (args.categoryId && args.categoryId !== 'ALL') {
            baseWhere.product = {
                ...baseWhere.product,
                categoryId: args.categoryId,
            };
        }

        // Multi-token search across product name, barcode, and SKU
        const searchQuery = (args.search || '').trim();
        if (searchQuery.length > 0) {
            const tokens = searchQuery.split(/\s+/).filter(Boolean);
            if (tokens.length > 0) {
                baseWhere.AND = tokens.map((token) => ({
                    OR: [
                        { product: { name: { contains: token } } },
                        { barcode: { contains: token } },
                        { sku: { contains: token } },
                        { product: { category: { name: { contains: token } } } },
                    ],
                }));
            }
        }

        // Clone baseWhere for stock-balance counting
        const filterForCounts = { ...baseWhere };

        // Balance filter for the paginated rows
        const queryWhere: any = { ...baseWhere };
        const balanceFilter = args.balanceFilter || 'ALL';
        if (balanceFilter === 'POSITIVE') {
            queryWhere.stock = { gt: 0 };
        } else if (balanceFilter === 'ZERO') {
            queryWhere.stock = { equals: 0 };
        } else if (balanceFilter === 'NEGATIVE') {
            queryWhere.stock = { lt: 0 };
        }

        // A filter or committed stock change can remove the requested page.
        const totalMatching = await prisma.productVariant.count({ where: queryWhere });
        const totalPages = Math.ceil(totalMatching / pageSize) || 1;
        const page = Math.min(requestedPage, totalPages);
        const skip = (page - 1) * pageSize;

        // Compute counts across full filtered dataset
        const [
            positiveCount,
            zeroCount,
            negativeCount,
            totalInFilter,
            items,
            categories,
        ] = await Promise.all([
            prisma.productVariant.count({
                where: {
                    ...filterForCounts,
                    stock: { gt: 0 },
                },
            }),
            prisma.productVariant.count({
                where: {
                    ...filterForCounts,
                    stock: { equals: 0 },
                },
            }),
            prisma.productVariant.count({
                where: {
                    ...filterForCounts,
                    stock: { lt: 0 },
                },
            }),
            prisma.productVariant.count({ where: filterForCounts }),
            prisma.productVariant.findMany({
                where: queryWhere,
                select: {
                    id: true,
                    sku: true,
                    barcode: true,
                    size: true,
                    color: true,
                    stock: true,
                    minStock: true,
                    isActive: true,
                    updatedAt: true,
                    // Strictly NO costPrice or financial fields
                    product: {
                        select: {
                            id: true,
                            name: true,
                            isActive: true,
                            category: {
                                select: {
                                    id: true,
                                    name: true,
                                },
                            },
                        },
                    },
                },
                orderBy: [
                    { product: { name: 'asc' } },
                    { sku: 'asc' },
                    { id: 'asc' },
                ],
                skip,
                take: pageSize,
            }),
            prisma.category.findMany({
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            }),
        ]);

        return {
            success: true,
            data: {
                items,
                totalMatching,
                page,
                pageSize,
                totalPages,
                stats: {
                    totalMatching,
                    totalInFilter,
                    positiveCount,
                    zeroCount,
                    negativeCount,
                },
                categories,
            },
        };
    } catch (error: any) {
        return {
            success: false,
            error: error.message || 'Failed to query stock overview',
        };
    }
}

export async function getStockMovements(prisma: any, args: GetStockMovementsArgs) {
    try {
        if (!args || !args.variantId) {
            return {
                success: false,
                error: 'Variant ID is required',
            };
        }

        // Verify variant exists and fetch metadata (excluding cost prices)
        const variant = await prisma.productVariant.findUnique({
            where: { id: args.variantId },
            select: {
                id: true,
                sku: true,
                barcode: true,
                size: true,
                color: true,
                stock: true,
                minStock: true,
                isActive: true,
                product: {
                    select: {
                        id: true,
                        name: true,
                        isActive: true,
                        category: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                },
            },
        });

        if (!variant) {
            return {
                success: false,
                error: 'Product variant not found',
            };
        }

        const movementWhere: any = {
            variantId: args.variantId,
        };

        if (args.fromDate) {
            const [y, m, d] = args.fromDate.split('-').map(Number);
            if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                const startDate = new Date(y, m - 1, d, 0, 0, 0, 0);
                movementWhere.createdAt = {
                    ...movementWhere.createdAt,
                    gte: startDate,
                };
            }
        }

        if (args.toDate) {
            const [y, m, d] = args.toDate.split('-').map(Number);
            if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                const endDate = new Date(y, m - 1, d, 23, 59, 59, 999);
                movementWhere.createdAt = {
                    ...movementWhere.createdAt,
                    lte: endDate,
                };
            }
        }

        const limit = Math.min(Math.max(1, Number(args.limit) || 50), 100);
        const offset = Math.max(0, Number(args.offset) || 0);

        const [totalMovements, movements] = await Promise.all([
            prisma.inventoryMovement.count({ where: movementWhere }),
            prisma.inventoryMovement.findMany({
                where: movementWhere,
                select: {
                    id: true,
                    variantId: true,
                    type: true,
                    quantity: true,
                    reason: true,
                    reference: true,
                    createdBy: true,
                    createdAt: true,
                },
                orderBy: [
                    { createdAt: 'desc' },
                    { id: 'desc' },
                ],
                skip: offset,
                take: limit,
            }),
        ]);

        // Resolve user operators where possible
        const creatorIds = Array.from(new Set(movements.map((m: any) => m.createdBy).filter(Boolean)));
        let userMap: Record<string, string> = {};
        if (creatorIds.length > 0) {
            try {
                const users = await prisma.user.findMany({
                    where: { id: { in: creatorIds } },
                    select: { id: true, name: true, username: true },
                });
                userMap = users.reduce((acc: any, u: any) => {
                    acc[u.id] = u.name || u.username;
                    return acc;
                }, {});
            } catch {
                // If user resolution fails, proceed with creator ID fallback
            }
        }

        const formattedMovements = movements.map((m: any) => ({
            ...m,
            operatorName: userMap[m.createdBy] || m.createdBy || 'System',
        }));

        return {
            success: true,
            data: {
                variant,
                movements: formattedMovements,
                totalMovements,
                limit,
                offset,
            },
        };
    } catch (error: any) {
        return {
            success: false,
            error: error.message || 'Failed to query movement history',
        };
    }
}
