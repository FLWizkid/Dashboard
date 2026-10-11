import { describe, expect, it } from "vitest";

import {
  compareScored,
  contributingFactors,
  explainBriefly,
  scoreTask,
  WEIGHTS,
  type ScoreInput,
} from "./score";

/**
 * The scoring engine.
 *
 * The gate is "auto-ranking feels right and is explainable; overrides
 * respected", and each of those three is a testable claim:
 *
 *   *feels right* — the worked examples below are the ones from `docs/
 *   priority.md`, so the documentation and the code cannot drift apart.
 *   *explainable* — every factor that moves a score carries a sentence.
 *   *overrides respected* — a manual rank beats every score, always.
 */

const NOW = new Date("2026-08-10T09:00:00.000Z");

function input(partial: Partial<ScoreInput> = {}): ScoreInput {
  return {
    id: "task-1",
    priority: null,
    dueAt: null,
    createdAt: "2026-08-01T09:00:00.000Z",
    pinned: false,
    manualRank: null,
    ...partial,
  };
}

describe("the weights", () => {
  it("sum to exactly 1, so the total is a percentage of a real maximum", () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("are the ones the specification asked for", () => {
    expect(WEIGHTS).toEqual({
      importance: 0.35,
      overdue: 0.25,
      dueProximity: 0.2,
      calendarProximity: 0.15,
      manual: 0.05,
    });
  });
});

describe("determinism", () => {
  it("gives the same answer for the same inputs, every time", () => {
    const task = input({ priority: "high", dueAt: "2026-08-11T09:00:00.000Z" });

    const runs = Array.from({ length: 20 }, () => scoreTask(task, NOW).total);
    expect(new Set(runs).size).toBe(1);
  });

  it("does not depend on the order tasks are scored in", () => {
    const a = input({ id: "a", priority: "high" });
    const b = input({ id: "b", priority: "low" });

    const forward = [scoreTask(a, NOW).total, scoreTask(b, NOW).total];
    const backward = [scoreTask(b, NOW).total, scoreTask(a, NOW).total];

    expect(forward).toEqual([backward[1], backward[0]]);
  });

  it("never exceeds 100 or drops below 0, even when everything fires", () => {
    const everything = input({
      priority: "critical",
      dueAt: "2026-06-01T09:00:00.000Z",
      pinned: true,
      inferredImportance: 1,
      linkedEvent: {
        startsAt: "2026-08-10T15:00:00.000Z",
        relation: "prep",
      },
    });

    const score = scoreTask(everything, NOW);
    expect(score.total).toBeGreaterThan(0);
    expect(score.total).toBeLessThanOrEqual(100);
  });

  it("scores an empty task at something, not nothing", () => {
    // An untriaged task with no dates still has importance 0.3 — new captures
    // must not sit at zero, or they sink below everything permanently.
    const score = scoreTask(input(), NOW);
    expect(score.total).toBeGreaterThan(0);
  });
});

describe("importance", () => {
  it("ranks the stated priorities in order", () => {
    const totals = (["critical", "high", "normal", "low"] as const).map(
      (priority) => scoreTask(input({ priority }), NOW).total,
    );

    expect(totals).toEqual([...totals].sort((a, b) => b - a));
  });

  it("puts untriaged between normal and low", () => {
    const normal = scoreTask(input({ priority: "normal" }), NOW).total;
    const untriaged = scoreTask(input({ priority: null }), NOW).total;
    const low = scoreTask(input({ priority: "low" }), NOW).total;

    expect(untriaged).toBeLessThan(normal);
    expect(untriaged).toBeGreaterThan(low);
  });

  it("lets inference raise a task above what its priority alone would give", () => {
    const plain = scoreTask(input({ priority: "low" }), NOW);
    const boosted = scoreTask(
      input({ priority: "low", inferredImportance: 0.9 }),
      NOW,
    );

    expect(boosted.total).toBeGreaterThan(plain.total);
  });

  it("never lets inference lower a stated priority", () => {
    // The engine may notice context; it may not overrule you.
    const stated = scoreTask(input({ priority: "critical" }), NOW);
    const withWeakContext = scoreTask(
      input({ priority: "critical", inferredImportance: 0.1 }),
      NOW,
    );

    expect(withWeakContext.total).toBe(stated.total);
  });
});

describe("overdue", () => {
  it("grows with lateness", () => {
    const oneDay = scoreTask(
      input({ dueAt: "2026-08-09T09:00:00.000Z" }),
      NOW,
    ).total;
    const oneWeek = scoreTask(
      input({ dueAt: "2026-08-03T09:00:00.000Z" }),
      NOW,
    ).total;

    expect(oneWeek).toBeGreaterThan(oneDay);
  });

  it("saturates at a fortnight, so one forgotten task can't own the list", () => {
    const twoWeeks = scoreTask(
      input({ dueAt: "2026-07-27T09:00:00.000Z" }),
      NOW,
    ).total;
    const sixMonths = scoreTask(
      input({ dueAt: "2026-02-10T09:00:00.000Z" }),
      NOW,
    ).total;

    expect(sixMonths).toBe(twoWeeks);
  });

  it("does not fire for something merely due soon", () => {
    const score = scoreTask(input({ dueAt: "2026-08-11T09:00:00.000Z" }), NOW);
    const overdue = score.factors.find((f) => f.factor === "overdue");

    expect(overdue?.points).toBe(0);
  });

  it("does not double-count with due proximity", () => {
    // Once late, only the overdue factor should be contributing; letting both
    // fire would weight the same fact at 45% of the total.
    const score = scoreTask(input({ dueAt: "2026-08-08T09:00:00.000Z" }), NOW);

    expect(
      score.factors.find((f) => f.factor === "overdue")!.points,
    ).toBeGreaterThan(0);
    expect(score.factors.find((f) => f.factor === "dueProximity")!.points).toBe(
      0,
    );
  });
});

describe("due proximity", () => {
  it("is stronger the sooner the task is due", () => {
    const tomorrow = scoreTask(
      input({ dueAt: "2026-08-11T09:00:00.000Z" }),
      NOW,
    ).total;
    const nextWeek = scoreTask(
      input({ dueAt: "2026-08-16T09:00:00.000Z" }),
      NOW,
    ).total;

    expect(tomorrow).toBeGreaterThan(nextWeek);
  });

  it("contributes nothing beyond the seven-day horizon", () => {
    const score = scoreTask(input({ dueAt: "2026-09-10T09:00:00.000Z" }), NOW);
    expect(score.factors.find((f) => f.factor === "dueProximity")!.points).toBe(
      0,
    );
  });
});

describe("calendar proximity", () => {
  it("boosts prep as the meeting approaches", () => {
    const soon = scoreTask(
      input({
        linkedEvent: { startsAt: "2026-08-10T15:00:00.000Z", relation: "prep" },
      }),
      NOW,
    );
    const later = scoreTask(
      input({
        linkedEvent: { startsAt: "2026-08-12T09:00:00.000Z", relation: "prep" },
      }),
      NOW,
    );

    expect(soon.total).toBeGreaterThan(later.total);
  });

  it("gives prep nothing once the meeting has passed", () => {
    const score = scoreTask(
      input({
        linkedEvent: { startsAt: "2026-08-09T09:00:00.000Z", relation: "prep" },
      }),
      NOW,
    );

    expect(
      score.factors.find((f) => f.factor === "calendarProximity")!.points,
    ).toBe(0);
  });

  it("gives follow-up nothing BEFORE its meeting, and says why", () => {
    // Ranking a follow-up highly the day before its meeting would be the
    // engine telling you to do something you cannot yet do.
    const score = scoreTask(
      input({
        linkedEvent: {
          startsAt: "2026-08-11T09:00:00.000Z",
          relation: "follow_up",
        },
      }),
      NOW,
    );

    const factor = score.factors.find((f) => f.factor === "calendarProximity")!;
    expect(factor.points).toBe(0);
  });

  it("boosts follow-up right after its meeting, decaying over three days", () => {
    const justAfter = scoreTask(
      input({
        linkedEvent: {
          startsAt: "2026-08-10T08:00:00.000Z",
          relation: "follow_up",
        },
      }),
      NOW,
    ).total;

    const twoDaysAfter = scoreTask(
      input({
        linkedEvent: {
          startsAt: "2026-08-08T08:00:00.000Z",
          relation: "follow_up",
        },
      }),
      NOW,
    ).total;

    expect(justAfter).toBeGreaterThan(twoDaysAfter);
  });

  it("treats a merely related meeting as weaker than declared prep", () => {
    const prep = scoreTask(
      input({
        linkedEvent: { startsAt: "2026-08-10T15:00:00.000Z", relation: "prep" },
      }),
      NOW,
    ).total;
    const related = scoreTask(
      input({
        linkedEvent: {
          startsAt: "2026-08-10T15:00:00.000Z",
          relation: "related",
        },
      }),
      NOW,
    ).total;

    expect(prep).toBeGreaterThan(related);
  });
});

describe("ordering and tie-breaks", () => {
  const scored = (partial: Partial<ScoreInput>) => {
    const value = input(partial);
    return { score: scoreTask(value, NOW), createdAt: value.createdAt };
  };

  it("puts a manually ranked task above every scored one", () => {
    // Even against a task that is critical, weeks overdue and pinned.
    const manual = scored({ id: "manual", manualRank: 0, priority: "low" });
    const screaming = scored({
      id: "screaming",
      priority: "critical",
      dueAt: "2026-07-01T09:00:00.000Z",
      pinned: true,
    });

    expect(compareScored(manual, screaming)).toBeLessThan(0);
    expect(compareScored(screaming, manual)).toBeGreaterThan(0);
  });

  it("orders manually ranked tasks among themselves by rank", () => {
    const first = scored({ id: "a", manualRank: 0 });
    const second = scored({ id: "b", manualRank: 1 });

    expect(compareScored(first, second)).toBeLessThan(0);
  });

  it("falls back to score, descending", () => {
    const high = scored({ id: "h", priority: "critical" });
    const low = scored({ id: "l", priority: "low" });

    expect(compareScored(high, low)).toBeLessThan(0);
  });

  it("breaks a score tie by age, oldest first", () => {
    const older = {
      score: scoreTask(input({ id: "older" }), NOW),
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const newer = {
      score: scoreTask(input({ id: "newer" }), NOW),
      createdAt: "2026-08-01T00:00:00.000Z",
    };

    expect(older.score.total).toBe(newer.score.total);
    expect(compareScored(older, newer)).toBeLessThan(0);
  });

  it("breaks a total tie by id, so the order never shuffles between renders", () => {
    const a = {
      score: scoreTask(input({ id: "aaa" }), NOW),
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const b = {
      score: scoreTask(input({ id: "bbb" }), NOW),
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    expect(compareScored(a, b)).toBeLessThan(0);
    expect(compareScored(b, a)).toBeGreaterThan(0);
  });

  it("is a total order — sorting is stable whatever the input order", () => {
    const tasks = [
      scored({ id: "a", priority: "high" }),
      scored({ id: "b", priority: "low" }),
      scored({ id: "c", manualRank: 2 }),
      scored({ id: "d", priority: "critical" }),
      scored({ id: "e", manualRank: 1 }),
      scored({ id: "f" }),
    ];

    const forward = [...tasks].sort(compareScored).map((t) => t.score.taskId);
    const reversed = [...tasks]
      .reverse()
      .sort(compareScored)
      .map((t) => t.score.taskId);

    expect(forward).toEqual(reversed);
    expect(forward.slice(0, 2)).toEqual(["e", "c"]);
  });
});

describe("explanations", () => {
  it("gives every contributing factor a sentence", () => {
    const score = scoreTask(
      input({
        priority: "high",
        dueAt: "2026-08-11T09:00:00.000Z",
        pinned: true,
        linkedEvent: { startsAt: "2026-08-10T15:00:00.000Z", relation: "prep" },
      }),
      NOW,
    );

    const contributing = contributingFactors(score);
    expect(contributing.length).toBeGreaterThan(0);
    for (const factor of contributing) {
      expect(factor.reason).toBeTruthy();
    }
  });

  it("never explains a factor that contributed nothing", () => {
    const score = scoreTask(input({ priority: "high" }), NOW);

    const silent = score.factors.filter((f) => f.points === 0);
    expect(silent.length).toBeGreaterThan(0);
    for (const factor of silent) {
      expect(factor.reason).toBeNull();
    }
  });

  it("orders the explanation by how much each factor actually moved it", () => {
    const score = scoreTask(
      input({ priority: "low", dueAt: "2026-07-01T09:00:00.000Z" }),
      NOW,
    );

    const contributing = contributingFactors(score);
    // Weeks overdue beats a low priority, and the explanation leads with it.
    expect(contributing[0].factor).toBe("overdue");
  });

  it("says plainly when a manual rank is what's happening", () => {
    const score = scoreTask(input({ manualRank: 0, priority: "low" }), NOW);
    expect(explainBriefly(score)).toBe("You placed this by hand.");
  });

  it("has something to say even about a task nothing is pushing", () => {
    expect(explainBriefly(scoreTask(input(), NOW))).toBeTruthy();
  });
});

describe("worked examples from the documentation", () => {
  // These are reproduced verbatim in docs/priority.md. If a weight changes,
  // one of these fails and the documentation gets corrected with the code.

  it("the board deck due tomorrow, with the board meeting tomorrow morning", () => {
    const score = scoreTask(
      input({
        id: "deck",
        priority: "high",
        dueAt: "2026-08-11T17:00:00.000Z",
        inferredImportance: 0.85,
        linkedEvent: { startsAt: "2026-08-11T09:00:00.000Z", relation: "prep" },
      }),
      NOW,
    );

    //   importance   0.85 × 35 = 29.75
    //   overdue         0 × 25 =  0
    //   due proximity  1 − 1.33/7 = 0.81 × 20 = 16.19
    //   calendar       1 − 24/48  = 0.50 × 15 =  7.50
    expect(score.total).toBeCloseTo(53.44, 2);
  });

  it("gives a meeting exactly 48 hours out nothing — that is the window edge", () => {
    // Worth pinning: the decay is linear and reaches zero *at* the boundary,
    // so "within 48 hours" means strictly within.
    const score = scoreTask(
      input({
        linkedEvent: { startsAt: "2026-08-12T09:00:00.000Z", relation: "prep" },
      }),
      NOW,
    );

    expect(
      score.factors.find((f) => f.factor === "calendarProximity")!.points,
    ).toBe(0);
  });

  it("the expenses form, three weeks late, low priority", () => {
    const score = scoreTask(
      input({
        id: "expenses",
        priority: "low",
        dueAt: "2026-07-20T09:00:00.000Z",
      }),
      NOW,
    );

    // 0.15×35 + 1×25 (saturated) + 0 + 0 + 0
    expect(score.total).toBeCloseTo(30.25, 1);
  });

  it("an untriaged capture from this morning", () => {
    const score = scoreTask(input({ id: "capture" }), NOW);

    // 0.3×35, and nothing else.
    expect(score.total).toBeCloseTo(10.5, 1);
  });
});
