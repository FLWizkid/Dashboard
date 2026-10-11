import { getZonedParts, zonedDayDifference } from "./zone";

/**
 * Display formatting for due dates.
 *
 * Calm and specific: "Today, 5:00 PM" beats "in 4 hours" for someone
 * scanning a list, and "Overdue · Tue" beats a red timestamp.
 * All of it resolves in the owner's timezone.
 */

const timeFormatterCache = new Map<string, Intl.DateTimeFormat>();
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function timeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = timeFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    });
    timeFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  const key = timeZone;
  let formatter = dateFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    dateFormatterCache.set(key, formatter);
  }
  return formatter;
}

export function formatTimeOfDay(instant: Date, timeZone: string): string {
  return timeFormatter(timeZone).format(instant);
}

/**
 * A short label for a due date, relative where that reads better.
 *   Overdue · yesterday · Today, 5:00 PM · Tomorrow, 9:00 AM · Fri, Aug 14
 */
export function formatDueDate(
  dueAt: string | Date,
  now: Date,
  timeZone: string,
): string {
  const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  const days = zonedDayDifference(now, due, timeZone);
  const time = formatTimeOfDay(due, timeZone);

  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days === -1) return `Yesterday, ${time}`;

  // Inside the next week a weekday name is the most useful thing to read.
  if (days > 1 && days <= 6) {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
    }).format(due);
    return `${weekday}, ${time}`;
  }

  const sameYear =
    getZonedParts(due, timeZone).year === getZonedParts(now, timeZone).year;
  const formatted = dateFormatter(timeZone).format(due);
  return sameYear
    ? formatted
    : `${formatted}, ${getZonedParts(due, timeZone).year}`;
}

/** Machine-readable value for a `<time datetime="…">` element. */
export function toDateTimeAttribute(dueAt: string | Date): string {
  return (typeof dueAt === "string" ? new Date(dueAt) : dueAt).toISOString();
}

/**
 * The value a `<input type="datetime-local">` expects, expressed in the
 * owner's timezone rather than the browser's.
 */
export function toDateTimeLocalValue(
  instant: string | Date,
  timeZone: string,
): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const parts = getZonedParts(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}
