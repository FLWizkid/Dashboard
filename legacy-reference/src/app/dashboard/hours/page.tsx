import type { Metadata } from "next";

import { HoursThisWeek } from "@/components/dashboard/hours-this-week";
import { HoursView } from "@/components/hours/hours-view";
import { QuickLog } from "@/components/hours/quick-log";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hours",
};

/**
 * Hours across the three sources.
 *
 * Quick-log sits above the fold on a phone and drops below the totals on a
 * desktop: on a phone this page is usually open *to log something*, and on a
 * desktop it is usually open *to look at something*.
 *
 * ── One card, reordered — not two cards, one hidden ──────────────────────
 * That layout used to be built by rendering `QuickLog` twice and hiding one
 * with `lg:hidden` / `hidden lg:block`. It looked identical and was wrong in
 * a way that only showed up once the card held state: two mounted instances
 * meant two independent descriptions and two category selections on one page,
 * and which one you had actually typed into depended on your window width.
 * The hidden copy also stayed in the accessibility tree's markup and matched
 * every query by test id or by label, so a test asking for "the description
 * box" got two answers.
 *
 * Flex `order` gets the same visual result from a single mount: the card is
 * ordered first on a phone and last from `lg` up. One instance, one piece of
 * state, one match per query.
 */
export default function HoursPage() {
  return (
    <div className="flex flex-col gap-6">
      {/* The week at a glance, moved here from the dashboard. It answers
          "am I on track", which is a question you ask in the place where you
          can do something about the answer — not one you want occupying a
          third of the home screen every morning. */}
      <HoursThisWeek />

      <HoursView />

      <div className="order-first lg:order-last">
        <QuickLog />
      </div>
    </div>
  );
}
