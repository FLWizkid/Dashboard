import type { Metadata } from "next";

import { HoursThisWeek } from "@/components/dashboard/hours-this-week";
import { NextTwoDays } from "@/components/dashboard/next-two-days";
import {
  NeedsAttention,
  TodaysMeetings,
} from "@/components/dashboard/todays-meetings";
import { SuggestionPrompts } from "@/components/priority/suggestion-prompt";
import { TopPriorities } from "@/components/dashboard/top-priorities";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * The balanced snapshot.
 *
 * Every card is live. The header has promised "your next two days" since P1;
 * that card now exists rather than being a sentence about one, and it reuses
 * the report's rollup so the two cannot disagree.
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
        <TodaysMeetings />
        <NeedsAttention />
        <HoursThisWeek className="md:col-span-2 xl:col-span-1" />
        <NextTwoDays className="md:col-span-2 xl:col-span-3" />
      </div>

      <TopPriorities />
    </div>
  );
}
