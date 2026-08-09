/**
 * Email → task.
 *
 * Turns a message into a proposed task, and — the part that matters — says
 * **why** it proposed each value. The specification is explicit that the
 * reason is shown and everything stays editable, because a suggestion you
 * cannot interrogate is one you either accept blindly or stop trusting.
 *
 * ── The precedence, in the order the spec fixes it ───────────────────────
 *   1. **Explicit deadline language** in the mail. "by Friday", "due 14 Aug",
 *      "before the board meeting on the 12th". Strongest, because the sender
 *      stated it.
 *   2. **A related meeting's timing.** If a linked event is coming up, prep
 *      is due before it. Weaker, because it is our inference.
 *   3. **Sender importance.** Manual, four-level. Weakest for *timing* — a
 *      critical sender does not imply a deadline — but strongest for
 *      *priority*, since it is the one thing the owner has stated directly.
 *
 * Nothing here writes anything. It returns a proposal; the caller shows it,
 * lets the owner change it, and only then creates the task.
 */

import { parseQuickAdd, type ParseCategory } from "@/lib/quick-add/parse";
import type { TaskPriority } from "@/lib/tasks/types";
import { addZonedDays, withZonedTime } from "@/lib/time/zone";

import type { CalendarEvent, Message, SenderImportance } from "./types";

/** Where a suggestion came from, so the UI can rank and explain it. */
export type SuggestionSource =
  "explicit_deadline" | "meeting_timing" | "sender_importance" | "default";

export interface SuggestedValue<T> {
  value: T;
  source: SuggestionSource;
  /** One sentence, shown to the owner verbatim. */
  reason: string;
  /** The words in the mail this came from, when it came from words. */
  evidence?: string;
}

export interface TaskSuggestion {
  title: string;
  notes: string | null;
  due: SuggestedValue<string> | null;
  priority: SuggestedValue<TaskPriority> | null;
  /**
   * The source link, always present and always confirmed: the owner clicked
   * "create a task from this mail", so linking it back is what they asked
   * for. Distinct from a *guessed* event link, which is never automatic.
   */
  sourceMessageId: string;
  /**
   * A meeting we think this relates to. **Unconfirmed** — the same
   * confirm-before-link rule as quick-add. Presented as a question.
   */
  relatedEvent: {
    eventId: string;
    title: string;
    startsAt: string;
    reason: string;
  } | null;
}

export interface SuggestOptions {
  message: Pick<
    Message,
    | "id"
    | "subject"
    | "snippet"
    | "body"
    | "from"
    | "receivedAt"
    | "senderImportance"
  >;
  /** Events to consider relating this mail to. Usually the next two weeks. */
  events?: CalendarEvent[];
  now: Date;
  timeZone: string;
  categories?: readonly ParseCategory[];
  /** Hour of day a bare date resolves to. Matches quick-add. */
  defaultDueHour?: number;
}

/* ── Deadline language ────────────────────────────────────────────────── */

/**
 * Phrases that mean the sender stated a deadline, as opposed to merely
 * mentioning a date.
 *
 * "Let's meet on Friday" is a date. "I need this by Friday" is a deadline.
 * Requiring one of these keeps the suggestion honest — mail is full of dates
 * that are nobody's due date.
 */
const DEADLINE_CUES =
  /\b(by|due|deadline|no later than|before|EOD|end of day|end of week|EOW|ASAP|as soon as possible|needs? to be (?:done|ready|in)|please (?:send|reply|confirm|respond)|respond by|reply by|sign(?:ed)? off by|turn(?:ed)? around by)\b/i;

/** How much of a body to read. Long threads are mostly quoted history. */
const BODY_SCAN_LIMIT = 2000;

/**
 * Strips quoted history and signatures before looking for a deadline.
 *
 * Without this, a two-week-old "by Friday" from the bottom of a thread wins
 * over what the newest message actually says.
 */
