import { describe, expect, it } from "vitest";

import {
  addZonedDays,
  addZonedMonths,
  endOfZonedMonth,
  getTimeZoneOffset,
  getZonedParts,
  isSameZonedDay,
  nextWeekday,
  startOfZonedDay,
  startOfZonedWeek,
  withZonedTime,
  zonedDayDifference,
  zonedTimeToUtc,
} from "./zone";

const NY = "America/New_York";
const TOKYO = "Asia/Tokyo";
const KOLKATA = "Asia/Kolkata"; // UTC+5:30 — catches half-hour offset bugs.

describe("getZonedParts", () => {
  it("reads the wall clock in the target zone", () => {
    const parts = getZonedParts(new Date("2026-08-05T14:00:00Z"), NY);
    expect(parts).toMatchObject({
      year: 2026,
      month: 8,
      day: 5,
      hour: 10,
      minute: 0,
      weekday: 3, // Wednesday
    });
  });

  it("handles a zone ahead of UTC that rolls the date forward", () => {
    const parts = getZonedParts(new Date("2026-08-05T20:00:00Z"), TOKYO);
    expect(parts).toMatchObject({ year: 2026, month: 8, day: 6, hour: 5 });
  });

  it("handles a half-hour offset", () => {
    const parts = getZonedParts(new Date("2026-08-05T14:00:00Z"), KOLKATA);
    expect(parts).toMatchObject({ hour: 19, minute: 30 });
  });

  it("reports midnight as hour 0, not 24", () => {
    // 04:00Z is exactly midnight in New York during daylight time.
    expect(getZonedParts(new Date("2026-08-05T04:00:00Z"), NY).hour).toBe(0);
  });
});

describe("getTimeZoneOffset", () => {
  it("is negative west of Greenwich", () => {
    expect(getTimeZoneOffset(new Date("2026-08-05T12:00:00Z"), NY)).toBe(
      -4 * 3_600_000,
    );
  });

  it("follows daylight saving", () => {
    expect(getTimeZoneOffset(new Date("2026-01-15T12:00:00Z"), NY)).toBe(
      -5 * 3_600_000,
    );
  });
});

describe("zonedTimeToUtc", () => {
  it("round-trips a wall clock through UTC", () => {
    const wall = {
      year: 2026,
      month: 8,
      day: 5,
      hour: 17,
      minute: 0,
      second: 0,
    };
    const instant = zonedTimeToUtc(wall, NY);
    expect(instant.toISOString()).toBe("2026-08-05T21:00:00.000Z");
    expect(getZonedParts(instant, NY)).toMatchObject(wall);
  });

  it("resolves the repeated hour when clocks go back", () => {
    // 2026-11-01 01:30 happens twice in New York. Either answer is defensible;
    // what matters is that the result really is 01:30 local.
    const instant = zonedTimeToUtc(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
      NY,
    );
    expect(getZonedParts(instant, NY)).toMatchObject({ hour: 1, minute: 30 });
  });

  it("resolves the missing hour when clocks go forward", () => {
    // 2026-03-08 02:30 does not exist in New York — the clock jumps 02:00 to
    // 03:00. We resolve to the last valid instant before the jump (01:30 EST)
    // rather than skipping an hour forward.
    const instant = zonedTimeToUtc(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
      NY,
    );
    expect(instant.toISOString()).toBe("2026-03-08T06:30:00.000Z");
    expect(getZonedParts(instant, NY)).toMatchObject({ hour: 1, minute: 30 });
  });
});

describe("startOfZonedDay", () => {
  it("finds local midnight, not UTC midnight", () => {
    expect(
      startOfZonedDay(new Date("2026-08-05T14:00:00Z"), NY).toISOString(),
    ).toBe("2026-08-05T04:00:00.000Z");
  });
});

describe("withZonedTime", () => {
  it("sets the wall-clock time on the same local day", () => {
    const result = withZonedTime(new Date("2026-08-05T14:00:00Z"), NY, 17, 30);
    expect(getZonedParts(result, NY)).toMatchObject({
      day: 5,
      hour: 17,
      minute: 30,
    });
  });
});

