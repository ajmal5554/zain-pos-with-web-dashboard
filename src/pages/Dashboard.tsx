import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    TrendingUp,
    TrendingDown,
    DollarSign,
    ShoppingBag,
    AlertTriangle,
    Package,
    Calendar,
    Info
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { reportsService } from '../services/reports.service';
import { db } from '../lib/db';
import { Loading } from '../components/ui/Loading';
import { DashboardSkeleton } from '../components/dashboard/DashboardSkeleton';
import { formatIndianCurrency, calculatePercentageChange } from '../lib/format';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from 'recharts';
import { startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, format as formatDate } from 'date-fns';
import { getStoredPaymentMethods, saveStoredPaymentMethods } from '../lib/paymentMethods';

type FilterPeriod = 'today' | 'week' | 'month' | 'year' | 'all';
type DashboardStat = {
    label: string;
    value: string | number;
    icon: any;
    color: string;
    change?: ReturnType<typeof calculatePercentageChange>;
    subtext?: string;
    alert?: boolean;
};

const formatDateInputValue = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseDateInputValue = (value: string): Date => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
};

export const Dashboard: React.FC = () => {
    const { user } = useAuthStore();
    const [loading, setLoading] = useState(true);
    const [todayStats, setTodayStats] = useState<any>(null);
    const [yesterdayStats, setYesterdayStats] = useState<any>(null);
    const [allTimeStats, setAllTimeStats] = useState<any>(null);
    const [lowStockItems, setLowStockItems] = useState<any[]>([]);
    const [topProducts, setTopProducts] = useState<any[]>([]);
    const [chartData, setChartData] = useState<any[]>([]);
    const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>('today');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedDate, setSelectedDate] = useState(formatDateInputValue(new Date()));
    const [paymentMethods, setPaymentMethods] = useState<Record<string, boolean>>(getStoredPaymentMethods);

    useEffect(() => {
        const handlePmUpdate = (e: any) => {
            if (e?.detail) {
                const merged = saveStoredPaymentMethods(e.detail);
                setPaymentMethods(merged);
            }
        };
        window.addEventListener('payment-methods-updated', handlePmUpdate);
        return () => window.removeEventListener('payment-methods-updated', handlePmUpdate);
    }, []);

    useEffect(() => {
        loadDashboardData();
    }, [selectedDate]);

    useEffect(() => {
        loadChartData();
    }, [filterPeriod, selectedYear, selectedDate]);

    const loadDashboardData = async () => {
        try {
            setLoading(true);
            const targetDate = parseDateInputValue(selectedDate);
            const [dailyReport, yesterdayReport, lowStock, topSelling, pmResult] = await Promise.all([
                reportsService.getDailySalesReport(targetDate),
                reportsService.getYesterdaySalesReport(),
                reportsService.getLowStockItems(),
                reportsService.getTopSellingProducts(5),
                window.electronAPI?.settings?.get
                    ? window.electronAPI.settings.get({ key: 'PAYMENT_METHODS' })
                    : Promise.resolve(null),
            ]);

            setTodayStats(dailyReport);
            setYesterdayStats(yesterdayReport);
            setLowStockItems(lowStock);
            setTopProducts(topSelling);

            if (pmResult?.success && pmResult.data) {
                try {
                    const parsed = JSON.parse(pmResult.data as string);
                    const merged = saveStoredPaymentMethods(parsed);
                    setPaymentMethods(merged);
                } catch (e) {
                    console.error('Failed to parse PAYMENT_METHODS setting:', e);
                }
            } else {
                try {
                    const dbPm = await db.settings.findUnique({ where: { key: 'PAYMENT_METHODS' } });
                    if (dbPm?.value) {
                        const parsed = JSON.parse(dbPm.value);
                        const merged = saveStoredPaymentMethods(parsed);
                        setPaymentMethods(merged);
                    }
                } catch (e) {
                    console.error('Failed to load fallback payment methods:', e);
                }
            }

            // Get all-time stats (Optimized) - Only query for Admin
            if (user?.role === 'ADMIN') {
                const [salesAgg, itemsAgg] = await Promise.all([
                    db.sales.aggregate({
                        where: { status: 'COMPLETED' },
                        _sum: { grandTotal: true },
                        _count: { id: true }
                    }),
                    db.saleItems.aggregate({
                        where: { sale: { status: 'COMPLETED' } },
                        _sum: { quantity: true }
                    })
                ]);

                setAllTimeStats({
                    totalRevenue: salesAgg._sum?.grandTotal || 0,
                    totalItems: itemsAgg._sum?.quantity || 0,
                    totalSales: salesAgg._count?.id || 0,
                });
            } else {
                setAllTimeStats(null);
            }
        } catch (error) {
            console.error('Failed to load dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadChartData = async () => {
        try {
            if (filterPeriod === 'today') {
                // Show hourly breakdown for the selected date
                const targetDate = parseDateInputValue(selectedDate);
                const todayReport = await reportsService.getDailySalesReport(targetDate);
                const hours = Array.from({ length: 24 }, (_, i) => i);

                const hourlyData = hours.map(hour => {
                    const hourSales = (todayReport?.sales || []).filter((sale: any) => {
                        const saleHour = new Date(sale.createdAt).getHours();
                        return saleHour === hour;
                    });

                    return {
                        date: `${hour}:00`,
                        sales: hourSales.reduce((sum: number, sale: any) => sum + (sale.grandTotal || 0), 0),
                        bills: hourSales.length,
                    };
                });

                setChartData(hourlyData);
            } else if (filterPeriod === 'week') {
                // Show last 7 days from selected date
                const baseDate = parseDateInputValue(selectedDate);
                const days = Array.from({ length: 7 }, (_, i) => {
                    const date = new Date(baseDate);
                    date.setDate(baseDate.getDate() - (6 - i));
                    return date;
                });

                const weekData = await Promise.all(
                    days.map(async (day) => {
                        const report = await reportsService.getDailySalesReport(day);
                        return {
                            date: formatDate(day, 'EEE dd'),
                            sales: report.totalSales,
                            bills: report.numberOfBills,
                        };
                    })
                );

                setChartData(weekData);
            } else if (filterPeriod === 'month') {
                const baseDate = parseDateInputValue(selectedDate);
                const monthlyReport = await reportsService.getMonthlySalesReport(baseDate);
                const days = eachDayOfInterval({
                    start: startOfMonth(baseDate),
                    end: endOfMonth(baseDate),
                });

                const data = days.map(day => {
                    const dayNum = day.getDate();
                    const dayData = monthlyReport.dailyBreakdown[dayNum] || { sales: 0, count: 0 };
                    return {
                        date: formatDate(day, 'dd MMM'),
                        sales: dayData.sales,
                        bills: dayData.count,
                    };
                });

                setChartData(data);
            } else if (filterPeriod === 'year') {
                // Show monthly breakdown for specific year
                const months = Array.from({ length: 12 }, (_, i) => {
                    const date = new Date(selectedYear, i, 1);
                    return date;
                });

                const yearData = await Promise.all(
                    months.map(async (month) => {
                        const report = await reportsService.getMonthlySalesReport(month);
                        return {
                            date: formatDate(month, 'MMM'),
                            sales: report.totalSales,
                            bills: report.numberOfBills,
                        };
                    })
                );

                setChartData(yearData);
            } else if (filterPeriod === 'all') {
                // Show all-time data grouped by month
                const allSales = await db.sales.findMany({
                    where: { status: 'COMPLETED' },
                    select: {
                        createdAt: true,
                        grandTotal: true,
                    },
                    orderBy: {
                        createdAt: 'asc',
                    },
                });

                // Group by month-year
                const monthlyMap = new Map<string, { sales: number; count: number }>();

                allSales.forEach((sale: any) => {
                    const date = new Date(sale.createdAt);
                    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    const existing = monthlyMap.get(key) || { sales: 0, count: 0 };
                    existing.sales += sale.grandTotal;
                    existing.count += 1;
                    monthlyMap.set(key, existing);
                });

                const allTimeData = Array.from(monthlyMap.entries())
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([key, data]) => {
                        const [year, month] = key.split('-');
                        const date = new Date(parseInt(year), parseInt(month) - 1);
                        return {
                            date: formatDate(date, 'MMM yyyy'),
                            sales: data.sales,
                            bills: data.count,
                        };
                    });

                setChartData(allTimeData);
            }
        } catch (error) {
            console.error('Failed to load chart data:', error);
        }
    };

    if (loading) {
        return <DashboardSkeleton />;
    }

    // Calculate comparisons
    const salesChange = calculatePercentageChange(
        todayStats?.totalSales || 0,
        yesterdayStats?.totalSales || 0
    );
    const billsChange = calculatePercentageChange(
        todayStats?.numberOfBills || 0,
        yesterdayStats?.numberOfBills || 0
    );
    const taxChange = calculatePercentageChange(
        todayStats?.totalTax || 0,
        yesterdayStats?.totalTax || 0
    );

    const isSelectedDateToday = isSameDay(parseDateInputValue(selectedDate), new Date());

    const greeting = (() => {
        if (!isSelectedDateToday) {
            return `Store Records · ${formatDate(parseDateInputValue(selectedDate), 'dd MMM yyyy')}`;
        }
        const hour = new Date().getHours();
        const firstName = user?.name ? user.name.split(' ')[0] : 'Zain';
        if (hour < 12) return `Good morning, ${firstName}! 👋`;
        if (hour < 17) return `Good afternoon, ${firstName}! 👋`;
        return `Good evening, ${firstName}! 👋`;
    })();

    const pulseSubtitle = (() => {
        if (!isSelectedDateToday) {
            const bills = todayStats?.numberOfBills || 0;
            const sales = todayStats?.totalSales || 0;
            return `Showing historical sales report for ${formatDate(parseDateInputValue(selectedDate), 'dd MMMM yyyy')} · ${bills} ${bills === 1 ? 'bill' : 'bills'} (${formatIndianCurrency(sales)}).`;
        }

        const bills = todayStats?.numberOfBills || 0;
        const sales = todayStats?.totalSales || 0;
        const hour = new Date().getHours();

        // Start of day / No sales yet
        if (bills === 0) {
            return 'Ready for the day! The register is open and ready for the first customer bill.';
        }

        // Evening / closing time (> 7 PM)
        if (hour >= 19) {
            return `Great shift! ${bills} ${bills === 1 ? 'bill' : 'bills'} processed today (${formatIndianCurrency(sales)}) · Ready for day-end reconciliation.`;
        }

        // Sales ahead of yesterday
        if (salesChange?.isIncrease && salesChange?.percentage && Math.abs(salesChange.percentage) >= 5) {
            return `${bills} ${bills === 1 ? 'bill' : 'bills'} completed today (${formatIndianCurrency(sales)}) · Ahead of yesterday's pace!`;
        }

        // Top selling product highlight
        if (topProducts && topProducts.length > 0 && topProducts[0]?.name) {
            return `${bills} ${bills === 1 ? 'bill' : 'bills'} completed today (${formatIndianCurrency(sales)}) · Top seller: ${topProducts[0].name}.`;
        }

        // General active store momentum
        return `${bills} ${bills === 1 ? 'bill' : 'bills'} completed today (${formatIndianCurrency(sales)}) · Store active and running smoothly.`;
    })();

    const isAdmin = user?.role === 'ADMIN';

    const stats: DashboardStat[] = [
        {
            label: "Today's Sales",
            value: formatIndianCurrency(todayStats?.totalSales || 0),
            icon: DollarSign,
            color: 'bg-green-500',
            change: salesChange,
            subtext: 'Total revenue',
        },
        ...(isAdmin ? [{
            label: 'All-Time Revenue',
            value: formatIndianCurrency(allTimeStats?.totalRevenue || 0),
            icon: TrendingUp,
            color: 'bg-indigo-500',
            subtext: `${allTimeStats?.totalSales || 0} invoices`,
        }] : []),
        {
            label: 'Total Bills (Today)',
            value: todayStats?.numberOfBills || 0,
            icon: ShoppingBag,
            color: 'bg-blue-500',
            change: billsChange,
            subtext: todayStats?.numberOfBills && todayStats?.totalSales 
                ? `${formatIndianCurrency(todayStats.totalSales / todayStats.numberOfBills)} avg` 
                : 'No bills yet',
        },
        {
            label: 'Tax Collected (Today)',
            value: formatIndianCurrency(todayStats?.totalTax || 0),
            icon: Package,
            color: 'bg-purple-500',
            change: taxChange,
            subtext: `${todayStats?.taxRate || 18}% GST`,
        },
        {
            label: 'Low Stock Items',
            value: lowStockItems.length,
            icon: AlertTriangle,
            color: 'bg-orange-500',
            alert: lowStockItems.length > 0,
            subtext: lowStockItems.length > 0 ? 'Needs attention' : 'All good',
        },
    ];

    return (
        <div className="space-y-6">
            {/* Store Pulse Banner */}
            <div className="card gradient-primary text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 sm:p-6 rounded-2xl shadow-sm">
                <div className="space-y-1">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                        {greeting}
                    </h1>
                    <p className="text-white/90 text-sm font-normal">
                        {pulseSubtitle}
                    </p>
                </div>
                <div className="flex items-center gap-3 bg-white/15 backdrop-blur-sm border border-white/20 px-4 py-2.5 rounded-xl text-white shadow-sm flex-shrink-0 self-start sm:self-auto">
                    <div className="p-2 bg-white/10 rounded-lg">
                        <Calendar className="w-5 h-5 text-blue-100" />
                    </div>
                    <div className="text-left sm:text-right">
                        <p className="text-xs text-blue-100 font-medium">
                            {formatDate(new Date(), 'EEEE')}
                        </p>
                        <p className="text-sm font-bold tracking-wide">
                            {formatDate(new Date(), 'dd MMMM yyyy')}
                        </p>
                    </div>
                </div>
            </div>

            {/* Stats Grid */}
            <div className={`grid grid-cols-2 ${isAdmin ? 'md:grid-cols-3 xl:grid-cols-5' : 'md:grid-cols-2 xl:grid-cols-4'} gap-3`}>
                {stats.map((stat, index) => {
                    const Icon = stat.icon;
                    return (
                        <div key={index} className="stat-card">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <p className="stat-label truncate text-xs">{stat.label}</p>
                                    <p className="stat-value mt-1 truncate text-base xl:text-lg" title={String(stat.value)}>{stat.value}</p>
                                    {stat.change && (
                                        <div className="flex items-center gap-1 mt-1">
                                            {stat.change.showContextual ? (
                                                // Show contextual message instead of misleading percentage
                                                <div className="flex items-center gap-1">
                                                    <Info className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                                    <p className="text-xs text-blue-600 dark:text-blue-400">
                                                        {stat.change.display}
                                                    </p>
                                                </div>
                                            ) : (
                                                // Show normal percentage change
                                                <div className="flex items-center gap-1">
                                                    {stat.change.isIncrease ? (
                                                        <TrendingUp className="w-3 h-3 text-green-600 dark:text-green-400" />
                                                    ) : (
                                                        <TrendingDown className="w-3 h-3 text-red-600 dark:text-red-400" />
                                                    )}
                                                    <p className={`text-xs ${stat.change.isIncrease ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                        {stat.change.display} from yesterday
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {stat.subtext && (
                                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                                            {stat.subtext}
                                        </p>
                                    )}
                                    {stat.alert && (
                                        <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                                            Needs attention
                                        </p>
                                    )}
                                </div>
                                <div className={`${stat.color} p-2 rounded-lg flex-shrink-0`}>
                                    <Icon className="w-5 h-5 text-white" />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Sales Chart */}
            <div className="card">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Calendar className="w-5 h-5" />
                        Sales Overview
                    </h3>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setFilterPeriod('today')}
                            className={`px-3 py-1 text-sm rounded transition-colors ${filterPeriod === 'today' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                        >
                            Today
                        </button>
                        <button
                            onClick={() => setFilterPeriod('week')}
                            className={`px-3 py-1 text-sm rounded transition-colors ${filterPeriod === 'week' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                        >
                            Week
                        </button>
                        <button
                            onClick={() => setFilterPeriod('month')}
                            className={`px-3 py-1 text-sm rounded transition-colors ${filterPeriod === 'month' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                        >
                            Month
                        </button>
                        <button
                            onClick={() => setFilterPeriod('year')}
                            className={`px-3 py-1 text-sm rounded transition-colors ${filterPeriod === 'year' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                        >
                            Year
                        </button>

                        {filterPeriod === 'year' && (
                            <select
                                value={selectedYear}
                                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                                className="px-2 py-1 text-sm rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(year => (
                                    <option key={year} value={year}>{year}</option>
                                ))}
                            </select>
                        )}

                        {isAdmin && (
                            <button
                                onClick={() => setFilterPeriod('all')}
                                className={`px-3 py-1 text-sm rounded transition-colors ${filterPeriod === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                            >
                                All Time
                            </button>
                        )}

                        <div className="flex items-center gap-2 border-l pl-2 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-2 border border-gray-200 dark:border-gray-600 focus-within:ring-1 focus-within:ring-blue-500">
                            <Calendar
                                className="w-4 h-4 text-gray-400 cursor-pointer"
                                onClick={() => {
                                    const input = document.getElementById('dashboard-date-picker') as HTMLInputElement;
                                    if (input) input.showPicker();
                                }}
                            />
                            <input
                                id="dashboard-date-picker"
                                type="date"
                                value={selectedDate}
                                onChange={(e) => {
                                    setSelectedDate(e.target.value);
                                    setFilterPeriod('today');
                                }}
                                className="bg-transparent border-none text-sm focus:ring-0 outline-none p-1 cursor-pointer"
                            />
                        </div>
                    </div>
                </div>

                <ResponsiveContainer width="100%" height={350}>
                    <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-300 dark:stroke-gray-700" />
                        <XAxis
                            dataKey="date"
                            tick={{ fontSize: 12 }}
                            angle={-45}
                            textAnchor="end"
                            height={80}
                        />
                        <YAxis
                            tick={{ fontSize: 12 }}
                            tickFormatter={(value) => {
                                if (value < 1000) return `₹${value}`;
                                if (value < 100000) return `₹${(value / 1000).toFixed(1)}k`;
                                return `₹${(value / 100000).toFixed(1)}L`;
                            }}
                        />
                        <Tooltip
                            formatter={(value: any, name: string) => {
                                if (name === 'sales') return [formatIndianCurrency(value), 'Revenue'];
                                if (name === 'bills') return [value, 'Bills'];
                                return [value, name];
                            }}
                            contentStyle={{
                                backgroundColor: 'var(--tooltip-bg, rgba(255, 255, 255, 0.95))',
                                border: '1px solid var(--tooltip-border, #ccc)',
                                borderRadius: '8px',
                                color: 'var(--tooltip-text, inherit)',
                            }}
                        />
                        <Legend
                            wrapperStyle={{ paddingTop: '20px' }}
                            formatter={(value) => {
                                if (value === 'sales') return 'Revenue (₹)';
                                if (value === 'bills') return 'Number of Bills';
                                return value;
                            }}
                        />
                        <Line
                            type="monotone"
                            dataKey="sales"
                            stroke="#3b82f6"
                            strokeWidth={2}
                            dot={{ r: 4 }}
                            activeDot={{ r: 6 }}
                            name="sales"
                        />
                        <Line
                            type="monotone"
                            dataKey="bills"
                            stroke="#10b981"
                            strokeWidth={2}
                            dot={{ r: 4 }}
                            activeDot={{ r: 6 }}
                            name="bills"
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {/* Charts and Lists */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Selling Products */}
                <div className="card flex flex-col h-full">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <Package className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                            Top Selling Products
                        </h3>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            Top 5
                        </span>
                    </div>
                    {topProducts.length > 0 ? (
                        <div className="space-y-2.5 flex-1">
                            {topProducts.map((product, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100/70 dark:hover:bg-gray-750/70 transition-colors"
                                >
                                    <div className="min-w-0 pr-2">
                                        <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                                            {product.productName}
                                        </p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                            {product.totalQuantity} units sold
                                        </p>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        <p className="font-semibold text-green-600 dark:text-green-400">
                                            {formatIndianCurrency(product.totalRevenue)}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-500 text-center py-8">No sales data yet</p>
                    )}
                </div>

                {/* Low Stock Alerts */}
                <div className="card flex flex-col h-full">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-amber-500" />
                            Low Stock Alerts
                            {lowStockItems.length > 0 && (
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                    {lowStockItems.length}
                                </span>
                            )}
                        </h3>
                        <Link
                            to="/stock"
                            className="text-xs font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400 hover:underline flex items-center gap-1"
                        >
                            View Stock
                            <span aria-hidden="true">&rarr;</span>
                        </Link>
                    </div>
                    {lowStockItems.length > 0 ? (
                        <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1 flex-1">
                            {[...lowStockItems]
                                .sort((a, b) => {
                                    if (a.stock <= 0 && b.stock > 0) return -1;
                                    if (b.stock <= 0 && a.stock > 0) return 1;
                                    return a.stock - b.stock;
                                })
                                .map((item: any, index) => {
                                    const isOversold = item.stock < 0;
                                    const isOutOfStock = item.stock === 0;
                                    const hasSpecificSize = item.size && item.size !== 'Standard';
                                    const hasColor = Boolean(item.color);

                                    return (
                                        <div
                                            key={item.id || index}
                                            className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100/70 dark:hover:bg-gray-750/70 rounded-lg transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-750"
                                        >
                                            <div className="min-w-0 pr-3">
                                                <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                                                    {item.product?.name || item.name || 'Product'}
                                                </p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                                    {hasSpecificSize && <span>Size: {item.size}</span>}
                                                    {hasSpecificSize && hasColor && <span> &bull; </span>}
                                                    {hasColor && <span>Color: {item.color}</span>}
                                                    {(hasSpecificSize || hasColor) ? ` (Min: ${item.minStock || 5})` : `Min required: ${item.minStock || 5}`}
                                                </p>
                                            </div>
                                            <div className="text-right flex-shrink-0">
                                                {isOversold ? (
                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
                                                        Oversold ({item.stock})
                                                    </span>
                                                ) : isOutOfStock ? (
                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
                                                        Out of stock
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
                                                        {item.stock} left
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
                            <Package className="w-10 h-10 text-emerald-400 mb-2 stroke-[1.5]" />
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">All products are well stocked</p>
                            <p className="text-xs text-gray-400">No items currently below minimum stock threshold</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Separated Transaction Audit by Payment Mode */}
            {todayStats?.sales && (() => {
                const availableModes = (['CASH', 'UPI', 'CARD'] as const).filter((mode) => {
                    const isEnabled = paymentMethods[mode] !== false;
                    if (isEnabled) return true;
                    // If disabled in settings, only show if there are actual transactions in that mode for the selected date
                    return (todayStats.sales || []).some((s: any) => {
                        if (s.status !== 'COMPLETED') return false;
                        if (s.paymentMethod === 'SPLIT' && s.payments && s.payments.length > 0) {
                            return s.payments.some((p: any) => (p.paymentMode || '').toUpperCase() === mode && Number(p.amount || 0) > 0);
                        }
                        return (s.paymentMethod || 'CASH').toUpperCase() === mode && Number(s.grandTotal || 0) > 0;
                    });
                });

                const gridColsClass = availableModes.length === 1
                    ? 'grid-cols-1 max-w-lg mx-auto'
                    : availableModes.length === 2
                        ? 'grid-cols-1 md:grid-cols-2'
                        : 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3';

                return (
                    <div className="space-y-6 mt-8 min-h-0">
                        <div className="flex items-center justify-between border-b pb-2 dark:border-gray-700">
                            <h3 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Audit by Payment Mode</h3>
                            <div className="text-sm font-bold text-primary-600 bg-primary-50 dark:bg-primary-900/20 px-3 py-1 rounded-full border border-primary-200">
                                Date: {formatDate(parseDateInputValue(selectedDate), 'dd MMM yyyy')}
                            </div>
                        </div>

                        <div className={`grid ${gridColsClass} gap-4 lg:gap-6 auto-rows-fr`}>
                            {availableModes.map((mode) => {
                                const modeEntries = (todayStats.sales || [])
                                    .filter((s: any) => s.status === 'COMPLETED')
                                    .flatMap((s: any) => {
                                        if (s.paymentMethod === 'SPLIT' && s.payments && s.payments.length > 0) {
                                            return s.payments
                                                .filter((p: any) => (p.paymentMode || '').toUpperCase() === mode)
                                                .map((p: any) => ({
                                                    id: `${s.id}-${p.id || mode}`,
                                                    billNo: s.billNo,
                                                    createdAt: s.createdAt,
                                                    amount: Number(p.amount || 0),
                                                    isSplit: true,
                                                    originalTotal: s.grandTotal
                                                }));
                                        } else if ((s.paymentMethod || 'CASH').toUpperCase() === mode) {
                                            return [{
                                                id: s.id,
                                                billNo: s.billNo,
                                                createdAt: s.createdAt,
                                                amount: Number(s.grandTotal || 0),
                                                isSplit: false,
                                                originalTotal: s.grandTotal
                                            }];
                                        }
                                        return [];
                                    });
                                const modeTotal = modeEntries.reduce((sum: number, tx: any) => sum + tx.amount, 0);

                                return (
                                    <div key={mode} className="flex flex-col h-full overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-dark-card shadow-sm">
                                        <div className={`p-4 flex justify-between items-center ${mode === 'CASH' ? 'bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700' :
                                            mode === 'UPI' ? 'bg-sky-50 dark:bg-sky-900/10 text-sky-700' :
                                                'bg-violet-50 dark:bg-violet-900/10 text-violet-700'
                                            }`}>
                                            <div className="flex items-center gap-2">
                                                <div className={`w-2 h-2 rounded-full ${mode === 'CASH' ? 'bg-emerald-500' :
                                                    mode === 'UPI' ? 'bg-sky-500' :
                                                        'bg-violet-500'
                                                    }`} />
                                                <span className="font-black text-xs uppercase tracking-widest">{mode} TRANSACTIONS</span>
                                            </div>
                                            <span className="font-black text-lg">{formatIndianCurrency(modeTotal)}</span>
                                        </div>

                                        <div className="flex-1 overflow-y-auto max-h-[400px] scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">
                                            <table className="w-full text-left">
                                                <thead className="bg-gray-50/80 dark:bg-gray-800/80 sticky top-0 backdrop-blur-sm z-10 border-b border-gray-100 dark:border-gray-700">
                                                    <tr className="text-[10px] font-bold text-gray-400 uppercase">
                                                        <th className="px-4 py-3">Bill</th>
                                                        <th className="px-4 py-3">Time</th>
                                                        <th className="px-4 py-3 text-right">Amount</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                                                    {modeEntries.length > 0 ? (
                                                        modeEntries.map((tx: any) => (
                                                            <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                                                                <td className="px-4 py-3 font-mono text-gray-900 dark:text-white">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span>#{tx.billNo}</span>
                                                                        {tx.isSplit && (
                                                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                                                                Split
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-3 text-xs text-gray-500 text-nowrap">{formatDate(new Date(tx.createdAt), 'hh:mm a')}</td>
                                                                <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white">{formatIndianCurrency(tx.amount)}</td>
                                                            </tr>
                                                        ))
                                                    ) : (
                                                        <tr>
                                                            <td colSpan={3} className="px-4 py-12 text-center text-xs text-gray-400 italic">No {mode} sales</td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="p-3 bg-gray-50/50 dark:bg-gray-800/50 text-[10px] font-bold text-gray-400 text-center uppercase border-t border-gray-100 dark:border-gray-800">
                                            Count: {modeEntries.length} Invoices
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};
