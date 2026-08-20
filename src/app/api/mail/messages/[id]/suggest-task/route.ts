import { NextResponse, type NextRequest } from "next/server";

import { getMailRepository } from "@/lib/mail/repository";
import { suggestTaskFromMessage } from "@/lib/mail/to-task";

export const dynamic = "force-dynamic";

/**
 * What task this mail would become.
 *
 * Suggestion only: nothing is created here. The owner sees the proposed
 * title, due date and priority — each with the reason it was chosen — edits
 * whatever is wrong, and then creates the task through the normal task route.
 * That separation is what keeps "suggested, never forced" true at the level
 * of the API rather than only in the interface.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const repository = await getMailRepository();
    const message = await repository.getMessage(id);

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const timeZone =
      request.nextUrl.searchParams.get("timeZone") ??
      process.env.DASHBOARD_TIME_ZONE ??
      "UTC";

    // A window either side of now: a mail can be about a meeting that has
    // already happened (follow-up) as well as one that has not (prep).
    const now = new Date();
    const events = await repository.listEvents({
      from: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
      to: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
    });

    return NextResponse.json({
      suggestion: suggestTaskFromMessage({
        message,
        events,
        now,
        timeZone,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
