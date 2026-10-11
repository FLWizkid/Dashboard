import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getMailRepository } from "@/lib/mail/repository";
import { eventQuerySchema } from "@/lib/mail/schema";

export const dynamic = "force-dynamic";

/**
 * Events in a window.
 *
 * Declined meetings are hidden by default. A meeting you declined is not on
 * your day, and showing it makes the agenda a record of invitations rather
 * than of what you are actually doing.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const query = eventQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: query.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const repository = await getMailRepository();
    const [events, calendars] = await Promise.all([
      repository.listEvents(query.data),
      repository.listCalendars(),
    ]);
    return NextResponse.json({ events, calendars });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
