import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { mintState, stateSecret } from "@/lib/mail/connect";
import { buildAuthorizeUrl, getOAuthConfig } from "@/lib/mail/oauth";
import { MAIL_PROVIDERS, type MailProvider } from "@/lib/mail/types";

export const dynamic = "force-dynamic";

/** Cookie holding the state we minted, so the callback can prove it was ours. */
export const STATE_COOKIE = "mail_oauth_state";

/**
 * Starts a connect.
 *
 * A signed `state` goes out in the URL **and** into an httpOnly cookie. The
 * callback requires both to be present and identical: the signature proves we
 * minted it, and the cookie proves it came back to the same browser it was
 * issued to. Either alone is weaker than the pair.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    // A connect is an authenticated action even though the provider's consent
    // screen is not: without this, an unauthenticated visitor could start a
    // flow whose callback then runs as nobody.
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { provider } = await context.params;
  if (!MAIL_PROVIDERS.includes(provider as MailProvider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const config = getOAuthConfig(provider as MailProvider);
  if (!config) {
    return NextResponse.json(
      {
        error: `${provider} is not configured on this box. See docs/oauth-setup.md.`,
      },
      { status: 409 },
    );
  }

  const origin = new URL(request.url).origin;
  const state = mintState(provider as MailProvider, { secret: stateSecret() });

  const response = NextResponse.redirect(
    buildAuthorizeUrl(config, state, origin),
  );

  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/api/mail/oauth",
    maxAge: 600,
  });

  return response;
}
