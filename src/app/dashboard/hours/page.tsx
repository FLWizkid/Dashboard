import type { Metadata } from "next";

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

      <HoursView />

      <div className="hidden lg:block">
        <QuickLog />
      </div>
    </div>
  );
}
