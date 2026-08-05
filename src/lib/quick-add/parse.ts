/**
 * Smart parsing for the single-line quick-add box.
 *
 * The contract, which the UI depends on:
 *   1. Parsing NEVER decides anything. It returns *suggestions* with the exact
 *      substring that produced each one, and the caller renders them as
 *      editable chips.
 *   2. An event reference is only ever a suggestion. Nothing here confirms a
 *      link — that is a deliberate user action (`confirmed_at` in the schema).
 *   3. Whatever text is not claimed by a suggestion becomes the title, and the
 *      title is never allowed to end up empty.
 *
 * The full grammar is documented in `docs/parser-rules.md`. Keep that file and
 * this one in step — it is the reference the owner reads, not the code.
 */

import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import type { TaskLinkRelation, TaskPriority } from "@/lib/tasks/types";
import {
  addZonedDays,
  addZonedMonths,
  endOfZonedMonth,
  getZonedParts,
  nextWeekday,
  startOfZonedDay,
  startOfZonedWeek,
  withZonedTime,
  zonedTimeToUtc,
} from "@/lib/time/zone";

/** Wall-clock hour a bare date snaps to (end of the working day). */
export const DEFAULT_DUE_HOUR = 17;

export type ParsedField =
  "dueAt" | "priority" | "category" | "owner" | "eventRef";

export interface Suggestion<T> {
  value: T;
  /** The exact input substring this came from. */
  raw: string;
  /**
   * `explicit` — the owner typed a token or an unambiguous date.
   * `inferred` — we read it out of ordinary prose and could be wrong.
   */
  confidence: "explicit" | "inferred";
}

export interface EventReference {
  label: string;
  relation: TaskLinkRelation;
}

export interface ConsumedSpan {
  field: ParsedField;
  raw: string;
  start: number;
  end: number;
}

export interface QuickAddResult {
  title: string;
  dueAt: Suggestion<string> | null;
  priority: Suggestion<TaskPriority> | null;
  categorySlug: Suggestion<string> | null;
  owner: Suggestion<string> | null;
  eventRef: Suggestion<EventReference> | null;
  /** Ordered by position in the input; drives the input highlighter. */
  consumed: ConsumedSpan[];
}

export interface ParseCategory {
  slug: string;
  name: string;
  aliases?: string[];
}

export interface ParseOptions {
  /** "now" for relative dates. Injected so the parser is fully testable. */
  now: Date;
  /** IANA zone the owner's wall clock is in. */
  timeZone: string;
  /** Defaults to the eight seeded CIO categories. */
  categories?: readonly ParseCategory[];
  defaultDueHour?: number;
}

/* ────────────────────────────────────────────────────────────────────────
 * Scanner — tracks what has been claimed so later rules can't re-claim it
 * ──────────────────────────────────────────────────────────────────────── */

class Scanner {
  readonly original: string;
  /** The input with claimed regions blanked to spaces, preserving indices. */
  working: string;
  readonly consumed: ConsumedSpan[] = [];

  constructor(input: string) {
    this.original = input;
    this.working = input;
  }

  claim(start: number, end: number, field: ParsedField): string {
    const raw = this.original.slice(start, end);
    this.consumed.push({ field, raw, start, end });
    this.working =
      this.working.slice(0, start) +
      " ".repeat(end - start) +
      this.working.slice(end);
    return raw;
  }

