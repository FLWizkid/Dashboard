import { NextResponse, type NextRequest } from "next/server";

import {
  totalsFor,
  monthlyBreakdown,
  weeklyBreakdown,
  type HoursInterval,
} from "@/lib/hours/aggregate";
import { getHoursRepository, toIntervals } from "@/lib/hours/repository";
import {
  readBody,
  requireUser,
  toErrorResponse,
  unauthorized,
} from "@/lib/hours/route-helpers";
import { createTimeEntrySchema, hoursQuerySchema } from "@/lib/hours/schema";
import {
  addZonedDays,
  isValidTimeZone,
  startOfZonedWeek,
} from "@/lib/time/zone";

export const dynamic = "force-dynamic";

/**
 * The week (or an explicit window) in three sources and one combined total.
 *
 * The rollup is computed here rather than in the browser so the dashboard
 * card, the hours view and the Phase 6 digest all get the same numbers from
 * the same code — and so a phone doesn't have to download a month of calendar
 * events to render one figure.
 */
export async function GET(request: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const query = hoursQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: query.error.flatten() },
      { status: 400 },
    );
  }

  // An unknown zone string would make every boundary silently UTC, so it is
  // rejected rather than defaulted past.
  const timeZone =
    query.data.timeZone && isValidTimeZone(query.data.timeZone)
      ? query.data.timeZone
      : "UTC";

  const now = new Date();
  const from = query.data.from
    ? new Date(query.data.from)
    : startOfZonedWeek(now, timeZone);
  const to = query.data.to
    ? new Date(query.data.to)
    : addZonedDays(from, timeZone, 7);

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return NextResponse.json({ error: "Invalid window" }, { status: 400 });
  }
  if (to <= from) {
    return NextResponse.json(
      { error: "The window has to end after it starts" },
      { status: 400 },
    );
  }

  try {
    const repository = await getHoursRepository();
    const [entries, blocks] = await Promise.all([
      repository.listTimeEntries({ from, to }),
      repository.listScheduledBlocks({ from, to }),
    ]);

    const intervals: HoursInterval[] = toIntervals(entries, blocks);

    return NextResponse.json({
      window: { from: from.toISOString(), to: to.toISOString(), timeZone },
      totals: totalsFor(intervals),
      days: weeklyBreakdown({ intervals, timeZone, now: from }),
      // The specification asks for weekly *and* monthly. The monthly rollup
      // has been computed since P4 and returned by nothing, so the view had
      // no way to answer "how did this month go" — a question a CIO asks
      // rather more often than "how did this week go".
      months: monthlyBreakdown({ intervals, timeZone, now: from }),
      entries,
      blocks,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Logs time by hand.
 *
 * Only `manual` — the schema has no `scheduled` member at all, so there is no
 * request that can put derived calendar time into the ledger.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await readBody(request, createTimeEntrySchema);
  if ("response" in body) return body.response;

  try {
    const repository = await getHoursRepository();
    const entry = await repository.createTimeEntry(body.data);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    // A reused client key lands here and comes back as a 200 with the entry
    // that already exists. See `toErrorResponse`.
    return toErrorResponse(error);
  }
}
