import { useState } from 'react';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { TIME_CATEGORIES, type TimeCategory, type TimeEntry } from '@/lib/types';
import { errorMessage, formatMinutes, parseDuration, toDateKey } from '@/lib/utils';
import { useUsageRank } from '@/data/organization';
import { ProjectPicker } from '@/components/projects/ProjectPicker';
import { CompanyPicker } from '@/components/companies/CompanyPicker';
import { useDeleteTimeEntry, useSaveTimeEntry } from '@/data/time';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

export function TimeEntryEditor({ entry, onDone }: { entry: TimeEntry; onDone: () => void }) {
  const rank = useUsageRank();
  const save = useSaveTimeEntry();
  const del = useDeleteTimeEntry();
  const toast = useToast();
  const [category, setCategory] = useState<TimeCategory>(entry.category);
  const [companyId, setCompanyId] = useState(entry.company_id ?? '');
  const [projectId, setProjectId] = useState(entry.project_id ?? '');
  const [description, setDescription] = useState(entry.description ?? '');
  const [duration, setDuration] = useState(String(entry.minutes));
  const [date, setDate] = useState(toDateKey(new Date(entry.started_at)));
  const [confirm, setConfirm] = useState(false);
  const minutes = parseDuration(duration);

  async function submit() {
    if (!minutes || minutes < 1 || minutes > 1440) return toast('Enter a duration like 30, 45m, 1h30 or 1.5h.', 'error');
    const original = new Date(entry.started_at);
    const started = date === toDateKey(original) ? original : new Date(`${date}T${format(original, 'HH:mm')}:00`);
    try {
      await save.mutateAsync({
        id: entry.id,
        minutes,
        category,
        company_id: companyId || null,
        project_id: projectId || null,
        description: description.trim() || null,
        started_at: started.toISOString(),
      });
      toast('Entry updated');
      onDone();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Description"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value as TimeCategory)}>
            {rank([...TIME_CATEGORIES], 'time_category', (c) => c.value).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Duration" hint={minutes ? formatMinutes(minutes) : 'e.g. 45, 1h30'}>
          <input className="input font-mono" value={duration} onChange={(e) => setDuration(e.target.value)} aria-invalid={!minutes} />
        </Field>
        <Field label="Project">
          <ProjectPicker
            value={projectId}
            companyId={companyId || null}
            onChange={(id, p) => {
              setProjectId(id);
              if (p?.company_id && !companyId) setCompanyId(p.company_id);
            }}
          />
        </Field>
        <Field label="Company">
          <CompanyPicker value={companyId} onChange={(id) => setCompanyId(id)} />
        </Field>
        <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
      </div>
      <div className="flex items-center gap-2 border-t border-line pt-3">
        {confirm ? (
          <>
            <span className="text-sm text-muted">Delete this entry?</span>
            <Button size="sm" variant="danger" onClick={async () => { try { await del.mutateAsync(entry.id); toast('Entry deleted'); onDone(); } catch (e) { toast(errorMessage(e), 'error'); } }}>Delete</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}><Trash2 /> Delete</Button>
        )}
        <div className="flex-1" />
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={save.isPending}>Save</Button>
      </div>
    </div>
  );
}
