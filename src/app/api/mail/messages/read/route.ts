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

  const parsed = markReadSchema.safeParse(await request.json());
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
