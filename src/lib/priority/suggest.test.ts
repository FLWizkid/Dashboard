import { describe, expect, it } from "vitest";

import type { Task } from "@/lib/tasks/types";

import type { EventContext } from "./importance";
import {
  describeConfidence,
  detectSuggestions,
  sharedTerms,
  suggestionKey,
} from "./suggest";

/**
 * Suggestion detection.
 *
 * The property that matters most is what it *doesn't* do: it never produces a
 * link, and it never asks a question twice. A wrong suggestion is not free —
 * a stream of bad guesses trains the owner to dismiss the feature without
 * reading, and the good suggestions go with it.
 */

const NOW = new Date("2026-08-10T09:00:00.000Z");

function task(partial: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Draft the Helios migration plan",
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

function event(partial: Partial<EventContext> = {}): EventContext {
  return {
    id: "event-1",
    title: "Helios migration review",
    startsAt: "2026-08-11T09:00:00.000Z",
    endsAt: "2026-08-11T10:00:00.000Z",
    attendeeCount: 4,
    isExternal: false,
    isCancelled: false,
    organizerAddress: null,
    isOwnerOrganiser: false,
    ...partial,
  };
}

describe("shared terms", () => {
  it("finds the words that make two titles about the same thing", () => {
    expect(
      sharedTerms("Draft the Helios migration plan", "Helios migration review"),
    ).toEqual(["helios", "migration"]);
  });

  it("ignores the vocabulary every calendar is full of", () => {
    // Without this, every task would relate to every meeting.
    expect(sharedTerms("Weekly review notes", "Weekly review meeting")).toEqual(
      [],
    );
  });

  it("keeps short but meaningful tokens like Q3 and SOC2", () => {
    expect(sharedTerms("SOC2 evidence", "SOC2 audit")).toEqual(["soc2"]);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(sharedTerms("HELIOS: migration", "helios — migration")).toEqual([
      "helios",
      "migration",
    ]);
  });

  it("finds nothing between unrelated titles", () => {
    expect(sharedTerms("Buy milk", "Board meeting")).toEqual([]);
  });
});

describe("detection", () => {
  it("suggests prep for a matching meeting that is coming up", () => {
    const [suggestion] = detectSuggestions({
      tasks: [task()],
      events: [event()],
      now: NOW,
    });

    expect(suggestion.kind).toBe("prep");
    expect(suggestion.reason).toContain("helios");
    expect(suggestion.reason).toContain("coming up");
  });

  it("suggests follow-up for a matching meeting that has just happened", () => {
    const [suggestion] = detectSuggestions({
      tasks: [task()],
      events: [event({ startsAt: "2026-08-10T07:00:00.000Z" })],
      now: NOW,
    });

    expect(suggestion.kind).toBe("follow_up");
    expect(suggestion.reason).toContain("just happened");
  });

  it("never suggests on timing alone", () => {
    // A meeting happening in an hour is not evidence that an unrelated task
    // belongs to it, and suggesting on proximity would bury the owner.
    const suggestions = detectSuggestions({
      tasks: [task({ title: "Buy a new laptop charger" })],
      events: [event({ startsAt: "2026-08-10T10:00:00.000Z" })],
      now: NOW,
    });

    expect(suggestions).toEqual([]);
  });

  it("is more confident when two words match than one", () => {
    const two = detectSuggestions({
      tasks: [task({ title: "Helios migration checklist" })],
      events: [event({ title: "Helios migration review" })],
      now: NOW,
    })[0];

    const one = detectSuggestions({
      tasks: [task({ title: "Helios budget" })],
      events: [event({ title: "Helios migration review" })],
      now: NOW,
    })[0];

    expect(two.confidence).toBeGreaterThan(one.confidence);
  });

  it("is more confident about a nearer meeting", () => {
    const near = detectSuggestions({
      tasks: [task()],
      events: [event({ startsAt: "2026-08-10T12:00:00.000Z" })],
      now: NOW,
    })[0];

    const far = detectSuggestions({
      tasks: [task()],
      events: [event({ startsAt: "2026-08-14T09:00:00.000Z" })],
      now: NOW,
    })[0];

    expect(near.confidence).toBeGreaterThan(far.confidence);
  });

  it("ignores meetings outside the windows", () => {
    const distant = detectSuggestions({
      tasks: [task()],
      events: [event({ startsAt: "2026-09-01T09:00:00.000Z" })],
      now: NOW,
    });
    const ancient = detectSuggestions({
      tasks: [task()],
      events: [event({ startsAt: "2026-08-01T09:00:00.000Z" })],
      now: NOW,
    });

    expect(distant).toEqual([]);
    expect(ancient).toEqual([]);
  });

  it("says nothing about a cancelled meeting", () => {
    expect(
      detectSuggestions({
        tasks: [task()],
        events: [event({ isCancelled: true })],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("says nothing about a completed task", () => {
    expect(
      detectSuggestions({
        tasks: [task({ status: "done" })],
        events: [event()],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("says nothing about a draft", () => {
    // A draft is not committed work; asking about it is asking about
    // something the owner has not decided to do.
    expect(
      detectSuggestions({
        tasks: [task({ isDraft: true })],
        events: [event()],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("does not re-suggest a link that already exists", () => {
    const linked = task({
      links: [
        {
          id: "link-1",
          taskId: "task-1",
          kind: "event",
          relation: "prep",
          targetId: "event-1",
          targetLabel: "Helios migration review",
          targetUrl: null,
          confirmedAt: "2026-08-09T09:00:00.000Z",
          createdAt: "2026-08-09T09:00:00.000Z",
        },
      ],
    });

    expect(
      detectSuggestions({ tasks: [linked], events: [event()], now: NOW }),
    ).toEqual([]);
  });

  it("never asks a question the owner has already answered", () => {
    // Dismissing a suggestion has to mean something, or it is a nag.
    const decided = new Set([suggestionKey("task-1", "event-1", "prep")]);

    expect(
      detectSuggestions({
        tasks: [task()],
        events: [event()],
        now: NOW,
        decided,
      }),
    ).toEqual([]);
  });

  it("orders suggestions deterministically", () => {
    const events = [
      event({ id: "b", title: "Helios migration review" }),
      event({ id: "a", title: "Helios migration review" }),
    ];

    const forward = detectSuggestions({ tasks: [task()], events, now: NOW });
    const backward = detectSuggestions({
      tasks: [task()],
      events: [...events].reverse(),
      now: NOW,
    });

    expect(forward.map((s) => s.eventId)).toEqual(
      backward.map((s) => s.eventId),
    );
  });
});

describe("the offered note", () => {
  it("offers a meeting note for prep", () => {
    const [suggestion] = detectSuggestions({
      tasks: [task()],
      events: [event()],
      now: NOW,
    });

    expect(suggestion.offeredNote?.kind).toBe("meeting");
    expect(suggestion.offeredNote?.title).toBe("Helios migration review");
  });

  it("offers a follow-up note after the meeting, named as one", () => {
    const [suggestion] = detectSuggestions({
      tasks: [task()],
      events: [event({ startsAt: "2026-08-10T07:00:00.000Z" })],
      now: NOW,
    });

    expect(suggestion.offeredNote?.kind).toBe("follow_up");
    expect(suggestion.offeredNote?.title).toContain("follow-up");
  });

  it("prefills context but never content", () => {
    // A note that arrives with sentences already in it gets skimmed and left,
    // and a decision log full of boilerplate is worse than an empty one.
    const [suggestion] = detectSuggestions({
      tasks: [task()],
      events: [event()],
      now: NOW,
    });

    expect(suggestion.offeredNote?.context).toBeTruthy();
    expect(Object.keys(suggestion.offeredNote!)).toEqual([
      "kind",
      "title",
      "context",
    ]);
  });
});

describe("presentation", () => {
  it("describes confidence in words, never as a number", () => {
    for (const value of [0.5, 0.7, 0.95]) {
      expect(describeConfidence(value)).not.toMatch(/\d/);
    }
  });

  it("gets more certain as confidence rises", () => {
    expect(describeConfidence(0.95)).not.toBe(describeConfidence(0.5));
  });
});
