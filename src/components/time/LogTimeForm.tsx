import { useEffect, useState } from 'react';
import { Clock, CornerDownLeft } from 'lucide-react';
import { TIME_CATEGORIES, type TimeCategory } from '@/lib/types';
import { cn, errorMessage, formatMinutes, parseDuration } from '@/lib/utils';
import { useSettings } from '@/data/settings';
import { useCompanies, useUsageRank } from '@/data/organization';
import { useSaveTimeEntry } from '@/data/time';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ProjectPicker } from '@/components/projects/ProjectPicker';

const PRESETS = [15, 30, 60, 90];

export function LogTimeForm({ layout = 'stack', onSaved, autoFocus }: { layout?: 'strip' | 'stack'; onSaved?: () => void; autoFocus?: boolean }) {
  const { data: settings } = useSettings();
  const { data: companies = [] } = useCompanies();
  const rank = useUsageRank();
  const save = useSaveTimeEntry();
  const toast = useToast();

  const [category, setCategory] = useState<TimeCategory>('infrastructure');
  const [companyId, setCompanyId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [carried, setCarried] = useState(false);
  const [duration, setDuration] = useState('30');
  const [date, setDate] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!settings || hydrated) return;
    if (settings.last_time_description) {
      setDescription(settings.last_time_description);
      setCarried(true);
    }
    if (settings.last_time_category) setCategory(settings.last_time_category);
    if (settings.last_time_company_id) setCompanyId(settings.last_time_company_id);
    setHydrated(true);
  }, [settings, hydrated]);

  const minutes = parseDuration(duration);

  async function submit() {
    if (!minutes || minutes < 1 || minutes > 1440) return toast('Enter a duration like 30, 45m, 1h30 or 1.5h.', 'error');
    try {
      await save.mutateAsync({
        minutes,
        category,
        company_id: companyId || null,
        project_id: projectId || null,
        description: description.trim() || null,
        ...(date ? { started_at: new Date(`${date}T12:00:00`).toISOString() } : {}),
      });
      toast(`Logged ${formatMinutes(minutes)} to ${TIME_CATEGORIES.find((c) => c.value === category)?.label}`);
      setCarried(!!description.trim());
      onSaved?.();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  const descField = (
    <Field
      label="Description"
      className={layout === 'strip' ? 'min-w-[200px] flex-[2]' : ''}
      hint={layout === 'stack' && carried ? 'Carried over from your last entry' : undefined}
    >
      <div className="relative">
        <input
          autoFocus={autoFocus}
          className={cn('input', carried && 'pr-24')}
          value={description}
          placeholder="What did you work on?"
          onChange={(e) => {
            setDescription(e.target.value);
            setCarried(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {carried && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-raised px-1.5 py-0.5 text-[11px] font-medium text-muted">carried over</span>
        )}
      </div>
    </Field>
  );

  return (
    <div className={layout === 'strip' ? 'flex flex-wrap items-end gap-2' : 'space-y-3'}>
      <Field label="Category" className={layout === 'strip' ? 'min-w-[140px] flex-1' : ''}>
        <Select value={category} onChange={(e) => setCategory(e.target.value as TimeCategory)}>
          {rank([...TIME_CATEGORIES], 'time_category', (c) => c.value).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </Field>
      <Field label="Project" className={layout === 'strip' ? 'min-w-[160px] flex-1' : ''}>
        <ProjectPicker
          value={projectId}
          companyId={companyId || null}
          onChange={(id, p) => {
            setProjectId(id);
            if (p?.company_id) setCompanyId(p.company_id);
          }}
        />
      </Field>
      <Field label="Company" className={layout === 'strip' ? 'min-w-[130px] flex-1' : ''}>
        <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">No company</option>
          {rank(companies, 'company', (c) => c.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      {descField}
      <Field label="Duration" className={layout === 'strip' ? 'w-[96px]' : ''} hint={layout === 'stack' ? (minutes ? formatMinutes(minutes) : 'e.g. 45, 1h30, 1.5h') : undefined}>
        <input className="input font-mono" value={duration} onChange={(e) => setDuration(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} aria-invalid={!minutes} />
      </Field>
      {layout === 'stack' && (
        <>
          <div className="flex gap-1.5">
            {PRESETS.map((p) => (
              <Button key={p} size="sm" variant={minutes === p ? 'primary' : 'secondary'} onClick={() => setDuration(String(p))}>
                {formatMinutes(p)}
              </Button>
            ))}
          </div>
          <Field label="Date" hint="Leave blank for now">
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </>
      )}
      <Button variant="primary" onClick={submit} disabled={save.isPending} className={layout === 'stack' ? 'w-full' : ''}>
        {layout === 'strip' ? <CornerDownLeft /> : <Clock />}
        Log time
      </Button>
    </div>
  );
}
