import "server-only";

import { reportError } from "@/lib/observability/report";
import {
  adapterForAccount,
  CredentialsMissingError,
} from "./adapter-for-account";
import { backOffMs, shouldAttemptSync, syncMessages } from "./sync";
import type { SyncStore, SyncableAccount } from "./sync-store.supabase";

/**
 * One sync pass over every connected mailbox.
 *
 * The engine, the adapters and the store all existed; this is the caller that
 * was missing. Without it a connected account never populated anything, so the
 * calendar and inbox read an empty table no matter how healthy the sync
 * engine's tests looked.
 */

export interface AccountSyncOutcome {
  accountId: string;
  emailAddress: string;
  provider: string;
  status: string;
  stored: number;
  skipped: string | null;
  error: string | null;
}

export interface RunSyncResult {
  attempted: number;
  stored: number;
  outcomes: AccountSyncOutcome[];
}

export interface RunSyncOptions {
  store: SyncStore;
  /** Bounded so one enormous mailbox cannot monopolise a scheduled run. */
  limit?: number;
  now?: Date;
  internalDomains?: string[];
}

export async function runMailSync(
  options: RunSyncOptions,
): Promise<RunSyncResult> {
  const now = options.now ?? new Date();
  const accounts = await options.store.listSyncableAccounts();

  const outcomes: AccountSyncOutcome[] = [];
  let stored = 0;
  let attempted = 0;

  // Sequential on purpose. These are one person's mailboxes on a home server;
  // running three providers concurrently buys a second or two and costs a
  // predictable failure mode when a provider starts rate-limiting.
  for (const account of accounts) {
    const skip = skipReason(account, now);
    if (skip) {
      outcomes.push(outcome(account, { status: "skipped", skipped: skip }));
      continue;
    }

    attempted += 1;

    try {
      const adapter = adapterForAccount(
        {
          id: account.id,
          provider: account.provider,
          credentials_cipher: account.credentialsCipher,
        },
        {
          writeCredentials: (id, cipher) =>
            options.store.writeCredentials(id, cipher),
          internalDomains: options.internalDomains,
        },
      );

      const result = await syncMessages(adapter, {
        accountId: account.id,
        provider: account.provider,
        cachingPolicy: account.cachingPolicy,
        cursor: account.cursor,
        limit: options.limit ?? 50,
      });

      const written = await options.store.persist(account.id, result);
      stored += written;

      outcomes.push(
        outcome(account, {
          status: result.status,
          stored: written,
          error: result.error,
        }),
      );
    } catch (caught) {
      // A throw here is ours, not the provider's — the engine converts
      // provider problems into results. Worth reporting, and worth recording
      // against the account so the interface can say why it went quiet.
      const message =
        caught instanceof CredentialsMissingError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Unknown sync failure";

      if (!(caught instanceof CredentialsMissingError)) {
        reportError(caught, {
          source: `run-sync:${account.provider}`,
          extra: { accountId: account.id },
        });
      }

      await options.store
        .persist(account.id, {
          status: "degraded",
          messages: [],
          cursor: account.cursor,
          requiresFullResync: false,
          degraded: true,
          error: "sync_failed",
          detail: message,
        })
        .catch(() => {
          // Already in the failure path; a store that cannot record the
          // failure should not mask the original one.
        });

      outcomes.push(
        outcome(account, { status: "degraded", error: message }),
      );
    }
  }

  return { attempted, stored, outcomes };
}

/**
 * Why this account is being left alone this run.
 *
 * Off is not a failure and neither is back-off — both are the system working,
 * so they are reported as skips rather than errors. A red line every quarter
 * hour for a mailbox deliberately set to Off teaches you to stop reading the
 * log.
 */
function skipReason(account: SyncableAccount, now: Date): string | null {
  if (!account.syncMailEnabled) return "Mail sync is switched off";
  if (account.cachingPolicy === "off") {
    return "Caching is off for this mailbox";
  }
  if (!account.credentialsCipher) {
    return "Not connected — no stored credentials";
  }
  if (!shouldAttemptSync(account.lastRunAt, account.failureCount, now)) {
    return `Backing off after ${account.failureCount} failures (${Math.round(
      backOffMs(account.failureCount) / 1000,
    )}s)`;
  }
  return null;
}

function outcome(
  account: SyncableAccount,
  patch: Partial<AccountSyncOutcome> & { status: string },
): AccountSyncOutcome {
  return {
    accountId: account.id,
    emailAddress: account.emailAddress,
    provider: account.provider,
    stored: 0,
    skipped: null,
    error: null,
    ...patch,
  };
}
