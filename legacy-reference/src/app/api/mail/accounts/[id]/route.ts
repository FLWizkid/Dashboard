import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import {
  MailAccountNotFoundError,
  getMailRepository,
} from "@/lib/mail/repository";
import { updateAccountSchema } from "@/lib/mail/schema";

export const dynamic = "force-dynamic";

/**
 * Changes an account's settings.
 *
 * Tightening the caching policy is destructive on purpose: dropping to
 * Metadata deletes every stored body, and dropping to Off deletes the stored
 * mail entirely. The alternative — a setting that governs new mail only —
 * would leave the owner believing bodies were gone when they were not.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  const parsed = updateAccountSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const repository = await getMailRepository();
    return NextResponse.json({
      account: await repository.updateAccount(id, parsed.data),
    });
  } catch (error) {
    if (error instanceof MailAccountNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/** Disconnects, taking the stored mail and the credential envelope with it. */
export async function DELETE(
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
    await repository.disconnectAccount(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof MailAccountNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
