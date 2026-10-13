import { format } from 'date-fns';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/ui/page-header';
import { QuickLogStrip } from '@/components/today/QuickLogStrip';
import { SummaryCards } from '@/components/today/SummaryCards';
import { TopPriorities } from '@/components/today/TopPriorities';
import { DueToday, NeedsAttention } from '@/components/today/TodayPanels';
import { AgentDigest } from '@/components/today/AgentDigest';
import { HealthStrip } from '@/components/today/HealthStrip';
import { MeetingsPanel } from '@/components/today/MeetingsPanel';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function TodayPage() {
  const { user } = useAuth();
  const name = user?.email?.startsWith('doug') ? 'Doug' : '';
  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <PageHeader title={`${greeting()}${name ? `, ${name}` : ''}`} description={format(new Date(), 'EEEE, MMMM d')} />

      <SummaryCards />

      <QuickLogStrip />

      <HealthStrip />

      <div className="grid gap-3 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-7">
          <TopPriorities />
          <DueToday />
        </div>
        <div className="space-y-3 lg:col-span-5">
          <NeedsAttention />
          <MeetingsPanel />
          <AgentDigest />
        </div>
      </div>
    </div>
  );
}
