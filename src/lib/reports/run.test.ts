import { describe, expect, it } from "vitest";

import { DEFAULT_DIGEST_SETTINGS, type DigestSettings } from "./repository";
import { dueKinds, periodDate } from "./run";

/**
 * The schedule.
 *
 * The cron fires **hourly** and asks `dueKinds` whether anything is due right
 * now in the owner's zone. That is what lets one schedule serve any timezone,
 * and what makes a missed hour recoverable — the period claim, not the firing,
 * is what decides whether a digest actually goes out.
 */

function settings(partial: Partial<DigestSettings> = {}): DigestSettings {
  return { ...DEFAULT_DIGEST_SETTINGS, ...partial };
}

/** 2026-08-10 is a Monday. */
const MONDAY_07_UTC = new Date("2026-08-10T07:00:00.000Z");
const MONDAY_09_UTC = new Date("2026-08-10T09:00:00.000Z");
const TUESDAY_07_UTC = new Date("2026-08-11T07:00:00.000Z");
const FIRST_OF_MONTH = new Date("2026-09-01T07:00:00.000Z");

describe("what is due", () => {
  it("fires the daily brief at the configured hour", () => {
    expect(dueKinds(settings({ dailyHour: 7 }), MONDAY_07_UTC)).toContain(
      "daily",
    );
  });

  it("fires nothing at any other hour", () => {
    expect(dueKinds(settings({ dailyHour: 7 }), MONDAY_09_UTC)).toEqual([]);
  });

  it("fires the weekly rollup on the configured weekday", () => {
    const due = dueKinds(settings({ weeklyDow: 1 }), MONDAY_07_UTC);
    expect(due).toContain("weekly");

    expect(dueKinds(settings({ weeklyDow: 1 }), TUESDAY_07_UTC)).not.toContain(
      "weekly",
    );
  });

  it("fires the monthly rollup on the first, when enabled", () => {
    expect(
      dueKinds(settings({ monthlyEnabled: true }), FIRST_OF_MONTH),
    ).toContain("monthly");

    expect(
      dueKinds(settings({ monthlyEnabled: true }), MONDAY_07_UTC),
    ).not.toContain("monthly");
  });

  it("respects a disabled digest", () => {
    expect(
      dueKinds(settings({ dailyEnabled: false }), MONDAY_07_UTC),
    ).not.toContain("daily");
  });

  it("leaves the monthly rollup off by default", () => {
    expect(dueKinds(settings(), FIRST_OF_MONTH)).not.toContain("monthly");
  });

  it("uses the owner's zone, not the server's", () => {
    // 07:00 in Sydney is 21:00 the previous day in UTC. A schedule that read
    // the server clock would fire the brief in the middle of their night.
    const sydney = settings({ timeZone: "Australia/Sydney", dailyHour: 7 });

    expect(dueKinds(sydney, new Date("2026-08-09T21:00:00.000Z"))).toContain(
      "daily",
    );
    expect(dueKinds(sydney, MONDAY_07_UTC)).toEqual([]);
  });

  it("can fire the daily and the weekly together", () => {
    const due = dueKinds(settings({ weeklyDow: 1 }), MONDAY_07_UTC);
    expect(due).toEqual(expect.arrayContaining(["daily", "weekly"]));
  });
});

describe("the period key", () => {
  it("gives a daily brief its own date", () => {
    expect(periodDate("daily", MONDAY_07_UTC, "UTC")).toBe("2026-08-10");
  });

  it("collapses a whole week to its Monday", () => {
    // So a weekly rollup is once per week whatever hour it fires at, and a
    // retry on Tuesday does not produce a second one.
    expect(periodDate("weekly", MONDAY_07_UTC, "UTC")).toBe("2026-08-10");
    expect(periodDate("weekly", TUESDAY_07_UTC, "UTC")).toBe("2026-08-10");
  });

  it("collapses a month to its first", () => {
    expect(
      periodDate("monthly", new Date("2026-09-17T07:00:00.000Z"), "UTC"),
    ).toBe("2026-09-01");
  });

  it("uses the owner's zone for the date boundary", () => {
    // 23:00 UTC on the 10th is already the 11th in Sydney, and the brief that
    // fires then is the 11th's brief.
    expect(
      periodDate(
        "daily",
        new Date("2026-08-10T23:00:00.000Z"),
        "Australia/Sydney",
      ),
    ).toBe("2026-08-11");
  });

  it("is stable across the hour, so a retry lands on the same key", () => {
    const first = periodDate(
      "daily",
      new Date("2026-08-10T07:00:00.000Z"),
      "UTC",
    );
    const retry = periodDate(
      "daily",
      new Date("2026-08-10T07:05:00.000Z"),
      "UTC",
    );

    expect(first).toBe(retry);
  });
});
