import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

const buildEffectiveSaleDateWhere = (startDate: Date | null, endDate?: Date | null) => {
    if (!startDate && !endDate) return undefined;

    const actualSaleDate: Record<string, Date> = {};
    const createdAt: Record<string, Date> = {};

    if (startDate) {
        actualSaleDate.gte = startDate;
        createdAt.gte = startDate;
    }
    if (endDate) {
        actualSaleDate.lte = endDate;
        createdAt.lte = endDate;
    }

    return {
        OR: [
            { actualSaleDate },
            {
                AND: [
                    { actualSaleDate: null },
                    { createdAt }
                ]
            }
        ]
    };
};

// Get revenue trends
router.get('/revenue', async (req, res) => {
    try {
        const days = parseInt(req.query.days as string) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const sales = await prisma.sale.findMany({
            where: {
                status: 'COMPLETED',
                ...buildEffectiveSaleDateWhere(startDate)
            }
        });

        const totalRevenue = sales.reduce((sum, s) => sum + s.grandTotal, 0);
        const averageRevenue = sales.length > 0 ? totalRevenue / sales.length : 0;

        res.json({
            totalRevenue,
            averageRevenue,
            totalOrders: sales.length,
            period: `Last ${days} days`
        });
    } catch (error) {
        console.error('Revenue error:', error);
        res.status(500).json({ error: 'Failed to fetch revenue data' });
    }
});

// Get top selling products
router.get('/top-products', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 10;

        const items = await prisma.saleItem.groupBy({
            by: ['variantId', 'productName'],
            _sum: {
                quantity: true,
                total: true
            },
            orderBy: {
                _sum: {
                    quantity: 'desc'
                }
            },
            take: limit
        });

        const topProducts = items.map(item => ({
            product: {
                id: item.variantId,
                name: item.productName,
                category: { name: 'N/A' } // Schema doesn't easily allow category name from saleItem group by
            },
            totalQuantity: item._sum.quantity || 0,
            totalRevenue: item._sum.total || 0
        }));

        res.json(topProducts);
    } catch (error) {
        console.error('Top products error:', error);
        res.status(500).json({ error: 'Failed to fetch top products' });
    }
});

// Get overall performance analytics
router.get('/performance', async (req, res) => {
    try {
        const totalSales = await prisma.sale.count({ where: { status: 'COMPLETED' } });
        const totalProducts = await prisma.product.count({ where: { isActive: true } });
        const totalInStock = await prisma.productVariant.aggregate({
            where: { isActive: true },
            _sum: { stock: true }
        });

        res.json({
            totalSales,
            totalProducts,
            totalInventoryStock: totalInStock._sum.stock || 0
        });
    } catch (error) {
        console.error('Performance error:', error);
        res.status(500).json({ error: 'Failed to fetch performance analytics' });
    }
});

router.get('/gst', async (req, res) => {
    try {
        const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date();
        const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();

        if (!req.query.startDate) startDate.setHours(0, 0, 0, 0);
        if (!req.query.endDate) endDate.setHours(23, 59, 59, 999);

        const sales = await prisma.sale.findMany({
            where: {
                status: 'COMPLETED',
                ...(buildEffectiveSaleDateWhere(startDate, endDate) || {})
            },
            include: {
                items: {
                    select: {
                        productName: true,
                        quantity: true,
                        taxRate: true,
                        taxAmount: true,
                        total: true
                    }
                }
            },
            orderBy: { createdAt: 'asc' }
        });

        const summary = {
            count: 0,
            subtotal: 0,
            discount: 0,
            taxableValue: 0,
            cgst: 0,
            sgst: 0,
            totalTax: 0,
            grandTotal: 0
        };

        const dailyMap = new Map<string, {
            date: string;
            bills: number;
            subtotal: number;
            discount: number;
            taxableValue: number;
            cgst: number;
            sgst: number;
            totalTax: number;
            grandTotal: number;
        }>();

        const slabMap = new Map<number, {
            rate: number;
            taxableValue: number;
            cgst: number;
            sgst: number;
            totalTax: number;
        }>();

        for (const sale of sales) {
            const effectiveDate = sale.actualSaleDate ?? sale.createdAt;
            const dateKey = effectiveDate.toISOString().split('T')[0];
            const taxableValue = sale.subtotal - sale.discount;

            summary.count += 1;
            summary.subtotal += sale.subtotal;
            summary.discount += sale.discount;
            summary.taxableValue += taxableValue;
            summary.cgst += sale.cgst;
            summary.sgst += sale.sgst;
            summary.totalTax += sale.taxAmount;
            summary.grandTotal += sale.grandTotal;

            if (!dailyMap.has(dateKey)) {
                dailyMap.set(dateKey, {
                    date: dateKey,
                    bills: 0,
                    subtotal: 0,
                    discount: 0,
                    taxableValue: 0,
                    cgst: 0,
                    sgst: 0,
                    totalTax: 0,
                    grandTotal: 0
                });
            }

            const daily = dailyMap.get(dateKey)!;
            daily.bills += 1;
            daily.subtotal += sale.subtotal;
            daily.discount += sale.discount;
            daily.taxableValue += taxableValue;
            daily.cgst += sale.cgst;
            daily.sgst += sale.sgst;
            daily.totalTax += sale.taxAmount;
            daily.grandTotal += sale.grandTotal;

            for (const item of sale.items) {
                const rate = item.taxRate || 0;
                const itemTaxable = item.total - item.taxAmount;
                const halfTax = item.taxAmount / 2;
                if (!slabMap.has(rate)) {
                    slabMap.set(rate, {
                        rate,
                        taxableValue: 0,
                        cgst: 0,
                        sgst: 0,
                        totalTax: 0
                    });
                }
                const slab = slabMap.get(rate)!;
                slab.taxableValue += itemTaxable;
                slab.cgst += halfTax;
                slab.sgst += halfTax;
                slab.totalTax += item.taxAmount;
            }
        }

        res.json({
            summary,
            daily: Array.from(dailyMap.values()),
            slabs: Array.from(slabMap.values()).sort((a, b) => a.rate - b.rate),
            sales: sales.map((sale) => ({
                id: sale.id,
                billNo: sale.billNo,
                createdAt: sale.actualSaleDate ?? sale.createdAt,
                customerName: sale.customerName,
                subtotal: sale.subtotal,
                discount: sale.discount,
                taxableValue: sale.subtotal - sale.discount,
                cgst: sale.cgst,
                sgst: sale.sgst,
                totalTax: sale.taxAmount,
                grandTotal: sale.grandTotal,
                paymentMethod: sale.paymentMethod
            }))
        });
    } catch (error) {
        console.error('GST report error:', error);
        res.status(500).json({ error: 'Failed to fetch GST report' });
    }
});

export default router;
