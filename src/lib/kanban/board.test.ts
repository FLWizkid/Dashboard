import { describe, expect, it } from "vitest";

import {
  canActivate,
  describeMissingForActivation,
  isLiveWork,
  missingForActivation,
  ACTIVATION_FIELDS,
} from "@/lib/tasks/draft";
import { READY_FIELDS } from "@/lib/tasks/ready";
import { sortTasks } from "@/lib/tasks/sort";
import type { Task } from "@/lib/tasks/types";

import {
  canMoveTo,
  canPromoteFromInbox,
  groupIntoLanes,
  laneAfterMove,
  LANES,
  triageSuggestions,
} from "./board";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Draft the board deck",
  notes: null,
  priority: "high",
  dueAt: "2026-08-12T21:00:00.000Z",
  categoryId: null,
  status: "inbox",
  pinned: false,
  sourceLink: null,
  owner: null,
  isReady: true,
  isDraft: false,
  canActivate: false,
  completedAt: null,
  createdAt: "2026-08-11T09:00:00.000Z",
  updatedAt: "2026-08-11T09:00:00.000Z",
  links: [],
  ...over,
});

/* ── Draft activation ─────────────────────────────────────────────────── */

describe("draft activation", () => {
  it("requires an owner as well as the Ready fields", () => {
    // Deliberately a higher bar than Ready. A follow-up with no owner is a
    // wish, and a decision log full of wishes stops being read.
    expect(ACTIVATION_FIELDS).toEqual(["owner", "dueAt", "priority"]);
    expect(ACTIVATION_FIELDS).toContain("owner");
    expect(READY_FIELDS).not.toContain("owner");
  });

  it("names what is missing", () => {
    expect(describeMissingForActivation(task({ owner: null }))).toBe(
      "Needs an owner",
    );
    expect(
      describeMissingForActivation(task({ owner: null, dueAt: null })),
    ).toBe("Needs an owner and a due date");
    expect(
      describeMissingForActivation(
        task({ owner: null, dueAt: null, priority: null }),
      ),
    ).toBe("Needs an owner, a due date and a priority");
  });

  it("says nothing when the task is complete", () => {
    expect(describeMissingForActivation(task({ owner: "Maya" }))).toBeNull();
  });

  it("treats whitespace as an absent owner", () => {
    expect(missingForActivation(task({ owner: "   " }))).toEqual(["owner"]);
  });

  it("activates only when all three are present", () => {
    expect(canActivate(task({ owner: "Maya" }))).toBe(true);
    expect(canActivate(task({ owner: "Maya", dueAt: null }))).toBe(false);
    expect(canActivate(task({ owner: "Maya", priority: null }))).toBe(false);
  });

  it("keeps drafts out of live work", () => {
    expect(isLiveWork(task())).toBe(true);
    expect(isLiveWork(task({ isDraft: true }))).toBe(false);
  });
});

/* ── Lanes ────────────────────────────────────────────────────────────── */

describe("lanes", () => {
  it("are the five from the specification, in order", () => {
    expect(LANES).toEqual(["inbox", "ready", "in_progress", "waiting", "done"]);
  });

  it("group tasks and exclude drafts", () => {
    const lanes = groupIntoLanes(
      [
        task({ id: "a", status: "inbox" }),
        task({ id: "b", status: "in_progress" }),
        task({ id: "c", status: "inbox", isDraft: true }),
      ],
      sortTasks,
    );

    expect(lanes.map((lane) => lane.status)).toEqual(LANES);
    expect(lanes[0].tasks.map((t) => t.id)).toEqual(["a"]);
    expect(lanes[2].tasks.map((t) => t.id)).toEqual(["b"]);
    // The draft belongs to the note that created it, not to the board.
    expect(lanes.flatMap((lane) => lane.tasks).map((t) => t.id)).not.toContain(
      "c",
    );
  });

  it("sorts within a lane with the same comparator as the task list", () => {
    const lanes = groupIntoLanes(
      [
        task({ id: "low", priority: "low" }),
        task({ id: "critical", priority: "critical" }),
      ],
      sortTasks,
    );

    expect(lanes[0].tasks.map((t) => t.id)).toEqual(["critical", "low"]);
  });

  it("moves one lane at a time and stops at the ends", () => {
    expect(laneAfterMove("inbox", 1)).toBe("ready");
    expect(laneAfterMove("ready", -1)).toBe("inbox");
    expect(laneAfterMove("inbox", -1)).toBe("inbox");
    expect(laneAfterMove("done", 1)).toBe("done");
  });
});

