import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getMailRepository } from "@/lib/mail/repository";
import { markReadSchema } from "@/lib/mail/schema";

export const dynamic = "force-dynamic";

/**
 * Marks messages read or unread.
 *
 * Takes a list rather than one id: opening a thread marks all of it read, and
 * doing that as one call keeps the optimistic update in the interface a single
 * step that either happened or did not.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // `request.json()` throws rather than returning null on a body that never
  // finished arriving, and that throw escapes the guard below to become an
  // uncaught exception and a logged server error.
  //
  // This route gets that more than any other because of *when* it is called:
  // opening a thread marks it read, and closing the tab or moving to another
  // module right afterwards makes the browser hang up mid-request. The
  // accompanying ECONNRESET is the same event seen from the socket. Nothing
  // is wrong on this side — the caller left — and reporting it as a server
  // fault trains you to ignore the error log, which is the real cost.
  //
  // A truncated body is a malformed one, so it takes the 400 the route
  // already has for that, quietly.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = markReadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const repository = await getMailRepository();
    await repository.markRead(parsed.data.messageIds, parsed.data.read);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
