import { useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Plug } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Dialog } from './dialog';

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label
      data-error={error ? 'true' : undefined}
      className={cn(
        'block',
        error && '[&_.input]:border-error-500 [&_.input]:ring-2 [&_.input]:ring-error-500/30 [&_.field-shell]:border-error-500 [&_.field-shell]:ring-2 [&_.field-shell]:ring-error-500/30',
        className,
      )}
    >
      <span className={cn('label', error && 'text-error-700 dark:text-error-300')}>{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-xs font-medium text-error-700 dark:text-error-300">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-subtle">{hint}</span>
      )}
    </label>
  );
}

export function focusFirstError(root: HTMLElement | null) {
  const el = root?.querySelector<HTMLElement>('[data-error="true"] input, [data-error="true"] select, [data-error="true"] textarea');
  el?.focus();
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'h-9 w-full rounded-md border border-line bg-surface px-3 text-sm transition-colors placeholder:text-subtle hover:border-subtle focus:border-primary-500 focus:outline-none',
        className,
      )}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('input appearance-none bg-[length:16px] bg-[right_8px_center] bg-no-repeat pr-8', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23889' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...props}>
      {children}
    </select>
  );
}

export interface SetupInfo {
  phase: number;
  what: string;
  steps: string[];
}

export function NotConnected({ title, info, compact }: { title: string; info: SetupInfo; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={cn('flex items-center gap-3 rounded-md border border-dashed border-line bg-raised/50', compact ? 'p-2' : 'p-4')}>
        <Plug className="size-4 shrink-0 text-subtle" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-muted">Not connected</p>
          {!compact && <p className="text-sm text-subtle">{info.what}</p>}
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Set up
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen} title={`Set up: ${title}`} description={`Planned for Phase ${info.phase}`}>
        <p className="mb-3 text-sm text-muted">{info.what}</p>
        <p className="label">Next steps</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {info.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="mt-4 rounded-md bg-raised p-3 text-xs text-muted">
          This panel stays grey until it is really connected. It will never show a green light from placeholder data.
        </p>
      </Dialog>
    </>
  );
}
