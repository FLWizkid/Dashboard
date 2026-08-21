import "server-only";

import { openCredentials, sealCredentials } from "./credentials";
import type { MailAdapter } from "./adapters/types";
import { createGoogleAdapter } from "./adapters/google";
import { createMicrosoftAdapter } from "./adapters/microsoft";
import { createProtonAdapter } from "./adapters/proton";
import { getOAuthConfig, refreshTokens, tokensExpired } from "./oauth";
import type { MailProvider } from "./types";

/**
 * Turns a stored account into a live adapter.
 *
 * This is the piece that was missing between the adapters and the sync engine:
 * the adapters take a `getAccessToken` callback, the database holds sealed
 * credentials, and nothing joined the two. Everything provider-specific stops
 * here — the sync engine above it only ever sees a `MailAdapter`.
 */

export interface AccountCredentialRow {
  id: string;
  provider: MailProvider;
  credentials_cipher: string | null;
}

/**
 * Persists refreshed credentials. Supplied by the caller because this module
 * has no opinion about where the row lives, and because a refresh that cannot
 * be written back should not silently succeed — the next run would refresh
 * again, and providers rate-limit that.
 */
export type CredentialWriter = (
  accountId: string,
  cipher: string,
) => Promise<void>;

export class CredentialsMissingError extends Error {
  constructor(accountId: string) {
    super(
      `Mail account ${accountId} has no stored credentials. Reconnect it before syncing.`,
    );
    this.name = "CredentialsMissingError";
  }
}

/**
 * An access-token supplier that refreshes on expiry and writes the new tokens
 * back.
 *
 * Refresh is done once per adapter and memoised for the life of that adapter:
 * a sync pass makes many requests, and each one asking "are these tokens
 * expired?" would otherwise race several refreshes against each other and
 * invalidate all but one.
 */
function oauthTokenSupplier(
  account: AccountCredentialRow,
  writeCredentials: CredentialWriter,
): () => Promise<string> {
  let inFlight: Promise<string> | null = null;

  return async () => {
    if (inFlight) return inFlight;

    inFlight = (async () => {
      if (!account.credentials_cipher) {
        throw new CredentialsMissingError(account.id);
      }

      const credentials = openCredentials(
        account.id,
        account.credentials_cipher,
      );

      if (credentials.kind !== "oauth") {
        throw new Error(
          `Account ${account.id} holds ${credentials.kind} credentials, but ${account.provider} needs OAuth`,
        );
      }

      if (!tokensExpired(credentials.tokens)) {
        return credentials.tokens.accessToken;
      }

      if (!credentials.tokens.refreshToken) {
        // Nothing to refresh with. Surfaced as a hard failure so the account
        // is marked for reconnection rather than retried every quarter hour.
        throw new Error(
          `Account ${account.id} has expired tokens and no refresh token. Reconnect it.`,
        );
      }

      const config = getOAuthConfig(account.provider);
      if (!config) {
        // The provider's client id/secret are no longer in the environment.
        // Refusing beats refreshing against a half-configured provider and
        // writing back tokens nobody can use.
        throw new Error(
          `${account.provider} is not configured on this machine, so its tokens cannot be refreshed`,
        );
      }
      // `refreshTokens` already carries the previous refresh token forward
      // when the provider omits a new one, so the sealed credential never
      // loses the ability to refresh again.
      const tokens = await refreshTokens(
        config,
        credentials.tokens.refreshToken,
      );

      await writeCredentials(
        account.id,
        sealCredentials(account.id, { ...credentials, tokens }),
      );

      return tokens.accessToken;
    })();

    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  };
}

export interface AdapterFactoryOptions {
  writeCredentials: CredentialWriter;
  /** Domains treated as internal when deciding if a meeting is external. */
  internalDomains?: string[];
  /** Proton only. Supplied by the caller so this module needs no IMAP import. */
  createProtonClients?: Parameters<typeof createProtonAdapter>[0];
}

/**
 * Builds the adapter for one account.
 *
 * Proton is deliberately not constructed here unless the caller passes the
 * client factories: it speaks IMAP/SMTP to a Bridge on this machine, and the
 * connection details are an operator concern rather than an OAuth one.
 */
export function adapterForAccount(
  account: AccountCredentialRow,
  options: AdapterFactoryOptions,
): MailAdapter {
  switch (account.provider) {
    case "gmail":
      return createGoogleAdapter({
        getAccessToken: oauthTokenSupplier(account, options.writeCredentials),
        internalDomains: options.internalDomains,
      });

    case "microsoft":
      return createMicrosoftAdapter({
        getAccessToken: oauthTokenSupplier(account, options.writeCredentials),
        internalDomains: options.internalDomains,
      });

    case "proton_bridge": {
      if (!options.createProtonClients) {
        throw new Error(
          "Proton needs Bridge connection details; none were supplied to the adapter factory",
        );
      }
      return createProtonAdapter(options.createProtonClients);
    }

    default: {
      const exhaustive: never = account.provider;
      throw new Error(`No adapter for provider ${String(exhaustive)}`);
    }
  }
}
