import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, Database, Globe, LayoutGrid, Mail, MonitorSmartphone, Plug, Plus, RefreshCw } from 'lucide-react';
import { MONITOR_KINDS, type CheckStatus, type MonitorKind } from '@/lib/types';
import { cn, errorMessage, relativeTime } from '@/lib/utils';
import { SETUP } from '@/lib/integrations';
import { useAutoRunStaleChecks, useOpsHealth } from '@/data/ops';
import { Panel, EmptyState } from '@/components/ui/panel';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { NotConnected } from '@/components/ui/field';
import { StatusPill } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { HealthLight } from '@/components/ops/HealthLight';
import { MonitorDetail } from '@/components/ops/MonitorDetail';
import { MonitorForm } from '@/components/ops/MonitorForm';

const SUMMARY: { status: CheckStatus; label: string }[] = [
  { status: 'action', label: 'Action needed' },
  { status: 'attention', label: 'Attention' },
  { status: 'healthy', label: 'Healthy' },
  { status: 'unknown', label: 'Unknown or paused' },
];

const TABS: { key: string; label: string; icon: typeof Globe; kinds: MonitorKind[] }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutGrid, kinds: ['domain', 'email_auth', 'website', 'database', 'manual'] },
  { key: 'domains', label: 'Domains', icon: Globe, kinds: ['domain'] },
  { key: 'email', label: 'Email', icon: Mail, kinds: ['email_auth'] },
  { key: 'websites', label: 'Websites', icon: MonitorSmartphone, kinds: ['website'] },
  { key: 'systems', label: 'Systems', icon: Database, kinds: ['database', 'manual'] },
];

export function OpsPage() {
  const [params] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get('tab')) ?? TABS[0];
  const ops = useOpsHealth();
  const run = useAutoRunStaleChecks();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });

  const opened = ops.health.find((h) => h.monitor.id === openId) ?? null;
  const editing = ops.health.find((h) => h.monitor.id === form.id)?.monitor ?? null;

  const runAll = () =>
    run.mutate(undefined, {
      onSuccess: (r) => toast(r.checked ? `Checked ${r.checked} item${r.checked === 1 ? '' : 's'}` : 'Everything was checked less than a minute ago.'),
      onError: (e) => toast(errorMessage(e), 'error'),
    });

  const groups = MONITOR_KINDS.filter((k) => tab.kinds.includes(k.value)).map((k) => ({ ...k, items: ops.health.filter((h) => h.monitor.kind === k.value) })).filter((g) => g.items.length);
  const tabProblems = (kinds: MonitorKind[]) => ops.health.filter((h) => kinds.includes(h.monitor.kind) && (h.status === 'action' || h.status === 'attention')).length;
  const counts = SUMMARY.map((s) => ({ ...s, n: ops.health.filter((h) => h.status === s.status).length }));

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader
        title="IT Operations"
        description={`Live checks against public registries and DNS. Last automatic run ${relativeTime(ops.lastChecked)}.`}
        tabs={TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon, to: t.key === 'overview' ? '/ops' : `/ops?tab=${t.key}`, count: tabProblems(t.kinds), tone: 'alert' as const }))}
        activeTab={tab.key}
        actions={
          <>
            <Button onClick={() => setForm({ open: true, id: null })}><Plus /> Add check</Button>
            <Button variant="primary" onClick={runAll} disabled={run.isPending || ops.loading}>
              <RefreshCw className={cn(run.isPending && 'animate-spin')} /> {run.isPending ? 'Checking...' : 'Run all checks'}
            </Button>
          </>
        }
      />

      {tab.key === 'overview' && !ops.loading && !ops.error && ops.health.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Status summary">
          {counts.map((c) => (
            <StatusPill key={c.status} status={c.status} label={`${c.n} ${c.label}`} />
          ))}
        </div>
      )}

      <Panel
        title={tab.key === 'overview' ? 'Status lights' : tab.label}
        icon={<Activity />}
        subtitle="Click any light for its breakdown and history"
        updatedAt={ops.updatedAt}
        onRefresh={() => ops.refetch()}
        refreshing={ops.fetching || run.isPending}
        loading={ops.loading}
        error={ops.error}
        empty={groups.length === 0}
        emptyState={
          <EmptyState
            icon={<Activity />}
            title={tab.key === 'overview' ? 'Nothing is being watched yet' : `No ${tab.label.toLowerCase()} checks yet`}
            text="Add a domain, website or manual system to start getting real status lights."
            action={<Button variant="primary" onClick={() => setForm({ open: true, id: null })}><Plus /> Add check</Button>}
          />
        }
      >
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.value}>
              <h3 className="label">{g.label}</h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.items.map((h) => <HealthLight key={h.monitor.id} health={h} onOpen={() => setOpenId(h.monitor.id)} />)}
              </div>
            </section>
          ))}
        </div>
      </Panel>

      {tab.key === 'overview' && <Panel title="Not connected yet" icon={<Plug />} subtitle="These need an account link first, so they stay grey">
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <p className="label">Resend email delivery</p>
            <NotConnected title="Resend" info={SETUP.resend} compact />
          </div>
          <div>
            <p className="label">Agent runs</p>
            <NotConnected title="Agent monitoring" info={SETUP.agents} compact />
          </div>
        </div>
      </Panel>}

      <MonitorDetail
        health={opened}
        onClose={() => setOpenId(null)}
        onEdit={() => {
          setForm({ open: true, id: openId });
          setOpenId(null);
        }}
      />
      <MonitorForm open={form.open} onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))} monitor={editing} />
    </div>
  );
}
