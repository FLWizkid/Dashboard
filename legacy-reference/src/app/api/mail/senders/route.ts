import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getMailRepository } from "@/lib/mail/repository";
import { rateSenderSchema } from "@/lib/mail/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const repository = await getMailRepository();
    return NextResponse.json({ senders: await repository.listSenders() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * Rates a sender.
 *
 * The rating applies to mail already received, not only to what arrives next.
 * Marking the board chair critical and then seeing this morning's message
 * still ranked normal would make the setting look broken.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = rateSenderSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const repository = await getMailRepository();
    return NextResponse.json({
      sender: await repository.rateSender(
        parsed.data.address,
        parsed.data.importance,
        parsed.data.notes,
      ),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
