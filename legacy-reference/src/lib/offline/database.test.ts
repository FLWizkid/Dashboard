import { describe, expect, it } from "vitest";

import { indexedDbCaptureStore } from "@/lib/tasks/capture-queue";
import { indexedDbOutbox } from "@/lib/hours/outbox";

import { DB_NAME, DB_VERSION, STORES } from "./database";

/**
 * The shared offline database.
 *
 * These tests exist because of a real bug. Offline capture was added with its
 * own copy of the open-and-upgrade logic and its own `DB_VERSION = 2`, while
 * the hours outbox still opened the same database name at version 1. Opening
 * an IndexedDB database at a *lower* version than it currently holds does not
 * upgrade and does not fall back — it fails with a `VersionError`.
 *
 * So a change to the tasks module silently broke offline time logging. Five
 * hours specs went red at once, which was lucky: the failure is invisible
 * until a queue is actually needed, and that is by definition the moment there
 * is no network to fall back on.
 */

describe("one database, one version", () => {
  it("names every store the app opens", () => {
    // A store used by a queue but missing from here would never be created by
    // the upgrade handler, and every read against it would throw.
    expect(Object.values(STORES)).toEqual(["time-entries", "captures"]);
  });

  it("keeps the version at or above the number of stores", () => {
    // Not arithmetic for its own sake: each store was added by a version bump,
    // so a version lower than the store count means one was added without one.
    expect(DB_VERSION).toBeGreaterThanOrEqual(Object.values(STORES).length);
  });

  it("uses one database name", () => {
    expect(DB_NAME).toBe("cio-dashboard-outbox");
  });
});

describe("both queues", () => {
  it("expose the same storage shape", () => {
    // They are separate features with separate merge rules, but the storage
    // contract is identical — which is what made sharing a database sensible
    // in the first place, and what made getting it wrong so easy.
    for (const store of [indexedDbOutbox, indexedDbCaptureStore]) {
      expect(typeof store.all).toBe("function");
      expect(typeof store.put).toBe("function");
      expect(typeof store.remove).toBe("function");
      expect(typeof store.clear).toBe("function");
    }
  });

  it("do not open the database themselves", async () => {
    // The actual regression guard. If either module ever calls
    // `indexedDB.open` again, it owns a version, and the two can drift.
    const sources = await Promise.all([
      import("node:fs").then(({ readFileSync }) =>
        readFileSync("src/lib/hours/outbox.ts", "utf8"),
      ),
      import("node:fs").then(({ readFileSync }) =>
        readFileSync("src/lib/tasks/capture-queue.ts", "utf8"),
      ),
    ]);

    for (const source of sources) {
      expect(source).not.toMatch(/indexedDB\.open/);
      expect(source).not.toMatch(/DB_VERSION\s*=/);
    }
  });
});
