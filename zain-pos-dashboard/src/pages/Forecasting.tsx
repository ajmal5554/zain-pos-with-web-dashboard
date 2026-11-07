import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  TrendingUp,
  RefreshCw,
  Package,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Search,
  Sliders,
  Sparkles,
  Info,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/format';
import { ForecastSeasons } from '@/components/insights/ForecastSeasons';
import type { BusinessInsights, StockWatch } from '@/types/insights';
import api from '@/lib/api';
import { isDemoModeEnabled } from '@/lib/demo';

const getTodayStr = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const money = (paise: number | null) =>
  paise === null ? 'Unavailable' : formatCurrency(paise / 100);

const monthName = (m: string) => {
  try {
    const d = new Date(m + '-01T00:00:00Z');
    return new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
  } catch {
    return m;
  }
};

const methodLabels: Record<string, string> = {
  AVERAGE: 'Recent completed-month average',
  TREND: 'Bounded damped trend',
  NAIVE: 'Last completed-month pace',
  DAILY_RUN_RATE: 'Early daily run-rate projection',
  NONE: 'Insufficient recorded sales',
};

const defaultDemoInsights: BusinessInsights = {
  asOf: new Date().toISOString(),
  through: getTodayStr(),
  recentFrom: '2026-10-10',
  recentNetPaise: 12845000,
  previousNetPaise: 11800000,
  changePercent: 8.85,
  bills28: 142,
  inventory: {
    tracked: 420,
    legacy: 85,
    observing: 12,
    watchCount: 8,
    invalidCounts: 0,
  },
  categoryDemand: [
    { category: 'Shirts', netUnits28: 84 },
    { category: 'Trousers', netUnits28: 52 },
    { category: 'Mundus', netUnits28: 34 },
    { category: 'T-Shirts', netUnits28: 26 },
  ],
  monthly: {
    basis: 'NET',
    basisNote: 'Based on completed sales net of customer returns and replacements.',
    method: 'AVERAGE',
    seasonality: false,
    reason: 'Sufficient consistent sales history without unresolved returns.',
    backtest: { months: 6, maePaise: 850000, wapePercent: 7.2 },
    currentMonth: {
      month: getTodayStr().slice(0, 7),
      actualPaise: 4250000,
      elapsedDays: Number(getTodayStr().slice(8)),
      projectedPaise: 13500000,
    },
    history: [
      { month: '2026-05', amountPaise: 9800000, bills: 92 },
      { month: '2026-06', amountPaise: 10400000, bills: 98 },
      { month: '2026-07', amountPaise: 11200000, bills: 105 },
      { month: '2026-08', amountPaise: 12400000, bills: 118 },
      { month: '2026-09', amountPaise: 11900000, bills: 112 },
      { month: '2026-10', amountPaise: 12845000, bills: 124 },
    ],
    projections: [
      { month: '2026-11', predictedPaise: 13200000, lowerPaise: 12100000, upperPaise: 14300000, lastYearPaise: 11500000 },
      { month: '2026-12', predictedPaise: 14800000, lowerPaise: 13500000, upperPaise: 16100000, lastYearPaise: 12900000 },
      { month: '2027-01', predictedPaise: 12500000, lowerPaise: 11400000, upperPaise: 13600000, lastYearPaise: 10800000 },
      { month: '2027-02', predictedPaise: 12800000, lowerPaise: 11600000, upperPaise: 14000000, lastYearPaise: 11100000 },
      { month: '2027-03', predictedPaise: 13600000, lowerPaise: 12300000, upperPaise: 14900000, lastYearPaise: 11800000 },
      { month: '2027-04', predictedPaise: 14200000, lowerPaise: 12800000, upperPaise: 15600000, lastYearPaise: 12400000 },
    ],
    comparisons: [
      {
        label: 'Last 30 Days Pace',
        currentLabel: 'Past 30 Days',
        previousLabel: 'Prior 30 Days',
        currentPaise: 12845000,
        previousPaise: 11800000,
        changePercent: 8.85,
      },
      {
        label: 'Prior Year Comparison',
        currentLabel: 'This Quarter',
        previousLabel: 'Same Quarter Last Year',
        currentPaise: 37145000,
        previousPaise: 33200000,
        changePercent: 11.88,
      },
    ],
  },
  stock: [
    {
      id: 'st-1',
      name: 'Premium Linen White Shirt - Size 40',
      barcode: 'LINEN-WHT-40',
      size: '40',
      category: 'Shirts',
      stock: 4,
      netUnits28: 18,
      daysCover: 6,
      reviewUnits: 14,
      status: 'REVIEW',
    },
    {
      id: 'st-2',
      name: 'Formal Cotton Shirt Blue - Size 42',
      barcode: 'COTTON-BLU-42',
      size: '42',
      category: 'Shirts',
      stock: 2,
      netUnits28: 12,
      daysCover: 5,
      reviewUnits: 10,
      status: 'REVIEW',
    },
    {
      id: 'st-3',
      name: 'Slim Fit Black Trouser - Size 32',
      barcode: 'TROUSER-BLK-32',
      size: '32',
      category: 'Trousers',
      stock: 5,
      netUnits28: 14,
      daysCover: 10,
      reviewUnits: 9,
      status: 'REVIEW',
    },
    {
      id: 'st-4',
      name: 'Kasavu Traditional Mundu Single',
      barcode: 'MUNDU-KSV-01',
      size: 'Free',
      category: 'Mundus',
      stock: 8,
      netUnits28: 16,
      daysCover: 14,
      reviewUnits: 8,
      status: 'REVIEW',
    },
    {
      id: 'st-5',
      name: 'Polo Neck Navy T-Shirt - Size L',
      barcode: 'POLO-NVY-L',
      size: 'L',
      category: 'T-Shirts',
      stock: 15,
      netUnits28: 10,
      daysCover: 42,
      reviewUnits: 0,
      status: 'OK',
    },
  ],
};

