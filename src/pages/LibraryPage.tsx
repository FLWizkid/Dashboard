import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckSquare, ExternalLink, FileText, GitCompare, Library, Mail, MailOpen, Search, Trash2 } from 'lucide-react';
import { useDeleteReport, useMarkReportRead, usePreviousReport, useReport, useReports, type ReportSummary } from '@/data/reports';
import { useCreateTask } from '@/data/tasks';
import { cn, errorMessage, relativeTime } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Pill } from '@/components/records/RecordTable';
import { Markdown } from '@/components/reports/Markdown';
import { ReportDiff } from '@/components/reports/ReportDiff';

function ReportListItem({ r, active }: { r: ReportSummary; active: boolean }) {
  return (
    <li>
      <Link
        to={`/library/${r.id}`}
        className={cn(
          'block border-b border-line px-3 py-2.5 transition-colors last:border-0 hover:bg-raised/60',
          active && 'bg-primary-500/10 hover:bg-primary-500/10',
        )}
      >
        <div className="flex items-center gap-2">
          {!r.read_at && <span className="size-2 shrink-0 rounded-full bg-primary-500" aria-label="Unread" />}
          <span className={cn('min-w-0 flex-1 truncate text-sm', !r.read_at && 'font-semibold')}>{r.title}</span>
          {r.status === 'failed' && <Pill tone="error">Failed</Pill>}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">{r.agent_name} · {relativeTime(r.received_at)}</p>
        {r.summary && <p className="mt-0.5 line-clamp-2 text-xs text-subtle">{r.summary}</p>}
      </Link>
    </li>
  );
}

function ReportDetail({ id }: { id: string }) {
  const report = useReport(id);
  const previous = usePreviousReport(report.data);
  const markRead = useMarkReportRead();
  const remove = useDeleteReport();
  const createTask = useCreateTask();
  const toast = useToast();
  const navigate = useNavigate();
  const [view, setView] = useState<'report' | 'compare'>('report');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const autoMarked = useRef<string | null>(null);

  const r = report.data;
  const { mutate: markReadMutate } = markRead;
  useEffect(() => {
    if (r && !r.read_at && autoMarked.current !== r.id) {
      autoMarked.current = r.id;
      markReadMutate({ id: r.id, read: true });
    }
  }, [r, markReadMutate]);

  const makeTask = () => {
    if (!r) return;
    createTask.mutate(
      { title: `Follow up: ${r.title}`.slice(0, 200), notes: `From ${r.agent_name}'s report on ${new Date(r.received_at).toLocaleDateString()}.\n${window.location.origin}/library/${r.id}`, priority: r.status === 'failed' ? 'high' : null },
      { onSuccess: () => toast('Task created'), onError: (e) => toast(errorMessage(e), 'error') },
    );
  };

  const del = () => {
    if (!r) return;
    if (!confirmDelete) return setConfirmDelete(true);
    remove.mutate(r.id, {
      onSuccess: () => { toast('Report deleted'); navigate('/library'); },
      onError: (e) => toast(errorMessage(e), 'error'),
    });
  };

  return (
    <Panel
      title={r?.title ?? 'Report'}
      icon={<FileText />}
      loading={report.isLoading}
      error={report.error}
      empty={!report.isLoading && !r}
      emptyState={<EmptyState icon={<FileText />} title="Report not found" text="It may have been deleted." action={<Button asChild size="sm"><Link to="/library">Back to the library</Link></Button>} />}
      actions={
        r && (
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => markRead.mutate({ id: r.id, read: !r.read_at })} aria-label={r.read_at ? 'Mark unread' : 'Mark read'}>
              {r.read_at ? <Mail /> : <MailOpen />} <span className="hidden sm:inline">{r.read_at ? 'Mark unread' : 'Mark read'}</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={makeTask} disabled={createTask.isPending}><CheckSquare /> <span className="hidden sm:inline">Make task</span></Button>
            <Button size="sm" variant={confirmDelete ? 'danger' : 'ghost'} onClick={del} onBlur={() => setConfirmDelete(false)} disabled={remove.isPending} aria-label="Delete report">
              <Trash2 /> {confirmDelete && 'Confirm'}
            </Button>
          </div>
        )
      }
    >
      {r && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <Link to="/agents" className="font-medium text-fg hover:text-primary-600 hover:underline">{r.agent_name}</Link>
            <span>{new Date(r.received_at).toLocaleString()}</span>
            <Pill tone={r.status === 'failed' ? 'error' : 'success'}>{r.status === 'failed' ? 'Failed' : 'Succeeded'}</Pill>
            {r.source_url && (
              <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-600 hover:underline dark:text-primary-400">
                <ExternalLink className="size-3" /> Original
              </a>
            )}
          </div>
          {r.summary && <p className="rounded-md border border-line bg-raised/60 p-3 text-sm">{r.summary}</p>}

          <div className="inline-flex rounded-md border border-line p-0.5 text-xs" role="tablist">
            {(['report', 'compare'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn('inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium transition-colors', view === v ? 'bg-primary-600 text-white' : 'text-muted hover:text-fg')}
              >
                {v === 'report' ? <FileText className="size-3.5" /> : <GitCompare className="size-3.5" />}
                {v === 'report' ? 'Full report' : 'Compare with previous run'}
              </button>
            ))}
          </div>

          {view === 'report' ? (
            r.body ? <Markdown text={r.body} /> : <p className="text-sm text-muted">This run sent no report text{r.source_url ? ', only a link to the original.' : '.'}</p>
          ) : previous.isLoading ? (
            <p className="text-sm text-muted">Loading the previous run...</p>
          ) : previous.error ? (
            <p className="text-sm text-error-600">Could not load the previous run.</p>
          ) : previous.data ? (
            <div className="space-y-2">
              <p className="text-xs text-muted">
                Compared with <Link to={`/library/${previous.data.id}`} className="font-medium text-primary-600 hover:underline">{previous.data.title}</Link> from {new Date(previous.data.received_at).toLocaleString()}.
              </p>
              <ReportDiff before={previous.data.body} after={r.body} />
            </div>
          ) : (
            <p className="text-sm text-muted">This is the first report from {r.agent_name}, so there is nothing to compare yet.</p>
          )}
        </div>
      )}
    </Panel>
  );
}