export function readableBody(body: string | null | undefined): string {
  if (!body) return "";

  const lines = body.slice(0, BODY_SCAN_LIMIT * 4).split(/\r?\n/);
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // "On Tuesday, Maya Chen wrote:" and friends start the quoted section.
    if (/^on .{0,80}\bwrote:\s*$/i.test(trimmed)) break;
    if (/^-{2,}\s*original message\s*-{2,}/i.test(trimmed)) break;
    if (/^from:\s.+/i.test(trimmed) && kept.length > 0) break;
    // "-- " on its own line is the signature delimiter.
    if (trimmed === "--") break;
    if (trimmed.startsWith(">")) continue;

    kept.push(line);
  }

  return kept.join("\n").slice(0, BODY_SCAN_LIMIT).trim();
}

/**
 * Finds a stated deadline.
 *
 * The date grammar is quick-add's, reused rather than reimplemented: it
 * already understands "by Friday", "next Tuesday", "14 Aug", times of day and
 * the DST-correct arithmetic underneath, and it is already heavily tested.
 * What is added here is the *cue* requirement.
 */
export function findExplicitDeadline(
  text: string,
  options: { now: Date; timeZone: string; defaultDueHour?: number },
): { dueAt: string; evidence: string } | null {
  for (const sentence of splitSentences(text)) {
    if (!DEADLINE_CUES.test(sentence)) continue;

    const parsed = parseQuickAdd(sentence, {
      now: options.now,
      timeZone: options.timeZone,
      defaultDueHour: options.defaultDueHour,
    });

    if (parsed.dueAt) {
      return { dueAt: parsed.dueAt.value, evidence: sentence.trim() };
    }
  }

  return null;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;\n])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .slice(0, 60);
}

/* ── Relating a mail to a meeting ─────────────────────────────────────── */

/** Words too common to be evidence that a mail and a meeting are related. */
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "with",
  "about",
  "re",
  "fwd",
  "fw",
  "to",
  "of",
  "on",
  "in",
  "at",
  "is",
  "are",
  "our",
  "your",
  "my",
  "this",
  "that",
  "meeting",
  "call",
  "sync",
  "update",
  "notes",
  "agenda",
  "please",
]);

export function significantWords(
  value: string | null | undefined,
): Set<string> {
  if (!value) return new Set();

  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  );
}

/**
 * Finds the upcoming meeting this mail most plausibly concerns.
 *
 * Two signals: overlapping significant words between the subject and the
 * event title, and the organizer or an attendee being the sender. Deliberately
 * conservative — a wrong guess here becomes a wrong due date, and a link the
 * owner has to notice and undo.
 */
export function findRelatedEvent(
  message: SuggestOptions["message"],
  events: CalendarEvent[],
  now: Date,
): { event: CalendarEvent; reason: string } | null {
  const subjectWords = significantWords(message.subject);

  let best: { event: CalendarEvent; score: number; reason: string } | null =
    null;

  for (const event of events) {
    if (event.isCancelled) continue;

    const startsAt = Date.parse(event.startsAt);
    if (Number.isNaN(startsAt) || startsAt < now.getTime()) continue;

    const titleWords = significantWords(event.title);
    const shared = [...subjectWords].filter((word) => titleWords.has(word));

    let score = shared.length * 2;
    let reason = "";

    if (shared.length > 0) {
      reason = `“${event.title}” shares “${shared.slice(0, 3).join(", ")}” with this mail's subject`;
    }

    if (event.organizer && event.organizer.address === message.from.address) {
      score += 2;
      reason = reason
        ? `${reason}, and ${message.from.address} organizes it`
        : `${message.from.address} organizes “${event.title}”`;
    }

    // Sooner is more likely to be what a mail is about.
    const daysAway = (startsAt - now.getTime()) / 86_400_000;
    if (daysAway <= 2) score += 1;

    if (score >= 2 && (!best || score > best.score)) {
      best = { event, score, reason };
    }
  }

  return best ? { event: best.event, reason: best.reason } : null;
}

/* ── Priority ─────────────────────────────────────────────────────────── */

const IMPORTANCE_TO_PRIORITY: Record<SenderImportance, TaskPriority | null> = {
  critical: "critical",
  high: "high",
  normal: null, // Deliberately no suggestion: "normal" is the absence of a signal.
  low: "low",
};

