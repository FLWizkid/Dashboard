import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, Bot, FileText, Library, Plug, Plus, Settings2, Trash2 } from 'lucide-react';
import { agentState, isOverdue, lastRunAt, useAgents, useDeleteAgent, useSaveAgent, type AgentState } from '@/data/agents';
import { useReports } from '@/data/reports';
import type { Agent } from '@/lib/types';
import { cn, errorMessage, relativeTime } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ConnectClaudeDialog } from '@/components/agents/ConnectClaudeDialog';
import { AgentSettingsDialog } from '@/components/agents/AgentSettingsDialog';

const STATE: Record<AgentState, { label: string; cls: string; dot: string }> = {
  running: { label: 'Running', cls: 'bg-primary-500/15 text-primary-700 dark:text-primary-300', dot: 'bg-primary-500 animate-pulse' },
  stalled: { label: 'Stalled', cls: 'bg-warning-500/15 text-warning-700 dark:text-warning-300', dot: 'bg-warning-500' },
  succeeded: { label: 'Succeeded', cls: 'bg-success-500/15 text-success-700 dark:text-success-300', dot: 'bg-success-500' },
  failed: { label: 'Failed', cls: 'bg-error-500/15 text-error-700 dark:text-error-300', dot: 'bg-error-500' },
  never: { label: 'Never run', cls: 'bg-raised text-muted', dot: 'bg-subtle' },
};

function StatePill({ state }: { state: AgentState }) {
  const s = STATE[state];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', s.cls)}>
      <span className={cn('size-2 rounded-full', s.dot)} /> {s.label}
    </span>
  );
}

function AddAgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const save = useSaveAgent();
  const toast = useToast();
  const [name, setName] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    save.mutate({ name, notes: null }, {
      onSuccess: () => { setName(''); onOpenChange(false); toast('Agent added'); },
      onError: (err) => toast(errorMessage(err).includes('duplicate') ? 'An agent with that name already exists.' : errorMessage(err), 'error'),
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add agent" description="Optional. Agents are also added automatically the first time they check in. Use the exact name the agent reports with.">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Agent name">
          <Input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Daily Inbox Triage" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || save.isPending}>{save.isPending ? 'Adding...' : 'Add agent'}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function AgentsPage() {
  const agents = useAgents();
  const remove = useDeleteAgent();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Agent | null>(null);
  const reports = useReports('');
  const unreadByAgent = new Map<string, number>();
  for (const r of reports.data ?? []) if (!r.read_at) unreadByAgent.set(r.agent_name, (unreadByAgent.get(r.agent_name) ?? 0) + 1);

  const list = agents.data ?? [];
  const states = list.map((a) => ({ agent: a, state: agentState(a) }));
  const overdue = list.filter((a) => isOverdue(a) && agentState(a) !== 'running').length;
  const counts = (['running', 'failed', 'stalled'] as AgentState[]).map((s) => ({ s, n: states.filter((x) => x.state === s).length })).filter((c) => c.n);

  const del = (id: string) => {
    if (confirmId !== id) return setConfirmId(id);
    remove.mutate(id, { onSuccess: () => toast('Agent removed'), onError: (e) => toast(errorMessage(e), 'error'), onSettled: () => setConfirmId(null) });
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <PageHeader
        title="Agent Operations"
        description="Your Claude agents: whether they are running, when they last ran, and their latest report. Manage the agents themselves in Claude."
        actions={
          <>
            <Button asChild><Link to="/library"><Library /> Reports</Link></Button>
            <Button onClick={() => setAdding(true)}><Plus /> Add agent</Button>
            <Button variant="primary" onClick={() => setConnecting(true)}><Plug /> Connect Claude</Button>
          </>
        }
      />

      {(counts.length > 0 || overdue > 0) && (
        <div className="flex flex-wrap gap-2" aria-label="Agent summary">
          {counts.map((c) => <span key={c.s} className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATE[c.s].cls)}>{c.n} {STATE[c.s].label}</span>)}
          {overdue > 0 && <span className="rounded-full bg-warning-500/15 px-2 py-0.5 text-xs font-medium text-warning-700 dark:text-warning-300">{overdue} overdue</span>}
        </div>
      )}

      <Panel
        title="Agents"
        icon={<Bot />}
        subtitle="Refreshes every minute"
        subtitleInline
        updatedAt={agents.dataUpdatedAt}
        onRefresh={() => agents.refetch()}
        refreshing={agents.isFetching}
        loading={agents.isLoading}
        error={agents.error}
        empty={list.length === 0}
        bodyClassName="p-0"
        emptyState={
          <div className="p-3">
            <EmptyState
              icon={<Bot />}
              title="No agents have checked in yet"
              text="Connect Claude to get a check-in key and the short instructions to paste into each agent."
              action={<Button variant="primary" onClick={() => setConnecting(true)}><Plug /> Connect Claude</Button>}
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-subtle">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last run</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Last message</th>
                <th className="px-3 py-2 font-medium">Report</th>
                <th className="w-px px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {states.map(({ agent: a, state }) => {
                const at = lastRunAt(a);
                return (
                  <tr key={a.id} className="group border-b border-line last:border-0 transition-colors hover:bg-raised/60">
                    <td className="px-3 py-2 font-medium">{a.name}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatePill state={state} />
                        {isOverdue(a) && state !== 'running' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning-500/15 px-2 py-0.5 text-xs font-medium text-warning-700 dark:text-warning-300" title={`Expected every ${a.expected_every_hours} hours`}>
                            <AlarmClock className="size-3" /> Overdue
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted" title={at ? new Date(at).toLocaleString() : undefined}>
                      {at ? relativeTime(at) : 'Never'}
                      {a.last_finished_at && state !== 'running' && state !== 'stalled' && a.last_started_at && (
                        <span className="ml-1 text-xs text-subtle">({Math.max(1, Math.round((new Date(a.last_finished_at).getTime() - new Date(a.last_started_at).getTime()) / 60000))} min)</span>
                      )}
                    </td>
                    <td className="hidden max-w-md truncate px-3 py-2 text-muted md:table-cell" title={a.last_message ?? undefined}>
                      {a.last_report_id ? <Link to={`/library/${a.last_report_id}`} className="hover:text-fg hover:underline">{a.last_message ?? 'Open report'}</Link> : (a.last_message ?? '')}
                    </td>
                    <td className="px-3 py-2">
                      {a.last_report_id ? (
                        <Link to={`/library/${a.last_report_id}`} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-primary-600 hover:underline dark:text-primary-400">
                          <FileText className="size-3.5" /> Latest
                          {(unreadByAgent.get(a.name) ?? 0) > 0 && <span className="rounded-full bg-primary-600 px-1.5 text-[10px] text-white">{unreadByAgent.get(a.name)} new</span>}
                        </Link>
                      ) : <span className="text-xs text-subtle">None yet</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Button size="iconSm" variant="ghost" className="opacity-60 group-hover:opacity-100" onClick={() => setEditing(a)} aria-label={`${a.name} settings`}>
                        <Settings2 />
                      </Button>
                      <Button
                        size={confirmId === a.id ? 'sm' : 'iconSm'}
                        variant={confirmId === a.id ? 'danger' : 'ghost'}
                        className={cn(confirmId !== a.id && 'opacity-60 group-hover:opacity-100')}
                        onClick={() => del(a.id)}
                        onBlur={() => setConfirmId((c) => (c === a.id ? null : c))}
                        aria-label={`Remove ${a.name}`}
                        disabled={remove.isPending}
                      >
                        <Trash2 /> {confirmId === a.id && 'Confirm'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <AddAgentDialog open={adding} onOpenChange={setAdding} />
      <ConnectClaudeDialog open={connecting} onOpenChange={setConnecting} />
      <AgentSettingsDialog agent={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
