/**
 * OAuth for the hosted providers.
 *
 * Server-side only. Tokens are never sent to the browser: the callback lands
 * on a route handler, the exchange happens there, and the result goes
 * straight into the encrypted `credentials_cipher` column.
 *
 * ── Feature flagging ─────────────────────────────────────────────────────
 * Google is expected to be configured. Microsoft is wired but tolerated as
 * absent, because registering an Azure application is a separate piece of
 * work the owner does on their own schedule. {@link providerConfigured} is
 * what the UI asks; nothing throws merely because Microsoft has not been set
 * up, and turning it on is adding two environment variables — not a code
 * change.
 *
 * Redirect URIs use the tailnet HTTPS hostname. That works because the
 * redirect happens in the owner's browser, which is on the tailnet; the
 * provider never has to reach the box.
 */

import type { MailProvider } from "./types";

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Absolute expiry, ISO 8601. Absolute because a relative one ages badly in storage. */
  expiresAt: string;
  scope: string | null;
  tokenType: string;
}

export interface OAuthProviderConfig {
  provider: MailProvider;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Extra parameters the provider needs on the authorize request. */
  authorizeParams: Record<string, string>;
}

/** Where a provider sends the browser back to. */
export function redirectUri(provider: MailProvider, origin?: string): string {
  const base = (
    origin ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
  return `${base}/api/mail/oauth/${provider}/callback`;
}

const GOOGLE_SCOPES = [
  // Read and modify, but never delete: `gmail.modify` cannot empty a mailbox,
  // which is the right ceiling for a dashboard.
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
];

const MICROSOFT_SCOPES = [
  "offline_access",
  "openid",
  "email",
  "User.Read",
  "Mail.ReadWrite",
  "Mail.Send",
  "Calendars.Read",
];

/** The configuration for a provider, or `null` when it is not set up. */
export function getOAuthConfig(
  provider: MailProvider,
): OAuthProviderConfig | null {
  if (provider === "gmail") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    return {
      provider,
      clientId,
      clientSecret,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: GOOGLE_SCOPES,
      authorizeParams: {
        // Without both of these Google issues a refresh token once and never
        // again, and the connection silently dies in an hour.
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
      },
    };
  }

  if (provider === "microsoft") {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    // `common` lets both work and personal accounts sign in; a single-tenant
    // registration overrides it.
    const tenant = process.env.MICROSOFT_TENANT_ID ?? "common";

    return {
      provider,
      clientId,
      clientSecret,
      authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      scopes: MICROSOFT_SCOPES,
      authorizeParams: { response_mode: "query" },
    };
  }

  // Proton has no OAuth: it authenticates against the local Bridge with a
  // username and password. See adapters/proton.ts.
  return null;
}

/** Whether this provider can be connected on this box right now. */
export function providerConfigured(provider: MailProvider): boolean {
  if (provider === "proton_bridge") {
    return Boolean(process.env.PROTON_BRIDGE_HOST);
  }
  return getOAuthConfig(provider) !== null;
}

/** What the connect screen shows for each provider. */
export function providerAvailability(provider: MailProvider): {
  configured: boolean;
  reason: string | null;
} {
  if (providerConfigured(provider)) return { configured: true, reason: null };

  switch (provider) {
    case "gmail":
      return {
        configured: false,
        reason:
          "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET — see docs/oauth-setup.md.",
      };
    case "microsoft":
      return {
        configured: false,
        reason:
          "Not yet registered. Create an Azure app registration and set " +
          "MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET; no code change is needed.",
      };
    case "proton_bridge":
      return {
        configured: false,
        reason:
          "Set PROTON_BRIDGE_HOST once Proton Bridge is running on this box.",
      };
  }
}

/**
 * The URL to send the browser to.
 *
 * `state` is a random value the caller stores in a short-lived cookie and
 * checks on the way back — it is what stops a third party from completing a
 * connection on the owner's behalf.
 */
export function buildAuthorizeUrl(
  config: OAuthProviderConfig,
  state: string,
  origin?: string,
): string {
  const url = new URL(config.authorizeUrl);

  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(config.provider, origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);

  for (const [key, value] of Object.entries(config.authorizeParams)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function postForm(
  url: string,
  form: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });

  const payload = (await response.json().catch(() => ({}))) as TokenResponse;

  if (!response.ok || payload.error) {
    throw new Error(
      `Token endpoint refused: ${payload.error ?? response.status} ${
        payload.error_description ?? ""
      }`.trim(),
    );
  }

  return payload;
}

function toTokens(payload: TokenResponse, now: Date): OAuthTokens {
  // 60 seconds of slack: a token that expires while in flight is a failure
  // the owner sees, and clock skew between us and the provider is real.
  const lifetime = (payload.expires_in ?? 3600) - 60;

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: new Date(
      now.getTime() + Math.max(lifetime, 0) * 1000,
    ).toISOString(),
    scope: payload.scope ?? null,
    tokenType: payload.token_type ?? "Bearer",
  };
}

export async function exchangeCode(
  config: OAuthProviderConfig,
  code: string,
  options: { origin?: string; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<OAuthTokens> {
  const payload = await postForm(
    config.tokenUrl,
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(config.provider, options.origin),
    },
    options.fetchImpl ?? globalThis.fetch,
  );

  return toTokens(payload, options.now ?? new Date());
}

/**
 * Refreshes an access token.
 *
 * Google omits `refresh_token` from a refresh response, so the existing one is
 * carried forward. Dropping it here is the classic way to break a connection
 * exactly one hour after setting it up.
 */
export async function refreshTokens(
  config: OAuthProviderConfig,
  refreshToken: string,
  options: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<OAuthTokens> {
  const payload = await postForm(
    config.tokenUrl,
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    },
    options.fetchImpl ?? globalThis.fetch,
  );

  const tokens = toTokens(payload, options.now ?? new Date());
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

/** True when the token is expired or close enough that it is not worth using. */
export function tokensExpired(
  tokens: OAuthTokens,
  now: Date = new Date(),
): boolean {
  return Date.parse(tokens.expiresAt) <= now.getTime();
}
