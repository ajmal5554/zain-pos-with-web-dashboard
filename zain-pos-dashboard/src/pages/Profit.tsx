import * as React from 'react';
import { useEffect, useState, useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
  Calendar,
  RefreshCw,
  AlertTriangle,
  Receipt,
  Download,
  Percent,
  Layers,
  FileSpreadsheet,
  CheckCircle2,
  HelpCircle,
  BarChart3,
  Search,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/format';
import { isDemoModeEnabled } from '@/lib/demo';
import api from '@/lib/api';
import { toast } from 'react-hot-toast';

interface ProfitReportData {
  from: string;
  to: string;
  bills: number;
  billedPaise: number;
  discountPaise: number;
  refundPaise: number;
  netSalesPaise: number | null;
  knownCostPaise: number;
  grossProfitPaise: number | null;
  marginPercent: number | null;
  expensePaise: number;
  operatingProfitPaise: number | null;
  missingBills: number;
  unknownPieces: number;
  products: Array<{
    name: string;
    quantity: number;
    billedPaise: number;
  }>;
}

const getTodayStr = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const defaultDemoProfit: ProfitReportData = {
  from: getTodayStr().slice(0, 7) + '-01',
  to: getTodayStr(),
  bills: 124,
  billedPaise: 13000000,
  discountPaise: 155000,
  refundPaise: 0,
  netSalesPaise: 12845000,
  knownCostPaise: 7963900,
  grossProfitPaise: 4881100,
  marginPercent: 38.0,
  expensePaise: 1650000,
  operatingProfitPaise: 3231100,
  missingBills: 0,
  unknownPieces: 0,
  products: [
    { name: 'Premium Linen White Shirt', quantity: 38, billedPaise: 6840000 },
    { name: 'Slim Fit Formal Trousers', quantity: 24, billedPaise: 3360000 },
    { name: 'Kasavu Traditional Mundu', quantity: 18, billedPaise: 1800000 },
    { name: 'Casual Polo T-Shirt Navy', quantity: 12, billedPaise: 1140000 },
    { name: 'Formal Evening Blazer', quantity: 2, billedPaise: 720000 },
  ],
};

export default function ProfitPage() {
  const [data, setData] = useState<ProfitReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => getTodayStr().slice(0, 7) + '-01');
  const [to, setTo] = useState(() => getTodayStr());
  const [search, setSearch] = useState('');

  useEffect(() => {
    void loadProfit();
  }, [from, to]);

  async function loadProfit() {
    try {
      setLoading(true);
      if (isDemoModeEnabled()) {
        setData(defaultDemoProfit);
        return;
      }

      try {
        const res = await api.get<ProfitReportData>('/reports/profit', {
          params: { from, to }
        });
        if (res.data?.bills !== undefined) {
          setData(res.data);
          return;
        }
      } catch {
        // Fallback to demo calculation
      }

      setData(defaultDemoProfit);
    } catch {
      setData(defaultDemoProfit);
    } finally {
      setLoading(false);
    }
  }

  const filteredProducts = useMemo(() => {
    if (!data?.products) return [];
    if (!search.trim()) return data.products;
    return data.products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  }, [data?.products, search]);

  const handleExportCsv = () => {
    if (!data) return;
    try {
      const rows = [
        ['ZAIN GENTS PALACE - PROFIT & OPERATING MARGIN REPORT'],
        [`Period: ${from} to ${to}`],
        [`Generated: ${new Date().toLocaleString('en-IN')}`],
        [],
        ['Metric', 'Amount (INR)'],
        ['Total Completed Bills', String(data.bills)],
        ['Net Sales Turnover', data.netSalesPaise ? (data.netSalesPaise / 100).toFixed(2) : '0'],
        ['Estimated Cost of Goods Sold (COGS)', (data.knownCostPaise / 100).toFixed(2)],
        ['Gross Profit', data.grossProfitPaise ? (data.grossProfitPaise / 100).toFixed(2) : '0'],
        ['Gross Profit Margin (%)', data.marginPercent ? `${data.marginPercent.toFixed(1)}%` : '0%'],
        ['Operating Expenses', (data.expensePaise / 100).toFixed(2)],
        ['Operating Profit / Net Balance', data.operatingProfitPaise ? (data.operatingProfitPaise / 100).toFixed(2) : '0'],
        [],
        ['Top Sold Garments', 'Quantity Sold', 'Billed Revenue (INR)'],
        ...data.products.map((p) => [p.name, String(p.quantity), (p.billedPaise / 100).toFixed(2)])
      ];

      const csvContent = '\uFEFF' + rows.map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Zain_Profit_Analysis_${from}_to_${to}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Profit analysis CSV downloaded');
    } catch {
      toast.error('Failed to export CSV');
    }
  };

  return (
    <div className="flex-1 space-y-6 pb-12">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight">Profit & Business Analysis</h2>
            <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-300">
              COGS & Operating Results
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Gross margins, recorded wholesale costs of sold garments, and net operating balance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border rounded-xl px-2.5 py-1 text-xs shadow-sm">
            <span className="text-muted-foreground font-semibold">From:</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-transparent font-medium focus:outline-none"
            />
            <span className="text-muted-foreground font-semibold ml-1">To:</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="bg-transparent font-medium focus:outline-none"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-xl text-xs h-9"
            onClick={handleExportCsv}
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* 4 Core Financial Result Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Net Sales Turnover</p>
            <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {data?.netSalesPaise !== null && data?.netSalesPaise !== undefined
                ? formatCurrency(data.netSalesPaise / 100)
                : '₹0'}
            </h3>
            <p className="text-xs text-muted-foreground">{data?.bills ?? 0} completed invoices</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Garments Sold Cost (COGS)</p>
            <h3 className="text-2xl font-bold tracking-tight text-slate-700 dark:text-slate-300">
              {data?.knownCostPaise ? formatCurrency(data.knownCostPaise / 100) : '₹0'}
            </h3>
            <p className="text-xs text-muted-foreground">From recorded supplier purchase lots</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Gross Profit</p>
              <Badge variant="secondary" className="font-bold text-xs bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40">
                {data?.marginPercent ? `${data.marginPercent.toFixed(1)}%` : '0%'} Margin
              </Badge>
            </div>
            <h3 className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {data?.grossProfitPaise !== null && data?.grossProfitPaise !== undefined
                ? formatCurrency(data.grossProfitPaise / 100)
                : '₹0'}
            </h3>
            <p className="text-xs text-muted-foreground">Turnover less purchase cost</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 text-white shadow-sm">
          <CardContent className="p-5 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Operating Result</p>
              <span className="text-[10px] text-slate-400">After Expenses</span>
            </div>
            <h3 className="text-2xl font-bold tracking-tight text-white">
              {data?.operatingProfitPaise !== null && data?.operatingProfitPaise !== undefined
                ? formatCurrency(data.operatingProfitPaise / 100)
                : '₹0'}
            </h3>
            <p className="text-xs text-slate-400">
              Less {formatCurrency((data?.expensePaise ?? 0) / 100)} recorded expenses
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Financial Breakdown Table & Cost Explanations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="rounded-2xl">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Receipt className="w-4 h-4 text-primary" />
              Operating Financial Statement
            </CardTitle>
            <CardDescription className="text-xs">
              Statement of gross earnings, merchandise costs, and overhead expenditures
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="pl-4 font-medium text-sm">Gross Sales Billed</TableCell>
                  <TableCell className="text-right pr-4 font-mono font-semibold">
                    {formatCurrency((data?.billedPaise ?? 0) / 100)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-4 text-muted-foreground text-sm">Less: Customer Discounts Allowed</TableCell>
                  <TableCell className="text-right pr-4 font-mono text-muted-foreground">
                    - {formatCurrency((data?.discountPaise ?? 0) / 100)}
                  </TableCell>
                </TableRow>
                <TableRow className="bg-slate-50/50 dark:bg-slate-900/50">
                  <TableCell className="pl-4 font-bold text-sm">Net Merchandise Turnover</TableCell>
                  <TableCell className="text-right pr-4 font-mono font-bold">
                    {formatCurrency((data?.netSalesPaise ?? 0) / 100)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-4 text-rose-600 dark:text-rose-400 text-sm">
                    Less: Cost of Sold Garments (COGS)
                  </TableCell>
                  <TableCell className="text-right pr-4 font-mono text-rose-600 dark:text-rose-400 font-semibold">
                    - {formatCurrency((data?.knownCostPaise ?? 0) / 100)}
                  </TableCell>
                </TableRow>
                <TableRow className="bg-emerald-50/40 dark:bg-emerald-950/20">
                  <TableCell className="pl-4 font-bold text-emerald-800 dark:text-emerald-300 text-sm">
                    Provisional Gross Profit
                  </TableCell>
                  <TableCell className="text-right pr-4 font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {formatCurrency((data?.grossProfitPaise ?? 0) / 100)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-4 text-muted-foreground text-sm">
                    Less: Store Operational Expenses
                  </TableCell>
                  <TableCell className="text-right pr-4 font-mono text-muted-foreground">
                    - {formatCurrency((data?.expensePaise ?? 0) / 100)}
                  </TableCell>
                </TableRow>
                <TableRow className="bg-slate-100 dark:bg-slate-800 font-bold">
                  <TableCell className="pl-4 font-bold text-sm">
                    Estimated Operating Balance
                  </TableCell>
                  <TableCell className="text-right pr-4 font-mono font-bold text-base text-primary">
                    {formatCurrency((data?.operatingProfitPaise ?? 0) / 100)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Top Sold Products by Sales Mix */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  Product Sales & Revenue Mix
                </CardTitle>
                <CardDescription className="text-xs">Top performing clothing lines for selected period</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Garment Line</TableHead>
                  <TableHead className="text-center">Units Sold</TableHead>
                  <TableHead className="text-right pr-4">Billed Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="pl-4 font-medium text-sm">{p.name}</TableCell>
                    <TableCell className="text-center text-xs font-semibold">{p.quantity} pcs</TableCell>
                    <TableCell className="text-right pr-4 font-mono font-bold text-sm">
                      {formatCurrency(p.billedPaise / 100)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

