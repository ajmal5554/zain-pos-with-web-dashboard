import { db } from '../lib/db';
import { startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';

export const reportsService = {
    // Get daily sales report
    async getDailySalesReport(date: Date = new Date()) {
        const start = startOfDay(date);
        const end = endOfDay(date);

        const sales = await db.sales.findMany({
            where: {
                status: 'COMPLETED',
                createdAt: {
                    gte: start,
                    lte: end,
                },
            },
            include: {
                items: true,
                payments: true,
                user: {
                    select: {
                        name: true,
                    },
                },
            },
        });

        const totalExchangeCredit = sales.reduce((sum: number, sale: any): number => {
            if (sale.payments && sale.payments.length > 0) {
                return sum + sale.payments
                    .filter((p: any) => (p.paymentMode || '').toUpperCase() === 'EXCHANGE_CREDIT')
                    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
            }
            return sum;
        }, 0);

        // totalSales excludes exchange credit — only counts fresh revenue
        const totalSales = sales.reduce((sum: number, sale: any): number => sum + sale.grandTotal, 0) - totalExchangeCredit;
        const totalTax = sales.reduce((sum: number, sale: any): number => sum + sale.taxAmount, 0);
        const totalDiscount = sales.reduce((sum: number, sale: any): number => sum + sale.discount, 0);

        const paymentBreakdown = sales.reduce((acc: Record<string, number>, sale: any): Record<string, number> => {
            if (sale.payments && sale.payments.length > 0) {
                // Use individual payment records — skip EXCHANGE_CREDIT from cash/upi/card totals
                sale.payments.forEach((payment: any) => {
                    const mode = (payment.paymentMode || 'CASH').toUpperCase();
                    if (mode === 'EXCHANGE_CREDIT' || mode === 'EXCHANGE') return; // exclude from payment breakdown
                    acc[mode] = (acc[mode] || 0) + Number(payment.amount || 0);
                });
            } else if (sale.paymentMethod === 'SPLIT') {
                // Legacy split without payment records — shouldn't happen, but handle gracefully
                acc['CASH'] = (acc['CASH'] || 0) + Number(sale.grandTotal || 0);
            } else {
                const mode = (sale.paymentMethod || 'CASH').toUpperCase();
                if (mode === 'EXCHANGE' || mode === 'EXCHANGE_CREDIT') return acc; // zero fresh collection
                acc[mode] = (acc[mode] || 0) + Number(sale.grandTotal || 0);
            }
            return acc;
        }, {} as Record<string, number>);

        return {
            date,
            totalSales,
            totalTax,
            totalDiscount,
            totalExchangeCredit,
            numberOfBills: sales.length,
            paymentBreakdown,
            sales,
        };
    },

    // Get yesterday's sales for comparison
    async getYesterdaySalesReport() {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return this.getDailySalesReport(yesterday);
    },

    // Get monthly sales report
    async getMonthlySalesReport(date: Date = new Date()) {
        const start = startOfMonth(date);
        const end = endOfMonth(date);

        const sales = await db.sales.findMany({
            where: {
                status: 'COMPLETED',
                createdAt: {
                    gte: start,
                    lte: end,
                },
            },
            include: {
                items: true,
                payments: true,
            },
        });

        const totalExchangeCredit = sales.reduce((sum: number, sale: any): number => {
            if (sale.payments && sale.payments.length > 0) {
                return sum + sale.payments
                    .filter((p: any) => (p.paymentMode || '').toUpperCase() === 'EXCHANGE_CREDIT')
                    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
            }
            return sum;
        }, 0);

        // totalSales excludes exchange credit — only counts fresh revenue
        const totalSales = sales.reduce((sum: number, sale: any): number => sum + sale.grandTotal, 0) - totalExchangeCredit;
        const totalTax = sales.reduce((sum: number, sale: any): number => sum + sale.taxAmount, 0);
        const totalDiscount = sales.reduce((sum: number, sale: any): number => sum + sale.discount, 0);

        // Daily breakdown — exclude EXCHANGE_CREDIT from daily sales totals
        const dailyBreakdown = sales.reduce((acc: Record<number, any>, sale: any): Record<number, any> => {
            const day = new Date(sale.createdAt).getDate();
            if (!acc[day]) {
                acc[day] = { sales: 0, count: 0 };
            }
            // Subtract exchange credit from this sale's contribution
            const saleExchangeCredit = (sale.payments || [])
                .filter((p: any) => (p.paymentMode || '').toUpperCase() === 'EXCHANGE_CREDIT')
                .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
            acc[day].sales += (sale.grandTotal - saleExchangeCredit);
            acc[day].count += 1;
            return acc;
        }, {} as Record<number, { sales: number; count: number }>);

        return {
            month: date,
            totalSales,
            totalTax,
            totalDiscount,
            numberOfBills: sales.length,
            dailyBreakdown,
            sales,
        };
    },

    // Get top selling products
    async getTopSellingProducts(limit: number = 10, startDate?: Date, endDate?: Date) {
        const whereClause: any = {
            sale: { status: 'COMPLETED' }
        };

        if (startDate && endDate) {
            whereClause.createdAt = {
                gte: startDate,
                lte: endDate,
            };
        }

        const saleItems = await db.saleItems.findMany({
            where: whereClause,
            include: {
                variant: {
                    include: {
                        product: true,
                    },
                },
            },
        });

        // Aggregate by product
        const productMap = new Map<string, {
            productId: string;
            productName: string;
            totalQuantity: number;
            totalRevenue: number;
        }>();

        saleItems.forEach((item: any) => {
            const key = item.variant?.productId || 'UNKNOWN';
            const existing = productMap.get(key);

            if (existing) {
                existing.totalQuantity += (item.quantity || 0);
                existing.totalRevenue += (item.total || 0);
            } else {
                productMap.set(key, {
                    productId: key,
                    productName: item.productName || 'Unknown Product',
                    totalQuantity: item.quantity || 0,
                    totalRevenue: item.total || 0,
                });
            }
        });

        return Array.from(productMap.values())
            .sort((a, b) => b.totalRevenue - a.totalRevenue)
            .slice(0, limit);
    },

    // Get low stock items
    async getLowStockItems() {
        const variants = await db.productVariants.findMany({
            where: {
                isActive: true,
            },
            include: {
                product: true,
            },
        });

        return variants.filter((v: any) => v.stock <= v.minStock);
    },

    // Get inventory value
    async getInventoryValue() {
        const variants = await db.productVariants.findMany({
            where: {
                isActive: true,
            },
        });

        const totalCostValue = variants.reduce((sum: number, v: any) =>
            sum + (v.costPrice * v.stock), 0
        );

        const totalSellingValue = variants.reduce((sum: number, v: any) =>
            sum + (v.sellingPrice * v.stock), 0
        );

        return {
            totalCostValue,
            totalSellingValue,
            potentialProfit: totalSellingValue - totalCostValue,
            totalItems: variants.reduce((sum: number, v: any) => sum + v.stock, 0),
        };
    },
};
