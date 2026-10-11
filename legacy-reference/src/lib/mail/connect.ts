import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { MailProvider } from "./types";

/**
 * Connecting an account, and the part of OAuth that is easy to get wrong.
 *
 * ── The `state` parameter is a CSRF defence, not a nonce ─────────────────
 * Without it, anyone who can get the owner's browser to visit our callback
 * URL with a `code` of their choosing can attach **their** mailbox to the
 * owner's dashboard. That is not a theoretical attack: it is the reason the
 * parameter exists, and "we generate a random string and ignore it on the way
 * back" is the shape almost every broken implementation takes.
 *
 * So the state is minted here, bound to the provider, signed with a secret
 * this box already has, and **verified on return**. It carries its own expiry
 * so a link left open in a tab for a week cannot be completed.
 *
 * Pure and dependency-free so the verification can be tested exhaustively —
 * including the cases that matter, which are all failures.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

export class OAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthStateError";
  }
}

export interface StateOptions {
  secret: string;
  now?: Date;
  ttlMs?: number;
}

/**
 * A signed state token for one connect attempt.
 *
 * `provider.expiry.nonce.signature`, base64url throughout. The provider is in
 * the payload so a state minted for Google cannot be replayed at Microsoft's
 * callback.
 */
export function mintState(
  provider: MailProvider,
  options: StateOptions,
): string {
  const now = options.now ?? new Date();
  const expiry = now.getTime() + (options.ttlMs ?? STATE_TTL_MS);
  const nonce = randomBytes(16).toString("base64url");

  const payload = `${provider}.${expiry}.${nonce}`;
  return `${payload}.${sign(payload, options.secret)}`;
}

/**
 * Verifies a returned state.
 *
 * Throws on every failure rather than returning false, so a caller cannot
 * accidentally treat "could not verify" as "verified" by ignoring a boolean.
 */
export function verifyState(
  state: string,
  provider: MailProvider,
  options: StateOptions,
): void {
  const parts = state.split(".");
  if (parts.length !== 4) {
    throw new OAuthStateError("The sign-in state was malformed.");
  }

  const [statedProvider, expiry, nonce, signature] = parts;
  const payload = `${statedProvider}.${expiry}.${nonce}`;

  if (!constantTimeEquals(signature, sign(payload, options.secret))) {
    throw new OAuthStateError("The sign-in state did not verify.");
  }

  // After the signature, never before: comparing the provider first would let
  // an attacker learn which field failed.
  if (statedProvider !== provider) {
    throw new OAuthStateError(
      "The sign-in state was issued for a different provider.",
    );
  }

  const deadline = Number(expiry);
  const now = (options.now ?? new Date()).getTime();

  if (!Number.isFinite(deadline) || deadline < now) {
    throw new OAuthStateError(
      "The sign-in attempt expired. Start it again from the Email page.",
    );
  }
}

function sign(payload: string, secret: string): string {
  if (!secret) {
    throw new OAuthStateError(
      "No secret is available to sign the sign-in state.",
    );
  }
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The secret used to sign state.
 *
 * Reuses the service-role key, which is already required for anything else on
 * this box to work and never leaves the server. A separate variable would be
 * one more thing to generate, document and forget.
 */
export function stateSecret(env = process.env): string {
  const secret =
    env.SUPABASE_SERVICE_ROLE_KEY || env.DASHBOARD_CRON_TOKEN || "";

  if (!secret) {
    throw new OAuthStateError(
      "SUPABASE_SERVICE_ROLE_KEY is not set, so a sign-in cannot be signed.",
    );
  }
  return secret;
}

/** Where the provider tells us who just signed in. */
const PROFILE_URL: Record<"gmail" | "microsoft", string> = {
  gmail: "https://www.googleapis.com/oauth2/v3/userinfo",
  microsoft: "https://graph.microsoft.com/v1.0/me",
};

export interface ConnectedIdentity {
  emailAddress: string;
  displayName: string | null;
  remoteId: string;
}

/**
 * Who the token belongs to.
 *
 * Asked of the provider rather than of the person connecting: a form field
 * would let a typo attach a mailbox under the wrong address, and every later
 * "is this message from me" comparison would then be wrong.
 */
export async function fetchIdentity(
  provider: "gmail" | "microsoft",
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectedIdentity> {
  const response = await fetchImpl(PROFILE_URL[provider], {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(
      `${provider} would not say who the account belongs to (${response.status}).`,
    );
  }

  const payload = (await response.json()) as {
    email?: string;
    mail?: string;
    userPrincipalName?: string;
    name?: string;
    displayName?: string;
    sub?: string;
    id?: string;
  };

  const emailAddress =
    payload.email ?? payload.mail ?? payload.userPrincipalName ?? "";

  if (!emailAddress) {
    throw new Error(
      `${provider} returned no address for the account, so it cannot be connected.`,
    );
  }

  return {
    emailAddress: emailAddress.toLowerCase(),
    displayName: payload.name ?? payload.displayName ?? null,
    remoteId: payload.sub ?? payload.id ?? emailAddress.toLowerCase(),
  };
}
