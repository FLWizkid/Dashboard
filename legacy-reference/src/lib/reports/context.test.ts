import { describe, expect, it } from "vitest";

import type { ExternalRefState, LinkedRef } from "@/lib/connectors/model";

import { contextChanges, describeChange } from "./context";

/**
 * What the brief says about linked context.
 *
 * The rule being protected: **a brief lists what changed, not what exists.**
 * Everything else here follows from that.
 */

const SINCE = new Date("2026-08-10T06:00:00.000Z");

function link(
  id: string,
  over: {
    state?: ExternalRefState;
    updatedAt?: string | null;
    confirmed?: boolean;
    title?: string;
    subtitle?: string | null;
  } = {},
): LinkedRef {
  return {
    id,
    refId: `ref-${id}`,
    taskId: "task-1",
    noteId: null,
    relation: "about",
    confirmedAt: over.confirmed === false ? null : "2026-08-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    ref: {
      id: `ref-${id}`,
      provider: "github",
      kind: "pull_request",
      remoteId: `acme/api#${id}`,
      url: `https://github.com/acme/api/pull/${id}`,
      title: over.title ?? `Pull request ${id}`,
      subtitle: over.subtitle === undefined ? `acme/api#${id}` : over.subtitle,
      state: over.state ?? "open",
      stateDetail: null,
      author: "someone",
      remoteUpdatedAt:
        over.updatedAt === undefined
          ? "2026-08-10T08:00:00.000Z"
          : over.updatedAt,
      fetchedAt: "2026-08-10T09:00:00.000Z",
      fetchError: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-10T09:00:00.000Z",
    },
  };
}

describe("what counts as news", () => {
  it("includes a reference that changed after the cutoff", () => {
    const changes = contextChanges({ links: [link("1")], since: SINCE });
    expect(changes).toHaveLength(1);
  });

  it("excludes one that has not moved since the last brief", () => {
    // Otherwise every brief repeats yesterday's, and the section becomes
    // something you scroll past.
    const stale = link("1", { updatedAt: "2026-08-09T00:00:00.000Z" });
    expect(contextChanges({ links: [stale], since: SINCE })).toEqual([]);
  });

  it("excludes an unconfirmed link entirely", () => {
    // A suggestion the owner has not agreed to is not a relationship. Sending
    // news about it would be the product asserting a link it was specifically
    // designed not to assert.
    const suggested = link("1", { confirmed: false });
    expect(contextChanges({ links: [suggested], since: SINCE })).toEqual([]);
  });

  it("excludes one with no update timestamp at all", () => {
    const unknown = link("1", { updatedAt: null });
    expect(contextChanges({ links: [unknown], since: SINCE })).toEqual([]);
  });

  it("ignores an unparseable timestamp rather than treating it as now", () => {
    const broken = link("1", { updatedAt: "not a date" });
    expect(contextChanges({ links: [broken], since: SINCE })).toEqual([]);
  });
});

describe("ordering", () => {
  it("puts settled work first", () => {
    // A merged pull request may mean a task is finished, which is an action.
    // Ordinary activity is a nudge.
    const changes = contextChanges({
      links: [
        link("busy", { state: "open", updatedAt: "2026-08-10T11:00:00.000Z" }),
        link("done", {
          state: "merged",
          updatedAt: "2026-08-10T07:00:00.000Z",
        }),
      ],
      since: SINCE,
    });

    expect(changes.map((change) => change.reason)).toEqual([
      "settled",
      "updated",
    ]);
  });

  it("orders by recency within a reason", () => {
    const changes = contextChanges({
      links: [
        link("older", { updatedAt: "2026-08-10T07:00:00.000Z" }),
        link("newer", { updatedAt: "2026-08-10T09:00:00.000Z" }),
      ],
      since: SINCE,
    });

    expect(changes.map((change) => change.link.id)).toEqual(["newer", "older"]);
  });

  it("is a total order, so a re-run does not reshuffle", () => {
    const same = "2026-08-10T08:00:00.000Z";
    const changes = contextChanges({
      links: [link("b", { updatedAt: same }), link("a", { updatedAt: same })],
      since: SINCE,
    });

    expect(changes.map((change) => change.link.id)).toEqual(["a", "b"]);
  });

  it("keeps the brief a brief", () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      link(String(index).padStart(2, "0")),
    );

    expect(contextChanges({ links: many, since: SINCE })).toHaveLength(8);
  });
});

describe("the sentence", () => {
  it("says merged rather than closed", () => {
    // The distinction the connector works to preserve must survive into the
    // words the owner actually reads.
    expect(
      describeChange({
        link: link("1", { state: "merged" }),
        reason: "settled",
      }),
    ).toContain("was merged");
  });

  it("says closed for a closed one", () => {
    expect(
      describeChange({
        link: link("1", { state: "closed" }),
        reason: "settled",
      }),
    ).toContain("was closed");
  });

  it("names where it lives", () => {
    expect(describeChange({ link: link("1"), reason: "updated" })).toContain(
      "(acme/api#1)",
    );
  });

  it("reads properly when there is no subtitle", () => {
    // No stray brackets, no double space.
    const sentence = describeChange({
      link: link("1", { subtitle: null, title: "A document" }),
      reason: "updated",
    });

    expect(sentence).toBe("A document has activity");
  });
});
