import type { Metadata } from "next";

import { CalendarView } from "@/components/mail/calendar-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calendar",
};

/** Today, as a column you read top to bottom. See `docs/providers.md`. */
export default function CalendarPage() {
  return <CalendarView />;
}
