import { beforeEach, describe, expect, it, vi } from "vitest";

import { runMailSync } from "./run-sync";
import type { SyncResult } from "./sync";
import type { SyncStore, SyncableAccount } from "./sync-store.supabase";

/**
 * These tests exist because of what the audit found: the sync engine, the
 * adapters and the store were all tested in isolation and all correct, and
 * the product still never fetched a single message, because nothing called
 * them. What follows tests the calling, not the parts.
 */

vi.mock("./adapter-for-account", async () => {
  const actual = await vi.importActual<typeof import("./adapter-for-account")>(
    "./adapter-for-account",
  );
  return {
    ...actual,
    adapterForAccount: vi.fn(() => ({}) as never),
  };
});

vi.mock("./sync", async () => {
  const actual = await vi.importActual<typeof import("./sync")>("./sync");
  return { ...actual, syncMessages: vi.fn() };
});

const { syncMessages } = await import("./sync");
const mockedSync = vi.mocked(syncMessages);

function account(patch: Partial<SyncableAccount> = {}): SyncableAccount {
  return {
    id: "account-1",
    provider: "gmail",
    cachingPolicy: "full",
    emailAddress: "doug@example.com",
    credentialsCipher: "cio1.k1.sealed",
    syncMailEnabled: true,
    cursor: null,
    failureCount: 0,
    lastRunAt: null,
    ...patch,
  };
}

function result(patch: Partial<SyncResult> = {}): SyncResult {
  return {
    status: "connected",
    messages: [],
    cursor: "cursor-2",
    requiresFullResync: false,
    degraded: false,
    error: null,
    detail: null,
    ...patch,
  };
}

function store(accounts: SyncableAccount[]): SyncStore & {
  persisted: { accountId: string; result: SyncResult }[];
} {
  const persisted: { accountId: string; result: SyncResult }[] = [];
  return {
    persisted,
    listSyncableAccounts: async () => accounts,
    writeCredentials: async () => {},
    persist: async (accountId, syncResult) => {
      persisted.push({ accountId, result: syncResult });
      return syncResult.messages.length;
    },
  };
}

describe("runMailSync", () => {
  // Several of these assert that the provider was *not* contacted, which is
  // only meaningful against a clean call record.
  beforeEach(() => {
    mockedSync.mockReset();
  });

  it("syncs a connected account and persists the result", async () => {
    mockedSync.mockResolvedValueOnce(result({ messages: [{}, {}] as never }));
    const target = store([account()]);

    const outcome = await runMailSync({ store: target });

    expect(outcome.attempted).toBe(1);
    expect(outcome.stored).toBe(2);
    expect(target.persisted).toHaveLength(1);
    expect(target.persisted[0].accountId).toBe("account-1");
  });

  it("skips a mailbox set to Off without contacting the provider", async () => {
    const target = store([account({ cachingPolicy: "off" })]);

    const outcome = await runMailSync({ store: target });

    expect(mockedSync).not.toHaveBeenCalled();
    expect(outcome.attempted).toBe(0);
    expect(outcome.outcomes[0].skipped).toMatch(/Caching is off/);
    // A skip is not a failure, so nothing is written against the account.
    expect(target.persisted).toHaveLength(0);
  });

  it("skips an account with no credentials rather than throwing", async () => {
    const target = store([account({ credentialsCipher: null })]);

    const outcome = await runMailSync({ store: target });

    expect(outcome.attempted).toBe(0);
    expect(outcome.outcomes[0].skipped).toMatch(/Not connected/);
  });

  it("respects back-off after repeated failures", async () => {
    const now = new Date("2026-08-20T12:00:00Z");
    const target = store([
      account({
        failureCount: 3,
        // Four minutes ago; back-off after three failures is four minutes.
        lastRunAt: new Date(now.getTime() - 60_000).toISOString(),
      }),
    ]);

    const outcome = await runMailSync({ store: target, now });

    expect(mockedSync).not.toHaveBeenCalled();
    expect(outcome.outcomes[0].skipped).toMatch(/Backing off/);
  });

  it("records a provider failure against the account and keeps going", async () => {
    mockedSync
      .mockResolvedValueOnce(
        result({ status: "degraded", error: "rate_limited", degraded: true }),
      )
      .mockResolvedValueOnce(result());

    const target = store([
      account({ id: "account-1" }),
      account({ id: "account-2" }),
    ]);

    const outcome = await runMailSync({ store: target });

    // The second account is still attempted: one provider being unhappy is
    // not a reason to leave the others unsynced.
    expect(outcome.attempted).toBe(2);
    expect(target.persisted[0].result.error).toBe("rate_limited");
    expect(outcome.outcomes[0].error).toBe("rate_limited");
    expect(outcome.outcomes[1].error).toBeNull();
  });

  it("turns an unexpected throw into a recorded degraded state", async () => {
    mockedSync.mockRejectedValueOnce(new Error("boom"));
    const target = store([account()]);

    const outcome = await runMailSync({ store: target });

    expect(outcome.outcomes[0].status).toBe("degraded");
    expect(outcome.outcomes[0].error).toBe("boom");
    expect(target.persisted[0].result.status).toBe("degraded");
    // The cursor is preserved so the next run resumes rather than skipping.
    expect(target.persisted[0].result.cursor).toBeNull();
  });
});
