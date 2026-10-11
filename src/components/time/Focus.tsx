import { useEffect, useRef, useState } from 'react';
import { Square, Timer, X } from 'lucide-react';
import { TIME_CATEGORIES, type FocusSession, type TimeCategory } from '@/lib/types';
import { cn, errorMessage, formatMinutes } from '@/lib/utils';
import { useSettings } from '@/data/settings';
import { useTasks } from '@/data/tasks';
import { useCompanies } from '@/data/organization';
import { useFinishFocus, useRunningFocus, useStartFocus } from '@/data/time';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useUi } from '@/components/shell/ui-context';

function remainingMs(s: FocusSession, now: number) {
  return new Date(s.started_at).getTime() + s.planned_minutes * 60_000 - now;
}

function fmtClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function FocusIndicator() {
  const { data: session } = useRunningFocus();
  const finish = useFinishFocus();
  const toast = useToast();
  const { openFocus } = useUi();
  const now = useNow(!!session);
  const finishing = useRef<string | null>(null);

  const remaining = session ? remainingMs(session, now) : 0;

  useEffect(() => {
    if (!session || remaining > 0 || finishing.current === session.id) return;
    finishing.current = session.id;
    finish
      .mutateAsync({ session, outcome: 'completed' })
      .then((r) => r.logged && toast(`Focus complete. ${formatMinutes(r.logged)} added to your hours.`))
      .catch((e) => toast(errorMessage(e), 'error'));
  }, [session, remaining, finish, toast]);

  useEffect(() => {
    const base = 'CIO Command Console';
    document.title = session && remaining > 0 ? `${fmtClock(remaining)} · Focus · ${base}` : base;
  }, [session, remaining]);

  if (!session) {
    return (
      <Button size="sm" variant="ghost" onClick={openFocus} title="Start focus (F)">
        <Timer />
        <span className="hidden xl:inline">Focus</span>
      </Button>
    );
  }

  const pct = Math.min(100, 100 - (remaining / (session.planned_minutes * 60_000)) * 100);
  return (
    <div className="flex h-8 items-center gap-1 rounded-md border border-accent-500/40 bg-accent-500/10 pl-2 pr-1 text-accent-800 dark:text-accent-300">
      <div className="relative size-4" aria-hidden>
        <svg viewBox="0 0 20 20" className="-rotate-90">
          <circle cx="10" cy="10" r="8" className="fill-none stroke-current opacity-25" strokeWidth="3" />
          <circle cx="10" cy="10" r="8" className="fill-none stroke-current transition-all" strokeWidth="3" strokeDasharray={50.3} strokeDashoffset={50.3 - (50.3 * pct) / 100} />
        </svg>
      </div>
      <span className="font-mono text-sm font-medium tabular-nums" aria-live="off">{fmtClock(remaining)}</span>
      <span className="hidden max-w-[140px] truncate text-xs lg:inline">{session.label ?? 'Focus'}</span>
      <button
        className="rounded p-1 hover:bg-accent-500/20"
        title="Finish now and log time"
        aria-label="Finish focus now and log time"
        onClick={() => {
          finishing.current = session.id;
          finish.mutateAsync({ session, outcome: 'completed' }).then((r) => toast(`Logged ${formatMinutes(r.logged)}`)).catch((e) => toast(errorMessage(e), 'error'));
        }}
      >
        <Square className="size-3.5" />
      </button>
      <button
        className="rounded p-1 hover:bg-accent-500/20"
        title="Cancel without logging"
        aria-label="Cancel focus without logging"
        onClick={() => {
          finishing.current = session.id;
          finish.mutateAsync({ session, outcome: 'cancelled' }).then(() => toast('Focus cancelled. Nothing logged.', 'info')).catch((e) => toast(errorMessage(e), 'error'));
        }}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function FocusStartDialog() {
  const { state, close } = useUi();
  const { data: settings } = useSettings();
  const { data: tasks = [] } = useTasks();
  const { data: companies = [] } = useCompanies();
  const { data: running } = useRunningFocus();
  const start = useStartFocus();
  const toast = useToast();
  const [taskId, setTaskId] = useState('');
  const [label, setLabel] = useState('');
  const [minutes, setMinutes] = useState<number | null>(null);
  const [category, setCategory] = useState<TimeCategory>('development');
  const [companyId, setCompanyId] = useState('');

  const open = state.focus;
  const planned = minutes ?? settings?.focus_minutes ?? 25;
  const openTasks = tasks.filter((t) => t.status !== 'done');

  async function begin() {
    const task = tasks.find((t) => t.id === taskId);
    try {
      await start.mutateAsync({
        task_id: task?.id ?? null,
        label: task?.title ?? (label.trim() || null),
        category,
        company_id: companyId || task?.company_id || null,
        planned_minutes: planned,
      });
      toast(`Focus started for ${formatMinutes(planned)}`);
      close('focus');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close('focus')} title="Start focus" description="When the timer finishes, the time is logged to your hours automatically.">
      {running ? (
        <p className="text-sm text-muted">A focus session is already running. Use the timer in the top bar to finish or cancel it.</p>
      ) : (
        <div className="space-y-3">
          <Field label="Task">
            <Select value={taskId} onChange={(e) => {
              setTaskId(e.target.value);
              const t = tasks.find((x) => x.id === e.target.value);
              if (t?.company_id) setCompanyId(t.company_id);
            }}>
              <option value="">No task (free focus)</option>
              {openTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </Select>
          </Field>
          {!taskId && (
            <Field label="Label">
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What are you focusing on?" />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Select value={category} onChange={(e) => setCategory(e.target.value as TimeCategory)}>
                {TIME_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Company">
              <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">None</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          <div>
            <span className="label">Length</span>
            <div className="flex flex-wrap gap-1.5">
              {[15, 25, 45, 50, 90].map((m) => (
                <Button key={m} size="sm" variant={planned === m ? 'primary' : 'secondary'} onClick={() => setMinutes(m)}>{m} min</Button>
              ))}
              <input
                type="number"
                min={1}
                max={180}
                className={cn('input h-8 w-20 font-mono')}
                value={planned}
                onChange={(e) => setMinutes(Math.max(1, Math.min(180, Number(e.target.value) || 1)))}
                aria-label="Custom minutes"
              />
            </div>
          </div>
          <Button variant="primary" className="w-full" onClick={begin} disabled={start.isPending}>
            <Timer /> Start {planned}-minute focus
          </Button>
        </div>
      )}
    </Dialog>
  );
}
