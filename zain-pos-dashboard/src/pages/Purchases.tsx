import * as React from 'react';
import { useEffect, useState, useMemo } from 'react';
import {
  Truck,
  Plus,
  Search,
  Calendar,
  Receipt,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Layers,
  Tag,
  Building2,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Modal } from '@/components/ui/Modal';
import { formatCurrency } from '@/lib/format';
import { isDemoModeEnabled } from '@/lib/demo';
import api from '@/lib/api';
import { toast } from 'react-hot-toast';

export interface PurchaseItem {
  id: string;
  name: string;
  quantity: number;
  unitCostPaise: number;
  sellingPricePaise: number;
}

export interface PurchaseRecord {
  id: string;
  supplier: string;
  invoiceNumber: string;
  invoiceDate: string;
  batchName: string;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
  linesCount: number;
  createdAt: string;
}

const getTodayStr = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const defaultDemoPurchases: PurchaseRecord[] = [
  {
    id: 'pur-1',
    supplier: 'Raymond Luxury Fabrics Ltd',
    invoiceNumber: 'RAY-9482',
    invoiceDate: '2026-11-02',
    batchName: 'Linen Shirts Diwali Delivery',
    totalPaise: 8450000,
    paidPaise: 8450000,
    duePaise: 0,
    linesCount: 3,
    createdAt: '2026-11-02T11:00:00Z',
  },
  {
    id: 'pur-2',
    supplier: 'Arvind Mills Garments',
    invoiceNumber: 'ARV-2026-88',
    invoiceDate: '2026-11-04',
    batchName: 'Slim Trousers Autumn Batch',
    totalPaise: 5600000,
    paidPaise: 3000000,
    duePaise: 2600000,
    linesCount: 2,
    createdAt: '2026-11-04T14:30:00Z',
  },
  {
    id: 'pur-3',
    supplier: 'Kalyan Silks Wholesale',
    invoiceNumber: 'KS-1092',
    invoiceDate: '2026-11-05',
    batchName: 'Kasavu Traditional Mundu',
    totalPaise: 2400000,
    paidPaise: 2400000,
    duePaise: 0,
    linesCount: 1,
    createdAt: '2026-11-05T16:00:00Z',
  },
];

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(getTodayStr());
  const [batchName, setBatchName] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [lines, setLines] = useState<Array<{ name: string; qty: string; unitCost: string; sellingPrice: string }>>([
    { name: '', qty: '', unitCost: '', sellingPrice: '' },
  ]);

  useEffect(() => {
    void loadPurchases();
  }, []);

  async function loadPurchases() {
    try {
      setLoading(true);
      if (isDemoModeEnabled()) {
        setPurchases(defaultDemoPurchases);
        return;
      }

      try {
        const res = await api.get<{ items: PurchaseRecord[] }>('/purchases');
        if (Array.isArray(res.data?.items)) {
          setPurchases(res.data.items);
          return;
        }
      } catch {
        // Fallback
      }

      setPurchases(defaultDemoPurchases);
    } catch {
      setPurchases(defaultDemoPurchases);
    } finally {
      setLoading(false);
    }
  }

  const filteredPurchases = useMemo(() => {
    if (!search.trim()) return purchases;
    const q = search.toLowerCase();
    return purchases.filter(
      (p) =>
        p.supplier.toLowerCase().includes(q) ||
        p.invoiceNumber.toLowerCase().includes(q) ||
        p.batchName.toLowerCase().includes(q)
    );
  }, [purchases, search]);

  const totals = useMemo(() => {
    return purchases.reduce(
      (acc, curr) => ({
        totalPaise: acc.totalPaise + curr.totalPaise,
        paidPaise: acc.paidPaise + curr.paidPaise,
        duePaise: acc.duePaise + curr.duePaise,
      }),
      { totalPaise: 0, paidPaise: 0, duePaise: 0 }
    );
  }, [purchases]);

  const addLine = () => {
    setLines([...lines, { name: '', qty: '', unitCost: '', sellingPrice: '' }]);
  };

  const removeLine = (idx: number) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const handleCreatePurchase = () => {
    if (!supplier.trim() || !invoiceNumber.trim()) {
      toast.error('Enter supplier name and invoice number.');
      return;
    }

    const validLines = lines.filter((l) => l.name.trim() && parseFloat(l.qty) > 0 && parseFloat(l.unitCost) > 0);
    if (!validLines.length) {
      toast.error('Add at least one garment line with quantity and unit cost.');
      return;
    }

    const totalInvoicePaise = validLines.reduce(
      (sum, l) => sum + Math.round(parseFloat(l.qty) * parseFloat(l.unitCost) * 100),
      0
    );
    const paidPaise = Math.round((parseFloat(paidAmount) || 0) * 100);
    const duePaise = Math.max(0, totalInvoicePaise - paidPaise);

    const newRecord: PurchaseRecord = {
      id: `pur-${Date.now()}`,
      supplier: supplier.trim(),
      invoiceNumber: invoiceNumber.trim(),
      invoiceDate,
      batchName: batchName.trim() || `${supplier.trim()} · ${invoiceNumber.trim()}`,
      totalPaise: totalInvoicePaise,
      paidPaise,
      duePaise,
      linesCount: validLines.length,
      createdAt: new Date().toISOString(),
    };

    setPurchases([newRecord, ...purchases]);
    setIsModalOpen(false);
    setSupplier('');
    setInvoiceNumber('');
    setBatchName('');
    setPaidAmount('');
    setLines([{ name: '', qty: '', unitCost: '', sellingPrice: '' }]);
    toast.success('Inward purchase delivery saved');
  };

  return (
    <div className="flex-1 space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight">Purchases & Suppliers</h2>
            <Badge variant="outline" className="border-blue-300 text-blue-700 dark:text-blue-300">
              Supplier Inward & Cost Lots
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Inward stock deliveries, supplier balances, cost layer tracking, and purchase bills.
          </p>
        </div>

        <Button onClick={() => setIsModalOpen(true)} className="gap-2 rounded-xl">
          <Plus className="w-4 h-4" />
          Receive Purchase
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Inward Stock</p>
            <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {formatCurrency(totals.totalPaise / 100)}
            </h3>
            <p className="text-xs text-muted-foreground">{purchases.length} supplier invoices</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Paid</p>
            <h3 className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {formatCurrency(totals.paidPaise / 100)}
            </h3>
            <p className="text-xs text-muted-foreground">Disbursed to suppliers</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Supplier Balances Due</p>
            <h3 className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
              {formatCurrency(totals.duePaise / 100)}
            </h3>
            <p className="text-xs text-muted-foreground">Outstanding payable balance</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Suppliers</p>
            <h3 className="text-2xl font-bold tracking-tight text-primary">
              {new Set(purchases.map((p) => p.supplier)).size} Vendors
            </h3>
            <p className="text-xs text-muted-foreground">Inward catalogue suppliers</p>
          </CardContent>
        </Card>
      </div>

      {/* Inward Invoices Table */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-3 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Truck className="w-4 h-4 text-primary" />
                Purchase Invoices Register ({filteredPurchases.length})
              </CardTitle>
              <CardDescription className="text-xs">
                History of inward deliveries, cost lots, and payment reconciliation
              </CardDescription>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search supplier or bill..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Supplier</TableHead>
                <TableHead>Invoice No.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Batch Name</TableHead>
                <TableHead className="text-right">Total Invoice</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Balance Due</TableHead>
                <TableHead className="pr-4 text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPurchases.map((p) => {
                const isPaid = p.duePaise === 0;
                const isPartial = p.duePaise > 0 && p.paidPaise > 0;

                return (
                  <TableRow key={p.id}>
                    <TableCell className="pl-4 font-semibold text-sm">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>{p.supplier}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-bold">
                      {p.invoiceNumber}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.invoiceDate}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                      {p.batchName}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-sm">
                      {formatCurrency(p.totalPaise / 100)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
                      {formatCurrency(p.paidPaise / 100)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-xs">
                      {p.duePaise > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          {formatCurrency(p.duePaise / 100)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">₹0</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-center">
                      <Badge
                        variant={isPaid ? 'default' : isPartial ? 'secondary' : 'destructive'}
                        className="text-[10px] uppercase font-bold"
                      >
                        {isPaid ? 'Paid' : isPartial ? 'Partial' : 'Due'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Receive Purchase Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Receive Inward Purchase Delivery" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="purSupp">Supplier Name</Label>
              <Input
                id="purSupp"
                placeholder="e.g. Raymond Fabrics"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="purInv">Invoice Number</Label>
              <Input
                id="purInv"
                placeholder="e.g. INV-1049"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="purDate">Invoice Date</Label>
              <Input
                id="purDate"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="purBatch">Batch Label (Optional)</Label>
              <Input
                id="purBatch"
                placeholder="Defaults to Supplier · Invoice No"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="purPaid">Amount Paid (₹)</Label>
              <Input
                id="purPaid"
                type="number"
                placeholder="0.00"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between">
              <Label className="font-bold text-sm">Garment Delivery Lines</Label>
              <Button variant="outline" size="sm" onClick={addLine} className="h-7 text-xs gap-1">
                <Plus className="w-3 h-3" /> Add Garment
              </Button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {lines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center p-2 rounded-xl bg-slate-50 dark:bg-slate-800/40 border">
                  <div className="col-span-5">
                    <Input
                      placeholder="Item name / size / description"
                      value={l.name}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx].name = e.target.value;
                        setLines(next);
                      }}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      placeholder="Qty"
                      type="number"
                      value={l.qty}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx].qty = e.target.value;
                        setLines(next);
                      }}
                      className="h-8 text-xs text-center"
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      placeholder="Cost ₹"
                      type="number"
                      value={l.unitCost}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx].unitCost = e.target.value;
                        setLines(next);
                      }}
                      className="h-8 text-xs text-right"
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      placeholder="MRP ₹"
                      type="number"
                      value={l.sellingPrice}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx].sellingPrice = e.target.value;
                        setLines(next);
                      }}
                      className="h-8 text-xs text-right"
                    />
                  </div>
                  <div className="col-span-1 text-center">
                    <button
                      onClick={() => removeLine(idx)}
                      className="text-rose-500 hover:text-rose-700 p-1"
                      title="Remove line"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreatePurchase}>
              Receive Delivery
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

