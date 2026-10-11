import { describe, expect, it } from "vitest";

import type { CalendarEvent, Message } from "./types";
import {
  findExplicitDeadline,
  findRelatedEvent,
  readableBody,
  significantWords,
  suggestPriority,
  suggestTaskFromMessage,
  taskTitleFor,
} from "./to-task";

/**
 * Fixed reference instant, matching the parser suite: Wednesday 5 August
 * 2026, 10:00 in New York — daylight time on purpose, so a timezone mistake
 * shows up as a one-hour drift rather than hiding behind a zero offset.
 */
const NOW = new Date("2026-08-05T14:00:00.000Z");
const ZONE = "America/New_York";

function message(
  over: Partial<Message> = {},
): Parameters<typeof suggestTaskFromMessage>[0]["message"] {
  return {
    id: "msg-1",
    subject: "Q3 board pack",
    snippet: null,
    body: null,
    from: { address: "maya@example.com", name: "Maya Chen" },
    receivedAt: NOW.toISOString(),
    senderImportance: "normal",
    ...over,
  } as Parameters<typeof suggestTaskFromMessage>[0]["message"];
}

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-1",
    calendarId: "cal-1",
    remoteId: "r1",
    seriesId: null,
    title: "Q3 board review",
    location: null,
    description: null,
    startsAt: "2026-08-07T14:00:00.000Z",
    endsAt: "2026-08-07T15:00:00.000Z",
    allDay: false,
    timeZone: ZONE,
    organizer: null,
    attendeeCount: 3,
    isExternal: false,
    response: "accepted",
    isCancelled: false,
    meetingUrl: null,
    ...over,
  };
}

const suggest = (
  over: Parameters<typeof suggestTaskFromMessage>[0]["message"],
  events: CalendarEvent[] = [],
) =>
  suggestTaskFromMessage({ message: over, events, now: NOW, timeZone: ZONE });

/* ── Title ────────────────────────────────────────────────────────────── */

describe("taskTitleFor", () => {
  it("strips reply and forward prefixes", () => {
    expect(taskTitleFor("Re: Fwd: RE: Q3 board pack")).toBe("Q3 board pack");
  });

  it("leaves an ordinary subject alone", () => {
    expect(taskTitleFor("Sign the vendor SOW")).toBe("Sign the vendor SOW");
  });

  it("does not strip a colon that is part of the subject", () => {
    expect(taskTitleFor("Q3: the numbers")).toBe("Q3: the numbers");
  });

  it("handles a missing subject", () => {
    expect(taskTitleFor(null)).toBe("(no subject)");
    expect(taskTitleFor("   ")).toBe("(no subject)");
  });
});

/* ── Quoted history ───────────────────────────────────────────────────── */

describe("readableBody", () => {
  it("stops at the quoted history", () => {
    // Otherwise a stale "by Friday" from two weeks ago beats what the newest
    // message actually says.
    const body = [
      "Can you confirm by Thursday?",
      "",
      "On Tue, 4 Aug 2026, Maya Chen wrote:",
      "> I need this by Friday",
    ].join("\n");

    expect(readableBody(body)).toBe("Can you confirm by Thursday?");
  });

  it("drops quoted lines", () => {
    expect(readableBody("New text\n> old text")).toBe("New text");
  });

  it("stops at a signature delimiter", () => {
    expect(readableBody("Body\n--\nMaya Chen\nCFO")).toBe("Body");
  });

  it("stops at an Outlook-style original message header", () => {
    expect(
      readableBody("Please review.\n-----Original Message-----\nFrom: someone"),
    ).toBe("Please review.");
  });

  it("handles an empty body", () => {
    expect(readableBody(null)).toBe("");
    expect(readableBody("")).toBe("");
  });
});

/* ── Explicit deadlines ───────────────────────────────────────────────── */

describe("findExplicitDeadline", () => {
  const find = (text: string) =>
    findExplicitDeadline(text, { now: NOW, timeZone: ZONE });

  it("reads a stated deadline", () => {
    const found = find("Please can you sign this by Friday.");
    expect(found).not.toBeNull();
    // Friday 7 August, 17:00 New York = 21:00 UTC.
    expect(found!.dueAt).toBe("2026-08-07T21:00:00.000Z");
    expect(found!.evidence).toContain("by Friday");
  });

  it("reads an explicit date", () => {
    expect(find("The deadline is 14 Aug.")).not.toBeNull();
  });

  it("ignores a date that is not a deadline", () => {
    // "Let's meet on Friday" is a date, not a due date. Mail is full of them.
    expect(find("Let's meet on Friday to talk it through.")).toBeNull();
  });

  it("ignores a deadline cue with no date", () => {
    expect(find("Please respond ASAP.")).toBeNull();
  });

  it("returns the sentence as evidence, so the reason can be shown", () => {
    const found = find("Background noise here. I need the pack by tomorrow.");
    expect(found!.evidence).toBe("I need the pack by tomorrow.");
  });

  it("takes the first stated deadline when there are several", () => {
    const found = find("Draft by Thursday. Final version by next Monday.");
    expect(found!.evidence).toContain("Thursday");
  });
});

