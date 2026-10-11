import { describe, expect, it } from "vitest";

import {
  classificationChanged,
  classifyEvent,
  type CategoryRule,
  type ClassifiableCalendar,
  type ClassifiableEvent,
} from "./classify";

const calendar = (
  over: Partial<ClassifiableCalendar> = {},
): ClassifiableCalendar => ({
  id: "cal-1",
  name: "Work",
  countsTowardHours: true,
  defaultCategoryId: "cat-operational",
  ...over,
});

const event = (over: Partial<ClassifiableEvent> = {}): ClassifiableEvent => ({
  id: "evt-1",
  title: "Board review",
  location: null,
  organizerAddress: null,
  attendeeAddresses: [],
  attendeeCount: 5,
  isExternal: false,
  isCancelled: false,
  categoryId: null,
  categorySource: "unclassified",
  hoursInclude: null,
  ...over,
});

const rule = (over: Partial<CategoryRule> = {}): CategoryRule => ({
  id: "rule-1",
  pattern: "board",
  field: "title",
  categoryId: "cat-stakeholder",
  countsTowardHours: true,
  position: 0,
  isEnabled: true,
  ...over,
});

const cues = {
  "people-team": "cat-people",
  "stakeholder-board": "cat-stakeholder",
};

/* ── Manual override ──────────────────────────────────────────────────── */

describe("manual override always wins", () => {
  it("beats a rule that would say otherwise", () => {
    const result = classifyEvent({
      event: event({ categoryId: "cat-strategic", categorySource: "manual" }),
      calendar: calendar(),
      rules: [rule({ categoryId: "cat-stakeholder" })],
    });

    expect(result.categoryId).toBe("cat-strategic");
    expect(result.source).toBe("manual");
    expect(result.reason).toMatch(/yourself/);
  });

  it("beats the attendee cues", () => {
    const result = classifyEvent({
      event: event({
        categoryId: "cat-strategic",
        categorySource: "manual",
        isExternal: true,
      }),
      calendar: calendar(),
      categoryIdBySlug: cues,
    });

    expect(result.categoryId).toBe("cat-strategic");
  });

  it("beats the calendar default", () => {
    const result = classifyEvent({
      event: event({ categoryId: "cat-strategic", categorySource: "manual" }),
      calendar: calendar({ defaultCategoryId: "cat-operational" }),
    });

    expect(result.categoryId).toBe("cat-strategic");
  });

  it("counts by default, because categorising it was a deliberate act", () => {
    expect(
      classifyEvent({
        event: event({ categoryId: "cat-strategic", categorySource: "manual" }),
        calendar: calendar(),
      }).countsTowardHours,
    ).toBe(true);
  });

  it("can still be excluded by the event-level toggle", () => {
    // "This is strategy work" and "don't count this one" are different
    // statements, and the owner is allowed to make both.
    const result = classifyEvent({
      event: event({
        categoryId: "cat-strategic",
        categorySource: "manual",
        hoursInclude: false,
      }),
      calendar: calendar(),
    });

    expect(result.categoryId).toBe("cat-strategic");
    expect(result.countsTowardHours).toBe(false);
    expect(result.reason).toMatch(/excluded it from hours/);
  });
});

/* ── The event-level toggle ───────────────────────────────────────────── */

describe("the event-level toggle", () => {
  it("includes something that would not otherwise count", () => {
    const result = classifyEvent({
      event: event({ hoursInclude: true }),
      calendar: calendar({ countsTowardHours: false }),
    });

    expect(result.countsTowardHours).toBe(true);
    expect(result.reason).toMatch(/included it in hours/);
  });

  it("excludes something that would", () => {
    const result = classifyEvent({
      event: event({ hoursInclude: false }),
      calendar: calendar(),
    });

    expect(result.countsTowardHours).toBe(false);
  });

  it("does not change the category, only whether it counts", () => {
    const result = classifyEvent({
      event: event({ hoursInclude: false }),
      calendar: calendar({ defaultCategoryId: "cat-operational" }),
    });

    expect(result.categoryId).toBe("cat-operational");
  });

  it("null means inherit", () => {
    expect(
      classifyEvent({
        event: event({ hoursInclude: null }),
        calendar: calendar(),
      }).countsTowardHours,
    ).toBe(true);
  });
});

