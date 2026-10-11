import { format } from 'date-fns';
import { Activity, Bot, CalendarDays } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { QuickLogStrip } from '@/components/today/QuickLogStrip';
import { TopPriorities } from '@/components/today/TopPriorities';
import { DueToday, NeedsAttention, NotConnectedPanel } from '@/components/today/TodayPanels';
import { NotConnected } from '@/components/ui/field';
import { SETUP } from '@/lib/integrations';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function TodayPage() {
  const { user } = useAuth();
  const name = user?.email?.startsWith('doug') ? 'Doug' : '';
  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{greeting()}{name && `, ${name}`}</h1>
          <p className="text-sm text-muted">{format(new Date(), 'EEEE, MMMM d')}</p>
        </div>
      </div>

      <QuickLogStrip />

      <section className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2">
        <Activity className="size-4 text-subtle" />
        <h2 className="text-sm font-semibold">Health lights</h2>
        <div className="min-w-0 flex-1">
          <NotConnected title="IT Operations health lights" info={SETUP.itOps} compact />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <NotConnectedPanel title="Today's meetings and next 2 days" icon={<CalendarDays />} setup="calendar" />
        </div>
        <div className="lg:col-span-5">
          <TopPriorities />
        </div>
        <div className="lg:col-span-7">
          <NeedsAttention />
        </div>
        <div className="lg:col-span-5">
          <NotConnectedPanel title="Agent digest" icon={<Bot />} setup="agents" />
        </div>
        <div className="lg:col-span-12">
          <DueToday />
        </div>
      </div>
    </div>
  );
}
