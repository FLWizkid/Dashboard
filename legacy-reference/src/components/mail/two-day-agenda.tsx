"use client";

import dynamic from "next/dynamic";

import { Card } from "@/components/ui/card";

/**
 * The two-day agenda, loaded when it is asked for.
 *
 * It lives behind a toggle, so most visits to the calendar never render it —
 * shipping and hydrating it alongside the day view meant paying for a view
 * the owner may not open, on the page whose whole job is to answer "what is
 * my day" quickly. Splitting it also keeps the reports rollup out of the
 * calendar's initial bundle, which is what dragged this route's first render
 * out far enough for the phone shell's sheet to still be open when the next
 * page arrived.
 */
const View = dynamic(
  () => import("./two-day-agenda-view").then((m) => m.TwoDayAgendaView),
  {
    loading: () => (
      <Card className="p-4 text-sm text-fg-muted" aria-busy>
        Loading…
      </Card>
    ),
  },
);

export function TwoDayAgenda() {
  return <View />;
}
