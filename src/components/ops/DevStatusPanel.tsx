import { ExternalLink, GitBranch, Rocket, Send, ServerCog } from 'lucide-react';
import { useDevStatus, type DevService } from '@/data/devstatus';
import { safeHref } from '@/lib/utils';
import { Panel } from '@/components/ui/panel';
import { StatusPill } from '@/components/ui/badge';

const META: Record<DevService['key'], { name: string; icon: typeof GitBranch; setup: string }> = {
  github: { name: 'GitHub', icon: GitBranch, setup: 'Needs a read-only GitHub token (GITHUB_TOKEN). See Setup, Your steps.' },
  vercel: { name: 'Vercel', icon: Rocket, setup: 'Needs a Vercel token (VERCEL_TOKEN). See Setup, Your steps.' },
  resend: { name: 'Resend (email)', icon: Send, setup: 'Needs the Resend key (RESEND_API_KEY). See Setup, Your steps.' },
};

const LABEL = { healthy: 'Healthy', attention: 'Attention', action: 'Action needed', unknown: 'Not connected' } as const;

function ServiceCard({ s }: { s: DevService }) {
  const m = META[s.key];
  const Icon = m.icon;
  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted" />
        <span className="text-sm font-medium">{m.name}</span>
        <span className="ml-auto"><StatusPill status={s.status} label={s.configured && s.status === 'unknown' ? 'Could not check' : LABEL[s.status]} /></span>
      </div>
      <p className="mt-1 text-xs text-muted">{s.configured ? s.error ?? s.summary : m.setup}</p>
      {s.items.length > 0 && (
        <ul className="mt-2 space-y-1">
          {s.items.slice(0, 8).map((i) => {
            const href = safeHref(i.url);
            return (
              <li key={i.label} className="flex items-start gap-2 text-xs">
                <span className={`mt-1 size-2 shrink-0 rounded-full ${i.status === 'healthy' ? 'bg-success-500' : i.status === 'action' ? 'bg-error-500' : i.status === 'attention' ? 'bg-warning-500' : 'bg-neutral-400'}`} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-fg">{i.label}</span> <span className="text-muted">{i.detail}</span>
                </span>
                {href && <a href={href} target="_blank" rel="noopener noreferrer" className="text-subtle hover:text-fg" aria-label={`Open ${i.label}`}><ExternalLink className="size-3.5" /></a>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function DevStatusPanel() {
  const status = useDevStatus();
  return (
    <Panel
      title="Code, hosting and email"
      icon={<ServerCog />}
      subtitle="GitHub builds, Vercel deploys and Resend sending, read-only"
      updatedAt={status.dataUpdatedAt}
      onRefresh={() => status.refetch()}
      refreshing={status.isFetching}
      loading={status.isLoading}
      error={status.error}
    >
      <div className="grid gap-3 lg:grid-cols-3">
        {(status.data ?? []).map((s) => <ServiceCard key={s.key} s={s} />)}
      </div>
    </Panel>
  );
}
