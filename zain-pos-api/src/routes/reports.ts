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
                status: { in: ['COMPLETED', 'VOIDED'] },
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
                },
                payments: true
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
            billFrom: string;
            billTo: string;
            subtotal: number;
            discount: number;
            taxableValue: number;
            cgst: number;
            sgst: number;
            totalTax: number;
            grandTotal: number;
            cash: number;
            upi: number;
            card: number;
        }>();

        const slabMap = new Map<number, {
            rate: number;
            taxableValue: number;
            cgst: number;
            sgst: number;
            totalTax: number;
        }>();

        for (const sale of sales) {
            if (sale.status === 'VOIDED') continue;

            const isReplacement = sale.paymentMethod === 'EXCHANGE' || (sale.remarks || '').includes('Replacement sale for Invoice');
            let freshCash = 0, freshUpi = 0, freshCard = 0;
            if (sale.payments && sale.payments.length > 0) {
                for (const p of sale.payments) {
                    const mode = (p.paymentMode || '').toUpperCase();
                    if (mode === 'CASH') freshCash += p.amount;
                    else if (mode === 'UPI') freshUpi += p.amount;
                    else if (mode === 'CARD') freshCard += p.amount;
                }
            } else {
                const mode = (sale.paymentMethod || '').toUpperCase();
                if (mode === 'CASH') freshCash = sale.grandTotal;
                else if (mode === 'UPI') freshUpi = sale.grandTotal;
                else if (mode === 'CARD') freshCard = sale.grandTotal;
            }

            const netFreshPaid = freshCash + freshUpi + freshCard;

            // If replacement bill with 0 fresh money collected, skip to prevent double counting
            if (isReplacement && netFreshPaid <= 0.009) {
                continue;
            }

            const effectiveRatio = isReplacement ? (netFreshPaid / Math.max(sale.grandTotal, 0.01)) : 1;
            const subtotal = parseFloat((sale.subtotal * effectiveRatio).toFixed(2));
            const discount = parseFloat((sale.discount * effectiveRatio).toFixed(2));
            const grandTotal = isReplacement ? netFreshPaid : sale.grandTotal;
            const taxableValue = parseFloat((subtotal - discount).toFixed(2));
            const totalTax = parseFloat((sale.taxAmount * effectiveRatio).toFixed(2));
            const cgst = parseFloat((totalTax / 2).toFixed(2));
            const sgst = parseFloat((totalTax / 2).toFixed(2));

            const effectiveDate = sale.actualSaleDate ?? sale.createdAt;
            const dateKey = effectiveDate.toISOString().split('T')[0];

            summary.count += 1;
            summary.subtotal += subtotal;
            summary.discount += discount;
            summary.taxableValue += taxableValue;
            summary.cgst += cgst;
            summary.sgst += sgst;
            summary.totalTax += totalTax;
            summary.grandTotal += grandTotal;

            if (!dailyMap.has(dateKey)) {
                dailyMap.set(dateKey, {
                    date: dateKey,
                    bills: 0,
                    billFrom: sale.billNo,
                    billTo: sale.billNo,
                    subtotal: 0,
                    discount: 0,
                    taxableValue: 0,
                    cgst: 0,
                    sgst: 0,
                    totalTax: 0,
                    grandTotal: 0,
                    cash: 0,
                    upi: 0,
                    card: 0
                });
            }

            const daily = dailyMap.get(dateKey)!;
            daily.bills += 1;
            daily.subtotal += subtotal;
            daily.discount += discount;
            daily.taxableValue += taxableValue;
            daily.cgst += cgst;
            daily.sgst += sgst;
            daily.totalTax += totalTax;
            daily.grandTotal += grandTotal;

            if (sale.billNo) {
                if (!daily.billFrom || sale.billNo < daily.billFrom) daily.billFrom = sale.billNo;
                if (!daily.billTo || sale.billNo > daily.billTo) daily.billTo = sale.billNo;
            }

            if (isReplacement) {
                daily.cash += freshCash;
                daily.upi += freshUpi;
                daily.card += freshCard;
            } else if (sale.paymentMethod === 'SPLIT' && sale.payments && sale.payments.length > 0) {
                for (const payment of sale.payments) {
                    const pMode = (payment.paymentMode || 'CASH').toUpperCase();
                    if (pMode === 'CASH') daily.cash += payment.amount;
                    else if (pMode === 'UPI') daily.upi += payment.amount;
                    else if (pMode === 'CARD') daily.card += payment.amount;
                }
            } else if (sale.paymentMethod === 'CASH') {
                daily.cash += sale.grandTotal;
            } else if (sale.paymentMethod === 'UPI') {
                daily.upi += sale.grandTotal;
            } else if (sale.paymentMethod === 'CARD') {
                daily.card += sale.grandTotal;
            }

            for (const item of sale.items) {
                const rate = item.taxRate || 0;
                const itemTotal = parseFloat((item.total * effectiveRatio).toFixed(2));
                const itemTax = parseFloat((item.taxAmount * effectiveRatio).toFixed(2));
                const itemTaxable = itemTotal - itemTax;
                const halfTax = itemTax / 2;
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
                slab.totalTax += itemTax;
            }
        }

        const completedSales = sales.filter(s => s.status !== 'VOIDED');
        const voidedSales = sales.filter(s => s.status === 'VOIDED');

        res.json({
            summary,
            daily: Array.from(dailyMap.values()),
            slabs: Array.from(slabMap.values()).sort((a, b) => a.rate - b.rate),
            sales: completedSales.map((sale) => ({
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
                paymentMethod: sale.paymentMethod,
                payments: sale.paymentMethod === 'SPLIT' && sale.payments?.length
                    ? sale.payments.map(p => ({ paymentMode: p.paymentMode, amount: p.amount }))
                    : undefined
            })),
            cancelledInvoices: voidedSales.map((sale) => ({
                id: sale.id,
                billNo: sale.billNo,
                createdAt: sale.createdAt,
                grossAmount: sale.subtotal,
                discount: sale.discount,
                amount: sale.grandTotal,
                status: sale.status,
                paymentMethod: sale.paymentMethod
            }))
        });
    } catch (error) {
        console.error('GST report error:', error);
        res.status(500).json({ error: 'Failed to fetch GST report' });
    }
});

export default router;
