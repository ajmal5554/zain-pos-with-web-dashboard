import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
    BrainCircuit,
    TrendingUp,
    Calendar,
    Sparkles,
    ShoppingBag,
    Package,
    ArrowUpRight,
    ArrowDownRight,
    Filter,
    Target,
    AlertTriangle,
    CheckCircle2,
    Lightbulb,
    IndianRupee
} from 'lucide-react';
import { db } from '../lib/db';
import { formatIndianCurrency } from '../lib/format';
import { useAuthStore } from '../store/authStore';
import { format, subYears } from 'date-fns';
import {
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area
} from 'recharts';

// Kerala Festival Dates (Approximate or fixed)
const KERALA_FESTIVALS = [
    { name: 'Vishu', month: 3, day: 14, description: 'Malayalam New Year - Major clothing purchase season' },
    { name: 'Onam', month: 7, day: 25, durationDays: 10, description: 'Harvest Festival - Peak bridal and traditional wear demand' },
    { name: 'Eid / Ramzan', month: null, moving: true, description: 'Major shopping season for ethnic wear' },
    { name: 'Christmas', month: 11, day: 25, description: 'Year-end festive shopping' },
    { name: 'Wedding Season', months: [0, 1, 3, 4, 7, 8], description: 'Recurring bridal wear demand' }
];

// --- TypeScript Interfaces ---

interface MonthlyBucket {
    key: string;       // "2024-08"
    revenue: number;
    count: number;
    month: number;     // 0-11 calendar month
    timestamp: Date;
}

interface ForecastPoint {
    month: string;
    revenue: number | null;
    predicted: number | null;
    predictedUpper: number | null;
    predictedLower: number | null;
    backtestPredicted: number | null;
}

interface BacktestResult {
    mape: number;
    accuracy: number;
    predictions: Array<{
        monthKey: string;
        actual: number;
        predicted: number;
    }>;
}

type SentimentType = 'positive' | 'cautious' | 'mixed' | 'recovering';

interface MarketSentiment {
    label: string;
    type: SentimentType;
}

interface ForecastStats {
    totalRevenue: number;
    avgMonthlyRevenue: number;
    predictedNextMonth: number;
    growthRate: string;
    topCategory: string;
    upcomingEvent: string;
    nextMonthLower: number;
    nextMonthUpper: number;
}

// --- Pure Forecasting Functions ---

function computeWMA(values: number[], maxWindow: number = 6): number {
    const window = values.slice(-maxWindow);
    const n = window.length;
    if (n === 0) return 0;
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < n; i++) {
        const weight = i + 1;
        weightedSum += window[i] * weight;
        weightTotal += weight;
    }
    return weightedSum / weightTotal;
}

function linearRegression(values: number[]): { slope: number; intercept: number; rSquared: number } {
    const n = values.length;
    if (n < 2) return { slope: 0, intercept: values[0] || 0, rSquared: 0 };

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += values[i];
        sumXY += i * values[i];
        sumXX += i * i;
    }

    const denom = n * sumXX - sumX * sumX;
    const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    const meanY = sumY / n;
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < n; i++) {
        const predicted = slope * i + intercept;
        ssRes += (values[i] - predicted) ** 2;
        ssTot += (values[i] - meanY) ** 2;
    }
    const rSquared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

    return { slope, intercept, rSquared };
}

function computeSeasonalFactors(buckets: MonthlyBucket[]): number[] {
    const monthTotals = new Array(12).fill(0);
    const monthCounts = new Array(12).fill(0);

    buckets.forEach(bucket => {
        monthTotals[bucket.month] += bucket.revenue;
        monthCounts[bucket.month] += 1;
    });

    const monthAverages = monthTotals.map((total: number, i: number) =>
        monthCounts[i] > 0 ? total / monthCounts[i] : 0
    );

    const validAverages = monthAverages.filter((a: number) => a > 0);
    const overallAvg = validAverages.length > 0
        ? validAverages.reduce((a: number, b: number) => a + b, 0) / validAverages.length
        : 0;

    if (overallAvg === 0) return new Array(12).fill(1);

    return monthAverages.map((avg: number, i: number) =>
        monthCounts[i] >= 2 ? avg / overallAvg : 1.0
    );
}

