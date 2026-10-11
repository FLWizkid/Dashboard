import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { PolicyForbidsError, getMailRepository } from "@/lib/mail/repository";

export const dynamic = "force-dynamic";

/**
 * One thread, with bodies where the account's policy stored them.
 *
 * A message with no body under Metadata is not an error — it is what that
 * policy means, and the interface says so rather than showing an empty pane.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const repository = await getMailRepository();
    const thread = await repository.getThread(id);

    if (!thread) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(thread);
  } catch (error) {
    if (error instanceof PolicyForbidsError) {
      return NextResponse.json(
        { error: error.message, policy: error.policy },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
