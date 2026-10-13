import { Link } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { agentState, lastRunAt, useAgents } from '@/data/agents';
import { cn, relativeTime } from '@/lib/utils';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';

const DOT = { running: 'bg-primary-500 animate-pulse', stalled: 'bg-warning-500', succeeded: 'bg-success-500', failed: 'bg-error-500', never: 'bg-subtle' };
const LABEL = { running: 'Running', stalled: 'Stalled', succeeded: 'Succeeded', failed: 'Failed', never: 'Never run' };

export function AgentDigest() {
  const agents = useAgents();
  const list = (agents.data ?? [])
    .map((a) => ({ a, state: agentState(a), at: lastRunAt(a) }))
    .sort((x, y) => (y.at ?? '').localeCompare(x.at ?? ''))
    .slice(0, 5);
  return (
    <Panel
      title="Agent digest"
      icon={<Bot />}
      actions={<Button asChild size="sm" variant="ghost"><Link to="/agents">View all</Link></Button>}
      loading={agents.isLoading}
      error={agents.error}
      onRefresh={() => agents.refetch()}
      refreshing={agents.isFetching}
      empty={list.length === 0}
      emptyState={<EmptyState icon={<Bot />} title="No agents have checked in" action={<Button asChild size="sm" variant="primary"><Link to="/agents">Connect Claude</Link></Button>} />}
    >
      <ul className="space-y-1.5 text-sm">
        {list.map(({ a, state, at }) => (
          <li key={a.id} className="flex items-center gap-2">
            <span className={cn('size-2 shrink-0 rounded-full', DOT[state])} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            <span className="shrink-0 text-xs text-subtle">{LABEL[state]} {at ? relativeTime(at) : ''}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
