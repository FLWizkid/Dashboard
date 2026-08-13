import { describe, expect, it, vi } from "vitest";

import type { ExternalRef } from "./model";
import { refreshStaleRefs } from "./refresh";
import type { ConnectorRepository } from "./repository";
import { ConnectorError, type Connector, type ResolvedRef } from "./types";

/**
 * The background refresh.
 *
 * The rules being protected: **never spend a request to learn nothing**, and
 * **one broken reference does not stop the rest**.
 */

const NOW = new Date("2026-08-10T12:00:00.000Z");
const LONG_AGO = "2026-08-01T00:00:00.000Z";

function ref(over: Partial<ExternalRef> = {}): ExternalRef {
  return {
    id: over.id ?? "ref-1",
    provider: "github",
    kind: "pull_request",
    remoteId: over.remoteId ?? "acme/api#1",
    url: "https://github.com/acme/api/pull/1",
    title: "Auth migration",
    subtitle: "acme/api#1",
    state: "open",
    stateDetail: null,
    author: "someone",
    remoteUpdatedAt: LONG_AGO,
    fetchedAt: LONG_AGO,
    fetchError: null,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    ...over,
  };
}

function resolved(remoteId: string): ResolvedRef {
  return {
    provider: "github",
    kind: "pull_request",
    remoteId,
    url: `https://github.com/${remoteId.replace("#", "/pull/")}`,
    title: "Auth migration",
    subtitle: remoteId,
    state: "merged",
    stateDetail: null,
    author: "someone",
    remoteUpdatedAt: NOW.toISOString(),
    snapshot: {},
  };
}

function harness(refs: ExternalRef[], connector?: Partial<Connector>) {
  const upsertRef = vi.fn(async (input: ResolvedRef) =>
    ref({ ...input } as never),
  );
  const recordRefFailure = vi.fn(async () => {});
  const refresh = vi.fn(async (remoteId: string) => resolved(remoteId));

  const repository = {
    staleRefs: async () => refs,
    upsertRef,
    recordRefFailure,
  } as unknown as ConnectorRepository;

  const stub: Connector = {
    provider: "github",
    capabilities: { search: false, webhooks: false } as never,
    recognises: () => true,
    resolve: async () => resolved("acme/api#1"),
    refresh,
    ...connector,
  };

  return { repository, connector: stub, upsertRef, recordRefFailure, refresh };
}

describe("what gets refreshed", () => {
  it("refreshes a stale, open reference", async () => {
    const h = harness([ref()]);

    const result = await refreshStaleRefs({
      repository: h.repository,
      connectorFor: () => h.connector,
      now: NOW,
    });

    expect(result.refreshed).toBe(1);
    expect(h.upsertRef).toHaveBeenCalledOnce();
  });

  it("never re-fetches a merged pull request", async () => {
    // Terminal is terminal. Re-fetching spends the rate limit to learn
    // nothing, forever, and the set of settled references only grows.
    const h = harness([ref({ state: "merged" })]);

    const result = await refreshStaleRefs({
      repository: h.repository,
      connectorFor: () => h.connector,
      now: NOW,
    });

    expect(result.skipped.settled).toBe(1);
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("leaves a freshly fetched reference alone", async () => {
    const h = harness([ref({ fetchedAt: NOW.toISOString() })]);

    const result = await refreshStaleRefs({
      repository: h.repository,
      connectorFor: () => h.connector,
      now: NOW,
    });

    expect(result.skipped.fresh).toBe(1);
  });

  it("backs off on a reference that failed an hour ago", async () => {
    // Hammering a provider that just answered 403 does not make it answer 200.
    const h = harness([
      ref({
        fetchError: "forbidden",
        fetchedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
      }),
    ]);

    const result = await refreshStaleRefs({
      repository: h.repository,
      connectorFor: () => h.connector,
      now: NOW,
    });

    expect(result.refreshed).toBe(0);
    expect(result.skipped.fresh).toBe(1);
  });

  it("retries one that failed two days ago", async () => {
    const h = harness([
      ref({
        fetchError: "forbidden",
        fetchedAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1000).toISOString(),
      }),
    ]);

    const result = await refreshStaleRefs({
      repository: h.repository,
      connectorFor: () => h.connector,
      now: NOW,
    });

    expect(result.refreshed).toBe(1);
  });
});

describe("when a provider is not configured", () => {
  it("skips rather than recording a failure against the reference", async () => {
    // The token was removed. That is not this reference's fault, and marking
    // it "out of date — forbidden" would make the interface blame the wrong
    // thing.
    const h = harness([ref()]);

    const result = await refreshStaleRefs({
      repository: h.repository,
      connectorFor: () => null,
      now: NOW,
    });

    expect(result.skipped.noConnector).toBe(1);
    expect(h.recordRefFailure).not.toHaveBeenCalled();
  });
});

describe("when one reference fails", () => {
  it("records it and keeps going", async () => {
    const h = harness([
      ref({ id: "a", remoteId: "acme/api#1" }),
      ref({ id: "b", remoteId: "acme/api#2" }),
    ]);

    h.refresh.mockImplementationOnce(async () => {
      throw new ConnectorError(
        "not_found",
        "github",
        "GitHub has no such item",
      );
    });

    const result = await refreshStaleRefs({
      repository: h.repository,
      connectorFor: () => h.connector,
      now: NOW,
    });

    expect(result.failed).toEqual([
      { remoteId: "acme/api#1", error: "GitHub has no such item" },
    ]);
    expect(result.refreshed).toBe(1);
    expect(h.recordRefFailure).toHaveBeenCalledWith(
      "a",
      "GitHub has no such item",
    );
  });

  it("survives the failure record itself failing", async () => {
    // A refresh pass that dies because it could not write down that something
    // died is the worst of both.
    const h = harness([ref()]);
    h.refresh.mockImplementation(async () => {
      throw new Error("boom");
    });
    h.recordRefFailure.mockImplementation(async () => {
      throw new Error("database is gone");
    });

    await expect(
      refreshStaleRefs({
        repository: h.repository,
        connectorFor: () => h.connector,
        now: NOW,
      }),
    ).resolves.toMatchObject({ refreshed: 0 });
  });
});
