import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth";
import { buildReport } from "@/lib/reports/build";
import { isValidTimeZone } from "@/lib/time/zone";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

const csv = (value: string | null) =>
  value
    ? value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    : [];

const querySchema = z.object({
  timeZone: z.string().trim().min(1).max(80).optional(),
  q: z.string().trim().max(200).optional(),
  incompleteOnly: z.enum(["true", "false"]).optional(),
  uncategorisedOnly: z.enum(["true", "false"]).optional(),
  includeDone: z.enum(["true", "false"]).optional(),
});

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // An unknown zone would silently make every day boundary UTC, which shifts
  // what lands in "Due soon" — rejected rather than defaulted past.
  const timeZone =
    parsed.data.timeZone && isValidTimeZone(parsed.data.timeZone)
      ? parsed.data.timeZone
      : "UTC";

  const priorities = csv(params.get("priorities")).filter(
    (value): value is (typeof TASK_PRIORITIES)[number] =>
      (TASK_PRIORITIES as readonly string[]).includes(value),
  );
  const statuses = csv(params.get("statuses")).filter(
    (value): value is (typeof TASK_STATUSES)[number] =>
      (TASK_STATUSES as readonly string[]).includes(value),
  );

  try {
    const report = await buildReport({
      timeZone,
      includeDone: parsed.data.includeDone === "true",
      filters: {
        categoryIds: csv(params.get("categories")),
        priorities,
        statuses,
        query: parsed.data.q,
        incompleteOnly: parsed.data.incompleteOnly === "true",
        uncategorisedOnly: parsed.data.uncategorisedOnly === "true",
      },
    });

    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
