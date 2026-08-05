import { CalendarClock, CalendarDays, Timer } from "lucide-react";
import type { Metadata } from "next";

import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { TopPriorities } from "@/components/dashboard/top-priorities";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * The balanced snapshot.
 *
 * Phase 1 wires the task half for real; the meeting, two-day and hours cards
 * hold their place until Phases 2 and 4 fill them. The layout is final — those
 * cards drop in without moving anything else.
 */
export default function DashboardHome() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-fg">Today</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Your meetings, your next two days, and what needs doing.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <PlaceholderCard
          title="Today's meetings"
          description="Your calendar for the day, with prep and follow-ups attached."
          phase="P2"
          icon={<CalendarDays />}
        />
        <PlaceholderCard
          title="Next two days"
          description="A rolled-up preview with due and overdue tasks folded in."
          phase="P2"
          icon={<CalendarClock />}
        />
        <PlaceholderCard
          title="Hours this week"
          description="Focused Pomodoro time plus scheduled work blocks."
          phase="P4"
          icon={<Timer />}
          className="md:col-span-2 xl:col-span-1"
        />
      </div>

      <TopPriorities />
    </div>
  );
}