export function suggestPriority(
  options: SuggestOptions,
  deadline: { dueAt: string } | null,
  relatedEvent: CalendarEvent | null,
): SuggestedValue<TaskPriority> | null {
  const importance = options.message.senderImportance;

  // A stated deadline inside 48 hours outranks everything: it is the sender
  // being explicit, and it is imminent.
  if (deadline) {
    const hoursAway =
      (Date.parse(deadline.dueAt) - options.now.getTime()) / 3_600_000;

    if (hoursAway <= 48) {
      const value: TaskPriority =
        importance === "critical" ? "critical" : "high";
      return {
        value,
        source: "explicit_deadline",
        reason:
          importance === "critical"
            ? "The mail states a deadline within two days, and this sender is marked Critical."
            : "The mail states a deadline within two days.",
      };
    }
  }

  if (importance === "critical" || importance === "high") {
    return {
      value: IMPORTANCE_TO_PRIORITY[importance] as TaskPriority,
      source: "sender_importance",
      reason: `You marked ${options.message.from.address} as ${importance === "critical" ? "Critical" : "High"} importance.`,
    };
  }

  if (relatedEvent) {
    const hoursAway =
      (Date.parse(relatedEvent.startsAt) - options.now.getTime()) / 3_600_000;

    if (hoursAway <= 48) {
      return {
        value: "high",
        source: "meeting_timing",
        reason: `“${relatedEvent.title}” is within two days, so prep is time-critical.`,
      };
    }
  }

  if (importance === "low") {
    return {
      value: "low",
      source: "sender_importance",
      reason: `You marked ${options.message.from.address} as Low importance.`,
    };
  }

  // No signal. Leaving priority unset is a real answer — it keeps the task
  // out of Ready state and visibly awaiting triage, which is the truth.
  return null;
}

/* ── The whole suggestion ─────────────────────────────────────────────── */

export function suggestTaskFromMessage(
  options: SuggestOptions,
): TaskSuggestion {
  const { message, now, timeZone } = options;

  const scanned = [
    message.subject ?? "",
    readableBody(message.body ?? message.snippet),
  ]
    .filter(Boolean)
    .join("\n");

  const deadline = findExplicitDeadline(scanned, {
    now,
    timeZone,
    defaultDueHour: options.defaultDueHour,
  });

  const related = findRelatedEvent(message, options.events ?? [], now);

  let due: SuggestedValue<string> | null = null;

  if (deadline) {
    due = {
      value: deadline.dueAt,
      source: "explicit_deadline",
      reason: "The mail states this deadline.",
      evidence: deadline.evidence,
    };
  } else if (related) {
    // Prep is due the working day before the meeting, at the default hour —
    // "due when the meeting starts" is a deadline nobody can meet.
    const eventStart = new Date(related.event.startsAt);
    const dayBefore = addZonedDays(eventStart, timeZone, -1);
    const dueAt = withZonedTime(
      dayBefore,
      timeZone,
      options.defaultDueHour ?? 17,
    );

    // Never suggest a due date in the past; if the meeting is tomorrow, the
    // honest answer is today.
    const value = dueAt.getTime() < now.getTime() ? now : dueAt;

    due = {
      value: value.toISOString(),
      source: "meeting_timing",
      reason: `“${related.event.title}” starts soon, so this is due the day before.`,
      evidence: related.reason,
    };
  }

  const priority = suggestPriority(options, deadline, related?.event ?? null);

  return {
    title: taskTitleFor(message.subject),
    notes: null,
    due,
    priority,
    sourceMessageId: message.id,
    relatedEvent: related
      ? {
          eventId: related.event.id,
          title: related.event.title,
          startsAt: related.event.startsAt,
          reason: related.reason,
        }
      : null,
  };
}

/**
 * The task's title.
 *
 * Reply prefixes are stripped — "Re: Re: Fwd: Q3 board pack" is not a task
 * name — but the subject is otherwise left exactly as the sender wrote it.
 */
export function taskTitleFor(subject: string | null): string {
  const cleaned = (subject ?? "")
    .replace(/^(\s*(re|fwd?|aw|tr)\s*:\s*)+/i, "")
    .trim();

  return cleaned === "" ? "(no subject)" : cleaned.slice(0, 500);
}
