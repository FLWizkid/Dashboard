import { Link } from 'react-router-dom';
import { format, subDays } from 'date-fns';
import { ArrowLeft, Printer } from 'lucide-react';
import type { PartnerRequest } from '@/lib/types';
import { prettyDate } from '@/lib/spend';
import { useRecords } from '@/data/records';
import { Button } from '@/components/ui/button';
import { PanelError, PanelSkeleton } from '@/components/ui/panel';

const DONE_WINDOW_DAYS = 30;

function sentence(r: PartnerRequest) {
  const asked = `${r.requested_by} asked on ${format(new Date(r.created_at), 'MMMM d')}`;
  const due = r.due_date ? ` It is needed by ${prettyDate(r.due_date)}.` : '';
  switch (r.status) {
    case 'new': return `${asked}. Doug has it on his list and has not started yet.${due}`;
    case 'in_progress': return `${asked}. Doug is working on this now.${due}`;
    case 'waiting': return `${asked}. This is paused while waiting on someone or something else.${due}`;
    default: return `Finished on ${format(new Date(r.completed_at ?? r.updated_at), 'MMMM d')}.${r.resolution ? ` ${r.resolution}` : ''}`;
  }
}

const GROUPS: { title: string; match: (r: PartnerRequest) => boolean }[] = [
  { title: 'Being worked on', match: (r) => r.status === 'in_progress' },
  { title: 'Waiting on something', match: (r) => r.status === 'waiting' },
  { title: 'Not started yet', match: (r) => r.status === 'new' },
  { title: `Finished in the last ${DONE_WINDOW_DAYS} days`, match: (r) => r.status === 'done' && new Date(r.completed_at ?? r.updated_at) >= subDays(new Date(), DONE_WINDOW_DAYS) },
];

export function RequestStatusPrint() {
  const requests = useRecords<PartnerRequest>('cc_requests');
  const rows = requests.data ?? [];

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-[760px] px-6 py-8 print:px-0 print:py-0">
        <div className="mb-6 flex items-center justify-between gap-2 print:hidden">
          <Button asChild variant="ghost"><Link to="/requests"><ArrowLeft /> Back to requests</Link></Button>
          <Button variant="primary" onClick={() => window.print()}><Printer /> Print</Button>
        </div>

        <header className="border-b border-neutral-300 pb-4">
          <h1 className="text-2xl font-semibold">IT requests: where things stand</h1>
          <p className="mt-1 text-sm text-neutral-600">As of {format(new Date(), "EEEE, MMMM d, yyyy 'at' h:mm a")}</p>
        </header>

        {requests.isLoading && <div className="mt-6"><PanelSkeleton rows={4} /></div>}
        {requests.error && <div className="mt-6"><PanelError error={requests.error} onRetry={() => requests.refetch()} /></div>}

        {!requests.isLoading && !requests.error && GROUPS.map((g) => {
          const list = rows.filter(g.match);
          return (
            <section key={g.title} className="mt-6 break-inside-avoid">
              <h2 className="text-lg font-semibold">{g.title} <span className="text-sm font-normal text-neutral-500">({list.length})</span></h2>
              {list.length === 0 ? (
                <p className="mt-1 text-sm text-neutral-500">Nothing here right now.</p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {list.map((r) => (
                    <li key={r.id} className="break-inside-avoid border-l-4 border-sky-500 pl-3">
                      <p className="font-medium">{r.title}</p>
                      <p className="text-sm leading-relaxed text-neutral-700">{sentence(r)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
