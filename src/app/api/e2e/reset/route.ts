import { NextResponse, type NextRequest } from "next/server";

import { isMemoryMode } from "@/lib/data-mode";
import type { MemoryEvent } from "@/lib/hours/repository.memory";

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

  resetMemoryStore();
  resetMemoryHoursStore();
  resetMemoryNoteStore();

  const body = (await request.json().catch(() => null)) as {
    events?: MemoryEvent[];
  } | null;

  if (body?.events) {
    seedMemoryEvents(body.events);
  }

  return NextResponse.json({ ok: true });
}
