import { describe, expect, it } from "vitest";

import {
  dueForRefresh,
  freshness,
  isSettled,
  STALE_AFTER_MS,
  type ExternalRef,
} from "./model";

/**
 * Freshness.
 *
 * The interesting question is not "how old is this" but **"how much should
 * the owner trust what is on screen"** — and the answer has to distinguish
 * three things that look identical in a timestamp: never looked, looked and
 * it was fine, looked and it failed.
 */

const NOW = new Date("2026-08-10T12:00:00.000Z");

function ref(over: Partial<ExternalRef> = {}): ExternalRef {
  return {
    id: "r1",
    provider: "github",
    kind: "pull_request",
    remoteId: "acme/api#482",
    url: "https://github.com/acme/api/pull/482",
    title: "Rotate the signing keys",
    subtitle: "acme/api#482",
    state: "open",
    stateDetail: null,
    author: "someone",
    remoteUpdatedAt: "2026-08-10T09:00:00.000Z",
    fetchedAt: "2026-08-10T11:00:00.000Z",
    fetchError: null,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-10T11:00:00.000Z",
    ...over,
  };
}

describe("freshness", () => {
  it("is fresh when it was fetched recently", () => {
    expect(freshness(ref(), NOW)).toBe("fresh");
  });

  it("is stale once the window has passed", () => {
    const old = new Date(NOW.getTime() - STALE_AFTER_MS - 1000).toISOString();
    expect(freshness(ref({ fetchedAt: old }), NOW)).toBe("stale");
  });

  it("says 'never' rather than 'stale' when it has not been fetched", () => {
    // A pasted URL that has not resolved yet is a different problem from an
    // old one, and the interface says something different about each.
    expect(freshness(ref({ fetchedAt: null }), NOW)).toBe("never");
  });

  it("reports a failure ahead of mere age", () => {
    // A failure is actionable — an expired token, a renamed repository. Age
    // is not, so it must not mask it.
    const old = new Date(NOW.getTime() - STALE_AFTER_MS - 1000).toISOString();
    expect(freshness(ref({ fetchedAt: old, fetchError: "403" }), NOW)).toBe(
      "failing",
    );
  });

  it("treats an unparseable timestamp as never fetched", () => {
    // Corrupt local state must not read as fresh, which is the direction
    // that silently shows wrong data.
    expect(freshness(ref({ fetchedAt: "not a date" }), NOW)).toBe("never");
  });
});

describe("what to re-fetch", () => {
  it("fetches something never fetched", () => {
    expect(dueForRefresh(ref({ fetchedAt: null }), NOW)).toBe(true);
  });

  it("leaves a fresh reference alone", () => {
    expect(dueForRefresh(ref(), NOW)).toBe(false);
  });

  it("re-fetches a stale one", () => {
    const old = new Date(NOW.getTime() - STALE_AFTER_MS - 1000).toISOString();
    expect(dueForRefresh(ref({ fetchedAt: old }), NOW)).toBe(true);
  });

  it("backs off a failing one rather than hammering it", () => {
    // Retrying a 403 every six hours does not make it a 200, and a provider
    // that just rate-limited you is not helped by more requests.
    const recentFailure = new Date(
      NOW.getTime() - 7 * 60 * 60 * 1000,
    ).toISOString();

    expect(
      dueForRefresh(ref({ fetchedAt: recentFailure, fetchError: "403" }), NOW),
    ).toBe(false);
  });

  it("does retry a failing one eventually", () => {
    const oldFailure = new Date(
      NOW.getTime() - 25 * 60 * 60 * 1000,
    ).toISOString();

    expect(
      dueForRefresh(ref({ fetchedAt: oldFailure, fetchError: "403" }), NOW),
    ).toBe(true);
  });
});

describe("settled states", () => {
  it("counts merged, closed and archived", () => {
    expect(isSettled(ref({ state: "merged" }))).toBe(true);
    expect(isSettled(ref({ state: "closed" }))).toBe(true);
    expect(isSettled(ref({ state: "archived" }))).toBe(true);
  });

  it("does not count open work", () => {
    expect(isSettled(ref({ state: "open" }))).toBe(false);
    expect(isSettled(ref({ state: "in_progress" }))).toBe(false);
  });

  it("does not count a thing that has no state", () => {
    // A document is not "settled"; it simply has no lifecycle. Treating it as
    // finished would stop it ever being refreshed.
    expect(isSettled(ref({ state: "none" }))).toBe(false);
  });
});
