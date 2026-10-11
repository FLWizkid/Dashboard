import type { Metadata } from "next";

import { ReportView } from "@/components/reports/report-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reports",
};

/**
 * The report workspace.
 *
 * The same page prints. See `@media print` in `globals.css` and the note at
 * the top of `ReportView` for why there is no separate print route.
 */
export default function ReportsPage() {
  return <ReportView />;
}