/* ── Relating to a meeting ────────────────────────────────────────────── */

describe("significantWords", () => {
  it("drops filler that would match anything", () => {
    // "meeting", "agenda", "re" and the articles appear in almost every mail
    // and almost every event title, so matching on them would relate
    // everything to everything.
    expect([
      ...significantWords("Re: the agenda for our board meeting"),
    ]).toEqual(["board"]);
  });

  it("handles nothing gracefully", () => {
    expect(significantWords(null).size).toBe(0);
  });
});

describe("findRelatedEvent", () => {
  it("matches on shared subject words", () => {
    const found = findRelatedEvent(message(), [event()], NOW);
    expect(found?.event.id).toBe("evt-1");
    expect(found?.reason).toContain("board");
  });

  it("matches when the sender organizes the meeting", () => {
    const found = findRelatedEvent(
      message({ subject: "Some notes" }),
      [
        event({
          title: "Weekly sync",
          organizer: { address: "maya@example.com", name: null },
        }),
      ],
      NOW,
    );

    expect(found?.event.title).toBe("Weekly sync");
    expect(found?.reason).toContain("organizes");
  });

  it("does not relate a mail to an unrelated meeting", () => {
    // A wrong guess here becomes a wrong due date and a link to undo.
    expect(
      findRelatedEvent(message({ subject: "Lunch?" }), [event()], NOW),
    ).toBeNull();
  });

  it("ignores meetings in the past", () => {
    expect(
      findRelatedEvent(
        message(),
        [event({ startsAt: "2026-08-01T14:00:00.000Z" })],
        NOW,
      ),
    ).toBeNull();
  });

  it("ignores cancelled meetings", () => {
    expect(
      findRelatedEvent(message(), [event({ isCancelled: true })], NOW),
    ).toBeNull();
  });

  it("prefers the stronger match when several are plausible", () => {
    const weak = event({ id: "weak", title: "Board social" });
    const strong = event({
      id: "strong",
      title: "Q3 board pack review",
      organizer: { address: "maya@example.com", name: null },
    });

    expect(findRelatedEvent(message(), [weak, strong], NOW)?.event.id).toBe(
      "strong",
    );
  });
});

/* ── Priority ─────────────────────────────────────────────────────────── */

describe("suggestPriority", () => {
  const options = (
    over: Partial<Parameters<typeof suggestTaskFromMessage>[0]> = {},
  ) => ({
    message: message(),
    now: NOW,
    timeZone: ZONE,
    ...over,
  });

  it("an imminent stated deadline wins", () => {
    const suggested = suggestPriority(
      options(),
      { dueAt: "2026-08-06T21:00:00.000Z" },
      null,
    );

    expect(suggested).toMatchObject({
      value: "high",
      source: "explicit_deadline",
    });
    expect(suggested!.reason).toMatch(/deadline within two days/);
  });

  it("an imminent deadline from a Critical sender is critical", () => {
    const suggested = suggestPriority(
      options({ message: message({ senderImportance: "critical" }) }),
      { dueAt: "2026-08-06T21:00:00.000Z" },
      null,
    );

    expect(suggested!.value).toBe("critical");
    expect(suggested!.reason).toMatch(/Critical/);
  });

  it("sender importance is used when no deadline is imminent", () => {
    const suggested = suggestPriority(
      options({ message: message({ senderImportance: "critical" }) }),
      null,
      null,
    );

    expect(suggested).toMatchObject({
      value: "critical",
      source: "sender_importance",
    });
    expect(suggested!.reason).toContain("maya@example.com");
  });

  it("meeting timing is used when nothing stronger applies", () => {
    const suggested = suggestPriority(options(), null, event());

    expect(suggested).toMatchObject({
      value: "high",
      source: "meeting_timing",
    });
    expect(suggested!.reason).toContain("Q3 board review");
  });

  it("respects the ordering: meeting timing beats sender importance", () => {
    // The specified order is deadline → meeting timing → sender importance.
    // This test previously asserted the opposite, which is how the deviation
    // survived a green suite: with importance first, an imminent meeting
    // could never be the stated reason for mail from the very people most
    // likely to be writing about one.
    const suggested = suggestPriority(
      options({ message: message({ senderImportance: "critical" }) }),
      null,
      event(),
    );

    expect(suggested!.source).toBe("meeting_timing");
    // A Critical sender still lifts the value, it just is not the reason.
    expect(suggested!.value).toBe("critical");
    expect(suggested!.reason).toContain("Q3 board review");
  });

  it("falls back to sender importance when no meeting is near", () => {
    const suggested = suggestPriority(
      options({ message: message({ senderImportance: "critical" }) }),
      null,
      null,
    );

    expect(suggested!.source).toBe("sender_importance");
    expect(suggested!.value).toBe("critical");
  });

  it("suggests nothing when there is no signal at all", () => {
    // Leaving priority unset keeps the task visibly awaiting triage, which is
    // the truth. Defaulting to Normal would fake a decision.
    expect(suggestPriority(options(), null, null)).toBeNull();
  });

  it("passes a Low sender through", () => {
    expect(
      suggestPriority(
        options({ message: message({ senderImportance: "low" }) }),
        null,
        null,
      ),
    ).toMatchObject({ value: "low", source: "sender_importance" });
  });
});

