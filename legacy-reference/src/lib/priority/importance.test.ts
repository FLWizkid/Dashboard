import { describe, expect, it } from "vitest";

import {
  explainImportance,
  inferImportance,
  inheritedImportance,
  strongestImportance,
  type EventContext,
  type InferenceOptions,
} from "./importance";

/**
 * Importance inference.
 *
 * The rule every test here is really checking: **every signal must be one the
 * owner can verify by looking at the meeting.** A boost they cannot trace to
 * something visible is a boost they cannot correct, and an uncorrectable
 * ranking gets ignored.
 */

const NOW = new Date("2026-08-10T09:00:00.000Z");

function event(partial: Partial<EventContext> = {}): EventContext {
  return {
    id: "event-1",
    title: "Weekly sync",
    startsAt: "2026-08-11T09:00:00.000Z",
    endsAt: "2026-08-11T10:00:00.000Z",
    attendeeCount: 3,
    isExternal: false,
    isCancelled: false,
    organizerAddress: "someone@example.invalid",
    isOwnerOrganiser: false,
    ...partial,
  };
}

function options(partial: Partial<InferenceOptions> = {}): InferenceOptions {
  return { relation: "prep", now: NOW, ...partial };
}

describe("proximity", () => {
  it("boosts a meeting inside the 48-hour window", () => {
    const result = inferImportance(event(), options());
    expect(result.value).toBeGreaterThan(0);
    expect(result.hits.some((hit) => hit.signal === "imminent")).toBe(true);
  });

  it("boosts more the closer the meeting is", () => {
    const inThreeHours = inferImportance(
      event({ startsAt: "2026-08-10T12:00:00.000Z" }),
      options(),
    );
    const inThirtySix = inferImportance(
      event({ startsAt: "2026-08-11T21:00:00.000Z" }),
      options(),
    );

    expect(inThreeHours.value).toBeGreaterThan(inThirtySix.value);
  });

  it("gives nothing to a meeting beyond the window", () => {
    const result = inferImportance(
      event({ startsAt: "2026-08-20T09:00:00.000Z" }),
      options(),
    );

    expect(result.hits.some((hit) => hit.signal === "imminent")).toBe(false);
  });

  it("gives prep nothing once the meeting has started", () => {
    const result = inferImportance(
      event({ startsAt: "2026-08-09T09:00:00.000Z" }),
      options({ relation: "prep" }),
    );

    expect(result.hits.some((hit) => hit.signal === "imminent")).toBe(false);
  });

  it("runs follow-up on the other side of the meeting", () => {
    const before = inferImportance(
      event({ startsAt: "2026-08-11T09:00:00.000Z" }),
      options({ relation: "follow_up" }),
    );
    const after = inferImportance(
      event({ startsAt: "2026-08-10T07:00:00.000Z" }),
      options({ relation: "follow_up" }),
    );

    expect(before.hits.some((hit) => hit.signal === "imminent")).toBe(false);
    expect(after.hits.some((hit) => hit.signal === "imminent")).toBe(true);
  });
});

describe("the strong signals", () => {
  it("boosts a meeting with someone outside the organisation", () => {
    const internal = inferImportance(event(), options());
    const external = inferImportance(event({ isExternal: true }), options());

    expect(external.value).toBeGreaterThan(internal.value);
    expect(
      external.hits.find((hit) => hit.signal === "external")?.reason,
    ).toContain("outside your organisation");
  });

  it("boosts a meeting whose title names a leadership forum", () => {
    const plain = inferImportance(event({ title: "Weekly sync" }), options());
    const exec = inferImportance(
      event({ title: "Exec review of the roadmap" }),
      options(),
    );

    expect(exec.value).toBeGreaterThan(plain.value);
  });

  it("treats a large meeting as a weaker version of the same signal", () => {
    const named = inferImportance(
      event({ title: "Leadership forum", attendeeCount: 3 }),
      options(),
    );
    const large = inferImportance(
      event({ title: "Planning", attendeeCount: 20 }),
      options(),
    );

    const namedWeight = named.hits.find(
      (h) => h.signal === "leadership",
    )!.weight;
    const largeWeight = large.hits.find(
      (h) => h.signal === "leadership",
    )!.weight;

    expect(largeWeight).toBeLessThan(namedWeight);
  });

  it("does not count size twice when the title already says leadership", () => {
    const both = inferImportance(
      event({ title: "Exec review", attendeeCount: 20 }),
      options(),
    );

    expect(both.hits.filter((hit) => hit.signal === "leadership")).toHaveLength(
      1,
    );
  });

  it("boosts a meeting where something gets decided", () => {
    const plain = inferImportance(event({ title: "Weekly sync" }), options());
    const decision = inferImportance(
      event({ title: "Budget approval" }),
      options(),
    );

    expect(decision.value).toBeGreaterThan(plain.value);
    expect(
      decision.hits.find((hit) => hit.signal === "decision")?.reason,
    ).toContain("approval");
  });

  it("gives a small boost for a meeting you organised", () => {
    const theirs = inferImportance(event(), options());
    const yours = inferImportance(event({ isOwnerOrganiser: true }), options());

    expect(yours.value).toBeGreaterThan(theirs.value);
  });
});