/* ── Rules ────────────────────────────────────────────────────────────── */

describe("keyword rules", () => {
  it("match a substring of the title, case-insensitively", () => {
    const result = classifyEvent({
      event: event({ title: "Q3 BOARD Review" }),
      calendar: calendar(),
      rules: [rule({ pattern: "board" })],
    });

    expect(result.source).toBe("rule");
    expect(result.categoryId).toBe("cat-stakeholder");
    expect(result.matchedRuleId).toBe("rule-1");
    expect(result.reason).toMatch(/Matched your rule/);
  });

  it("run in the owner's order, first match wins", () => {
    const result = classifyEvent({
      event: event({ title: "Board budget review" }),
      calendar: calendar(),
      rules: [
        rule({
          id: "second",
          pattern: "budget",
          categoryId: "cat-vendor",
          position: 2,
        }),
        rule({
          id: "first",
          pattern: "board",
          categoryId: "cat-stakeholder",
          position: 1,
        }),
      ],
    });

    expect(result.matchedRuleId).toBe("first");
    expect(result.categoryId).toBe("cat-stakeholder");
  });

  it("can exclude without assigning a category", () => {
    const result = classifyEvent({
      event: event({ title: "Lunch" }),
      calendar: calendar(),
      rules: [
        rule({ pattern: "lunch", categoryId: null, countsTowardHours: false }),
      ],
    });

    expect(result.countsTowardHours).toBe(false);
    expect(result.reason).toMatch(/Excluded by your rule/);
  });

  it("fall back to the calendar's default category when the rule names none", () => {
    const result = classifyEvent({
      event: event({ title: "Lunch" }),
      calendar: calendar({ defaultCategoryId: "cat-operational" }),
      rules: [rule({ pattern: "lunch", categoryId: null })],
    });

    expect(result.categoryId).toBe("cat-operational");
  });

  it("match on location, organizer and attendee too", () => {
    expect(
      classifyEvent({
        event: event({ location: "Boardroom 3" }),
        calendar: calendar(),
        rules: [rule({ pattern: "boardroom", field: "location" })],
      }).source,
    ).toBe("rule");

    expect(
      classifyEvent({
        event: event({ organizerAddress: "chair@board.example" }),
        calendar: calendar(),
        rules: [rule({ pattern: "board.example", field: "organizer" })],
      }).source,
    ).toBe("rule");

    expect(
      classifyEvent({
        event: event({ attendeeAddresses: ["vendor@acme.example"] }),
        calendar: calendar(),
        rules: [rule({ pattern: "acme", field: "attendee" })],
      }).source,
    ).toBe("rule");
  });

  it("skip disabled rules", () => {
    const result = classifyEvent({
      event: event({ title: "Board review" }),
      calendar: calendar(),
      rules: [rule({ isEnabled: false })],
    });

    expect(result.source).not.toBe("rule");
  });

  it("ignore an empty pattern rather than matching everything", () => {
    const result = classifyEvent({
      event: event(),
      calendar: calendar(),
      rules: [rule({ pattern: "   " })],
    });

    expect(result.source).not.toBe("rule");
  });
});

/* ── Cues ─────────────────────────────────────────────────────────────── */

describe("attendee cues", () => {
  it("treat an external meeting as stakeholder work", () => {
    const result = classifyEvent({
      event: event({ isExternal: true }),
      calendar: calendar({ defaultCategoryId: null }),
      categoryIdBySlug: cues,
    });

    expect(result.source).toBe("attendees");
    expect(result.categoryId).toBe("cat-stakeholder");
    expect(result.reason).toMatch(/outside your organisation/);
  });

  it("treat a two-person meeting as a one-to-one", () => {
    const result = classifyEvent({
      event: event({ attendeeCount: 2 }),
      calendar: calendar({ defaultCategoryId: null }),
      categoryIdBySlug: cues,
    });

    expect(result.categoryId).toBe("cat-people");
    expect(result.reason).toMatch(/one-to-one/);
  });

  it("lose to a rule", () => {
    const result = classifyEvent({
      event: event({ isExternal: true, title: "Board review" }),
      calendar: calendar(),
      rules: [rule({ categoryId: "cat-strategic" })],
      categoryIdBySlug: cues,
    });

    expect(result.source).toBe("rule");
    expect(result.categoryId).toBe("cat-strategic");
  });

  it("are skipped entirely when the category does not exist", () => {
    // Better to fall through than to invent a category the owner deleted.
    const result = classifyEvent({
      event: event({ isExternal: true }),
      calendar: calendar({ defaultCategoryId: null }),
      categoryIdBySlug: {},
    });

    expect(result.source).toBe("unclassified");
  });
});