/* ── The whole suggestion ─────────────────────────────────────────────── */

describe("suggestTaskFromMessage", () => {
  it("always links the source message, and always confirmed", () => {
    // The owner clicked "make a task from this mail", so linking it back is
    // what they asked for — unlike a guessed event link.
    const suggestion = suggest(message());
    expect(suggestion.sourceMessageId).toBe("msg-1");
  });

  it("prefers a stated deadline over a meeting", () => {
    const suggestion = suggest(
      message({ body: "Please sign this by Thursday." }),
      [event()],
    );

    expect(suggestion.due!.source).toBe("explicit_deadline");
    expect(suggestion.due!.evidence).toContain("by Thursday");
    expect(suggestion.due!.reason).toBe("The mail states this deadline.");
  });

  it("falls back to the day before a related meeting", () => {
    const suggestion = suggest(message(), [event()]);

    expect(suggestion.due!.source).toBe("meeting_timing");
    // Meeting Friday 7 Aug → due Thursday 6 Aug at 17:00 New York (21:00Z).
    expect(suggestion.due!.value).toBe("2026-08-06T21:00:00.000Z");
    expect(suggestion.due!.reason).toContain("day before");
  });

  it("never suggests a due date in the past", () => {
    // A meeting first thing tomorrow would otherwise put prep due yesterday.
    const suggestion = suggest(message(), [
      event({ startsAt: "2026-08-05T18:00:00.000Z" }),
    ]);

    expect(Date.parse(suggestion.due!.value)).toBeGreaterThanOrEqual(
      NOW.getTime(),
    );
  });

  it("suggests nothing for a mail with no signal", () => {
    const suggestion = suggest(
      message({ subject: "Lunch?", body: "Fancy it?" }),
    );

    expect(suggestion.due).toBeNull();
    expect(suggestion.priority).toBeNull();
    expect(suggestion.relatedEvent).toBeNull();
  });

  it("proposes a related event but does not link it", () => {
    // Confirm-before-link, same rule as quick-add: the caller shows this as a
    // question, and nothing is linked until the owner says so.
    const suggestion = suggest(message(), [event()]);

    expect(suggestion.relatedEvent).toMatchObject({
      eventId: "evt-1",
      title: "Q3 board review",
    });
    expect(suggestion.relatedEvent!.reason).toBeTruthy();
  });

  it("reads the deadline out of the snippet when there is no body", () => {
    // Under the Metadata caching policy there is no body — the snippet is all
    // we have, and it should still be used.
    const suggestion = suggest(
      message({ body: null, snippet: "Reply by Friday please" }),
    );

    expect(suggestion.due?.source).toBe("explicit_deadline");
  });

  it("gives every suggestion a reason", () => {
    const suggestion = suggest(
      message({ senderImportance: "critical", body: "Sign by Thursday." }),
      [event()],
    );

    expect(suggestion.due!.reason).toBeTruthy();
    expect(suggestion.priority!.reason).toBeTruthy();
    expect(suggestion.relatedEvent!.reason).toBeTruthy();
  });

  it("uses the subject as the title, cleaned", () => {
    expect(suggest(message({ subject: "Re: Q3 board pack" })).title).toBe(
      "Q3 board pack",
    );
  });
});
