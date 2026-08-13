import { describe, expect, it } from "vitest";

import type { Task, TaskLink, TaskLinkRelation } from "@/lib/tasks/types";

import type { EventContext } from "./importance";
import { explain, rankTasks, releaseManual, reorderManual } from "./rank";

/**
 * Assembling a ranking from tasks, links and meetings.
 *
 * The load-bearing rule here is the one about **confirmed** links: an
 * unconfirmed link is a question the owner has not answered, and letting it
 * move the ranking would be auto-linking through the back door — the
 * relationship would still be invisible, but the order would already have
 * changed.
 */

const NOW = new Date("2026-08-10T09:00:00.000Z");

function task(partial: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Draft the board deck",
    notes: null,
    priority: null,
    dueAt: null,
    categoryId: null,
    status: "inbox",
    pinned: false,
    sourceLink: null,
    owner: null,
    isReady: false,
    isDraft: false,
    canActivate: false,
    manualRank: null,
    manualRankSetAt: null,
    completedAt: null,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    links: [],
    ...partial,
  };
}

function link(
  relation: TaskLinkRelation,
  eventId: string,
  confirmed: boolean,
): TaskLink {
  return {
    id: `link-${eventId}-${relation}`,
    taskId: "task-1",
    kind: "event",
    relation,
    targetId: eventId,
    targetLabel: "A meeting",
    targetUrl: null,
    confirmedAt: confirmed ? "2026-08-09T09:00:00.000Z" : null,
    createdAt: "2026-08-09T09:00:00.000Z",
  };
}

function event(partial: Partial<EventContext> = {}): EventContext {
  return {
    id: "event-1",
    title: "Board meeting",
    startsAt: "2026-08-11T09:00:00.000Z",
    endsAt: "2026-08-11T10:00:00.000Z",
    attendeeCount: 9,
    isExternal: true,
    isCancelled: false,
    organizerAddress: null,
    isOwnerOrganiser: false,
    ...partial,
  };
}

const events = (...list: EventContext[]) =>
  new Map(list.map((e) => [e.id, e] as const));

describe("confirmed links only", () => {
  it("lets a confirmed event link raise a task", () => {
    const plain = rankTasks({ tasks: [task()], events: events(), now: NOW });
    const linked = rankTasks({
      tasks: [task({ links: [link("prep", "event-1", true)] })],
      events: events(event()),
      now: NOW,
    });

    expect(linked[0].score.total).toBeGreaterThan(plain[0].score.total);
  });

  it("ignores an unconfirmed link entirely", () => {
    // The suggestion has not been answered. Moving the ranking on it would be
    // acting on a relationship the owner has not agreed to.
    const plain = rankTasks({ tasks: [task()], events: events(), now: NOW });
    const suggested = rankTasks({
      tasks: [task({ links: [link("prep", "event-1", false)] })],
      events: events(event()),
      now: NOW,
    });

    expect(suggested[0].score.total).toBe(plain[0].score.total);
    expect(suggested[0].drivingEvent).toBeNull();
  });

  it("ignores a link to an event it cannot see", () => {
    const ranked = rankTasks({
      tasks: [task({ links: [link("prep", "missing", true)] })],
      events: events(),
      now: NOW,
    });

    expect(ranked[0].drivingEvent).toBeNull();
  });

  it("ignores a link to a cancelled meeting", () => {
    const ranked = rankTasks({
      tasks: [task({ links: [link("prep", "event-1", true)] })],
      events: events(event({ isCancelled: true })),
      now: NOW,
    });

    expect(ranked[0].drivingEvent).toBeNull();
  });
});

describe("choosing which meeting drives the ranking", () => {
  it("picks the most important, not the first", () => {
    const ranked = rankTasks({
      tasks: [
        task({
          links: [link("prep", "dull", true), link("prep", "board", true)],
        }),
      ],
      events: events(
        event({
          id: "dull",
          title: "Coffee",
          attendeeCount: 2,
          isExternal: false,
        }),
        event({ id: "board", title: "Board decision", isExternal: true }),
      ),
      now: NOW,
    });

    expect(ranked[0].drivingEvent?.id).toBe("board");
  });

  it("gives prep a larger share of the meeting's importance than follow-up", () => {
    // Compared an hour either side of the same meeting, so the only thing
    // differing is the relation. Comparing *totals* across different timings
    // would not isolate this: a follow-up whose meeting has just finished can
    // legitimately outrank prep for a meeting still a day away, because the
    // calendar-proximity factor is doing the work there rather than
    // inheritance.
    const importanceOf = (relation: "prep" | "follow_up", startsAt: string) => {
      const [ranked] = rankTasks({
        tasks: [task({ links: [link(relation, "event-1", true)] })],
        events: events(event({ startsAt })),
        now: NOW,
      });
      return ranked.score.factors.find((f) => f.factor === "importance")!
        .points;
    };

    expect(importanceOf("prep", "2026-08-10T10:00:00.000Z")).toBeGreaterThan(
      importanceOf("follow_up", "2026-08-10T08:00:00.000Z"),
    );
  });

  it("can rank a just-finished follow-up above prep for a distant meeting", () => {
    // The flip side of the rule above, pinned so nobody 'fixes' it: what you
    // can do now beats what you must do eventually.
    const prep = rankTasks({
      tasks: [task({ links: [link("prep", "event-1", true)] })],
      events: events(event({ startsAt: "2026-08-11T09:00:00.000Z" })),
      now: NOW,
    });

    const followUp = rankTasks({
      tasks: [task({ links: [link("follow_up", "event-1", true)] })],
      events: events(event({ startsAt: "2026-08-10T07:00:00.000Z" })),
      now: NOW,
    });

    expect(followUp[0].score.total).toBeGreaterThan(prep[0].score.total);
  });
});