  /** First match of `re` in the unclaimed text, or `null`. */
  find(re: RegExp): RegExpExecArray | null {
    const scoped = new RegExp(re.source, re.flags.replace("g", ""));
    return scoped.exec(this.working);
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Priority
 * ──────────────────────────────────────────────────────────────────────── */

const PRIORITY_TOKEN =
  /(?<![^\s])!(critical|crit|high|hi|normal|norm|low|c|h|n|l)\b/i;
const PRIORITY_PN = /(?<![^\s])p([1-4])\b/i;
const PRIORITY_INFERRED_CRITICAL = /\b(urgent|asap|emergency|critical)\b/i;
const PRIORITY_INFERRED_HIGH = /\b(important|high priority)\b/i;

const PRIORITY_BY_TOKEN: Record<string, TaskPriority> = {
  critical: "critical",
  crit: "critical",
  c: "critical",
  high: "high",
  hi: "high",
  h: "high",
  normal: "normal",
  norm: "normal",
  n: "normal",
  low: "low",
  l: "low",
};

const PRIORITY_BY_PN: Record<string, TaskPriority> = {
  "1": "critical",
  "2": "high",
  "3": "normal",
  "4": "low",
};

function parsePriority(scanner: Scanner): Suggestion<TaskPriority> | null {
  const token = scanner.find(PRIORITY_TOKEN);
  if (token) {
    const raw = scanner.claim(
      token.index,
      token.index + token[0].length,
      "priority",
    );
    return {
      value: PRIORITY_BY_TOKEN[token[1].toLowerCase()],
      raw,
      confidence: "explicit",
    };
  }

  const pn = scanner.find(PRIORITY_PN);
  if (pn) {
    const raw = scanner.claim(pn.index, pn.index + pn[0].length, "priority");
    return { value: PRIORITY_BY_PN[pn[1]], raw, confidence: "explicit" };
  }

  // Inferred priorities are read out of the wording but NOT removed — "urgent"
  // is part of what the task says, and dropping it would lose meaning.
  const critical = scanner.find(PRIORITY_INFERRED_CRITICAL);
  if (critical) {
    return { value: "critical", raw: critical[0], confidence: "inferred" };
  }

  const high = scanner.find(PRIORITY_INFERRED_HIGH);
  if (high) {
    return { value: "high", raw: high[0], confidence: "inferred" };
  }

  return null;
}

/* ────────────────────────────────────────────────────────────────────────
 * Category and owner
 * ──────────────────────────────────────────────────────────────────────── */

const CATEGORY_TOKEN = /(?<![^\s])#([\p{L}\p{N}][\p{L}\p{N}&:._/-]*)/u;
const OWNER_TOKEN = /(?<![^\s])@([\p{L}\p{N}][\p{L}\p{N}._-]*)/u;

/** Lowercase and strip everything that isn't a letter or digit. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function resolveCategory(
  token: string,
  categories: readonly ParseCategory[],
): string | null {
  const needle = normalise(token);
  if (!needle) return null;

  for (const category of categories) {
    const candidates = [
      category.slug,
      category.name,
      ...(category.aliases ?? []),
    ];
    if (candidates.some((candidate) => normalise(candidate) === needle)) {
      return category.slug;
    }
  }

  // Fall back to a unique prefix match so `#sec` finds Security, Risk &
  // Compliance. Ambiguous prefixes resolve to nothing rather than to a guess.
  const prefixed = categories.filter((category) =>
    [category.slug, category.name, ...(category.aliases ?? [])].some(
      (candidate) => normalise(candidate).startsWith(needle),
    ),
  );
  return prefixed.length === 1 ? prefixed[0].slug : null;
}

/* ────────────────────────────────────────────────────────────────────────
 * Time of day
 * ──────────────────────────────────────────────────────────────────────── */

const MERIDIEM_TIME = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\.?\b/i;
const H24_TIME = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const AT_PREFIX = /(?<![^\s])at\s+$/i;

interface TimeMatch {
  hour: number;
  minute: number;
  start: number;
  end: number;
}

/**
 * Find a clock time in `text`. When `requireMeridiem` is set, a bare `14:30`
 * is ignored — that guard keeps "8/12" and "1:1" out of the time slot when we
 * are scanning loose text rather than the words right after a date.
 */
function findTime(text: string, requireMeridiem: boolean): TimeMatch | null {
  const meridiem = MERIDIEM_TIME.exec(text);
  const h24 = requireMeridiem ? null : H24_TIME.exec(text);

  const useMeridiem =
    meridiem !== null && (h24 === null || meridiem.index <= h24.index);

  if (useMeridiem && meridiem) {
    const hour12 = Number(meridiem[1]) % 12;
    const isPm = meridiem[3].toLowerCase() === "p";
    let start = meridiem.index;
    // Swallow a preceding "at " so it doesn't linger in the title.
    const before = text.slice(0, start);
    const at = AT_PREFIX.exec(before);
    if (at) start = at.index;
    return {
      hour: hour12 + (isPm ? 12 : 0),
      minute: meridiem[2] ? Number(meridiem[2]) : 0,
      start,
      end: meridiem.index + meridiem[0].length,
    };
  }

  if (h24) {
    let start = h24.index;
    const at = AT_PREFIX.exec(text.slice(0, start));
    if (at) start = at.index;
    return {
      hour: Number(h24[1]),
      minute: Number(h24[2]),
      start,
      end: h24.index + h24[0].length,
    };
  }

  return null;
}

/* ────────────────────────────────────────────────────────────────────────
 * Dates
 * ──────────────────────────────────────────────────────────────────────── */

/** Optional lead-in words that belong to the date and should vanish with it. */
const LEAD = "(?:(?:by|due|on|before|until|till)\\s+)?";

/**
 * Month names are enumerated in full rather than matched as a prefix plus
 * `[a-z]*`: "marketing" starts with "mar", and a task called
 * "marketing 5 review" is not due on the fifth of March.
 */
const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

// Longest first in both, so `thursday` isn't cut short to `thu` and
// `september` isn't cut short to `sep`.
const byLengthDesc = (a: string, b: string) => b.length - a.length;
const MONTH_NAMES = Object.keys(MONTHS).sort(byLengthDesc).join("|");
const WEEKDAY_NAMES = Object.keys(WEEKDAYS).sort(byLengthDesc).join("|");

interface DateResolution {
  /** Midnight of the resolved day in the owner's zone. */
  day?: Date;
  /** An absolute instant ("in 3 hours") that already carries a time. */
  exact?: Date;
  /** A time of day carried by the expression itself ("tonight"). */
  time?: { hour: number; minute: number };
}

interface DateRule {
  re: RegExp;
  resolve: (
    match: RegExpExecArray,
    now: Date,
    timeZone: string,
  ) => DateResolution | null;
}

/** Pick the year that puts a month/day pair in the near future. */
function inferYear(
  month: number,
  day: number,
  now: Date,
  timeZone: string,
): number {
  const parts = getZonedParts(now, timeZone);
  const thisYear = zonedTimeToUtc(
    { year: parts.year, month, day, hour: 23, minute: 59, second: 59 },
    timeZone,
  );
  return thisYear.getTime() >= startOfZonedDay(now, timeZone).getTime()
    ? parts.year
    : parts.year + 1;
}

function dayIn(
  timeZone: string,
  year: number,
  month: number,
  day: number,
): Date {
  return zonedTimeToUtc(
    { year, month, day, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

const DATE_RULES: DateRule[] = [
  // 2026-08-12
  {
    re: new RegExp(`${LEAD}\\b(\\d{4})-(\\d{1,2})-(\\d{1,2})\\b`, "i"),
    resolve: (m, _now, tz) => ({
      day: dayIn(tz, Number(m[1]), Number(m[2]), Number(m[3])),
    }),
  },
  // 8/12 or 8/12/2026 — month/day, US order.
  {
    re: new RegExp(`${LEAD}\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b`, "i"),
    resolve: (m, now, tz) => {
      const month = Number(m[1]);
      const day = Number(m[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      let year: number;
      if (m[3]) {
        year = Number(m[3]);
        if (year < 100) year += 2000;
      } else {
        year = inferYear(month, day, now, tz);
      }
      return { day: dayIn(tz, year, month, day) };
    },
  },
  // Aug 12 / August 12th
  {
    re: new RegExp(
      `${LEAD}\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
      "i",
    ),
    resolve: (m, now, tz) => {
      const month = MONTHS[m[1].toLowerCase()];
      const day = Number(m[2]);
      if (day < 1 || day > 31) return null;
      return { day: dayIn(tz, inferYear(month, day, now, tz), month, day) };
    },
  },
  // 12 Aug / 12th of August
  {
    re: new RegExp(
      `${LEAD}\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_NAMES})\\.?\\b`,
      "i",
    ),
    resolve: (m, now, tz) => {
      const day = Number(m[1]);
      const month = MONTHS[m[2].toLowerCase()];
      if (day < 1 || day > 31) return null;
      return { day: dayIn(tz, inferYear(month, day, now, tz), month, day) };
    },
  },
  // in 3 days / in 2 weeks / in 4 hours
  {
    re: /\bin\s+(\d{1,3})\s+(hours?|hrs?|days?|weeks?|months?|mins?|minutes?)\b/i,
    resolve: (m, now, tz) => {
      const amount = Number(m[1]);
      const unit = m[2].toLowerCase();
      if (unit.startsWith("min")) {
        return { exact: new Date(now.getTime() + amount * 60_000) };
      }
      if (unit.startsWith("h")) {
        return { exact: new Date(now.getTime() + amount * 3_600_000) };
      }
      if (unit.startsWith("d")) {
        return { day: startOfZonedDay(addZonedDays(now, tz, amount), tz) };
      }
      if (unit.startsWith("w")) {
        return { day: startOfZonedDay(addZonedDays(now, tz, amount * 7), tz) };
      }
      return { day: startOfZonedDay(addZonedMonths(now, tz, amount), tz) };
    },
  },
  // today / tonight / tomorrow / yesterday
  {
    re: new RegExp(
      `${LEAD}\\b(today|tonight|tomorrow|tmrw|tmw|yesterday)\\b`,
      "i",
    ),
    resolve: (m, now, tz) => {
      const word = m[1].toLowerCase();
      if (word === "today") return { day: startOfZonedDay(now, tz) };
      if (word === "tonight") {
        return { day: startOfZonedDay(now, tz), time: { hour: 20, minute: 0 } };
      }
      if (word === "yesterday") {
        return { day: startOfZonedDay(addZonedDays(now, tz, -1), tz) };
      }
      return { day: startOfZonedDay(addZonedDays(now, tz, 1), tz) };
    },
  },
  // eod / eow / eom
  {
    re: new RegExp(
      `${LEAD}\\b(eod|end of (?:the )?day|eow|end of (?:the )?week|eom|end of (?:the )?month)\\b`,
      "i",
    ),
    resolve: (m, now, tz) => {
      const word = m[1].toLowerCase();
      if (word.startsWith("eod") || word.includes("day")) {
        return { day: startOfZonedDay(now, tz) };
      }
      if (word.startsWith("eom") || word.includes("month")) {
        return { day: endOfZonedMonth(now, tz) };
      }
      return { day: endOfWorkWeek(now, tz) };
    },
  },
  // next week / this week / next month / this month
  {
    re: new RegExp(`${LEAD}\\b(next|this)\\s+(week|month)\\b`, "i"),
    resolve: (m, now, tz) => {
      const which = m[1].toLowerCase();
      const unit = m[2].toLowerCase();
      if (unit === "week") {
        return which === "next"
          ? { day: addZonedDays(startOfZonedWeek(now, tz), tz, 7) }
          : { day: endOfWorkWeek(now, tz) };
      }
      if (which === "next") {
        const parts = getZonedParts(addZonedMonths(now, tz, 1), tz);
        return { day: dayIn(tz, parts.year, parts.month, 1) };
      }
      return { day: endOfZonedMonth(now, tz) };
    },
  },
  // friday / next friday / this thu
  {
    re: new RegExp(
      `${LEAD}\\b(?:(next|this|coming)\\s+)?(${WEEKDAY_NAMES})\\b`,
      "i",
    ),
    resolve: (m, now, tz) => {
      const qualifier = m[1]?.toLowerCase();
      const weekday = WEEKDAYS[m[2].toLowerCase()];
      if (qualifier === "next") {
        // "next Friday" = the Friday of the following calendar week, never
        // the one two days away. Unambiguous beats clever.
        const nextWeekStart = addZonedDays(startOfZonedWeek(now, tz), tz, 7);
        return { day: nextWeekday(nextWeekStart, tz, weekday, true) };
      }
      return { day: nextWeekday(startOfZonedDay(now, tz), tz, weekday, true) };
    },
  },
];

/** Friday of the current work week, rolling forward over the weekend. */
function endOfWorkWeek(now: Date, timeZone: string): Date {
  const friday = addZonedDays(startOfZonedWeek(now, timeZone), timeZone, 4);
  const today = startOfZonedDay(now, timeZone);
  return friday.getTime() < today.getTime()
    ? addZonedDays(friday, timeZone, 7)
    : friday;
}

function parseDue(
  scanner: Scanner,
  now: Date,
  timeZone: string,
  defaultDueHour: number,
): Suggestion<string> | null {
  for (const rule of DATE_RULES) {
    const match = scanner.find(rule.re);
    if (!match) continue;

    const resolution = rule.resolve(match, now, timeZone);
    if (!resolution) continue;

    const start = match.index;
    let end = match.index + match[0].length;

    // A time may trail the date ("Friday at 9:30", "tomorrow 3pm"). Look only
    // at the few words that follow so we don't reach across the sentence.
    let time = resolution.time ?? null;
    if (!resolution.exact) {
      const tail = scanner.working.slice(end, end + 14);
      const trailing = findTime(tail, false);
      if (trailing && tail.slice(0, trailing.start).trim() === "") {
        time = { hour: trailing.hour, minute: trailing.minute };
        end += trailing.end;
      }
    }

    const raw = scanner.claim(start, end, "dueAt");

    if (resolution.exact) {
      return {
        value: resolution.exact.toISOString(),
        raw,
        confidence: "explicit",
      };
    }

    // No trailing time? Take a standalone "at 4pm" from anywhere in the rest
    // of the line before falling back to the default due hour.
    if (!time) {
      const loose = findTime(scanner.working, true);
      if (loose) {
        time = { hour: loose.hour, minute: loose.minute };
        scanner.claim(loose.start, loose.end, "dueAt");
      }
    }

    const day = resolution.day!;
    const due = withZonedTime(
      day,
      timeZone,
      time?.hour ?? defaultDueHour,
      time?.minute ?? 0,
    );
    return { value: due.toISOString(), raw, confidence: "explicit" };
  }

  // A time on its own ("call Ana at 4pm") means today, or tomorrow if that
  // moment has already passed.
  const loose = findTime(scanner.working, true);
  if (loose) {
    const raw = scanner.claim(loose.start, loose.end, "dueAt");
    let due = withZonedTime(now, timeZone, loose.hour, loose.minute);
    if (due.getTime() <= now.getTime()) {
      due = withZonedTime(
        addZonedDays(now, timeZone, 1),
        timeZone,
        loose.hour,
        loose.minute,
      );
    }
    return { value: due.toISOString(), raw, confidence: "explicit" };
  }

  return null;
}

/* ────────────────────────────────────────────────────────────────────────
 * Event references
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Up to six words. The label must START WITH A LETTER, which is what keeps
 * "Prep 1:1 notes for Maya" from being read as prep for an event called "1".
 * A real event name that begins with a digit is missed rather than mangled —
 * under-detecting is the right side to err on for a suggestion.
 */
const LABEL = "(\\p{L}[\\p{L}\\p{N}'&./-]*(?:\\s+[\\p{L}\\p{N}'&./-]+){0,5})";
const ARTICLE = "(?:the\\s+|my\\s+|our\\s+|a\\s+|an\\s+)?";

const EVENT_EXPLICIT =
  /(?<![^\s])\^(?:"([^"]{1,200})"|([\p{L}\p{N}][\p{L}\p{N} '&./-]{0,80}))/u;

const EVENT_PHRASES: { re: RegExp; relation: TaskLinkRelation }[] = [
  {
    re: new RegExp(
      `\\b(?:prep(?:aration)?(?:\\s+for)?|prepare\\s+for|ahead\\s+of|prior\\s+to|before)\\s+${ARTICLE}${LABEL}`,
      "iu",
    ),
    relation: "prep",
  },
  {
    re: new RegExp(
      `\\b(?:follow[-\\s]?ups?\\s+(?:on|from|to|after)|following|after|post)\\s+${ARTICLE}${LABEL}`,
      "iu",
    ),
    relation: "follow_up",
  },
  {
    re: new RegExp(`\\bre:\\s*${LABEL}`, "iu"),
    relation: "related",
  },
];

function parseEventRef(scanner: Scanner): Suggestion<EventReference> | null {
  const explicit = scanner.find(EVENT_EXPLICIT);
  if (explicit) {
    const label = (explicit[1] ?? explicit[2] ?? "").trim();
    if (label) {
      const raw = scanner.claim(
        explicit.index,
        explicit.index + explicit[0].length,
        "eventRef",
      );
      return {
        value: { label, relation: "related" },
        raw,
        confidence: "explicit",
      };
    }
  }

  for (const phrase of EVENT_PHRASES) {
    const match = scanner.find(phrase.re);
    if (!match) continue;
    const label = match[1]?.trim();
    if (!label) continue;

    const start = match.index;
    const end = match.index + match[0].length;

    // Never let the event phrase eat the whole line — a task needs a title.
    const remaining = (
      scanner.working.slice(0, start) + scanner.working.slice(end)
    ).trim();
    if (!remaining) {
      return {
        value: { label, relation: phrase.relation },
        raw: match[0],
        confidence: "inferred",
      };
    }

    const raw = scanner.claim(start, end, "eventRef");
    return {
      value: { label, relation: phrase.relation },
      raw,
      confidence: "inferred",
    };
  }

  return null;
}

/* ────────────────────────────────────────────────────────────────────────
 * Entry point
 * ──────────────────────────────────────────────────────────────────────── */

function cleanTitle(working: string): string {
  return working
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—:;,.\s]+/, "")
    .replace(/[-–—:;,\s]+$/, "")
    .trim();
}

/**
 * Parse one line of quick-add input into a title plus editable suggestions.
 *
 * Rules are applied in a fixed order and each one blanks the text it claims,
 * so an earlier rule always wins a contested substring. The order —
 * explicit tokens, then dates, then event phrases — is what makes
 * "before Friday" a due date while "before the board review" is an event
 * reference.
 */
export function parseQuickAdd(
  input: string,
  options: ParseOptions,
): QuickAddResult {
  const scanner = new Scanner(input);
  const categories = options.categories ?? DEFAULT_CATEGORIES;
  const defaultDueHour = options.defaultDueHour ?? DEFAULT_DUE_HOUR;

  // 1. Explicit tokens.
  const priority = parsePriority(scanner);

  let categorySlug: Suggestion<string> | null = null;
  const categoryMatch = scanner.find(CATEGORY_TOKEN);
  if (categoryMatch) {
    const slug = resolveCategory(categoryMatch[1], categories);
    if (slug) {
      const raw = scanner.claim(
        categoryMatch.index,
        categoryMatch.index + categoryMatch[0].length,
        "category",
      );
      categorySlug = { value: slug, raw, confidence: "explicit" };
    }
    // An unresolved `#tag` is left alone: it stays in the title rather than
    // silently disappearing into a category that doesn't exist.
  }

  let owner: Suggestion<string> | null = null;
  const ownerMatch = scanner.find(OWNER_TOKEN);
  if (ownerMatch) {
    const raw = scanner.claim(
      ownerMatch.index,
      ownerMatch.index + ownerMatch[0].length,
      "owner",
    );
    owner = { value: ownerMatch[1], raw, confidence: "explicit" };
  }

  // 2. Dates before event phrases, so "before Friday" reads as a due date.
  const dueAt = parseDue(
    scanner,
    options.now,
    options.timeZone,
    defaultDueHour,
  );

  // 3. Whatever prose is left may still name an event.
  const eventRef = parseEventRef(scanner);

  const title = cleanTitle(scanner.working) || input.trim();

  return {
    title,
    dueAt,
    priority,
    categorySlug,
    owner,
    eventRef,
    consumed: [...scanner.consumed].sort((a, b) => a.start - b.start),
  };
}
