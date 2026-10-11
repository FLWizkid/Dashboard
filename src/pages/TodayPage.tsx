import { format } from 'date-fns';
import { Bot } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/ui/page-header';
import { QuickLogStrip } from '@/components/today/QuickLogStrip';
import { SummaryCards } from '@/components/today/SummaryCards';
import { TopPriorities } from '@/components/today/TopPriorities';
import { DueToday, NeedsAttention, NotConnectedPanel } from '@/components/today/TodayPanels';
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
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader title={`${greeting()}${name ? `, ${name}` : ''}`} description={format(new Date(), 'EEEE, MMMM d')} />

      <SummaryCards />

      <QuickLogStrip />

      <HealthStrip />

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">
          <TopPriorities />
          <DueToday />
        </div>
        <div className="space-y-4 lg:col-span-5">
          <NeedsAttention />
          <MeetingsPanel />
          <NotConnectedPanel title="Agent digest" icon={<Bot />} setup="agents" />
        </div>
      </div>
    </div>
  );
}
