import React, { useState } from 'react';
import { seasonAlerts, type SeasonReminder, shiftDay } from '@/lib/forecastSeasons';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'react-hot-toast';
import { Calendar, Plus, Trash2, AlertCircle } from 'lucide-react';

export const ForecastSeasons: React.FC<{
  today: string;
  horizon: number;
  userId?: string;
}> = ({ today, horizon, userId = 'default' }) => {
  const key = `forecast-seasons-v1:${userId}`;
  const [custom, setCustom] = useState<SeasonReminder[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(saved)
        ? saved
            .filter(
              (r) =>
                typeof r.id === 'string' &&
                typeof r.name === 'string' &&
                r.name.length <= 80 &&
                r.date >= today &&
                /^\d{4}-\d{2}-\d{2}$/.test(r.date)
            )
            .slice(0, 50)
        : [];
    } catch {
      return [];
    }
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('Eid / Ramadan');
  const [date, setDate] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null);

  function save(rows: SeasonReminder[]) {
    try {
      localStorage.setItem(key, JSON.stringify(rows));
      setCustom(rows);
      return true;
    } catch {
      toast.error('Could not save planning dates on this device.');
      return false;
    }
  }

  function add() {
    if (
      !name.trim() ||
      name.length > 80 ||
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      date < today
    ) {
      toast.error('Enter a season name and a valid upcoming date.');
      return;
    }
    if (custom.length >= 50) {
      toast.error('Remove an older reminder before adding another.');
      return;
    }
    if (save([...custom, { id: crypto.randomUUID(), name: name.trim(), date }])) {
      setOpen(false);
      setName('');
      setDate('');
      toast.success('Season reminder saved.');
    }
  }

  const alerts = seasonAlerts(today, horizon, custom);

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 bg-white dark:bg-slate-900 shadow-sm">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-base flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            Seasonal Demand & Festival Planning Alerts
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upcoming high-demand retail periods within the {horizon}-month horizon. Reminders do not artificially inflate algorithmic forecasts.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5 rounded-xl text-xs h-8">
          <Plus className="w-3.5 h-3.5" />
          Add Seasonal Date
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-3 pt-1">
        {alerts.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 col-span-2">
            No active seasonal windows within the selected {horizon}-month horizon.
          </p>
        ) : (
          alerts.map((a) => {
            const isDue = shiftDay(a.start, -42) <= today;
            return (
              <div
                key={a.id}
                className="rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 p-4 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <strong className="text-sm font-bold text-amber-950 dark:text-amber-200">{a.name}</strong>
                  <span className="text-xs font-mono text-amber-800 dark:text-amber-300">
                    {a.start === a.end ? a.start : `${a.start.slice(0, 7)} to ${a.end.slice(0, 7)}`}
                  </span>
                </div>
                <p className="text-xs text-amber-900/90 dark:text-amber-300/80 leading-relaxed">{a.detail}</p>
                <div className="flex items-center justify-between pt-1 border-t border-amber-200/50 dark:border-amber-800/30">
                  <p className="text-[11px] font-medium text-amber-800 dark:text-amber-400">
                    {isDue ? '⚡ Preparation review is due now' : `Review by ${shiftDay(a.start, -42)}`}
                  </p>
                  {a.custom && (
                    <button
                      className="text-xs text-rose-600 hover:underline inline-flex items-center gap-1 font-medium"
                      onClick={() => setRemoveId(a.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Add Seasonal Planning Reminder" size="sm">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="seasonName">Festival or Season Name</Label>
            <Input
              id="seasonName"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Eid-ul-Fitr, Onam, Vishu"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="seasonDate">Confirmed Planning Date</Label>
            <Input
              id="seasonDate"
              type="date"
              min={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Religious festival dates vary locally. Adding dates here schedules reminders to evaluate inventory lead times 4–6 weeks prior.
          </p>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={add}>Save Reminder</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(removeId)}
        onClose={() => setRemoveId(null)}
        onConfirm={() => {
          if (save(custom.filter((r) => r.id !== removeId))) setRemoveId(null);
        }}
        title="Remove Season Reminder?"
        message="This will remove the seasonal planning alert from your dashboard view."
        confirmText="Remove"
        variant="danger"
      />
    </section>
  );
};

