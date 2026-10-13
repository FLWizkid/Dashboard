import { useState, type FormEvent } from 'react';
import { format } from 'date-fns';
import { cn, errorMessage } from '@/lib/utils';
import { useDeleteRecord, useSaveRecord, type RecordTable, type RecordValues } from '@/data/records';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { CompanyPicker } from '@/components/companies/CompanyPicker';

export interface FieldSpec {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'datetime' | 'number' | 'select' | 'company' | 'checkbox';
  options?: { value: string; label: string }[];
  required?: boolean;
  max?: number;
  hint?: string;
  placeholder?: string;
  wide?: boolean;
}

type Draft = Record<string, string | boolean>;

function toDraft(fields: FieldSpec[], source: Record<string, unknown>): Draft {
  const d: Draft = {};
  for (const f of fields) {
    const v = source[f.key];
    if (f.type === 'checkbox') d[f.key] = v === undefined ? false : Boolean(v);
    else if (f.type === 'datetime') d[f.key] = typeof v === 'string' && v ? format(new Date(v), "yyyy-MM-dd'T'HH:mm") : '';
    else if (f.type === 'select' && f.required && (v === null || v === undefined || v === '')) d[f.key] = f.options?.[0]?.value ?? '';
    else d[f.key] = v === null || v === undefined ? '' : String(v);
  }
  return d;
}

function fromDraft(fields: FieldSpec[], draft: Draft): { values: RecordValues; errors: Record<string, string> } {
  const values: RecordValues = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const raw = draft[f.key];
    if (f.type === 'checkbox') { values[f.key] = Boolean(raw); continue; }
    const s = String(raw ?? '').trim();
    if (!s) {
      if (f.required) errors[f.key] = `${f.label} is required.`;
      values[f.key] = f.type === 'number' ? 0 : null;
      continue;
    }
    if (f.max && s.length > f.max) errors[f.key] = `Keep this under ${f.max} characters.`;
    if (f.type === 'number') {
      const n = Number(s.replace(/[$,]/g, ''));
      if (!Number.isFinite(n) || n < 0) errors[f.key] = 'Enter a number of 0 or more.';
      values[f.key] = Math.round(n * 100) / 100;
    } else if (f.type === 'datetime') {
      const dt = new Date(s);
      if (Number.isNaN(dt.getTime())) errors[f.key] = 'Enter a valid date and time.';
      else values[f.key] = dt.toISOString();
    } else {
      values[f.key] = s;
    }
  }
  return { values, errors };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  table: RecordTable;
  fields: FieldSpec[];
  record: { id: string } | null;
  defaults?: Record<string, unknown>;
  transform?: (values: RecordValues, previous: Record<string, unknown> | null) => RecordValues;
}

export function RecordDialog(props: Props) {
  const { open, onOpenChange, title, description, record } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description} side="right">
      {open && <RecordForm key={record?.id ?? 'new'} {...props} />}
    </Dialog>
  );
}

function RecordForm({ onOpenChange, table, fields, record, defaults, transform }: Props) {
  const save = useSaveRecord(table);
  const remove = useDeleteRecord(table);
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const previous = record as Record<string, unknown> | null;
  const [draft, setDraft] = useState<Draft>(() => toDraft(fields, previous ?? defaults ?? {}));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (key: string, v: string | boolean) => setDraft((d) => ({ ...d, [key]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { values, errors: errs } = fromDraft(fields, draft);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const payload = transform ? transform(values, previous) : values;
    save.mutate(record ? { ...payload, id: record.id } : payload, {
      onSuccess: () => { onOpenChange(false); toast(record ? 'Saved' : 'Added'); },
      onError: (err) => toast(errorMessage(err), 'error'),
    });
  };

  return (
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => {
            const v = draft[f.key];
            const wide = f.wide || f.type === 'textarea';
            if (f.type === 'checkbox') {
              return (
                <label key={f.key} className={cn('flex items-center gap-2 text-sm', wide && 'sm:col-span-2')}>
                  <input type="checkbox" className="size-4 accent-primary-600" checked={Boolean(v)} onChange={(e) => set(f.key, e.target.checked)} />
                  {f.label}
                </label>
              );
            }
            return (
              <Field key={f.key} label={f.required ? `${f.label} *` : f.label} hint={f.hint} error={errors[f.key]} className={cn(wide && 'sm:col-span-2')}>
                {f.type === 'textarea' ? (
                  <textarea className="input min-h-[88px] py-2" value={String(v ?? '')} maxLength={f.max} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
                ) : f.type === 'select' ? (
                  <Select value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)}>
                    {!f.required && <option value="">Not set</option>}
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                ) : f.type === 'company' ? (
                  <CompanyPicker value={String(v ?? '')} onChange={(id) => set(f.key, id)} />
                ) : (
                  <Input
                    type={f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : 'text'}
                    inputMode={f.type === 'number' ? 'decimal' : undefined}
                    value={String(v ?? '')}
                    maxLength={f.max}
                    placeholder={f.placeholder}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </Field>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          {record && (
            <Button
              variant={confirmDelete ? 'danger' : 'ghost'}
              className="mr-auto"
              disabled={remove.isPending}
              onBlur={() => setConfirmDelete(false)}
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true);
                remove.mutate(record.id, { onSuccess: () => { onOpenChange(false); toast('Removed'); }, onError: (err) => toast(errorMessage(err), 'error') });
              }}
            >
              {confirmDelete ? 'Confirm remove' : 'Remove'}
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? 'Saving...' : record ? 'Save changes' : 'Add'}</Button>
        </div>
      </form>
  );
}