describe("addZonedDays", () => {
  it("keeps the clock time across a daylight-saving boundary", () => {
    // New York falls back on 2026-11-01.
    const before = zonedTimeToUtc(
      { year: 2026, month: 10, day: 31, hour: 9, minute: 0, second: 0 },
      NY,
    );
    const after = addZonedDays(before, NY, 2);
    expect(getZonedParts(after, NY)).toMatchObject({
      month: 11,
      day: 2,
      hour: 9,
    });
    // Wall clock unchanged even though the elapsed time is 49 hours.
    expect(after.getTime() - before.getTime()).toBe(49 * 3_600_000);
  });

  it("goes backwards", () => {
    const result = addZonedDays(new Date("2026-08-05T14:00:00Z"), NY, -1);
    expect(getZonedParts(result, NY)).toMatchObject({ month: 8, day: 4 });
  });
});

describe("addZonedMonths", () => {
  it("clamps to the last valid day", () => {
    const jan31 = zonedTimeToUtc(
      { year: 2026, month: 1, day: 31, hour: 12, minute: 0, second: 0 },
      NY,
    );
    expect(getZonedParts(addZonedMonths(jan31, NY, 1), NY)).toMatchObject({
      month: 2,
      day: 28,
    });
  });

  it("rolls across a year boundary", () => {
    const result = addZonedMonths(new Date("2026-11-15T12:00:00Z"), NY, 3);
    expect(getZonedParts(result, NY)).toMatchObject({ year: 2027, month: 2 });
  });
});

describe("endOfZonedMonth", () => {
  it("finds the last day of the month", () => {
    expect(
      getZonedParts(endOfZonedMonth(new Date("2026-02-10T12:00:00Z"), NY), NY),
    ).toMatchObject({ month: 2, day: 28 });
  });
});

describe("nextWeekday", () => {
  const wednesday = new Date("2026-08-05T14:00:00Z");

  it("finds the coming Friday", () => {
    expect(getZonedParts(nextWeekday(wednesday, NY, 5), NY)).toMatchObject({
      month: 8,
      day: 7,
    });
  });

  it("returns today when today is the weekday and today counts", () => {
    expect(getZonedParts(nextWeekday(wednesday, NY, 3), NY)).toMatchObject({
      day: 5,
    });
  });

  it("skips a week when today does not count", () => {
    expect(
      getZonedParts(nextWeekday(wednesday, NY, 3, false), NY),
    ).toMatchObject({ day: 12 });
  });
});

describe("startOfZonedWeek", () => {
  it("returns Monday for a midweek day", () => {
    expect(
      getZonedParts(startOfZonedWeek(new Date("2026-08-05T14:00:00Z"), NY), NY),
    ).toMatchObject({ month: 8, day: 3, hour: 0 });
  });

  it("treats Sunday as the end of the week that began six days earlier", () => {
    // 2026-08-09 is a Sunday.
    expect(
      getZonedParts(startOfZonedWeek(new Date("2026-08-09T14:00:00Z"), NY), NY),
    ).toMatchObject({ month: 8, day: 3 });
  });
});

describe("isSameZonedDay / zonedDayDifference", () => {
  it("compares calendar days in the target zone, not UTC", () => {
    const lateNightNy = new Date("2026-08-06T03:00:00Z"); // 23:00 Aug 5 in NY
    const morningNy = new Date("2026-08-05T14:00:00Z");
    expect(isSameZonedDay(lateNightNy, morningNy, NY)).toBe(true);
    expect(isSameZonedDay(lateNightNy, morningNy, "UTC")).toBe(false);
  });

  it("counts whole calendar days", () => {
    expect(
      zonedDayDifference(
        new Date("2026-08-05T23:00:00Z"),
        new Date("2026-08-06T01:00:00Z"),
        "UTC",
      ),
    ).toBe(1);
  });
});