describe("saturation and refusals", () => {
  it("saturates rather than exceeding 1", () => {
    const everything = inferImportance(
      event({
        title: "Board decision: exec sign-off",
        startsAt: "2026-08-10T10:00:00.000Z",
        attendeeCount: 20,
        isExternal: true,
        isOwnerOrganiser: true,
      }),
      options(),
    );

    expect(everything.value).toBeLessThanOrEqual(1);
    expect(everything.value).toBeGreaterThan(0.9);
  });

  it("gives a cancelled meeting nothing at all", () => {
    // A cancelled meeting is not a reason to do anything, however important
    // it would otherwise have been.
    const result = inferImportance(
      event({
        title: "Board decision",
        isExternal: true,
        isCancelled: true,
        startsAt: "2026-08-10T10:00:00.000Z",
      }),
      options(),
    );

    expect(result.value).toBe(0);
    expect(result.hits).toEqual([]);
  });

  it("survives an unparseable start time without inventing a boost", () => {
    const result = inferImportance(
      event({ startsAt: "not a date" }),
      options(),
    );

    expect(result.hits.some((hit) => hit.signal === "imminent")).toBe(false);
    expect(Number.isFinite(result.value)).toBe(true);
  });
});

describe("inheritance", () => {
  it("gives linked work part of the boost, never all of it", () => {
    // The prep for the board meeting matters because the board meeting does,
    // but it is not as important as the board meeting.
    expect(inheritedImportance(1, "prep")).toBeLessThan(1);
    expect(inheritedImportance(1, "prep")).toBeGreaterThan(0);
  });

  it("gives prep more than follow-up", () => {
    // Prep has a deadline it cannot miss: the meeting happens either way.
    expect(inheritedImportance(1, "prep")).toBeGreaterThan(
      inheritedImportance(1, "follow_up"),
    );
  });

  it("gives a merely related task the least", () => {
    expect(inheritedImportance(1, "related")).toBeLessThan(
      inheritedImportance(1, "follow_up"),
    );
  });

  it("inherits nothing from an unimportant parent", () => {
    expect(inheritedImportance(0, "prep")).toBe(0);
  });

  it("scales with the parent", () => {
    expect(inheritedImportance(0.5, "prep")).toBeLessThan(
      inheritedImportance(1, "prep"),
    );
  });
});

describe("several linked meetings", () => {
  it("takes the strongest, not the sum", () => {
    // Summing would make "link everything to everything" a way to game your
    // own ranking, and four dull meetings do not add up to the board.
    const weak = inferImportance(event({ title: "Weekly sync" }), options());
    const strong = inferImportance(
      event({ title: "Board decision", isExternal: true }),
      options(),
    );

    const best = strongestImportance([weak, weak, weak, strong]);
    expect(best.value).toBe(strong.value);
  });

  it("handles having no linked meetings at all", () => {
    expect(strongestImportance([])).toEqual({ value: 0, hits: [] });
  });
});

describe("explanations", () => {
  it("names the strongest signal", () => {
    const result = inferImportance(
      event({ title: "Board decision", isExternal: true }),
      options(),
    );

    const explanation = explainImportance(result);
    expect(explanation).toBeTruthy();
    expect(typeof explanation).toBe("string");
  });

  it("has nothing to say when nothing fired", () => {
    const result = inferImportance(
      event({ startsAt: "2026-09-20T09:00:00.000Z" }),
      options(),
    );

    expect(explainImportance(result)).toBeNull();
  });

  it("gives every hit a reason naming something checkable", () => {
    const result = inferImportance(
      event({
        title: "Exec board approval",
        isExternal: true,
        isOwnerOrganiser: true,
        attendeeCount: 12,
      }),
      options(),
    );

    for (const hit of result.hits) {
      expect(hit.reason.length).toBeGreaterThan(0);
      // Not a bare score — the sentence has to point at something.
      expect(hit.reason).not.toMatch(/^\d/);
    }
  });
});