export function LibraryPage() {
  const { id } = useParams();
  const [search, setSearch] = useState('');
  const [agent, setAgent] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const reports = useReports(search);

  const all = reports.data ?? [];
  const agents = useMemo(() => [...new Set(all.map((r) => r.agent_name))].sort(), [all]);
  const list = all.filter((r) => (!agent || r.agent_name === agent) && (!unreadOnly || !r.read_at));
  const unread = all.filter((r) => !r.read_at).length;

  const chip = (active: boolean) => cn('rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors', active ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300' : 'border-line text-muted hover:text-fg');

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <PageHeader title="Report Library" description="Every report your agents send, each on its own screen. Search, open the full text, and see what changed since the last run." />
      <div className="grid gap-3 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <div className={cn('space-y-2', id && 'hidden lg:block')}>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <input className="input pl-8" placeholder="Search reports" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search reports" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            <button className={chip(unreadOnly)} onClick={() => setUnreadOnly((u) => !u)}>Unread{unread ? ` (${unread})` : ''}</button>
            <button className={chip(!agent)} onClick={() => setAgent(null)}>All agents</button>
            {agents.map((a) => <button key={a} className={chip(agent === a)} onClick={() => setAgent(agent === a ? null : a)}>{a}</button>)}
          </div>
          <Panel
            title="Reports"
            icon={<Library />}
            subtitle={`${list.length} shown`}
            subtitleInline
            loading={reports.isLoading}
            error={reports.error}
            onRefresh={() => reports.refetch()}
            refreshing={reports.isFetching}
            empty={list.length === 0}
            bodyClassName="p-0"
            emptyState={
              <div className="p-3">
                <EmptyState
                  icon={<Library />}
                  title={all.length === 0 && !search ? 'No reports yet' : 'Nothing matches'}
                  text={all.length === 0 && !search ? 'Open Agent Operations and use Connect Claude. Agents then send their full report here when they finish.' : 'Try a different search or filter.'}
                  action={all.length === 0 && !search ? <Button asChild size="sm" variant="primary"><Link to="/agents">Agent Operations</Link></Button> : undefined}
                />
              </div>
            }
          >
            <ul className="max-h-[70vh] overflow-y-auto">
              {list.map((r) => <ReportListItem key={r.id} r={r} active={r.id === id} />)}
            </ul>
          </Panel>
        </div>
        <div className={cn(!id && 'hidden lg:block')}>
          {id ? (
            <div className="space-y-2">
              <Button asChild size="sm" variant="ghost" className="lg:hidden"><Link to="/library"><ArrowLeft /> All reports</Link></Button>
              <ReportDetail key={id} id={id} />
            </div>
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">
              Pick a report on the left to read it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