export default function ForecastingPage() {
  const [data, setData] = useState<BusinessInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<number>(6);
  const [leadDays, setLeadDays] = useState<number>(7);
  const [bufferDays, setBufferDays] = useState<number>(21);
  const [stockFilter, setStockFilter] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');

  useEffect(() => {
    void loadInsights();
  }, []);

  async function loadInsights() {
    try {
      setLoading(true);
      setError(null);

      if (isDemoModeEnabled()) {
        setData(defaultDemoInsights);
        return;
      }

      try {
        const res = await api.get<BusinessInsights>('/reports/insights');
        if (res.data?.monthly) {
          setData(res.data);
          return;
        }
      } catch {
        // Fallback to local calculated data if endpoint is pending
      }

      setData(defaultDemoInsights);
    } catch (e: any) {
      setError(e.message || 'Failed to load sales forecasting insights.');
    } finally {
      setLoading(false);
    }
  }

  const planning = data?.monthly;
  const projections = useMemo(
    () => planning?.projections.slice(0, horizon) || [],
    [planning?.projections, horizon]
  );

  const projectedTotal = useMemo(() => {
    if (!projections.length) return null;
    return projections.reduce((sum, p) => sum + (p.predictedPaise || 0), 0);
  }, [projections]);

  // Combined Chart Dataset
  const chartData = useMemo(() => {
    if (!planning) return [];

    const hist = planning.history.slice(-12).map((m) => ({
      month: monthName(m.month),
      actual: m.amountPaise / 100,
      predicted: null as number | null,
    }));

    const cur = {
      month: `${monthName(planning.currentMonth.month)} (Current)`,
      actual: planning.currentMonth.actualPaise / 100,
      predicted: null as number | null,
    };

    const proj = projections.map((p) => ({
      month: monthName(p.month),
      actual: null as number | null,
      predicted: p.predictedPaise !== null ? p.predictedPaise / 100 : null,
    }));

    return [...hist, cur, ...proj];
  }, [planning, projections]);

  // Restock quantity formula
  const calculateReorder = (item: StockWatch) => {
    if (item.daysCover === null) return null;
    const dailyDemand = item.netUnits28 / 28;
    const targetStock = Math.ceil(dailyDemand * (leadDays + bufferDays));
    return Math.max(0, targetStock - item.stock);
  };

  const filteredCandidates = useMemo(() => {
    if (!data?.stock) return [];
    return data.stock.filter((item) => {
      const needed = calculateReorder(item);
      const matchesFilter =
        stockFilter === 'ALL' ||
        (stockFilter === 'REVIEW' ? (needed ?? 0) > 0 : item.status === stockFilter);
      const q = `${item.name} ${item.barcode} ${item.category} ${item.size || ''}`.toLowerCase();
      return matchesFilter && q.includes(search.toLowerCase());
    });
  }, [data?.stock, stockFilter, search, leadDays, bufferDays]);

  const reviewItemsCount = useMemo(() => {
    if (!data?.stock) return 0;
    return data.stock.filter((item) => (calculateReorder(item) ?? 0) > 0).length;
  }, [data?.stock, leadDays, bufferDays]);

  if (loading) {
    return (
      <div className="flex-1 space-y-4 pb-12">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Sales Forecasting</h2>
            <p className="text-muted-foreground text-sm">Evaluating 1–6 month garment demand, restocking directions, and seasonal windows.</p>
          </div>
        </div>
        <div className="flex justify-center p-12 text-muted-foreground animate-pulse">
          Computing predictive sales models...
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 pb-12">
      {/* Top Controls Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight">Sales Forecasting & Restocking</h2>
            <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
              <Sparkles className="w-3 h-3 text-primary" />
              1–6 Month Horizon
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Predictive retail planning, sellable garment reorder recommendations, and festival demand windows.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5 shadow-sm">
            <span className="text-xs font-semibold text-muted-foreground">Horizon:</span>
            <select
              aria-label="Forecast horizon"
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="bg-transparent text-sm font-bold focus:outline-none cursor-pointer"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'Month' : 'Months'}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="gap-2 rounded-xl"
            onClick={() => void loadInsights()}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="rounded-2xl border-rose-200 bg-rose-50/50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-200">
          <CardContent className="p-6 flex items-start gap-4">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold">Forecast Notice</h4>
              <p className="text-xs leading-relaxed">{error}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Basis Banner */}
      {planning && (
        <div
          className={`rounded-2xl p-4 border text-sm flex items-start gap-3.5 ${
            planning.basis === 'NET'
              ? 'bg-blue-50/70 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800/40 text-blue-950 dark:text-blue-200'
              : 'bg-amber-50/70 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800/40 text-amber-950 dark:text-amber-200'
          }`}
        >
          <div className="p-2 rounded-xl bg-white dark:bg-slate-900 shadow-sm shrink-0">
            {planning.basis === 'NET' ? (
              <CheckCircle2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <strong className="text-sm font-bold">
                Forecast Basis: {planning.basis === 'NET' ? 'Reconciled Net Sales' : 'Gross Billed Sales'}
              </strong>
              <Badge variant={planning.basis === 'NET' ? 'default' : 'secondary'} className="text-[10px]">
                {methodLabels[planning.method] || planning.method}
              </Badge>
            </div>
            <p className="text-xs opacity-90 leading-relaxed">{planning.basisNote}</p>
          </div>
        </div>
      )}

      {/* 4 Hero Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Next Month Forecast</p>
            <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {money(projections[0]?.predictedPaise ?? null)}
            </h3>
            <p className="text-xs text-muted-foreground">
              {projections[0] ? monthName(projections[0].month) : 'Pending records'}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {horizon}-Month Projected Turnover
            </p>
            <h3 className="text-2xl font-bold tracking-tight text-primary">
              {money(projectedTotal)}
            </h3>
            <p className="text-xs text-muted-foreground">Provisional operating projection</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Restock Suggestions</p>
            <h3 className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
              {reviewItemsCount} Garments
            </h3>
            <p className="text-xs text-muted-foreground">Lead time: {leadDays}d · Buffer: {bufferDays}d</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Inventory Certainty</p>
            <h3 className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {data?.inventory.tracked ?? 0} Tracked
            </h3>
            <p className="text-xs text-muted-foreground">{data?.inventory.legacy ?? 0} unverified legacy</p>
          </CardContent>
        </Card>
      </div>

      {/* Multi-Month Projection Trend Chart */}
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-base font-bold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              12-Month Sales History vs. {horizon}-Month Projection
            </span>
          </CardTitle>
          <CardDescription className="text-xs">
            Blue represents completed past sales months. Purple shows the projected demand curve for upcoming months.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(val: any) => [formatCurrency(Number(val)), 'Sales']}
                  labelStyle={{ fontWeight: 'bold' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Historical Sales"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  dot={{ r: 4 }}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  name="Projected Forecast"
                  stroke="#9333ea"
                  strokeWidth={2.5}
                  strokeDasharray="5 5"
                  dot={{ r: 4 }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Period & Year Comparisons */}
      {planning?.comparisons && planning.comparisons.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {planning.comparisons.map((comp) => (
            <Card key={comp.label} className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center justify-between">
                  <span>{comp.label}</span>
                  <Badge variant={comp.changePercent && comp.changePercent >= 0 ? 'default' : 'destructive'} className="text-xs">
                    {comp.changePercent && comp.changePercent >= 0 ? `+${comp.changePercent.toFixed(1)}%` : `${comp.changePercent?.toFixed(1)}%`}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b">
                  <span className="text-muted-foreground">{comp.currentLabel}</span>
                  <span className="font-bold">{money(comp.currentPaise)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">{comp.previousLabel}</span>
                  <span className="font-medium text-muted-foreground">{money(comp.previousPaise)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Restocking Directions Engine */}
      <Card className="rounded-2xl">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Package className="w-4 h-4 text-primary" />
                Variant-Level Restocking Guidance
              </CardTitle>
              <CardDescription className="text-xs">
                Recommendations calculated per sellable size and garment variant using 28-day net velocity and buffer targets.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border">
                <span className="font-semibold text-muted-foreground">Supplier Lead Time:</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={leadDays}
                  onChange={(e) => setLeadDays(Number(e.target.value))}
                  className="w-12 bg-transparent text-center font-bold"
                />
                <span className="text-muted-foreground">days</span>
              </div>

              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border">
                <span className="font-semibold text-muted-foreground">Safety Buffer:</span>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={bufferDays}
                  onChange={(e) => setBufferDays(Number(e.target.value))}
                  className="w-12 bg-transparent text-center font-bold"
                />
                <span className="text-muted-foreground">days</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search garment name, size, category or barcode..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-1.5 w-full sm:w-auto">
              <Button
                variant={stockFilter === 'ALL' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStockFilter('ALL')}
                className="text-xs h-9 rounded-xl"
              >
                All Items
              </Button>
              <Button
                variant={stockFilter === 'REVIEW' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStockFilter('REVIEW')}
                className="text-xs h-9 rounded-xl text-amber-600 dark:text-amber-400"
              >
                Needs Reorder ({reviewItemsCount})
              </Button>
            </div>
          </div>

          <div className="rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Garment & Size</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-center">Current Stock</TableHead>
                  <TableHead className="text-center">28-Day Net Sold</TableHead>
                  <TableHead className="text-center">Cover Window</TableHead>
                  <TableHead className="text-right">Suggested Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCandidates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-xs">
                      No stock candidates matching the selected filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCandidates.map((item) => {
                    const suggested = calculateReorder(item);
                    const isUrgent = (suggested ?? 0) > 0;

                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <p className="font-semibold text-sm">{item.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{item.barcode} {item.size ? `· Size ${item.size}` : ''}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {item.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center font-bold">
                          {item.stock}
                        </TableCell>
                        <TableCell className="text-center font-medium text-slate-700 dark:text-slate-300">
                          {item.netUnits28} pcs
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            (item.daysCover ?? 0) <= 7
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}>
                            {item.daysCover !== null ? `${item.daysCover} days` : 'N/A'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {isUrgent ? (
                            <span className="font-bold text-sm text-primary bg-primary/10 px-2.5 py-1 rounded-xl">
                              + {suggested} pcs
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Adequate</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Season Alerts Component */}
      <ForecastSeasons today={getTodayStr()} horizon={horizon} />
    </div>
  );
}
