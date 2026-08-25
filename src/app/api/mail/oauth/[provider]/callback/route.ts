import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { sealCredentials } from "@/lib/mail/credentials";
import {
  fetchIdentity,
  OAuthStateError,
  stateSecret,
  verifyState,
} from "@/lib/mail/connect";
import { exchangeCode, getOAuthConfig } from "@/lib/mail/oauth";
import { createClient } from "@/lib/supabase/server";
import { MAIL_PROVIDERS, type MailProvider } from "@/lib/mail/types";

import { STATE_COOKIE } from "../start/route";

export const dynamic = "force-dynamic";

/**
 * Finishes a connect.
 *
 * ── The order of checks is the security ──────────────────────────────────
 *
 *   1. There is a signed-in owner.
 *   2. The `state` verifies **and** matches the cookie we set.
 *   3. Only then is the `code` exchanged.
 *
 * Exchanging first and validating afterwards would already have attached an
 * attacker's mailbox by the time the check ran.
 *
 * The account row is created before the credentials are sealed, because the
 * envelope is bound to the row's id — that binding is what stops a stolen
 * credential being replayed against a different account.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { provider } = await context.params;
  if (!MAIL_PROVIDERS.includes(provider as MailProvider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const url = new URL(request.url);
  const denied = url.searchParams.get("error");
  if (denied) {
    return redirectWith(request, `Connecting was cancelled (${denied}).`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookie = request.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state) {
    return redirectWith(request, "The provider returned an incomplete reply.");
  }

  if (!cookie || cookie !== state) {
    // The signature alone would pass here. Requiring the cookie is what ties
    // the reply to the browser the flow started in.
    return redirectWith(
      request,
      "That sign-in did not start in this browser, so it was refused.",
    );
  }

  try {
    verifyState(state, provider as MailProvider, { secret: stateSecret() });
  } catch (error) {
    return redirectWith(
      request,
      error instanceof OAuthStateError
        ? error.message
        : "The sign-in state did not verify.",
    );
  }

  const config = getOAuthConfig(provider as MailProvider);
  if (!config) {
    return redirectWith(request, `${provider} is not configured on this box.`);
  }

  try {
    const tokens = await exchangeCode(config, code, { origin: url.origin });

    const identity = await fetchIdentity(
      provider as "gmail" | "microsoft",
      tokens.accessToken,
    );

    const supabase = await createClient();

    // Upsert on (user, provider, remote id): reconnecting an account that is
    // already here must refresh its credentials rather than create a second
    // row, which would then sync everything twice.
    const { data, error } = await supabase
      .from("mail_accounts")
      .upsert(
        {
          provider,
          remote_id: identity.remoteId,
          email_address: identity.emailAddress,
          display_name: identity.displayName,
          status: "connected",
          status_detail: null,
          last_error: null,
          // A newly connected mailbox caches headers only.
          //
          // The documented behaviour is that a corporate account starts at
          // Off and a personal one may go to Full, but nothing in the connect
          // path ever set either, so every account silently took the column
          // default. Metadata is the honest starting point for a mailbox
          // whose status nobody has stated yet: enough for the product to be
          // useful, no bodies at rest until the owner says which kind of
          // mailbox this is. Marking it corporate moves it to Off; the
          // database trigger refuses corporate + Full regardless.
          caching_policy: "metadata",
        },
        { onConflict: "user_id,provider,remote_id" },
      )
      .select("id")
      .single<{ id: string }>();

    if (error) throw new Error(error.message);

    const { error: sealError } = await supabase
      .from("mail_accounts")
      .update({
        credentials_cipher: sealCredentials(data.id, {
          kind: "oauth",
          provider: provider as "gmail" | "microsoft",
          tokens,
        }),
      })
      .eq("id", data.id);

    if (sealError) throw new Error(sealError.message);

    const response = NextResponse.redirect(
      new URL("/dashboard/email?connected=1", request.url),
    );
    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch (error) {
    return redirectWith(
      request,
      error instanceof Error ? error.message : "Connecting failed.",
    );
  }
}

/**
 * Back to the Email page with the reason.
 *
 * A JSON error body would leave the owner on a blank page holding a stack
 * trace; the interface can say what happened and offer the button again.
 */
function redirectWith(request: NextRequest, message: string): NextResponse {
  const target = new URL("/dashboard/email", request.url);
  target.searchParams.set("error", message);

  const response = NextResponse.redirect(target);
  response.cookies.delete(STATE_COOKIE);
  return response;
}
