import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { providerAvailability } from "@/lib/mail/oauth";
import { getMailRepository } from "@/lib/mail/repository";
import { MAIL_PROVIDERS } from "@/lib/mail/types";

export const dynamic = "force-dynamic";

/**
 * The connected accounts, and which providers could be connected.
 *
 * Availability is returned alongside, so the interface can say "Microsoft is
 * built but not configured on this box" rather than either hiding it or
 * offering a button that fails.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const repository = await getMailRepository();
    return NextResponse.json({
      accounts: await repository.listAccounts(),
      providers: MAIL_PROVIDERS.map((provider) =>
        providerAvailability(provider),
      ),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
