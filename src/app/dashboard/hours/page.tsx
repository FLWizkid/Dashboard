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
 */
export default function HoursPage() {
  return (
    <div className="space-y-6">
      <div className="lg:hidden">
        <QuickLog />
      </div>

      {/* The week at a glance, moved here from the dashboard. It answers
          "am I on track", which is a question you ask in the place where you
          can do something about the answer — not one you want occupying a
          third of the home screen every morning. */}
      <HoursThisWeek />

      <HoursView />

      <div className="hidden lg:block">
        <QuickLog />
      </div>
    </div>
  );
}
