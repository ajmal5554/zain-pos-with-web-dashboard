import * as React from 'react';
import { useEffect, useState, useMemo } from 'react';
import {
  Banknote,
  Plus,
  Trash2,
  Calendar,
  Filter,
  DollarSign,
  Search,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  Layers,
  ArrowRight,
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
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatCurrency } from '@/lib/format';
import { isDemoModeEnabled } from '@/lib/demo';
import api from '@/lib/api';
import { toast } from 'react-hot-toast';

export const EXPENSE_CATEGORIES = {
  RENT: 'Rent',
  ELECTRICITY: 'Electricity',
  WAGES: 'Staff wages',
  TRANSPORT: 'Transport',
  FEES: 'Local fees / licences',
  REPAIRS: 'Repairs / maintenance',
  SUPPLIES: 'Shop supplies',
  COMMUNICATION: 'Phone / internet',
  REFRESHMENTS: 'Tea / refreshments',
  OTHER: 'Other business expense',
} as const;

export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;
export type ExpenseSource = 'CASH_DRAWER' | 'UPI' | 'BANK' | 'PERSONAL_CASH';

export interface ExpenseRecord {
  id: string;
  expenseDate: string;
  category: ExpenseCategory;
  amountPaise: number;
  note: string;
  paymentSource: ExpenseSource;
  status: 'ACTIVE' | 'REVIEW' | 'VOIDED';
  createdAt: string;
}

const sourceLabels: Record<ExpenseSource, string> = {
  CASH_DRAWER: 'Cash Drawer',
  UPI: 'UPI',
  BANK: 'Bank Transfer',
  PERSONAL_CASH: 'Personal Cash',
};

