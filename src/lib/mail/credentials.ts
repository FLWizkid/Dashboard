/**
 * Credential storage.
 *
 * OAuth tokens and Bridge passwords are the highest-value rows in the
 * database: a refresh token is a standing key to a live Google account, and
 * unlike a mail body it keeps working. They are therefore encrypted with the
 * same envelope as message bodies, bound by AAD to the account they belong
 * to, so write access to the database is not enough to move one account's
 * token onto another.
 *
 * **Server-side only.** Nothing here may be imported from a client component;
 * `getKeyring()` throws in the browser as a backstop.
 */

import { aad, decryptField, encryptField } from "@/lib/crypto/envelope";

import type { OAuthTokens } from "./oauth";
import type { MailProvider } from "./types";

/** What we store for a hosted provider. */
export interface OAuthCredentials {
  kind: "oauth";
  provider: Extract<MailProvider, "gmail" | "microsoft">;
  tokens: OAuthTokens;
}

/**
 * What we store for Proton Bridge.
 *
 * Bridge issues a per-application password that is only usable against
 * `127.0.0.1`, which limits the blast radius — but it is still a password to
 * a decrypted mailbox, so it gets the same treatment.
 */
export interface BridgeCredentials {
  kind: "bridge";
  provider: "proton_bridge";
  host: string;
  imapPort: number;
  smtpPort: number;
  username: string;
  password: string;
}

export type Credentials = OAuthCredentials | BridgeCredentials;

/** Encrypts credentials for storage against a specific account row. */
export function sealCredentials(
  accountId: string,
  credentials: Credentials,
): string {
  return encryptField(
    JSON.stringify(credentials),
    aad.credentials(accountId),
    // Uses the process keyring; explicit so the failure mode when encryption
    // is unconfigured is a clear throw at the point of storage.
  );
}

/**
 * Decrypts credentials.
 *
 * Throws rather than returning null: a credential that will not decrypt is
 * either tampered with or encrypted under a retired key, and both need a
 * person, not a silent fallback to "not connected".
 */
export function openCredentials(
  accountId: string,
  cipher: string,
): Credentials {
  const parsed = JSON.parse(
    decryptField(cipher, aad.credentials(accountId)),
  ) as Credentials;

  if (parsed.kind !== "oauth" && parsed.kind !== "bridge") {
    throw new Error(`Unrecognised credential shape for account ${accountId}`);
  }

  return parsed;
}

/**
 * Strips credentials out of anything on its way to the client.
 *
 * Used by the repository so no route has to remember. The account shape the
 * UI receives carries `hasCredentials`, never the credential.
 */
export function redactCredentials<T extends { credentials_cipher?: unknown }>(
  row: T,
): Omit<T, "credentials_cipher"> & { hasCredentials: boolean } {
  const { credentials_cipher: cipher, ...rest } = row;
  return { ...rest, hasCredentials: Boolean(cipher) };
}
