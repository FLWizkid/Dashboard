import { NextResponse, type NextRequest } from "next/server";

import { isMemoryMode } from "@/lib/data-mode";
import type { MemoryEvent } from "@/lib/hours/repository.memory";
import type { EventContext } from "@/lib/priority/importance";

export const dynamic = "force-dynamic";

/**
 * Clears the in-memory store between end-to-end specs.
 *
 * Returns 404 unless memory mode is active, so the route simply does not
 * exist in any real deployment.
 *
 * An optional body seeds calendar events. Scheduled hours are derived from
 * the calendar rather than stored, so without a way to put events there the
 * hours view could only ever be tested with two of its three columns.
 */
export async function POST(request: NextRequest) {
  if (!isMemoryMode()) {
    return new NextResponse(null, { status: 404 });
  }

  const { resetMemoryStore } = await import("@/lib/tasks/repository.memory");
  const { resetMemoryHoursStore, seedMemoryEvents } =
    await import("@/lib/hours/repository.memory");
  const { resetMemoryNoteStore } =
    await import("@/lib/notes/repository.memory");
  const { resetMemoryPriorityStore, seedPriorityEvents } =
    await import("@/lib/priority/repository.memory");
  const { resetMemoryReportStore } =
    await import("@/lib/reports/repository.memory");
  const { resetMemoryConnectorStore } =
    await import("@/lib/connectors/repository.memory");
  const { resetMemoryMail } = await import("@/lib/mail/repository.memory");

  resetMemoryStore();
  resetMemoryHoursStore();
  resetMemoryNoteStore();
  resetMemoryPriorityStore();
  resetMemoryReportStore();
  resetMemoryConnectorStore();
  const body = (await request.json().catch(() => null)) as {
    events?: MemoryEvent[];
    calendar?: EventContext[];
    mailAccounts?: "seeded" | "none";
  } | null;

  // `mailAccounts: "none"` is how a spec reaches the connect screen, which
  // the Email page shows only when nothing is connected.
  resetMemoryMail({ accounts: body?.mailAccounts ?? "seeded" });

  if (body?.events) {
    seedMemoryEvents(body.events);
  }

  // The priority engine reads meetings too. Phase 2's sync has no live feed
  // yet, so seeding is how the calendar half of the ranking gets exercised.
  if (body?.calendar) {
    seedPriorityEvents(body.calendar);
  }

  return NextResponse.json({ ok: true });
}