function computeStdDev(values: number[]): number {
    const n = values.length;
    if (n < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
    return Math.sqrt(variance);
}

function generateForecast(
    monthlyRevenues: number[],
    seasonalFactors: number[],
    lastCalendarMonth: number,
    monthsAhead: number
): Array<{ predicted: number; upper: number; lower: number }> {
    const n = monthlyRevenues.length;
    const wma = computeWMA(monthlyRevenues);
    const { slope, intercept } = linearRegression(monthlyRevenues);
    const stddev = computeStdDev(monthlyRevenues);

    const results: Array<{ predicted: number; upper: number; lower: number }> = [];

    for (let i = 1; i <= monthsAhead; i++) {
        const targetMonth = (lastCalendarMonth + i) % 12;
        const sf = seasonalFactors[targetMonth];

        const trendValue = slope * (n - 1 + i) + intercept;
        const baseline = 0.6 * wma + 0.4 * trendValue;
        const predicted = baseline * sf;

        // 80% confidence interval, widening with sqrt(horizon)
        const z = 1.28;
        const margin = z * stddev * Math.sqrt(i) * sf;

        results.push({
            predicted: Math.max(0, predicted),
            upper: Math.max(0, predicted + margin),
            lower: Math.max(0, predicted - margin)
        });
    }

    return results;
}

function runBacktest(
    monthlyRevenues: number[],
    monthlyBuckets: MonthlyBucket[],
    backtestWindow: number = 6
): BacktestResult | null {
    const n = monthlyRevenues.length;
    if (n < backtestWindow + 6) return null;

    const cutoff = n - backtestWindow;
    const trainingData = monthlyRevenues.slice(0, cutoff);
    const actualData = monthlyRevenues.slice(cutoff);

    const trainingBuckets = monthlyBuckets.slice(0, cutoff);
    const trainingSeasonals = computeSeasonalFactors(trainingBuckets);
    const lastTrainingMonth = trainingBuckets[cutoff - 1].month;

    const forecasted = generateForecast(trainingData, trainingSeasonals, lastTrainingMonth, backtestWindow);

    let totalAbsPercentError = 0;
    let validCount = 0;
    const predictions: BacktestResult['predictions'] = [];

    for (let i = 0; i < backtestWindow; i++) {
        const actual = actualData[i];
        const predicted = forecasted[i].predicted;
        if (actual > 0) {
            totalAbsPercentError += Math.abs(actual - predicted) / actual;
            validCount++;
        }
        predictions.push({
            monthKey: monthlyBuckets[cutoff + i].key,
            actual,
            predicted
        });
    }

    const mape = validCount > 0 ? (totalAbsPercentError / validCount) * 100 : 100;
    const accuracy = Math.max(0, Math.round(100 - mape));

    return { mape: Math.round(mape * 10) / 10, accuracy, predictions };
}

function computeConfidenceLevel(
    monthCount: number,
    coefficientOfVariation: number,
    rSquared: number
): { label: string; score: number } {
    const dataScore = Math.min(monthCount / 12, 1) * 40;
    const varianceScore = Math.max(0, (1 - coefficientOfVariation)) * 30;
    const trendScore = rSquared * 30;

    const totalScore = Math.round(dataScore + varianceScore + trendScore);

    let label: string;
    if (totalScore >= 70) label = 'Very reliable prediction';
    else if (totalScore >= 45) label = 'Fairly reliable prediction';
    else label = 'Rough estimate - need more sales data';

    return { label, score: totalScore };
}

function computeMarketSentiment(
    monthlyRevenues: number[],
    slope: number
): MarketSentiment {
    const n = monthlyRevenues.length;
    if (n < 3) return { label: 'Insufficient Data', type: 'mixed' };

    const recent = monthlyRevenues.slice(-3);
    const recentGrowths: number[] = [];
    for (let i = 1; i < recent.length; i++) {
        if (recent[i - 1] > 0) {
            recentGrowths.push((recent[i] - recent[i - 1]) / recent[i - 1]);
        }
    }
    const recentAvgGrowth = recentGrowths.length > 0
        ? recentGrowths.reduce((a, b) => a + b, 0) / recentGrowths.length
        : 0;

    const overallTrendPositive = slope > 0;
    const recentTrendPositive = recentAvgGrowth > 0;

    if (overallTrendPositive && recentTrendPositive) {
        return { label: 'Sales are growing well!', type: 'positive' };
    } else if (overallTrendPositive && !recentTrendPositive) {
        return { label: 'Sales dipped recently, but overall trend is good', type: 'mixed' };
    } else if (!overallTrendPositive && recentTrendPositive) {
        return { label: 'Sales are picking up again!', type: 'recovering' };
    } else {
        return { label: 'Sales are slowing down - take action', type: 'cautious' };
    }
}

// --- Component ---

export const Forecasting: React.FC = () => {
    const user = useAuthStore((state) => state.user);
    const canViewInsights = !!user && (user.role === 'ADMIN' || user.permViewInsights);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<ForecastStats | null>(null);
    const [forecastData, setForecastData] = useState<ForecastPoint[]>([]);
    const [seasonalInsights, setSeasonalInsights] = useState<any[]>([]);
    const [forecastMonths, setForecastMonths] = useState<number>(6);
    const [confidenceLabel, setConfidenceLabel] = useState<string>('Analysing...');
    const [confidenceScore, setConfidenceScore] = useState<number>(0);
    const [marketSentiment, setMarketSentiment] = useState<MarketSentiment>({ label: 'Analysing...', type: 'positive' });
    const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);

    useEffect(() => {
        if (canViewInsights) analyzeSales();
    }, [forecastMonths, canViewInsights]);

    if (!canViewInsights) {
        return <Navigate to="/pos" replace />;
    }

    const analyzeSales = async () => {
        try {
            setLoading(true);
            const twoYearsAgo = subYears(new Date(), 2);

            const [sales, allProducts] = await Promise.all([
                db.sales.findMany({
                    where: {
                        status: 'COMPLETED',
                        createdAt: { gte: twoYearsAgo.toISOString() }
                    },
                    include: { items: true },
                    orderBy: { createdAt: 'asc' }
                }),
                db.products.findMany({
                    include: {
                        category: true,
                        variants: { select: { id: true } }
                    }
                })
            ]);

            if (sales.length === 0) {
                setLoading(false);
                return;
            }

            // Build variantId -> categoryName lookup
            const variantCategoryMap: Record<string, string> = {};
            allProducts.forEach((product: any) => {
                const catName = product.category?.name || 'Uncategorized';
                product.variants.forEach((v: any) => {
                    variantCategoryMap[v.id] = catName;
                });
            });

            // Monthly bucketing
            const monthlyMap: Record<string, MonthlyBucket> = {};
            sales.forEach((sale: any) => {
                const date = new Date(sale.createdAt);
                const key = format(date, 'yyyy-MM');
                if (!monthlyMap[key]) {
                    monthlyMap[key] = { key, revenue: 0, count: 0, month: date.getMonth(), timestamp: date };
                }
                monthlyMap[key].revenue += sale.grandTotal;
                monthlyMap[key].count += 1;
            });

            const sortedKeys = Object.keys(monthlyMap).sort();
            const buckets = sortedKeys.map(k => monthlyMap[k]);
            const revenues = buckets.map(b => b.revenue);

            // Compute forecasting components
            const seasonalFactors = computeSeasonalFactors(buckets);
            const { slope, rSquared } = linearRegression(revenues);
            const stddev = computeStdDev(revenues);
            const mean = revenues.reduce((a, b) => a + b, 0) / revenues.length;
            const cv = mean > 0 ? stddev / mean : 1;

            const lastBucket = buckets[buckets.length - 1];
            const lastCalMonth = lastBucket.month;

            // Generate forecast
            const forecast = generateForecast(revenues, seasonalFactors, lastCalMonth, forecastMonths);

            // Build chart data
            const chartData: ForecastPoint[] = [];

            buckets.forEach(b => {
                chartData.push({
                    month: format(b.timestamp, 'MMM yyyy'),
                    revenue: b.revenue,
                    predicted: null,
                    predictedUpper: null,
                    predictedLower: null,
                    backtestPredicted: null
                });
            });

            forecast.forEach((f, i) => {
                const futureDate = new Date(lastBucket.timestamp.getFullYear(), lastBucket.timestamp.getMonth() + 1 + i, 1);
                chartData.push({
                    month: format(futureDate, 'MMM yyyy'),
                    revenue: null,
                    predicted: f.predicted,
                    predictedUpper: f.upper,
                    predictedLower: f.lower,
                    backtestPredicted: null
                });
            });

            // Backtest
            const btResult = runBacktest(revenues, buckets);
            setBacktestResult(btResult);

            if (btResult) {
                btResult.predictions.forEach(bp => {
                    const chartPoint = chartData.find(
                        cd => cd.month === format(new Date(bp.monthKey + '-01'), 'MMM yyyy')
                    );
                    if (chartPoint) {
                        chartPoint.backtestPredicted = bp.predicted;
                    }
                });
            }

            // Category intelligence using real categories
            const catMap: Record<string, { name: string; quantity: number; revenue: number }> = {};
            sales.forEach((s: any) => {
                s.items.forEach((item: any) => {
                    const cat = variantCategoryMap[item.variantId] || 'Uncategorized';
                    if (!catMap[cat]) catMap[cat] = { name: cat, quantity: 0, revenue: 0 };
                    catMap[cat].quantity += item.quantity;
                    catMap[cat].revenue += item.total;
                });
            });
            const sortedCategories = Object.values(catMap).sort((a, b) => b.revenue - a.revenue);
            const topCategory = sortedCategories[0]?.name || 'N/A';

            // Seasonal insights
            const seasons = [
                { id: 'vishu', name: 'Vishu Season', months: [3, 4], weight: 0 },
                { id: 'onam', name: 'Onam Peak', months: [7, 8], weight: 0 },
                { id: 'wedding', name: 'Wedding Windows', months: [0, 1, 4, 9], weight: 0 },
                { id: 'year_end', name: 'Year End / Xmas', months: [11], weight: 0 }
            ];
            sales.forEach((sale: any) => {
                const month = new Date(sale.createdAt).getMonth();
                const season = seasons.find(s => s.months.includes(month));
                if (season) season.weight += sale.grandTotal;
            });
            setSeasonalInsights(seasons.sort((a, b) => b.weight - a.weight));

            // Confidence & sentiment
            const confidence = computeConfidenceLevel(revenues.length, cv, rSquared);
            setConfidenceLabel(confidence.label);
            setConfidenceScore(confidence.score);

            const sentiment = computeMarketSentiment(revenues, slope);
            setMarketSentiment(sentiment);

            // Upcoming festivals
            const currentMonth = new Date().getMonth();
            const upcomingFestivals = KERALA_FESTIVALS.filter(f => {
                if (f.month !== null && f.month !== undefined) return f.month >= currentMonth && f.month <= currentMonth + 2;
                return false;
            });

            // Stats
            const totalRev = revenues.reduce((a, b) => a + b, 0);
            const lastMonthRev = revenues[revenues.length - 1];
            const prevMonthRev = revenues.length > 1 ? revenues[revenues.length - 2] : lastMonthRev;
            const realGrowthRate = prevMonthRev > 0 ? ((lastMonthRev - prevMonthRev) / prevMonthRev) * 100 : 0;
            const nextMonthPrediction = forecast[0]?.predicted || lastMonthRev * 1.05;

            setForecastData(chartData);
            setStats({
                totalRevenue: totalRev,
                avgMonthlyRevenue: totalRev / (revenues.length || 1),
                predictedNextMonth: nextMonthPrediction,
                growthRate: realGrowthRate.toFixed(1),
                topCategory,
                upcomingEvent: upcomingFestivals[0]?.name || 'Regular Season',
                nextMonthLower: forecast[0]?.lower || 0,
                nextMonthUpper: forecast[0]?.upper || 0,
            });

        } catch (error) {
            console.error('Forecasting error:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="p-8 text-center">Analysing market patterns...</div>;

    const sentimentColors = {
        positive: { bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200', icon: 'text-emerald-600', title: 'text-emerald-800', text: 'text-emerald-700' },
        mixed: { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200', icon: 'text-amber-600', title: 'text-amber-800', text: 'text-amber-700' },
        recovering: { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200', icon: 'text-blue-600', title: 'text-blue-800', text: 'text-blue-700' },
        cautious: { bg: 'bg-rose-50 dark:bg-rose-900/20', border: 'border-rose-200', icon: 'text-rose-600', title: 'text-rose-800', text: 'text-rose-700' }
    };
    const sc = sentimentColors[marketSentiment.type];

    return (
        <div className="space-y-6">
            {/* Header - stacks on small, side-by-side on large */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                        <BrainCircuit className="w-7 h-7 md:w-8 md:h-8 text-primary-600 shrink-0" />
                        SALES FORECASTER
                    </h1>
                    <p className="text-sm text-gray-500">See how your business is doing and what to expect next</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {/* Forecast Period Control */}
                    <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
                        {([
                            { months: 3, label: '3M' },
                            { months: 6, label: '6M' },
                            { months: 12, label: '1Y' }
                        ] as const).map(opt => (
                            <button
                                key={opt.months}
                                onClick={() => setForecastMonths(opt.months)}
                                className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all whitespace-nowrap ${
                                    forecastMonths === opt.months
                                        ? 'bg-primary-600 text-white shadow-sm'
                                        : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    {/* Market Sentiment Badge */}
                    <div className={`${sc.bg} border ${sc.border} p-2.5 md:p-3 rounded-2xl flex items-center gap-2`}>
                        <Sparkles className={`w-4 h-4 md:w-5 md:h-5 ${sc.icon} shrink-0`} />
                        <div>
                            <p className={`text-[10px] uppercase font-black ${sc.title} tracking-widest`}>Your Business</p>
                            <p className={`text-xs md:text-sm font-bold ${sc.text}`}>{marketSentiment.label}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Prediction Cards */}
            <div className={`grid grid-cols-1 sm:grid-cols-2 ${backtestResult ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-4`}>
                <div className="card bg-white dark:bg-dark-card border-none shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-125 transition-transform">
                        <TrendingUp className="w-12 h-12" />
                    </div>
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Expected Next Month Sales</p>
                    <p className="text-2xl font-black mt-2 text-primary-600">
                        {formatIndianCurrency(stats?.predictedNextMonth || 0)}
                    </p>
                    <div className={`flex items-center gap-1 mt-2 ${parseFloat(stats?.growthRate || '0') >= 0 ? 'text-emerald-600' : 'text-rose-600'} text-xs font-bold`}>
                        {parseFloat(stats?.growthRate || '0') >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                        <span>{stats?.growthRate}% {parseFloat(stats?.growthRate || '0') >= 0 ? 'up from last month' : 'down from last month'}</span>
                    </div>
                    <p className="text-[9px] text-gray-400 mt-1">
                        Could be between {formatIndianCurrency(stats?.nextMonthLower || 0)} and {formatIndianCurrency(stats?.nextMonthUpper || 0)}
                    </p>
                </div>

                <div className="card bg-white dark:bg-dark-card border-none shadow-sm">
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Your Monthly Average</p>
                    <p className="text-2xl font-black mt-2 text-gray-900 dark:text-white">
                        {formatIndianCurrency(stats?.avgMonthlyRevenue || 0)}
                    </p>
                    <p className="text-[10px] text-gray-500 mt-2 font-medium">This is how much you typically sell per month</p>
                </div>

                <div className="card bg-gradient-to-br from-indigo-600 to-violet-700 text-white border-none shadow-lg">
                    <p className="text-xs font-black text-white/70 uppercase tracking-widest">Stock Up Budget (3 Months)</p>
                    <p className="text-xl md:text-2xl font-black mt-2">{formatIndianCurrency((stats?.avgMonthlyRevenue || 0) * 2.5)}</p>
                    <p className="text-[10px] text-white/50 mt-2 font-medium italic">{confidenceLabel} for {stats?.upcomingEvent}</p>
                </div>

                <div className="card bg-white dark:bg-dark-card border-none shadow-sm">
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Best Selling Category</p>
                    <p className="text-2xl font-black mt-2 text-emerald-600">{stats?.topCategory}</p>
                    <p className="text-[10px] text-gray-500 mt-2 font-medium">This category brings in the most money</p>
                </div>

                {backtestResult && (
                    <div className="card bg-white dark:bg-dark-card border-none shadow-sm">
                        <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Prediction Accuracy</p>
                        <p className={`text-2xl font-black mt-2 ${backtestResult.accuracy >= 80 ? 'text-emerald-600' : backtestResult.accuracy >= 60 ? 'text-amber-600' : 'text-rose-600'}`}>
                            {backtestResult.accuracy}%
                        </p>
                        <p className="text-[10px] text-gray-500 mt-2 font-medium">
                            {backtestResult.accuracy >= 80 ? 'Our predictions are very close to reality' : backtestResult.accuracy >= 60 ? 'Our predictions are fairly close' : 'Predictions may vary - more data will improve this'}
                        </p>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Forecast Chart */}
                <div className="card lg:col-span-2 shadow-sm border-none bg-white dark:bg-dark-card">
                    <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4">
                        <div>
                            <h3 className="font-black text-gray-900 dark:text-white uppercase tracking-tight flex items-center gap-2 text-base md:text-lg">
                                <Calendar className="w-5 h-5 text-primary-600 shrink-0" />
                                Your Sales Chart
                            </h3>
                            <p className="text-xs text-gray-500 font-medium">Past sales (what actually happened) vs Future predictions (what we expect)</p>
                        </div>

                        <div className="flex flex-wrap gap-3 bg-gray-50 dark:bg-gray-800/50 p-2.5 rounded-2xl border border-gray-100 dark:border-gray-700">
                            <div className="flex items-center gap-1.5">
                                <div className="w-6 h-1 bg-primary-500 rounded-full shrink-0"></div>
                                <p className="text-[10px] font-bold whitespace-nowrap">Actual Sales</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <div className="w-6 h-1 bg-violet-400 border-t-2 border-dashed border-violet-500 shrink-0"></div>
                                <p className="text-[10px] font-bold text-violet-600 whitespace-nowrap">Prediction</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <div className="w-6 h-[1px] border-t-2 border-dashed border-violet-300 shrink-0"></div>
                                <p className="text-[10px] font-bold text-violet-400 whitespace-nowrap">Best/Worst</p>
                            </div>
                            {backtestResult && (
                                <div className="flex items-center gap-1.5">
                                    <div className="w-6 h-[1px] border-t-2 border-dashed border-amber-400 shrink-0"></div>
                                    <p className="text-[10px] font-bold text-amber-500 whitespace-nowrap">Accuracy ({backtestResult.accuracy}%)</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="h-[280px] md:h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={forecastData}>
                                <defs>
                                    <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorPred" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.05} />
                                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                <XAxis
                                    dataKey="month"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 10, fontWeight: 700 }}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 10, fontWeight: 700 }}
                                    tickFormatter={(v) => `₹${v / 1000}k`}
                                />
                                <Tooltip
                                    cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '5 5' }}
                                    contentStyle={{
                                        borderRadius: '16px',
                                        border: 'none',
                                        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
                                        padding: '12px'
                                    }}
                                    content={({ active, payload, label }) => {
                                        if (active && payload && payload.length) {
                                            const dataPoint = payload[0].payload as ForecastPoint;
                                            const isPast = dataPoint.revenue !== null;
                                            const isFuture = dataPoint.predicted !== null;

                                            return (
                                                <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 max-w-xs">
                                                    <p className="text-[10px] font-black uppercase text-gray-400 mb-2 border-b pb-1">{label}</p>
                                                    <div className="space-y-2">
                                                        {isPast && (
                                                            <div>
                                                                <div className="flex justify-between items-center gap-8">
                                                                    <span className="text-xs font-bold text-blue-600">You actually sold:</span>
                                                                    <span className="text-sm font-black">{formatIndianCurrency(dataPoint.revenue!)}</span>
                                                                </div>
                                                                <p className="text-[9px] text-gray-400 mt-1">This is real data from your billing records</p>
                                                            </div>
                                                        )}
                                                        {isFuture && (
                                                            <div>
                                                                <div className="flex justify-between items-center gap-8">
                                                                    <span className="text-xs font-bold text-violet-500">We expect you to sell:</span>
                                                                    <span className="text-sm font-black">{formatIndianCurrency(dataPoint.predicted!)}</span>
                                                                </div>
                                                                {dataPoint.predictedUpper !== null && (
                                                                    <p className="text-[9px] text-gray-400 mt-1">
                                                                        Best case: {formatIndianCurrency(dataPoint.predictedUpper)} | Worst case: {formatIndianCurrency(dataPoint.predictedLower!)}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}
                                                        {dataPoint.backtestPredicted !== null && (
                                                            <div className="flex justify-between items-center gap-8 pt-1 border-t border-dashed">
                                                                <span className="text-xs font-bold text-amber-500">We had predicted:</span>
                                                                <span className="text-sm font-black">{formatIndianCurrency(dataPoint.backtestPredicted)}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="revenue"
                                    stroke="#3b82f6"
                                    strokeWidth={4}
                                    fillOpacity={1}
                                    fill="url(#colorRev)"
                                    name="Actual Revenue"
                                    activeDot={{ r: 6, strokeWidth: 0 }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="predicted"
                                    stroke="#8b5cf6"
                                    strokeWidth={2}
                                    strokeDasharray="6 4"
                                    fillOpacity={1}
                                    fill="url(#colorPred)"
                                    name="Forecasting"
                                />
                                <Area
                                    type="monotone"
                                    dataKey="predictedUpper"
                                    stroke="#8b5cf680"
                                    strokeWidth={1}
                                    strokeDasharray="4 4"
                                    fill="none"
                                    dot={false}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="predictedLower"
                                    stroke="#8b5cf680"
                                    strokeWidth={1}
                                    strokeDasharray="4 4"
                                    fill="none"
                                    dot={false}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="backtestPredicted"
                                    stroke="#f59e0b"
                                    strokeWidth={2}
                                    strokeDasharray="6 3"
                                    fill="none"
                                    dot={{ r: 3, fill: '#f59e0b', strokeWidth: 0 }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Regional Insights */}
                <div className="space-y-6">
                    <div className="card shadow-sm border-none bg-white dark:bg-dark-card h-full">
                        <h3 className="font-black text-gray-900 dark:text-white uppercase tracking-tight mb-4 flex items-center gap-2">
                            <Filter className="w-5 h-5 text-primary-600" />
                            When Do You Sell Most?
                        </h3>
                        <div className="space-y-3">
                            {seasonalInsights.map((season) => (
                                <div key={season.id} className="p-3 md:p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
                                    <div className="flex justify-between items-start mb-2">
                                        <span className="font-black text-[10px] md:text-xs uppercase tracking-widest text-gray-500">{season.name}</span>
                                        <span className="text-[10px] md:text-xs font-bold text-primary-600 bg-white dark:bg-gray-700 px-2 py-0.5 md:py-1 rounded-lg shrink-0 ml-2">
                                            Busy Period
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-end gap-3">
                                        <div className="min-w-0">
                                            <p className="text-base md:text-lg font-black truncate">{formatIndianCurrency(season.weight)}</p>
                                            <p className="text-[10px] text-gray-400">Total sales during this season</p>
                                        </div>
                                        <div className="h-2 w-24 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-primary-600 rounded-full"
                                                style={{ width: `${(season.weight / (stats?.totalRevenue || 1)) * 100 * 5}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Action Plan & Understanding Guide */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card shadow-sm border-none bg-white dark:bg-dark-card">
                    <h3 className="font-black text-gray-900 dark:text-white uppercase tracking-tight mb-6 flex items-center gap-2">
                        <Target className="w-5 h-5 text-primary-600" />
                        What Should You Do Next?
                    </h3>
                    <div className="space-y-4">
                        {/* Stock Up Recommendation */}
                        <div className="flex gap-3">
                            <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
                                <ShoppingBag className="w-5 h-5 md:w-6 md:h-6 text-indigo-600" />
                            </div>
                            <div>
                                <p className="font-bold text-sm">Stock up on "{stats?.topCategory}"</p>
                                <p className="text-xs text-gray-500 mt-1">This is your #1 selling category. Order 20% extra before {stats?.upcomingEvent} so you don't run out when customers come in.</p>
                            </div>
                        </div>

                        {/* Budget Suggestion */}
                        <div className="flex gap-3">
                            <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                                <IndianRupee className="w-5 h-5 md:w-6 md:h-6 text-emerald-600" />
                            </div>
                            <div>
                                <p className="font-bold text-sm">Keep {formatIndianCurrency((stats?.avgMonthlyRevenue || 0) * 2.5)} ready for purchasing</p>
                                <p className="text-xs text-gray-500 mt-1">Based on your monthly sales of {formatIndianCurrency(stats?.avgMonthlyRevenue || 0)}, this is how much stock you need to buy for the next 3 months.</p>
                            </div>
                        </div>

                        {/* Growth / Decline Strategy */}
                        {parseFloat(stats?.growthRate || '0') >= 0 ? (
                            <div className="flex gap-3">
                                <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                                    <TrendingUp className="w-5 h-5 md:w-6 md:h-6 text-amber-600" />
                                </div>
                                <div>
                                    <p className="font-bold text-sm">Your sales are growing - invest more</p>
                                    <p className="text-xs text-gray-500 mt-1">Last month you grew by {stats?.growthRate}%. This is a good time to try new products, increase ads, or open for longer hours to capture more sales.</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex gap-3">
                                <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center shrink-0">
                                    <AlertTriangle className="w-5 h-5 md:w-6 md:h-6 text-rose-600" />
                                </div>
                                <div>
                                    <p className="font-bold text-sm">Sales dipped {Math.abs(parseFloat(stats?.growthRate || '0')).toFixed(1)}% - take action</p>
                                    <p className="text-xs text-gray-500 mt-1">Consider running offers or discounts, check if any popular items are out of stock, and make sure your shop is visible on Google Maps and social media.</p>
                                </div>
                            </div>
                        )}

                        {/* Seasonal Advice */}
                        <div className="flex gap-3">
                            <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
                                <Lightbulb className="w-5 h-5 md:w-6 md:h-6 text-violet-600" />
                            </div>
                            <div>
                                <p className="font-bold text-sm">
                                    {stats?.upcomingEvent !== 'Regular Season'
                                        ? `${stats?.upcomingEvent} is coming - prepare now!`
                                        : 'No festival coming soon - focus on regular sales'}
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                    {stats?.upcomingEvent !== 'Regular Season'
                                        ? `Customers will shop more during ${stats?.upcomingEvent}. Make sure your best products are in stock and your shop is well decorated for the season.`
                                        : 'Use this quiet period to organize inventory, train staff, clear old stock with discounts, and plan purchases for the next festival.'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card shadow-sm border-2 border-primary-50 bg-primary-50/20 dark:bg-primary-900/5 dark:border-primary-900/20">
                    <h3 className="font-black text-primary-900 dark:text-primary-400 uppercase tracking-tight mb-4 flex items-center gap-2">
                        <Sparkles className="w-5 h-5" />
                        Understanding This Page
                    </h3>
                    <div className="space-y-4">
                        <div className="p-3 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-primary-100 dark:border-primary-800">
                            <p className="text-xs font-bold text-primary-700 mb-1 flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> What is this page?
                            </p>
                            <p className="text-[10px] text-gray-500 font-medium leading-relaxed">
                                This page looks at all your past sales and tries to guess how much you will sell in the coming months. Think of it like a weather forecast - it gives you a good idea of what's coming so you can prepare.
                            </p>
                        </div>
                        <div className="p-3 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-primary-100 dark:border-primary-800">
                            <p className="text-xs font-bold text-primary-700 mb-1 flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> What does the chart show?
                            </p>
                            <p className="text-[10px] text-gray-500 font-medium leading-relaxed">
                                The <strong>blue line</strong> is your real sales - money you actually earned each month.
                                The <strong>purple dashed line</strong> is our prediction of future sales.
                                The <strong>faint lines</strong> around it show the best and worst case.
                                {backtestResult && <> The <strong>orange dots</strong> show what we would have predicted for past months - you can compare them with the blue line to see how accurate we are.</>}
                            </p>
                        </div>
                        <div className="p-3 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-primary-100 dark:border-primary-800">
                            <p className="text-xs font-bold text-primary-700 mb-1 flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> How accurate is this?
                            </p>
                            <p className="text-[10px] text-gray-500 font-medium leading-relaxed">
                                {backtestResult
                                    ? `We tested our predictions against your last 6 months of real sales and we were ${backtestResult.accuracy}% accurate. ${backtestResult.accuracy >= 75 ? 'That\'s quite reliable!' : 'It will improve as we get more months of data.'}`
                                    : 'We need at least 12 months of sales data to test our accuracy. Keep using the system and this will automatically improve!'}
                                {' '}The more sales data you have, the better the predictions become.
                            </p>
                        </div>
                        <div className="p-3 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-primary-100 dark:border-primary-800">
                            <p className="text-xs font-bold text-primary-700 mb-1 flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> What should I do with this info?
                            </p>
                            <p className="text-[10px] text-gray-500 font-medium leading-relaxed">
                                Use the "Expected Next Month Sales" number to plan how much stock to buy.
                                Check the "Best Selling Category" to know what customers want most.
                                Look at the seasonal section to prepare for busy festival periods ahead of time.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
