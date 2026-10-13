import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PageTab {
  key: string;
  label: string;
  to: string;
  icon?: LucideIcon;
  count?: number;
  tone?: 'default' | 'alert';
}

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: PageTab[];
  activeTab?: string;
  children?: ReactNode;
}

export function PageHeader({ title, description, actions, tabs, activeTab, children }: PageHeaderProps) {
  return (
    <div className={cn('space-y-2', tabs && 'border-b border-line')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
      {tabs && (
        <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label={`${title} sections`}>
          {tabs.map((t) => {
            const active = t.key === activeTab;
            return (
              <Link
                key={t.key}
                to={t.to}
                replace
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-2 border-b-2 px-3 text-sm transition-colors',
                  active ? 'border-primary-500 font-medium text-fg' : 'border-transparent text-muted hover:border-line hover:text-fg',
                )}
              >
                {t.icon && <t.icon className="size-4" />}
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span
                    className={cn(
                      'min-w-5 rounded-full px-1.5 text-center text-xs font-medium',
                      t.tone === 'alert' ? 'bg-error-500/15 text-error-700 dark:text-error-300' : 'bg-raised text-muted',
                    )}
                  >
                    {t.count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
