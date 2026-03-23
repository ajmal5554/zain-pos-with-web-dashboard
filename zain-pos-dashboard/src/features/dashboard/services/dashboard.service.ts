import api from '@/lib/api';
import { differenceInDays } from 'date-fns';

export interface DashboardStats {
    summary: {
        totalSales: number;
        totalOrders: number;
        averageOrderValue: number;
        range?: { start: string; end: string };
    };
    salesTrend: {
        label: string;
        sales: number;
        orders: number;
        original?: any;
    }[];
    paymentAudit: {
        CASH: any[];
        UPI: any[];
        CARD: any[];
    };
    topProducts: any[];
    lowStock: any[];
}

// Helper: resolve a settled result, returning fallback on failure
function settled<T>(result: PromiseSettledResult<{ data: T }>, fallback: T): T {
    if (result.status === 'fulfilled') return result.value.data;
    console.warn('Dashboard request failed:', (result as PromiseRejectedResult).reason?.message);
    return fallback;
}

export const dashboardService = {
    getStats: async (startDate?: Date, endDate?: Date): Promise<DashboardStats> => {
        const startStr = startDate ? startDate.toISOString() : undefined;
        const endStr = endDate ? endDate.toISOString() : undefined;

        const isSingleDay = startDate && endDate && differenceInDays(endDate, startDate) < 1;

        const chartEndpoint = isSingleDay ? '/sales/hourly' : '/sales/daily';
        const chartParams = isSingleDay
            ? { date: startStr }
            : { startDate: startStr, endDate: endStr };

        // Use allSettled so ONE failed request doesn't break the entire dashboard
        const [summaryRes, trendRes, auditRes, topRes, stockRes] = await Promise.allSettled([
            api.get('/sales/summary', { params: { startDate: startStr, endDate: endStr } }),
            api.get(chartEndpoint, { params: chartParams }),
            api.get('/sales/audit-payment-modes', { params: { startDate: startStr, endDate: endStr } }),
            api.get('/reports/top-products', { params: { limit: 5 } }),
            api.get('/inventory/low-stock', { params: { threshold: 5 } })
        ]);

        const summaryData = settled(summaryRes, { totalSales: 0, totalOrders: 0, averageOrderValue: 0 });
        const trendData: any[] = settled(trendRes, []);
        const auditData = settled(auditRes, { CASH: [], UPI: [], CARD: [] });
        const topData: any[] = settled(topRes, []);
        const stockData: any[] = settled(stockRes, []);

        // Standardize Trend Data
        let salesTrend = [];
        if (isSingleDay) {
            salesTrend = trendData.map((item: any) => ({
                label: `${item.hour}:00`,
                sales: item.sales,
                orders: item.orders,
                original: item.hour
            }));
        } else {
            salesTrend = trendData.map((item: any) => ({
                label: new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
                sales: item.sales,
                orders: item.orders,
                original: item.date
            }));
        }

        return {
            summary: summaryData,
            salesTrend,
            paymentAudit: auditData,
            topProducts: topData,
            lowStock: stockData
        };
    }
};
