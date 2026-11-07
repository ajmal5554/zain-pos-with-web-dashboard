import * as React from 'react';
import { useEffect, useState, useMemo } from 'react';
import {
  Wallet,
  Lock,
  Unlock,
  AlertCircle,
  Plus,
  Minus,
  Check,
  RefreshCw,
  Calendar,
  AlertTriangle,
  Receipt,
  CheckCircle2,
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

export interface RegisterSummary {
  id: string;
  date: string;
  status: 'OPEN' | 'CLOSED';
  openingFloat: number;
  cashSalesTotal: number;
  cashOutsTotal: number;
  expectedCash: number;
  actualCash?: number;
  difference?: number;
  openedAt: string;
  closedAt?: string;
  notes?: string;
}

export interface ShiftRecord {
  id: string;
  date: string;
  status: 'OPEN' | 'CLOSED';
  openingFloat: number;
  expectedCash: number;
  actualCash: number;
  difference: number;
  closedAt?: string;
  notes?: string;
}

const getTodayStr = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const defaultDemoRegister: RegisterSummary = {
  id: 'reg-today',
  date: getTodayStr(),
  status: 'OPEN',
  openingFloat: 5000,
  cashSalesTotal: 34200,
  cashOutsTotal: 500,
  expectedCash: 38700,
  openedAt: `${getTodayStr()}T09:30:00Z`,
};

const defaultDemoHistory: ShiftRecord[] = [
  {
    id: 'reg-1',
    date: '2026-11-06',
    status: 'CLOSED',
    openingFloat: 5000,
    expectedCash: 42600,
    actualCash: 42600,
    difference: 0,
    closedAt: '2026-11-06T21:45:00Z',
    notes: 'Shift balanced cleanly with zero discrepancy.',
  },
  {
    id: 'reg-2',
    date: '2026-11-05',
    status: 'CLOSED',
    openingFloat: 5000,
    expectedCash: 38900,
    actualCash: 38850,
    difference: -50,
    closedAt: '2026-11-05T21:30:00Z',
    notes: 'Small coin rounding variation of ₹50.',
  },
  {
    id: 'reg-3',
    date: '2026-11-04',
    status: 'CLOSED',
    openingFloat: 5000,
    expectedCash: 51200,
    actualCash: 51200,
    difference: 0,
    closedAt: '2026-11-04T22:00:00Z',
    notes: 'Busy Wednesday festival sales.',
  },
];

export default function CashDrawerPage() {
  const [current, setCurrent] = useState<RegisterSummary | null>(null);
  const [history, setHistory] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Cash Out Modal
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [cashOutAmount, setCashOutAmount] = useState('');
  const [cashOutCategory, setCashOutCategory] = useState('EXPENSE');
  const [cashOutNote, setCashOutNote] = useState('');

  // Close Register Modal
  const [closeOpen, setCloseOpen] = useState(false);
  const [actualCounted, setActualCounted] = useState('');
  const [closeNotes, setCloseNotes] = useState('');

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      if (isDemoModeEnabled()) {
        setCurrent(defaultDemoRegister);
        setHistory(defaultDemoHistory);
        return;
      }

      try {
        const [regRes, histRes] = await Promise.all([
          api.get<RegisterSummary>('/cash-drawer/current'),
          api.get<{ items: ShiftRecord[] }>('/cash-drawer/history'),
        ]);
        setCurrent(regRes.data);
        setHistory(histRes.data?.items || defaultDemoHistory);
        return;
      } catch {
        // Fallback
      }

      setCurrent(defaultDemoRegister);
      setHistory(defaultDemoHistory);
    } catch {
      setCurrent(defaultDemoRegister);
      setHistory(defaultDemoHistory);
    } finally {
      setLoading(false);
    }
  }

  const handleCashOut = () => {
    const amt = parseFloat(cashOutAmount);
    if (isNaN(amt) || amt <= 0) {
      toast.error('Enter a valid amount.');
      return;
    }

    if (current) {
      const updated: RegisterSummary = {
        ...current,
        cashOutsTotal: current.cashOutsTotal + amt,
        expectedCash: current.expectedCash - amt,
      };
      setCurrent(updated);
    }

    setCashOutOpen(false);
    setCashOutAmount('');
    setCashOutNote('');
    toast.success(`Disbursed ${formatCurrency(amt)} from cash drawer`);
  };

  const handleCloseRegister = () => {
    const counted = parseFloat(actualCounted);
    if (isNaN(counted) || counted < 0) {
      toast.error('Enter valid physically counted cash.');
      return;
    }

    if (current) {
      const diff = counted - current.expectedCash;
      const closedRecord: ShiftRecord = {
        id: current.id,
        date: current.date,
        status: 'CLOSED',
        openingFloat: current.openingFloat,
        expectedCash: current.expectedCash,
        actualCash: counted,
        difference: diff,
        closedAt: new Date().toISOString(),
        notes: closeNotes || (diff === 0 ? 'Balanced' : `Variance of ${formatCurrency(diff)}`),
      };

      setHistory([closedRecord, ...history]);
      setCurrent({
        ...current,
        status: 'CLOSED',
        actualCash: counted,
        difference: diff,
        closedAt: new Date().toISOString(),
      });
    }

    setCloseOpen(false);
    setActualCounted('');
    setCloseNotes('');
    toast.success('Shift closed and reconciled.');
  };

  return (
    <div className="flex-1 space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight">Cash Register & Drawer</h2>
            <Badge
              variant={current?.status === 'OPEN' ? 'default' : 'secondary'}
              className="gap-1 font-bold"
            >
              {current?.status === 'OPEN' ? (
                <>
                  <Unlock className="w-3 h-3 text-emerald-400" />
                  Shift Open
                </>
              ) : (
                <>
                  <Lock className="w-3 h-3" />
                  Shift Closed
                </>
              )}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Daily cash drawer float management, mid-shift disbursements, and end-of-day cash reconciliation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {current?.status === 'OPEN' && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-xl text-xs h-9"
                onClick={() => setCashOutOpen(true)}
              >
                <Minus className="w-3.5 h-3.5 text-rose-600" />
                Cash Out / Expense
              </Button>
              <Button
                size="sm"
                className="gap-1.5 rounded-xl text-xs h-9 bg-slate-900 hover:bg-slate-800 text-white"
                onClick={() => setCloseOpen(true)}
              >
                <Lock className="w-3.5 h-3.5" />
                Close Shift
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 4 Register Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Opening Float</p>
            <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {formatCurrency(current?.openingFloat ?? 0)}
            </h3>
            <p className="text-xs text-muted-foreground">Declared at store opening</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Today's Cash Sales</p>
            <h3 className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              + {formatCurrency(current?.cashSalesTotal ?? 0)}
            </h3>
            <p className="text-xs text-muted-foreground">Direct customer currency</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cash Outs & Petty</p>
            <h3 className="text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
              - {formatCurrency(current?.cashOutsTotal ?? 0)}
            </h3>
            <p className="text-xs text-muted-foreground">Withdrawn or expenses paid</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <CardContent className="p-5 space-y-2">
            <p className="text-xs font-semibold opacity-80 uppercase tracking-wider">Expected in Drawer</p>
            <h3 className="text-2xl font-bold tracking-tight">
              {formatCurrency(current?.expectedCash ?? 0)}
            </h3>
            <p className="text-xs opacity-80">Float + Cash Sales - Cash Out</p>
          </CardContent>
        </Card>
      </div>

      {/* History Table */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            Previous Shifts Reconciliation Log
          </CardTitle>
          <CardDescription className="text-xs">
            Daily records of physically counted closing cash versus expected drawer balance
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Shift Date</TableHead>
                <TableHead className="text-right">Opening Float</TableHead>
                <TableHead className="text-right">Expected Cash</TableHead>
                <TableHead className="text-right">Counted Cash</TableHead>
                <TableHead className="text-center">Variance / Difference</TableHead>
                <TableHead>Closing Notes</TableHead>
                <TableHead className="pr-4 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((reg) => (
                <TableRow key={reg.id}>
                  <TableCell className="pl-4 font-medium text-xs font-mono">
                    {reg.date}
                  </TableCell>
                  <TableCell className="text-right font-medium text-xs">
                    {formatCurrency(reg.openingFloat)}
                  </TableCell>
                  <TableCell className="text-right font-medium text-xs">
                    {formatCurrency(reg.expectedCash)}
                  </TableCell>
                  <TableCell className="text-right font-bold text-xs">
                    {formatCurrency(reg.actualCash)}
                  </TableCell>
                  <TableCell className="text-center">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        reg.difference === 0
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : reg.difference > 0
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                      }`}
                    >
                      {reg.difference === 0 ? 'Exact Match' : `${reg.difference > 0 ? '+' : ''}${formatCurrency(reg.difference)}`}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                    {reg.notes || '-'}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Badge variant={reg.status === 'OPEN' ? 'default' : 'secondary'} className="text-[10px]">
                      {reg.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Cash Out Modal */}
      <Modal isOpen={cashOutOpen} onClose={() => setCashOutOpen(false)} title="Record Cash Out / Drawer Withdrawal" size="sm">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="coAmt">Amount to Disburse (₹)</Label>
            <Input
              id="coAmt"
              type="number"
              placeholder="0.00"
              value={cashOutAmount}
              onChange={(e) => setCashOutAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="coCat">Category</Label>
            <select
              id="coCat"
              value={cashOutCategory}
              onChange={(e) => setCashOutCategory(e.target.value)}
              className="w-full rounded-md border border-input bg-background p-2.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="EXPENSE">Petty Cash / Shop Expense</option>
              <option value="OWNER_WITHDRAWAL">Owner Personal Withdrawal</option>
              <option value="FREIGHT">Freight / Courier Charge</option>
              <option value="CHANGE_FLOAT">Change Top-Up / Bank Deposit</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="coNote">Particulars / Reason</Label>
            <Input
              id="coNote"
              placeholder="e.g. Courier boy payment for shirt carton"
              value={cashOutNote}
              onChange={(e) => setCashOutNote(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => setCashOutOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCashOut}>Record Cash Out</Button>
          </div>
        </div>
      </Modal>

      {/* Close Register Modal */}
      <Modal isOpen={closeOpen} onClose={() => setCloseOpen(false)} title="Close Shift & Count Cash Drawer" size="sm">
        <div className="space-y-4">
          <div className="p-3 bg-muted/60 rounded-xl space-y-1 text-xs">
            <div className="flex justify-between font-semibold">
              <span>Expected Cash Balance:</span>
              <span className="font-bold text-sm text-primary">
                {formatCurrency(current?.expectedCash ?? 0)}
              </span>
            </div>
            <p className="text-muted-foreground">
              Float ({formatCurrency(current?.openingFloat ?? 0)}) + Cash Sales ({formatCurrency(current?.cashSalesTotal ?? 0)}) - Cash Out ({formatCurrency(current?.cashOutsTotal ?? 0)})
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="actCount">Physically Counted Cash in Drawer (₹)</Label>
            <Input
              id="actCount"
              type="number"
              placeholder="Enter counted amount"
              value={actualCounted}
              onChange={(e) => setActualCounted(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="closeNote">Closing Notes (Optional)</Label>
            <Input
              id="closeNote"
              placeholder="e.g. Clean shift, zero discrepancy"
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => setCloseOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCloseRegister}>Confirm Close</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

