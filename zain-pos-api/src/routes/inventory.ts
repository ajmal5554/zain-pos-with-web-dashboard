import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, type AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

async function getActor(req: AuthRequest) {
    if (!req.userId) return null;
    return prisma.user.findUnique({ where: { id: req.userId } });
}

async function requireManageProducts(req: AuthRequest, res: any) {
    const actor = await getActor(req);
    if (!actor) {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
    }
    if (actor.role !== 'ADMIN' && !actor.permManageProducts) {
        res.status(403).json({ error: 'Missing permission: manage products' });
        return null;
    }
    return actor;
}

// Get all products with variants and stock levels
router.get('/products', async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            include: {
                category: true,
                variants: true
            },
            where: { isActive: true },
            orderBy: { name: 'asc' }
        });

        // Flatten products and variants for simpler dashboard view
        const flattened = products.flatMap(product => {
            const activeVariants = product.variants.filter(v => v.isActive);

            if (activeVariants.length === 0) {
                // Return product as a single item if no active variants exist
                return [{
                    id: product.id,
                    name: product.name,
                    price: 0,
                    stock: 0,
                    category: product.category,
                    status: 'No Variants'
                }];
            }

            return activeVariants.map(variant => ({
                id: `${product.id}-${variant.id}`,
                name: product.name + (variant.size ? ` (${variant.size}${variant.color ? ` ${variant.color}` : ''})` : ''),
                price: variant.sellingPrice,
                stock: variant.stock,
                category: product.category
            }));
        });

        res.json(flattened);
    } catch (error) {
        console.error('Products error:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// Get low stock product variants
router.get('/low-stock', async (req, res) => {
    try {
        const threshold = parseInt(req.query.threshold as string) || 5;

        const variants = await prisma.productVariant.findMany({
            where: {
                stock: { lte: threshold },
                isActive: true
            },
            include: {
                product: {
                    include: { category: true }
                }
            },
            orderBy: { stock: 'asc' }
        });

        const lowStock = variants.map(v => ({
            id: `${v.product.id}-${v.id}`,
            name: v.product.name + (v.size ? ` (${v.size})` : ''),
            price: v.sellingPrice,
            stock: v.stock,
            category: v.product.category
        }));

        res.json(lowStock);
    } catch (error) {
        console.error('Low stock error:', error);
        res.status(500).json({ error: 'Failed to fetch low stock products' });
    }
});

// Get product categories
router.get('/categories', async (req, res) => {
    try {
        const categories = await prisma.category.findMany({
            include: {
                _count: {
                    select: { products: true }
                }
            },
            orderBy: { name: 'asc' }
        });

        res.json(categories);
    } catch (error) {
        console.error('Categories error:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

router.get('/products/manage', async (req, res) => {
    try {
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

        const products = await prisma.product.findMany({
            where: {
                isActive: true,
                ...(search ? {
                    OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { variants: { some: { barcode: { contains: search, mode: 'insensitive' }, isActive: true } } },
                        { variants: { some: { sku: { contains: search, mode: 'insensitive' }, isActive: true } } }
                    ]
                } : {})
            },
            include: {
                category: true,
                variants: {
                    where: { isActive: true },
                    orderBy: { createdAt: 'asc' }
                }
            },
            orderBy: { updatedAt: 'desc' }
        });

        res.json(products);
    } catch (error) {
        console.error('Managed products error:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

router.post('/products', async (req: AuthRequest, res) => {
    const actor = await requireManageProducts(req, res);
    if (!actor) return;

    const { name, categoryId, hsn, taxRate = 5, description, variants = [] } = req.body || {};
    if (!name || !categoryId || !Array.isArray(variants) || variants.length === 0) {
        return res.status(400).json({ error: 'name, categoryId, and at least one variant are required' });
    }

    const product = await prisma.product.create({
        data: {
            name,
            categoryId,
            hsn: hsn || null,
            taxRate: Number(taxRate) || 5,
            description: description || null,
            variants: {
                create: variants.map((variant: any, index: number) => ({
                    sku: variant.sku || `${name}-${Date.now()}-${index}`,
                    barcode: variant.barcode,
                    size: variant.size || null,
                    color: variant.color || null,
                    mrp: Number(variant.mrp) || 0,
                    sellingPrice: Number(variant.sellingPrice) || 0,
                    costPrice: Number(variant.costPrice) || 0,
                    stock: Number(variant.stock) || 0,
                    minStock: Number(variant.minStock) || 5
                }))
            }
        },
        include: {
            category: true,
            variants: true
        }
    });

    await prisma.auditLog.create({
        data: {
            action: 'REMOTE_PRODUCT_CREATED',
            details: `Product ${product.name} created from web dashboard by ${actor.username}`,
            userId: actor.id
        }
    });

    res.status(201).json(product);
});

router.patch('/products/:id', async (req: AuthRequest, res) => {
    const actor = await requireManageProducts(req, res);
    if (!actor) return;

    const productId = String(req.params.id);
    const { name, categoryId, hsn, taxRate = 5, description, variants = [] } = req.body || {};

    const updated = await prisma.$transaction(async (tx) => {
        const product = await tx.product.update({
            where: { id: productId },
            data: {
                name,
                categoryId,
                hsn: hsn || null,
                taxRate: Number(taxRate) || 5,
                description: description || null
            }
        });

        await tx.productVariant.updateMany({
            where: { productId },
            data: { isActive: false }
        });

        for (const [index, variant] of variants.entries()) {
            if (variant.id) {
                await tx.productVariant.update({
                    where: { id: variant.id },
                    data: {
                        sku: variant.sku || `${name}-${Date.now()}-${index}`,
                        barcode: variant.barcode,
                        size: variant.size || null,
                        color: variant.color || null,
                        mrp: Number(variant.mrp) || 0,
                        sellingPrice: Number(variant.sellingPrice) || 0,
                        costPrice: Number(variant.costPrice) || 0,
                        stock: Number(variant.stock) || 0,
                        minStock: Number(variant.minStock) || 5,
                        isActive: true
                    }
                });
            } else {
                await tx.productVariant.create({
                    data: {
                        productId,
                        sku: variant.sku || `${name}-${Date.now()}-${index}`,
                        barcode: variant.barcode,
                        size: variant.size || null,
                        color: variant.color || null,
                        mrp: Number(variant.mrp) || 0,
                        sellingPrice: Number(variant.sellingPrice) || 0,
                        costPrice: Number(variant.costPrice) || 0,
                        stock: Number(variant.stock) || 0,
                        minStock: Number(variant.minStock) || 5,
                        isActive: true
                    }
                });
            }
        }

        return tx.product.findUnique({
            where: { id: product.id },
            include: {
                category: true,
                variants: {
                    where: { isActive: true },
                    orderBy: { createdAt: 'asc' }
                }
            }
        });
    });

    await prisma.auditLog.create({
        data: {
            action: 'REMOTE_PRODUCT_UPDATED',
            details: `Product ${updated?.name || productId} updated from web dashboard by ${actor.username}`,
            userId: actor.id
        }
    });

    res.json(updated);
});

router.delete('/products/:id', async (req: AuthRequest, res) => {
    const actor = await requireManageProducts(req, res);
    if (!actor) return;

    const productId = String(req.params.id);

    await prisma.$transaction(async (tx) => {
        await tx.productVariant.updateMany({
            where: { productId },
            data: { isActive: false }
        });

        await tx.product.update({
            where: { id: productId },
            data: { isActive: false }
        });
    });

    await prisma.auditLog.create({
        data: {
            action: 'REMOTE_PRODUCT_DEACTIVATED',
            details: `Product ${productId} deactivated from web dashboard by ${actor.username}`,
            userId: actor.id
        }
    });

    res.json({ success: true });
});

export default router;