describe("ordering", () => {
  it("excludes completed tasks by default", () => {
    const ranked = rankTasks({
      tasks: [task({ id: "a" }), task({ id: "b", status: "done" })],
      events: events(),
      now: NOW,
    });

    expect(ranked.map((r) => r.task.id)).toEqual(["a"]);
  });

  it("includes them when asked", () => {
    const ranked = rankTasks({
      tasks: [task({ id: "a" }), task({ id: "b", status: "done" })],
      events: events(),
      now: NOW,
      includeDone: true,
    });

    expect(ranked).toHaveLength(2);
  });

  it("puts a manually placed task first, whatever the scores say", () => {
    const ranked = rankTasks({
      tasks: [
        task({
          id: "screaming",
          priority: "critical",
          dueAt: "2026-07-01T09:00:00.000Z",
        }),
        task({ id: "placed", priority: "low", manualRank: 0 }),
      ],
      events: events(),
      now: NOW,
    });

    expect(ranked[0].task.id).toBe("placed");
  });

  it("produces the same order however the input is shuffled", () => {
    const tasks = [
      task({ id: "a", priority: "high" }),
      task({ id: "b", priority: "low" }),
      task({ id: "c", manualRank: 1 }),
      task({ id: "d", priority: "critical" }),
    ];

    const forward = rankTasks({ tasks, events: events(), now: NOW }).map(
      (r) => r.task.id,
    );
    const reversed = rankTasks({
      tasks: [...tasks].reverse(),
      events: events(),
      now: NOW,
    }).map((r) => r.task.id);

    expect(forward).toEqual(reversed);
  });
});

describe("explanations", () => {
  it("says plainly when a manual placement is in force", () => {
    const [ranked] = rankTasks({
      tasks: [task({ manualRank: 0 })],
      events: events(),
      now: NOW,
    });

    const explanation = explain(ranked);
    expect(explanation.overridden).toBe(true);
    expect(explanation.headline).toContain("by hand");
    expect(explanation.lines).toEqual([]);
  });

  it("lists the factors that moved it, with a sentence each", () => {
    const [ranked] = rankTasks({
      tasks: [task({ priority: "high", dueAt: "2026-08-11T09:00:00.000Z" })],
      events: events(),
      now: NOW,
    });

    const explanation = explain(ranked);
    expect(explanation.lines.length).toBeGreaterThan(0);
    for (const line of explanation.lines) {
      expect(line.detail).toBeTruthy();
    }
  });

  it("shows the calendar signals behind a boost", () => {
    const [ranked] = rankTasks({
      tasks: [task({ links: [link("prep", "event-1", true)] })],
      events: events(event({ title: "Board decision", isExternal: true })),
      now: NOW,
    });

    const explanation = explain(ranked);
    expect(explanation.signals.length).toBeGreaterThan(0);
  });

  it("has something honest to say about a task nothing is pushing", () => {
    const [ranked] = rankTasks({
      tasks: [task()],
      events: events(),
      now: NOW,
    });

    expect(explain(ranked).headline).toBeTruthy();
  });
});

describe("manual placement arithmetic", () => {
  it("renumbers from zero with no gaps", () => {
    const result = reorderManual(["a", "b", "c"], "c", 0);
    expect(result).toEqual([
      { taskId: "c", manualRank: 0 },
      { taskId: "a", manualRank: 1 },
      { taskId: "b", manualRank: 2 },
    ]);
  });

  it("adds a task that wasn't placed before", () => {
    const result = reorderManual(["a", "b"], "new", 1);
    expect(result.map((r) => r.taskId)).toEqual(["a", "new", "b"]);
  });

  it("clamps an index past the end", () => {
    const result = reorderManual(["a", "b"], "c", 99);
    expect(result.map((r) => r.taskId)).toEqual(["a", "b", "c"]);
  });

  it("closes the gap when a task is released back to the engine", () => {
    const result = releaseManual(["a", "b", "c"], "b");
    expect(result).toEqual([
      { taskId: "a", manualRank: 0 },
      { taskId: "c", manualRank: 1 },
    ]);
  });
});
