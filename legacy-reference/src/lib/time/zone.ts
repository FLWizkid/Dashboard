/**
 * Timezone-aware wall-clock arithmetic, built on `Intl` only.
 *
 * The product auto-detects the timezone from the browser with a settings
 * override, so nothing may assume the runtime's local zone — a due date typed
 * as "Friday 5pm" must land at 5pm in *the owner's* zone whether it was parsed
 * in the browser, in a server action, or in a cron digest on the box.
 *
 * Everything here takes an explicit `timeZone` and returns UTC instants.
 * No dependency: `Intl.DateTimeFormat` already knows the tz database, and a
 * two-pass offset lookup handles DST correctly, including the ambiguous hour.
 */

export interface WallClock {
  year: number;
  /** 1-12, not the `Date` 0-11. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface ZonedParts extends WallClock {
  /** 0 = Sunday … 6 = Saturday, matching `Date.prototype.getDay`. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Returns `true` when the runtime recognises the IANA zone name. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading a person in `timeZone` sees at `instant`. */
export function getZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    // `hourCycle: "h23"` still reports midnight as "24" in some ICU builds.
    hour: Number(lookup.hour) % 24,
    minute: Number(lookup.minute),
    second: Number(lookup.second),
    weekday: WEEKDAY_INDEX[lookup.weekday] ?? 0,
  };
}

/**
 * Offset of `timeZone` from UTC at `instant`, in milliseconds
 * (positive east of Greenwich).
 */
export function getTimeZoneOffset(instant: Date, timeZone: string): number {
  const parts = getZonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // Drop sub-second precision from both sides so the difference is exact.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Convert a wall-clock reading in `timeZone` to the UTC instant it names.
 *
 * Two passes: guess the offset by pretending the reading is UTC, then re-read
 * the offset at the resulting instant. That second pass is what makes DST
 * transitions land correctly.
 *
 * The two ambiguous cases resolve deterministically:
 *   • Repeated hour (clocks go back): the first of the two, i.e. still on the
 *     pre-transition offset.
 *   • Missing hour (clocks go forward): the last valid instant before the
 *     jump, so a due time never travels forward into the following hour.
 * Both are covered by tests in `zone.test.ts`.
 */
export function zonedTimeToUtc(wall: WallClock, timeZone: string): Date {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );

  const firstOffset = getTimeZoneOffset(new Date(naive), timeZone);
  const firstGuess = naive - firstOffset;

  const secondOffset = getTimeZoneOffset(new Date(firstGuess), timeZone);
  if (secondOffset === firstOffset) return new Date(firstGuess);

  return new Date(naive - secondOffset);
}

/** Midnight at the start of the day `instant` falls on, in `timeZone`. */
export function startOfZonedDay(instant: Date, timeZone: string): Date {
  const parts = getZonedParts(instant, timeZone);
  return zonedTimeToUtc({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone);
}

/**
 * Set the time of day on the date `instant` falls on, in `timeZone`.
 * Used to snap a bare date ("Friday") to the default due hour.
 */
export function withZonedTime(
  instant: Date,
  timeZone: string,
  hour: number,
  minute = 0,
): Date {
  const parts = getZonedParts(instant, timeZone);
  return zonedTimeToUtc({ ...parts, hour, minute, second: 0 }, timeZone);
}

/**
 * Add whole days in wall-clock terms, so "+1 day" across a DST boundary keeps
 * the same clock time rather than shifting by an hour.
 */
export function addZonedDays(
  instant: Date,
  timeZone: string,
  days: number,
): Date {
  const parts = getZonedParts(instant, timeZone);
  const shifted = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return zonedTimeToUtc(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
    },
    timeZone,
  );
}

/** Add whole months, clamping to the last valid day (Jan 31 + 1mo = Feb 28). */
export function addZonedMonths(
  instant: Date,
  timeZone: string,
  months: number,
): Date {
  const parts = getZonedParts(instant, timeZone);
  const targetMonthIndex = parts.month - 1 + months;
  const targetYear = parts.year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();

  return zonedTimeToUtc(
    {
      year: targetYear,
      month: targetMonth + 1,
      day: Math.min(parts.day, lastDay),
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
    },
    timeZone,
  );
}

/** Last calendar day of the month `instant` falls in, in `timeZone`. */
export function endOfZonedMonth(instant: Date, timeZone: string): Date {
  const parts = getZonedParts(instant, timeZone);
  const lastDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  return zonedTimeToUtc(
    { ...parts, day: lastDay, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

/**
 * Move to the next occurrence of `weekday` (0 = Sunday).
 * `includeToday` decides whether "Friday" said on a Friday means today.
 */
export function nextWeekday(
  instant: Date,
  timeZone: string,
  weekday: number,
  includeToday = true,
): Date {
  const current = getZonedParts(instant, timeZone).weekday;
  let delta = (weekday - current + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addZonedDays(instant, timeZone, delta);
}

/** Monday of the week `instant` falls in (weeks start Monday: work-week default). */
export function startOfZonedWeek(instant: Date, timeZone: string): Date {
  const weekday = getZonedParts(instant, timeZone).weekday;
  // Sunday (0) belongs to the week that started six days earlier.
  const back = weekday === 0 ? 6 : weekday - 1;
  return startOfZonedDay(addZonedDays(instant, timeZone, -back), timeZone);
}

/** True when both instants fall on the same calendar day in `timeZone`. */
export function isSameZonedDay(a: Date, b: Date, timeZone: string): boolean {
  const pa = getZonedParts(a, timeZone);
  const pb = getZonedParts(b, timeZone);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** Whole calendar days from `a`'s day to `b`'s day in `timeZone`. */
export function zonedDayDifference(a: Date, b: Date, timeZone: string): number {
  const pa = getZonedParts(a, timeZone);
  const pb = getZonedParts(b, timeZone);
  const dayA = Date.UTC(pa.year, pa.month - 1, pa.day);
  const dayB = Date.UTC(pb.year, pb.month - 1, pb.day);
  return Math.round((dayB - dayA) / 86_400_000);
}

/**
 * The browser's zone, or `UTC` where `Intl` isn't available.
 * Callers should prefer an explicit setting when the owner has set one.
 */
export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
