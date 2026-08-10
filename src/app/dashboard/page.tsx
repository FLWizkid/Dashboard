import { CalendarClock, CalendarDays } from "lucide-react";
import type { Metadata } from "next";

import { HoursThisWeek } from "@/components/dashboard/hours-this-week";
import { SuggestionPrompts } from "@/components/priority/suggestion-prompt";
import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { TopPriorities } from "@/components/dashboard/top-priorities";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * The balanced snapshot.
 *
 * Tasks and hours are live. The two calendar cards hold their place until
 * Phase 2's interface lands — the layout was built for them, so they drop in
 * without moving anything else.
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

      {/* Questions first. A prompt buried under three cards is a prompt that
          never gets answered, and an unanswered suggestion does nothing at
          all — no link, no effect on the ranking. */}
      <SuggestionPrompts />

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
        <HoursThisWeek className="md:col-span-2 xl:col-span-1" />
      </div>

      <TopPriorities />
    </div>
  );
}
