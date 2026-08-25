import { describe, expect, it } from "vitest";

import { getZonedParts } from "@/lib/time/zone";

import { parseQuickAdd, type ParseOptions } from "./parse";

/**
 * Fixed reference point for every case below:
 *   Wednesday 5 August 2026, 10:00 in New York (14:00 UTC).
 * Picked in daylight time so a timezone mistake shows up as a one-hour drift
 * rather than hiding behind a zero offset.
 */
const NOW = new Date("2026-08-05T14:00:00Z");
const TZ = "America/New_York";

const options: ParseOptions = { now: NOW, timeZone: TZ };

/** The parsed due date as a local wall clock, for readable assertions. */
function due(input: string, overrides: Partial<ParseOptions> = {}) {
  const result = parseQuickAdd(input, { ...options, ...overrides });
  if (!result.dueAt) return null;
  const parts = getZonedParts(new Date(result.dueAt.value), TZ);
  return {
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

describe("the reference date is what the suite assumes", () => {
  it("is a Wednesday in August", () => {
    const parts = getZonedParts(NOW, TZ);
    expect(parts).toMatchObject({ year: 2026, month: 8, day: 5, weekday: 3 });
  });
});

describe("title extraction", () => {
  it("keeps the plain text and drops every token it claims", () => {
    const result = parseQuickAdd(
      "Draft board deck !high friday 3pm #strategic",
      options,
    );
    expect(result.title).toBe("Draft board deck");
  });

  it("collapses the whitespace left behind by removed tokens", () => {
    expect(parseQuickAdd("Call   Ana   !low   tomorrow", options).title).toBe(
      "Call Ana",
    );
  });

  it("never claims a date lead-in from inside a word", () => {
    // "secti[on] tomorrow" once matched the "on <date>" lead-in against the
    // tail of the word before the date, storing a task called "…secti".
    const cases: Array<[string, string]> = [
      [
        "Review the security section tomorrow 4pm",
        "Review the security section",
      ],
      ["Finish the migration friday", "Finish the migration"],
      ["Confirm standby tomorrow", "Confirm standby"],
      ["Check overdue items tomorrow", "Check overdue items"],
      [
        "Chase the until-now silent vendor tomorrow",
        "Chase the until-now silent vendor",
      ],
    ];
    for (const [input, title] of cases) {
      const result = parseQuickAdd(input, options);
      expect(result.title, input).toBe(title);
      expect(result.dueAt, input).not.toBeNull();
    }
  });

  it("still removes a real lead-in with its date", () => {
    expect(parseQuickAdd("File the report by friday", options).title).toBe(
      "File the report",
    );
    expect(parseQuickAdd("Review on monday", options).title).toBe("Review");
    expect(parseQuickAdd("Pay invoice due tomorrow", options).title).toBe(
      "Pay invoice",
    );
  });

  it("never produces an empty title", () => {
    // The whole input is a date; there is nothing else to call the task.
    const result = parseQuickAdd("tomorrow", options);
    expect(result.title).toBe("tomorrow");
    expect(result.dueAt).not.toBeNull();
  });

  it("strips leading and trailing separators", () => {
    expect(parseQuickAdd("!high — Review the SOC2 gap", options).title).toBe(
      "Review the SOC2 gap",
    );
  });

  it("reports the exact substring behind each suggestion", () => {
    const result = parseQuickAdd("Ship the plan !critical tomorrow", options);
    expect(result.priority?.raw.trim()).toBe("!critical");
    expect(result.dueAt?.raw.trim()).toBe("tomorrow");
    // Spans are ordered by position so the input can be highlighted.
    expect(result.consumed.map((span) => span.field)).toEqual([
      "priority",
      "dueAt",
    ]);
  });
});

describe("priority", () => {
  it.each([
    ["!critical", "critical"],
    ["!crit", "critical"],
    ["!c", "critical"],
    ["!high", "high"],
    ["!hi", "high"],
    ["!h", "high"],
    ["!normal", "normal"],
    ["!norm", "normal"],
    ["!n", "normal"],
    ["!low", "low"],
    ["!l", "low"],
  ])("reads %s as %s", (token, expected) => {
    const result = parseQuickAdd(`Do the thing ${token}`, options);
    expect(result.priority?.value).toBe(expected);
    expect(result.priority?.confidence).toBe("explicit");
    expect(result.title).toBe("Do the thing");
  });

  it.each([
    ["p1", "critical"],
    ["p2", "high"],
    ["p3", "normal"],
    ["p4", "low"],
  ])("reads %s as %s", (token, expected) => {
    expect(
      parseQuickAdd(`${token} Fix the outage`, options).priority?.value,
    ).toBe(expected);
  });

  it("is null when nothing says otherwise — untriaged, not defaulted", () => {
    expect(parseQuickAdd("Read the vendor SOW", options).priority).toBeNull();
  });

  it("infers critical from urgency words without removing them", () => {
    const result = parseQuickAdd("urgent: patch the gateway", options);
    expect(result.priority?.value).toBe("critical");
    expect(result.priority?.confidence).toBe("inferred");
    // The word carries meaning; the title keeps it.
    expect(result.title).toBe("urgent: patch the gateway");
  });

  it("infers high from 'important'", () => {
    expect(
      parseQuickAdd("important follow-up note", options).priority?.value,
    ).toBe("high");
  });

  it("prefers an explicit token over an inferred word", () => {
    const result = parseQuickAdd("urgent rewrite !low", options);
    expect(result.priority?.value).toBe("low");
    expect(result.priority?.confidence).toBe("explicit");
  });

  it("ignores a bang in the middle of a word", () => {
    expect(parseQuickAdd("Ship it!high time", options).priority).toBeNull();
  });
});

describe("category", () => {
  it("resolves a slug", () => {
    expect(
      parseQuickAdd("Board pack #strategic", options).categorySlug?.value,
    ).toBe("strategic");
  });

  it("resolves an alias", () => {
    expect(parseQuickAdd("Renewal #vendor", options).categorySlug?.value).toBe(
      "vendor-budget",
    );
  });

  it("resolves a unique prefix", () => {
    expect(parseQuickAdd("Pen test #sec", options).categorySlug?.value).toBe(
      "security-risk-compliance",
    );
  });

  it("is case- and punctuation-insensitive", () => {
    expect(
      parseQuickAdd("Hiring #People-Team", options).categorySlug?.value,
    ).toBe("people-team");
  });

  it("leaves an unknown tag in the title rather than guessing", () => {
    const result = parseQuickAdd("Ship #nonsense", options);
    expect(result.categorySlug).toBeNull();
    expect(result.title).toBe("Ship #nonsense");
  });

  it("reports the unknown tag so the interface can say so", () => {
    // Staying in the title is deliberate; staying there *silently* was the
    // bug. The preview reads this field and explains the leftover tag.
    expect(parseQuickAdd("Ship #nonsense", options).unknownTag).toBe(
      "#nonsense",
    );
    expect(parseQuickAdd("Ship #vendor", options).unknownTag).toBeNull();
    expect(parseQuickAdd("Ship it", options).unknownTag).toBeNull();
  });

  it("resolves against a caller-supplied taxonomy", () => {
    const result = parseQuickAdd("Ship #platform", {
      ...options,
      categories: [{ slug: "platform", name: "Platform" }],
    });
    expect(result.categorySlug?.value).toBe("platform");
  });
});

describe("owner", () => {
  it("reads an @mention", () => {
    const result = parseQuickAdd("@sam review the contract", options);
    expect(result.owner?.value).toBe("sam");
    expect(result.title).toBe("review the contract");
  });

  it("ignores an email address in the middle of a word", () => {
    expect(
      parseQuickAdd("mail doug@example.com back", options).owner,
    ).toBeNull();
  });
});

describe("dates — relative", () => {
  it("reads today", () => {
    expect(due("Sync notes today")).toEqual({
      month: 8,
      day: 5,
      hour: 17,
      minute: 0,
    });
  });

  it("reads tomorrow", () => {
    expect(due("Sync notes tomorrow")).toMatchObject({ month: 8, day: 6 });
  });

  it("reads tmrw", () => {
    expect(due("Sync notes tmrw")).toMatchObject({ month: 8, day: 6 });
  });

  it("reads tonight as 8pm", () => {
    expect(due("Read the deck tonight")).toEqual({
      month: 8,
      day: 5,
      hour: 20,
      minute: 0,
    });
  });

  it("reads 'in N days'", () => {
    expect(due("Chase the invoice in 3 days")).toMatchObject({
      month: 8,
      day: 8,
    });
  });

  it("reads 'in N weeks'", () => {
    expect(due("Board follow-up in 2 weeks")).toMatchObject({
      month: 8,
      day: 19,
    });
  });

  it("reads 'in N hours' and keeps the clock time", () => {
    // 10:00 local + 4h.
    expect(due("Call back in 4 hours")).toEqual({
      month: 8,
      day: 5,
      hour: 14,
      minute: 0,
    });
  });

  it("reads 'in N months'", () => {
    expect(due("Renew the licence in 2 months")).toMatchObject({
      month: 10,
      day: 5,
    });
  });
});

describe("dates — weekdays", () => {
  it("reads a bare weekday as the next one", () => {
    expect(due("Ship the memo friday")).toMatchObject({ month: 8, day: 7 });
  });

  it("treats today's weekday as today", () => {
    expect(due("Ship the memo wednesday")).toMatchObject({ month: 8, day: 5 });
  });

  it("reads 'this friday' the same as 'friday'", () => {
    expect(due("Ship the memo this friday")).toEqual(
      due("Ship the memo friday"),
    );
  });

  it("reads 'next friday' as the Friday of the following week", () => {
    // Not 7 Aug (two days away) — 14 Aug.
    expect(due("Ship the memo next friday")).toMatchObject({
      month: 8,
      day: 14,
    });
  });

  it("reads abbreviated weekdays", () => {
    expect(due("Ship the memo thu")).toMatchObject({ month: 8, day: 6 });
    expect(due("Ship the memo thurs")).toMatchObject({ month: 8, day: 6 });
  });
});

describe("dates — shorthand", () => {
  it("reads eod as today", () => {
    expect(due("Approve the PO eod")).toMatchObject({
      month: 8,
      day: 5,
      hour: 17,
    });
  });

  it("reads eow as Friday of the work week", () => {
    expect(due("Approve the PO eow")).toMatchObject({ month: 8, day: 7 });
  });

  it("rolls eow forward over the weekend", () => {
    // Saturday 8 August.
    expect(
      due("Approve the PO eow", { now: new Date("2026-08-08T14:00:00Z") }),
    ).toMatchObject({ month: 8, day: 14 });
  });

  it("reads eom as the last day of the month", () => {
    expect(due("Close the books eom")).toMatchObject({ month: 8, day: 31 });
  });

  it("reads 'next week' as Monday", () => {
    expect(due("Draft the paper next week")).toMatchObject({
      month: 8,
      day: 10,
    });
  });

  it("reads 'next month' as the first", () => {
    expect(due("Plan the offsite next month")).toMatchObject({
      month: 9,
      day: 1,
    });
  });
});

describe("dates — explicit", () => {
  it("reads ISO", () => {
    expect(due("Board pack 2026-09-14")).toMatchObject({ month: 9, day: 14 });
  });

  it("reads month/day in US order", () => {
    expect(due("Board pack 9/14")).toMatchObject({ month: 9, day: 14 });
  });

  it("reads month/day/year", () => {
    const result = parseQuickAdd("Board pack 9/14/2027", options);
    expect(new Date(result.dueAt!.value).getUTCFullYear()).toBe(2027);
  });

  it("reads a month name before the day", () => {
    expect(due("Board pack Sept 14")).toMatchObject({ month: 9, day: 14 });
    expect(due("Board pack September 14th")).toMatchObject({
      month: 9,
      day: 14,
    });
  });

  it("reads a day before the month name", () => {
    expect(due("Board pack 14 September")).toMatchObject({ month: 9, day: 14 });
    expect(due("Board pack 14th of September")).toMatchObject({
      month: 9,
      day: 14,
    });
  });

  it("rolls a past month/day into next year", () => {
    // 1 March is behind us on 5 August.
    const result = parseQuickAdd("Annual review 3/1", options);
    expect(new Date(result.dueAt!.value).getUTCFullYear()).toBe(2027);
  });

  it("does not read a month out of a word that merely starts like one", () => {
    // "marketing" starts with "mar"; this is not the 5th of March.
    expect(parseQuickAdd("marketing 5 review", options).dueAt).toBeNull();
  });

  it("rejects an impossible month", () => {
    expect(parseQuickAdd("Order 45/99 widgets", options).dueAt).toBeNull();
  });
});

describe("times", () => {
  it("attaches a trailing time to the date", () => {
    expect(due("Standup tomorrow 9am")).toEqual({
      month: 8,
      day: 6,
      hour: 9,
      minute: 0,
    });
  });

  it("attaches a trailing 'at' time", () => {
    expect(due("Standup tomorrow at 9:15am")).toEqual({
      month: 8,
      day: 6,
      hour: 9,
      minute: 15,
    });
  });

  it("reads 24-hour times after a date", () => {
    expect(due("Standup tomorrow 14:30")).toEqual({
      month: 8,
      day: 6,
      hour: 14,
      minute: 30,
    });
  });

  it("finds a detached 'at' time elsewhere in the line", () => {
    expect(due("Call the auditor at 4pm on friday")).toEqual({
      month: 8,
      day: 7,
      hour: 16,
      minute: 0,
    });
  });

  it("treats a bare time as today when it is still ahead", () => {
    expect(due("Call Ana at 4pm")).toEqual({
      month: 8,
      day: 5,
      hour: 16,
      minute: 0,
    });
  });

  it("rolls a bare time that has already passed to tomorrow", () => {
    // Reference time is 10:00 local.
    expect(due("Call Ana at 9am")).toEqual({
      month: 8,
      day: 6,
      hour: 9,
      minute: 0,
    });
  });

  it("does not read a bare 24-hour clock as a time", () => {
    // Otherwise "1:1 with Sam" becomes a due date.
    expect(parseQuickAdd("1:1 with Sam", options).dueAt).toBeNull();
  });

  it("honours a custom default due hour", () => {
    expect(due("Sync notes tomorrow", { defaultDueHour: 9 })).toMatchObject({
      hour: 9,
    });
  });

  it("respects the caller's timezone", () => {
    const result = parseQuickAdd("Sync notes tomorrow", {
      ...options,
      timeZone: "Asia/Tokyo",
    });
    // 17:00 on 6 Aug in Tokyo is 08:00 UTC.
    expect(result.dueAt?.value).toBe("2026-08-06T08:00:00.000Z");
  });
});

describe("lead-in words", () => {
  it.each(["by", "due", "on", "before", "until", "till"])(
    "swallows '%s' along with the date",
    (lead) => {
      const result = parseQuickAdd(`Send the pack ${lead} friday`, options);
      expect(result.title).toBe("Send the pack");
      expect(result.dueAt).not.toBeNull();
    },
  );
});

describe("event references", () => {
  it("reads an explicit ^ token", () => {
    const result = parseQuickAdd(
      'Write talking points ^"Q3 board review"',
      options,
    );
    expect(result.eventRef?.value).toEqual({
      label: "Q3 board review",
      relation: "related",
    });
    expect(result.title).toBe("Write talking points");
  });

  it("reads a prep phrase", () => {
    const result = parseQuickAdd(
      "Draft slides prep for the board review",
      options,
    );
    expect(result.eventRef?.value).toEqual({
      label: "board review",
      relation: "prep",
    });
    expect(result.title).toBe("Draft slides");
  });

  it("reads a follow-up phrase", () => {
    const result = parseQuickAdd("Send notes after the exec sync", options);
    expect(result.eventRef?.value).toEqual({
      label: "exec sync",
      relation: "follow_up",
    });
    expect(result.title).toBe("Send notes");
  });

  it("reads 'ahead of' as prep", () => {
    expect(
      parseQuickAdd("Read the pack ahead of the audit walkthrough", options)
        .eventRef?.value.relation,
    ).toBe("prep");
  });

  it("reads 're:' as a plain relation", () => {
    const result = parseQuickAdd("Chase legal re: vendor renewal", options);
    expect(result.eventRef?.value).toEqual({
      label: "vendor renewal",
      relation: "related",
    });
  });

  it("is always a suggestion, never a decision", () => {
    // The parser has no way to express "linked" — only "this looks like a
    // link". Confirmation happens in the UI and is recorded in the database.
    const result = parseQuickAdd("Send notes after the exec sync", options);
    expect(result.eventRef?.confidence).toBe("inferred");
    expect(Object.keys(result)).not.toContain("confirmed");
  });

  it("prefers a date over an event phrase for 'before <weekday>'", () => {
    const result = parseQuickAdd("Send the pack before friday", options);
    expect(result.dueAt).not.toBeNull();
    expect(result.eventRef).toBeNull();
    expect(result.title).toBe("Send the pack");
  });

  it("still reads 'before <event>' as an event", () => {
    const result = parseQuickAdd(
      "Send the pack before the board review",
      options,
    );
    expect(result.eventRef?.value.label).toBe("board review");
    expect(result.dueAt).toBeNull();
  });

  it("keeps the phrase in the title when removing it would leave nothing", () => {
    const result = parseQuickAdd("prep for the board review", options);
    expect(result.title).toBe("prep for the board review");
    expect(result.eventRef?.value.label).toBe("board review");
  });

  it("does not invent an event from a number after 'prep'", () => {
    // Regression: "Prep 1:1 notes for Maya" used to be read as prep for an
    // event called "1", which also chewed the front off the title.
    const result = parseQuickAdd("Prep 1:1 notes for Maya", options);
    expect(result.eventRef).toBeNull();
    expect(result.title).toBe("Prep 1:1 notes for Maya");
  });

  it("still reads a label that merely contains digits", () => {
    expect(
      parseQuickAdd("Write notes prep for the Q3 review", options).eventRef
        ?.value.label,
    ).toBe("Q3 review");
  });

  it("does not run the label past the end of a short phrase", () => {
    const result = parseQuickAdd(
      "Circulate minutes after the quarterly business review with the leadership team and the auditors",
      options,
    );
    // Capped at six words.
    expect(
      result.eventRef!.value.label.split(/\s+/).length,
    ).toBeLessThanOrEqual(6);
  });
});

describe("everything at once", () => {
  it("handles a realistic capture", () => {
    const result = parseQuickAdd(
      "Draft board deck !high friday 3pm #strategic @doug prep for the Q3 board review",
      options,
    );

    expect(result.title).toBe("Draft board deck");
    expect(result.priority?.value).toBe("high");
    expect(result.categorySlug?.value).toBe("strategic");
    expect(result.owner?.value).toBe("doug");
    expect(result.eventRef?.value).toEqual({
      label: "Q3 board review",
      relation: "prep",
    });

    const parts = getZonedParts(new Date(result.dueAt!.value), TZ);
    expect(parts).toMatchObject({ month: 8, day: 7, hour: 15, minute: 0 });
  });

  it("returns an all-null result for text with no signals", () => {
    const result = parseQuickAdd("Read the vendor SOW", options);
    expect(result).toMatchObject({
      title: "Read the vendor SOW",
      dueAt: null,
      priority: null,
      categorySlug: null,
      owner: null,
      eventRef: null,
      consumed: [],
    });
  });

  it("handles an empty input without throwing", () => {
    expect(parseQuickAdd("", options).title).toBe("");
  });
});
