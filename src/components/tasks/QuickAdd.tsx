import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CalendarDays, CornerDownLeft, Flag, Hash, Building2, Repeat, Fingerprint } from 'lucide-react';
import { format } from 'date-fns';
import { parseQuickAdd, type ParsedTask } from '@/lib/quick-add';
import { IDENTITIES, PRIORITIES, RECURRENCES, type Identity, type Priority, type Recurrence } from '@/lib/types';
import { cn, fromDateKey, errorMessage } from '@/lib/utils';
import { useCompanies } from '@/data/organization';
import { useCreateTask } from '@/data/tasks';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

type Overrides = Partial<Omit<ParsedTask, 'title' | 'unknownCompany'>>;

function Chip({ icon, active, children }: { icon: ReactNode; active: boolean; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors [&_svg]:size-3.5', active ? 'border-primary-500/50 bg-primary-500/10 text-fg' : 'border-line text-subtle')}>
      {icon}
      {children}
    </span>
  );
}

const chipInput = 'bg-transparent text-xs focus:outline-none [color-scheme:inherit] cursor-pointer';

export function QuickAdd({ autoFocus, defaultDue, onCreated }: { autoFocus?: boolean; defaultDue?: string; onCreated?: () => void }) {
  const [text, setText] = useState('');
  const [overrides, setOverrides] = useState<Overrides>(defaultDue ? { due_date: defaultDue } : {});
  const { data: companies = [] } = useCompanies();
  const create = useCreateTask();
  const toast = useToast();

  const parsed = useMemo(() => parseQuickAdd(text, companies), [text, companies]);
  const final = { ...parsed, ...overrides };
  const set = (patch: Overrides) => setOverrides((o) => ({ ...o, ...patch }));

  async function save() {
    if (!final.title.trim()) return;
    const company = companies.find((c) => c.id === final.company_id);
    try {
      await create.mutateAsync({
        title: final.title.trim(),
        due_date: final.due_date,
        priority: final.priority,
        category: final.category,
        company_id: final.company_id,
        identity: final.identity ?? company?.identity ?? null,
        recurrence: final.recurrence,
        status: final.priority && final.due_date ? 'ready' : 'backlog',
      });
      toast(`Task added: ${final.title.trim()}`);
      setText('');
      setOverrides(defaultDue ? { due_date: defaultDue } : {});
      onCreated?.();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          autoFocus={autoFocus}
          className="input h-10 font-medium"
          placeholder="Renew encountive.com domain fri !high #IT @Encountive"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          aria-label="Quick add task"
        />
        <Button variant="primary" className="h-10" onClick={save} disabled={!final.title.trim() || create.isPending}>
          <CornerDownLeft />
          Add
        </Button>
      </div>
      {text.trim() && (
        <div className="flex flex-wrap items-center gap-1.5 animate-fade-in">
          <span className="mr-1 text-xs text-subtle">Will save as</span>
          <Chip icon={<CalendarDays />} active={!!final.due_date}>
            <input type="date" className={chipInput} value={final.due_date ?? ''} onChange={(e) => set({ due_date: e.target.value || null })} aria-label="Due date" />
            {final.due_date && <span className="text-subtle">{format(fromDateKey(final.due_date), 'EEE')}</span>}
          </Chip>
          <Chip icon={<Flag />} active={!!final.priority}>
            <select className={chipInput} value={final.priority ?? ''} onChange={(e) => set({ priority: (e.target.value || null) as Priority | null })} aria-label="Priority">
              <option value="">No priority</option>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Chip>
          <Chip icon={<Hash />} active={!!final.category}>
            <input className={cn(chipInput, 'w-20')} placeholder="category" value={final.category ?? ''} onChange={(e) => set({ category: e.target.value || null })} aria-label="Category" />
          </Chip>
          <Chip icon={<Building2 />} active={!!final.company_id}>
            <select
              className={chipInput}
              value={final.company_id ?? ''}
              onChange={(e) => {
                const c = companies.find((x) => x.id === e.target.value);
                set({ company_id: c?.id ?? null, identity: c?.identity ?? final.identity });
              }}
              aria-label="Company"
            >
              <option value="">No company</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Chip>
          <Chip icon={<Fingerprint />} active={!!final.identity}>
            <select className={chipInput} value={final.identity ?? ''} onChange={(e) => set({ identity: (e.target.value || null) as Identity | null })} aria-label="Identity">
              <option value="">Identity unset</option>
              {IDENTITIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
          </Chip>
          <Chip icon={<Repeat />} active={final.recurrence !== 'none'}>
            <select className={chipInput} value={final.recurrence} onChange={(e) => set({ recurrence: e.target.value as Recurrence })} aria-label="Repeat">
              {RECURRENCES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Chip>
          {parsed.unknownCompany && <span className="text-xs text-warning-700 dark:text-warning-400">No company matches "@{parsed.unknownCompany}"</span>}
        </div>
      )}
      {!text.trim() && (
        <p className="text-xs text-subtle">
          Tips: <code className="font-mono">fri</code>, <code className="font-mono">tomorrow</code>, <code className="font-mono">in 3d</code>, <code className="font-mono">10/31</code> for dates ·{' '}
          <code className="font-mono">!high</code> priority · <code className="font-mono">#IT</code> category · <code className="font-mono">@Encountive</code> company ·{' '}
          <code className="font-mono">every week</code> to repeat
        </p>
      )}
    </div>
  );
}