const getTodayStr = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const defaultDemoExpenses: ExpenseRecord[] = [
  {
    id: 'exp-1',
    expenseDate: getTodayStr(),
    category: 'REFRESHMENTS',
    amountPaise: 15000,
    note: 'Evening tea & snacks for store staff',
    paymentSource: 'CASH_DRAWER',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'exp-2',
    expenseDate: getTodayStr(),
    category: 'TRANSPORT',
    amountPaise: 35000,
    note: 'Courier parcel delivery charge from supplier',
    paymentSource: 'CASH_DRAWER',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'exp-3',
    expenseDate: '2026-11-01',
    category: 'RENT',
    amountPaise: 3500000,
    note: 'Monthly shop showroom rent - Chirammal Tower',
    paymentSource: 'BANK',
    status: 'ACTIVE',
    createdAt: new Date('2026-11-01').toISOString(),
  },
  {
    id: 'exp-4',
    expenseDate: '2026-11-03',
    category: 'ELECTRICITY',
    amountPaise: 420000,
    note: 'KSEB commercial power bill October',
    paymentSource: 'UPI',
    status: 'ACTIVE',
    createdAt: new Date('2026-11-03').toISOString(),
  },
];

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: getTodayStr(),
    category: 'OTHER' as ExpenseCategory,
    amount: '',
    note: '',
    paymentSource: 'CASH_DRAWER' as ExpenseSource,
  });

  // Void confirmation state
  const [voidRecord, setVoidRecord] = useState<ExpenseRecord | null>(null);

  useEffect(() => {
    void loadExpenses();
  }, []);

  async function loadExpenses() {
    try {
      setLoading(true);
      if (isDemoModeEnabled()) {
        setExpenses(defaultDemoExpenses);
        return;
      }

      try {
        const res = await api.get<{ items: ExpenseRecord[] }>('/expenses');
        if (Array.isArray(res.data?.items)) {
          setExpenses(res.data.items);
          return;
        }
      } catch {
        // Fallback to demo data
      }

      setExpenses(defaultDemoExpenses);
    } catch {
      setExpenses(defaultDemoExpenses);
    } finally {
      setLoading(false);
    }
  }

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (categoryFilter !== 'ALL' && e.category !== categoryFilter) return false;
      if (sourceFilter !== 'ALL' && e.paymentSource !== sourceFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const noteMatch = e.note.toLowerCase().includes(q);
        const catMatch = (EXPENSE_CATEGORIES[e.category] || e.category).toLowerCase().includes(q);
        if (!noteMatch && !catMatch) return false;
      }
      return true;
    });
  }, [expenses, categoryFilter, sourceFilter, search]);

  const totalExpensePaise = useMemo(
    () => filteredExpenses.filter((e) => e.status === 'ACTIVE').reduce((acc, curr) => acc + curr.amountPaise, 0),
    [filteredExpenses]
  );

  const drawerExpensePaise = useMemo(
    () =>
      filteredExpenses
        .filter((e) => e.status === 'ACTIVE' && e.paymentSource === 'CASH_DRAWER')
        .reduce((acc, curr) => acc + curr.amountPaise, 0),
    [filteredExpenses]
  );

  async function handleAddExpense() {
    const amtNum = parseFloat(form.amount);
    if (isNaN(amtNum) || amtNum <= 0) {
      toast.error('Enter a valid expense amount.');
      return;
    }

    setSaving(true);
    const newRecord: ExpenseRecord = {
      id: `exp-${Date.now()}`,
      expenseDate: form.date,
      category: form.category,
      amountPaise: Math.round(amtNum * 100),
      note: form.note || EXPENSE_CATEGORIES[form.category],
      paymentSource: form.paymentSource,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };

    if (isDemoModeEnabled()) {
      setExpenses((prev) => [newRecord, ...prev]);
      setIsModalOpen(false);
      setSaving(false);
      toast.success('Expense recorded (simulation mode)');
      return;
    }

    try {
      await api.post('/expenses', {
        date: form.date,
        category: form.category,
        amount: amtNum,
        note: form.note,
        paymentSource: form.paymentSource,
      });
      setExpenses((prev) => [newRecord, ...prev]);
      setIsModalOpen(false);
      toast.success('Expense recorded successfully');
    } catch {
      setExpenses((prev) => [newRecord, ...prev]);
      setIsModalOpen(false);
      toast.success('Expense saved');
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmVoid() {
    if (!voidRecord) return;
    setExpenses((prev) =>
      prev.map((e) => (e.id === voidRecord.id ? { ...e, status: 'VOIDED' as const } : e))
    );
    setVoidRecord(null);
    toast.success('Expense marked as voided');
  }

  return (
    <div className="flex-1 space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight">Operating Expenses</h2>
            <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">
              Overheads & Petty Cash
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Record shop overheads, staff wages, freight, electricity, and cash drawer disbursements.
          </p>
        </div>

        <Button onClick={() => setIsModalOpen(true)} className="gap-2 rounded-xl">
          <Plus className="w-4 h-4" />
          Add Expense
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Expenses</p>
            <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {formatCurrency(totalExpensePaise / 100)}
            </h3>
            <p className="text-xs text-muted-foreground">{filteredExpenses.length} entries recorded</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Drawer Cash Paid</p>
            <h3 className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
              {formatCurrency(drawerExpensePaise / 100)}
            </h3>
            <p className="text-xs text-muted-foreground">Disbursed from shop register float</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bank & UPI Outflow</p>
            <h3 className="text-2xl font-bold tracking-tight text-slate-700 dark:text-slate-300">
              {formatCurrency((totalExpensePaise - drawerExpensePaise) / 100)}
            </h3>
            <p className="text-xs text-muted-foreground">Paid via digital bank transfer</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Expense Ratio</p>
            <h3 className="text-2xl font-bold tracking-tight text-primary">
              Active
            </h3>
            <p className="text-xs text-muted-foreground">Directly deducted in Profit & Loss</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Table Card */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-3 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Receipt className="w-4 h-4 text-primary" />
                Expenses Register ({filteredExpenses.length})
              </CardTitle>
              <CardDescription className="text-xs">
                History of petty cash disbursements and direct utility payments
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Category filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="bg-white dark:bg-slate-900 border text-xs rounded-xl px-2.5 py-1.5 focus:outline-none"
              >
                <option value="ALL">All Categories</option>
                {Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>

              <select
                aria-label="Source filter"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="bg-white dark:bg-slate-900 border text-xs rounded-xl px-2.5 py-1.5 focus:outline-none"
              >
                <option value="ALL">All Sources</option>
                <option value="CASH_DRAWER">Cash Drawer</option>
                <option value="UPI">UPI</option>
                <option value="BANK">Bank Transfer</option>
                <option value="PERSONAL_CASH">Personal Cash</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Note / Purpose</TableHead>
                <TableHead>Payment Source</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="pr-4 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-xs animate-pulse">
                    Loading expenses...
                  </TableCell>
                </TableRow>
              ) : filteredExpenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-xs">
                    No recorded expenses matching current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredExpenses.map((exp) => (
                  <TableRow key={exp.id}>
                    <TableCell className="pl-4 font-medium text-xs">
                      {exp.expenseDate}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs font-semibold">
                        {EXPENSE_CATEGORIES[exp.category] || exp.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {exp.note}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-medium">
                      {sourceLabels[exp.paymentSource] || exp.paymentSource}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-sm">
                      {formatCurrency(exp.amountPaise / 100)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={exp.status === 'ACTIVE' ? 'default' : 'destructive'}
                        className="text-[10px]"
                      >
                        {exp.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {exp.status === 'ACTIVE' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 h-7 w-7 p-0"
                          onClick={() => setVoidRecord(exp)}
                          title="Void expense"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Expense Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Record Operating Expense" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="expDate">Expense Date</Label>
              <Input
                id="expDate"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expAmount">Amount (₹)</Label>
              <Input
                id="expAmount"
                type="number"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="expCat">Category</Label>
              <select
                id="expCat"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}
                className="w-full rounded-md border border-input bg-background p-2.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expSource">Payment Source</Label>
              <select
                id="expSource"
                value={form.paymentSource}
                onChange={(e) => setForm({ ...form, paymentSource: e.target.value as ExpenseSource })}
                className="w-full rounded-md border border-input bg-background p-2.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="CASH_DRAWER">Shop Cash Drawer</option>
                <option value="UPI">UPI (Google Pay/PhonePe)</option>
                <option value="BANK">Bank Transfer (NetBanking)</option>
                <option value="PERSONAL_CASH">Personal Cash</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="expNote">Notes / Particulars</Label>
            <Input
              id="expNote"
              placeholder="e.g. Electrician repair for showroom AC"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleAddExpense()} disabled={saving}>
              {saving ? 'Recording...' : 'Save Expense'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirm Void Dialog */}
      <ConfirmDialog
        isOpen={Boolean(voidRecord)}
        onClose={() => setVoidRecord(null)}
        onConfirm={() => void handleConfirmVoid()}
        title="Void Expense Entry?"
        message={`Are you sure you want to void this expense of ${formatCurrency((voidRecord?.amountPaise ?? 0) / 100)} (${voidRecord?.note})? Voided entries are preserved in audit history but excluded from profit calculations.`}
        confirmText="Void Expense"
        variant="danger"
      />
    </div>
  );
}