/* ── Calendar and default ─────────────────────────────────────────────── */

describe("calendar level", () => {
  it("excludes a whole calendar", () => {
    const result = classifyEvent({
      event: event(),
      calendar: calendar({ countsTowardHours: false, name: "Personal" }),
    });

    expect(result.countsTowardHours).toBe(false);
    expect(result.reason).toContain("Personal");
  });

  it("a calendar exclusion beats a rule that would include", () => {
    const result = classifyEvent({
      event: event({ title: "Board review" }),
      calendar: calendar({ countsTowardHours: false }),
      rules: [rule()],
    });

    expect(result.countsTowardHours).toBe(false);
  });

  it("uses the calendar's default category as a last resort", () => {
    const result = classifyEvent({
      event: event(),
      calendar: calendar({ defaultCategoryId: "cat-operational" }),
    });

    expect(result.source).toBe("calendar");
    expect(result.categoryId).toBe("cat-operational");
  });
});

describe("nothing matched", () => {
  it("does not count, and says how to fix it", () => {
    // Only work-category events count by default. A dashboard that silently
    // counts a dentist appointment is worse than one that counts nothing.
    const result = classifyEvent({
      event: event(),
      calendar: calendar({ defaultCategoryId: null }),
    });

    expect(result.source).toBe("unclassified");
    expect(result.categoryId).toBeNull();
    expect(result.countsTowardHours).toBe(false);
    expect(result.reason).toMatch(/Set a category, or add a rule/);
  });
});

describe("cancelled meetings", () => {
  it("do not count", () => {
    const result = classifyEvent({
      event: event({ isCancelled: true }),
      calendar: calendar(),
    });

    expect(result.countsTowardHours).toBe(false);
    expect(result.reason).toMatch(/Cancelled/);
  });

  it("still lose to a manual override", () => {
    // The owner may have attended anyway, or logged it deliberately.
    const result = classifyEvent({
      event: event({
        isCancelled: true,
        categorySource: "manual",
        categoryId: "cat-strategic",
      }),
      calendar: calendar(),
    });

    expect(result.countsTowardHours).toBe(true);
  });
});

/* ── Everything explains itself ───────────────────────────────────────── */

describe("every classification carries a reason", () => {
  it("whatever path it took", () => {
    const results = [
      classifyEvent({
        event: event({ categorySource: "manual" }),
        calendar: calendar(),
      }),
      classifyEvent({ event: event(), calendar: calendar(), rules: [rule()] }),
      classifyEvent({
        event: event({ isExternal: true }),
        calendar: calendar({ defaultCategoryId: null }),
        categoryIdBySlug: cues,
      }),
      classifyEvent({ event: event(), calendar: calendar() }),
      classifyEvent({
        event: event(),
        calendar: calendar({ defaultCategoryId: null }),
      }),
      classifyEvent({
        event: event({ isCancelled: true }),
        calendar: calendar(),
      }),
    ];

    for (const result of results) {
      expect(result.reason.length, result.source).toBeGreaterThan(10);
      expect(result.reason).not.toMatch(/undefined|null/);
    }
  });
});

describe("classificationChanged", () => {
  it("is false when re-running produces the same answer", () => {
    // The sync path uses this to avoid writing on every pass.
    const stored = event({
      categoryId: "cat-operational",
      categorySource: "calendar",
    });
    const next = classifyEvent({ event: stored, calendar: calendar() });

    expect(classificationChanged(stored, next)).toBe(false);
  });

  it("is true when a new rule changes the outcome", () => {
    const stored = event({
      categoryId: "cat-operational",
      categorySource: "calendar",
    });
    const next = classifyEvent({
      event: stored,
      calendar: calendar(),
      rules: [rule({ categoryId: "cat-stakeholder" })],
    });

    expect(classificationChanged(stored, next)).toBe(true);
  });
});