/* ── Moves ────────────────────────────────────────────────────────────── */

describe("canMoveTo", () => {
  it("gates Inbox → Ready on the Ready fields", () => {
    const incomplete = task({ priority: null, isReady: false });
    const result = canMoveTo(incomplete, "ready");

    expect(result.allowed).toBe(false);
    expect(result.missing).toBe("Needs priority");
  });

  it("allows the promotion once the fields are there", () => {
    expect(canMoveTo(task(), "ready").allowed).toBe(true);
  });

  it("does not gate any other move", () => {
    // Nobody needs a workflow engine telling them they may not put something
    // back.
    const incomplete = task({ priority: null, dueAt: null, isReady: false });

    for (const lane of ["inbox", "in_progress", "waiting", "done"] as const) {
      expect(canMoveTo(incomplete, lane).allowed, lane).toBe(true);
    }
  });

  it("refuses to move a draft at all, and says why", () => {
    const result = canMoveTo(task({ isDraft: true }), "in_progress");

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/owner, a due date and a priority/);
  });
});

/* ── Triage ───────────────────────────────────────────────────────────── */

describe("triageSuggestions", () => {
  it("asks for a priority first on an untriaged card", () => {
    const suggestions = triageSuggestions(
      task({ priority: null, dueAt: null, isReady: false }),
    );

    expect(suggestions[0]).toMatchObject({
      action: "set_priority",
      primary: true,
    });
    expect(suggestions.map((s) => s.action)).toContain("set_due");
  });

  it("offers exactly one primary suggestion", () => {
    // A card offering three equally weighted choices is a card you skip.
    for (const candidate of [
      task({ priority: null, dueAt: null, isReady: false }),
      task({ dueAt: null, isReady: false }),
      task(),
    ]) {
      const primary = triageSuggestions(candidate).filter((s) => s.primary);
      expect(
        primary.length,
        JSON.stringify(candidate.priority),
      ).toBeLessThanOrEqual(1);
    }
  });

  it("offers promotion once the card is complete", () => {
    expect(triageSuggestions(task()).map((s) => s.action)).toEqual(["promote"]);
    expect(canPromoteFromInbox(task())).toBe(true);
  });

  it("asks for a title before anything else", () => {
    const suggestions = triageSuggestions(
      task({ title: "  ", priority: null, isReady: false }),
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].action).toBe("set_title");
  });

  it("suggests starting a Ready card and completing a live one", () => {
    expect(triageSuggestions(task({ status: "ready" }))[0].action).toBe(
      "start",
    );
    expect(triageSuggestions(task({ status: "in_progress" }))[0].action).toBe(
      "complete",
    );
    expect(triageSuggestions(task({ status: "waiting" }))[0].action).toBe(
      "complete",
    );
  });

  it("suggests nothing for a done card or a draft", () => {
    expect(triageSuggestions(task({ status: "done" }))).toEqual([]);
    expect(triageSuggestions(task({ isDraft: true }))).toEqual([]);
  });

  it("gives every suggestion a reason", () => {
    const all = [
      ...triageSuggestions(task({ priority: null, isReady: false })),
      ...triageSuggestions(task()),
      ...triageSuggestions(task({ status: "ready" })),
    ];

    for (const suggestion of all) {
      expect(suggestion.reason.length, suggestion.action).toBeGreaterThan(10);
    }
  });

  it("does not offer promotion from outside the Inbox", () => {
    expect(canPromoteFromInbox(task({ status: "ready" }))).toBe(false);
  });
});
