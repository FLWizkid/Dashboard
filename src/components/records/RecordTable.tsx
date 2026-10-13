import { useState, type ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { cn, errorMessage } from '@/lib/utils';
import { useDeleteRecord, type RecordTable } from '@/data/records';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

export interface Column<T> {
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
  wideOnly?: boolean;
}

interface Props<T extends { id: string }> {
  table: RecordTable;
  rows: T[];
  columns: Column<T>[];
  onEdit: (row: T) => void;
  nameOf: (row: T) => string;
  rowClass?: (row: T) => string | undefined;
}

export function RecordTable<T extends { id: string }>({ table, rows, columns, onEdit, nameOf, rowClass }: Props<T>) {
  const remove = useDeleteRecord(table);
  const toast = useToast();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const del = (id: string) => {
    if (confirmId !== id) return setConfirmId(id);
    remove.mutate(id, { onSuccess: () => toast('Removed'), onError: (e) => toast(errorMessage(e), 'error'), onSettled: () => setConfirmId(null) });
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-subtle">
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th key={c.label} className={cn('px-3 py-2 font-medium', c.wideOnly && 'hidden md:table-cell')}>{c.label}</th>
            ))}
            <th className="w-px px-3 py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={cn('group border-b border-line last:border-0 transition-colors hover:bg-raised/60', rowClass?.(r))}>
              {columns.map((c) => (
                <td key={c.label} className={cn('px-3 py-2 align-top', c.wideOnly && 'hidden md:table-cell', c.className)}>{c.render(r)}</td>
              ))}
              <td className="whitespace-nowrap px-3 py-2 text-right align-top">
                <Button size="iconSm" variant="ghost" className="opacity-60 group-hover:opacity-100" onClick={() => onEdit(r)} aria-label={`Edit ${nameOf(r)}`}>
                  <Pencil />
                </Button>
                <Button
                  size={confirmId === r.id ? 'sm' : 'iconSm'}
                  variant={confirmId === r.id ? 'danger' : 'ghost'}
                  className={cn(confirmId !== r.id && 'opacity-60 group-hover:opacity-100')}
                  onClick={() => del(r.id)}
                  onBlur={() => setConfirmId((c) => (c === r.id ? null : c))}
                  aria-label={`Remove ${nameOf(r)}`}
                  disabled={remove.isPending}
                >
                  <Trash2 /> {confirmId === r.id && 'Confirm'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'error' | 'primary' }) {
  const cls = {
    neutral: 'bg-raised text-muted',
    success: 'bg-success-500/15 text-success-700 dark:text-success-300',
    warning: 'bg-warning-500/15 text-warning-700 dark:text-warning-300',
    error: 'bg-error-500/15 text-error-700 dark:text-error-300',
    primary: 'bg-primary-500/15 text-primary-700 dark:text-primary-300',
  }[tone];
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', cls)}>{children}</span>;
}
