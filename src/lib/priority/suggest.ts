/**
 * Detecting task ↔ meeting relationships, and never acting on them alone.
 *
 * The specification is unambiguous: *when a task/event relationship is
 * detected, offer prep note (before) + follow-up note (after); never auto-link
 * silently.* Everything here produces **questions**, not links.
 *
 * ── Why a suggestion is not a weak link ──────────────────────────────────
 * The tempting shortcut is to write the link with `confirmed_at = null` and
 * treat unconfirmed links as suggestions. It looks equivalent and it is not:
 * every consumer then has to remember to filter, the ranking engine has to
 * remember not to count them, and the first place that forgets shows the owner
 * a relationship they never agreed to. A suggestion lives in its own table and
 * cannot be mistaken for a link by anyone who forgets it exists.
 *
 * ── Why the detection is so conservative ─────────────────────────────────
 * A wrong suggestion is not free. Each one is a question the owner has to
 * read and answer, and a stream of bad guesses trains them to dismiss the
 * whole feature without reading — at which point the good suggestions are lost
 * too. So: high bar, few suggestions, each with a reason that names the
 * evidence.
 */

import type { Task } from "@/lib/tasks/types";

import type { EventContext } from "./importance";

export const SUGGESTION_KINDS = ["prep", "follow_up", "related"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export interface LinkSuggestion {
  taskId: string;
  eventId: string;
  kind: SuggestionKind;
  /** 0–1. Never shown as a number — see `describeConfidence`. */
  confidence: number;
  /** Names the evidence. The owner is being asked to confirm something. */
  reason: string;
  /** The note we offer to create alongside the link, if they want one. */
  offeredNote: OfferedNote | null;
}

export interface OfferedNote {
  kind: "meeting" | "follow_up";
  title: string;
  /**
   * Prefilled context. Deliberately not prefilled *content* — a note that
   * arrives with sentences already in it gets skimmed and left, and a decision
   * log full of boilerplate is worse than an empty one.
   */
  context: string;
}

/** Below this, we do not ask. */
const ASK_THRESHOLD = 0.5;

/** How long after a meeting a follow-up is still worth offering. */
const FOLLOW_UP_WINDOW_HOURS = 72;

/** How far ahead prep is worth offering. */
const PREP_WINDOW_HOURS = 120;

export interface DetectOptions {
  tasks: readonly Task[];
  events: readonly EventContext[];
  now: Date;
  /**
   * Pairs already decided — accepted or dismissed. A question the owner has
   * answered must never be asked again; that is the difference between a
   * helpful assistant and a nag.
   */
  decided?: ReadonlySet<string>;
}

/** The key used to remember a decided pair. */
export function suggestionKey(
  taskId: string,
  eventId: string,
  kind: SuggestionKind,
): string {
  return `${taskId}:${eventId}:${kind}`;
}

/* ── Detection ────────────────────────────────────────────────────────── */

export function detectSuggestions(options: DetectOptions): LinkSuggestion[] {
  const decided = options.decided ?? new Set<string>();
  const suggestions: LinkSuggestion[] = [];

  for (const task of options.tasks) {
    if (task.status === "done") continue;
    // A draft is not committed work; suggesting links for it would be asking
    // about something the owner has not decided to do.
    if (task.isDraft) continue;

    const alreadyLinked = new Set(
      task.links
        .filter((link) => link.kind === "event" && link.targetId)
        .map((link) => link.targetId!),
    );

    for (const event of options.events) {
      if (event.isCancelled) continue;
      if (alreadyLinked.has(event.id)) continue;

      const match = scoreMatch(task, event, options.now);
      if (!match || match.confidence < ASK_THRESHOLD) continue;
      if (decided.has(suggestionKey(task.id, event.id, match.kind))) continue;

      suggestions.push({
        taskId: task.id,
        eventId: event.id,
        kind: match.kind,
        confidence: round2(match.confidence),
        reason: match.reason,
        offeredNote: offerNote(task, event, match.kind),
      });
    }
  }

  // Strongest first, then deterministic — the order suggestions are asked in
  // should not depend on how the events came back from the database.
  return suggestions.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.taskId.localeCompare(b.taskId) ||
      a.eventId.localeCompare(b.eventId),
  );
}

interface Match {
  kind: SuggestionKind;
  confidence: number;
  reason: string;
}

/**
 * Is this task about this meeting?
 *
 * Only one kind of evidence counts: **shared significant words** between the
 * task title and the meeting title. Timing alone is never enough — "these
 * happened near each other" describes every task and every meeting in a busy
 * week, and suggesting on that basis would bury the owner.
 *
 * Timing decides *which* relationship it is (prep before, follow-up after) and
 * adjusts confidence, but it cannot create a suggestion by itself.
 */
function scoreMatch(task: Task, event: EventContext, now: Date): Match | null {
  const shared = sharedTerms(task.title, event.title);
  if (shared.length === 0) return null;

  const starts = Date.parse(event.startsAt);
  if (!Number.isFinite(starts)) return null;

  const hoursUntil = (starts - now.getTime()) / 3_600_000;

  // Two shared words is much stronger evidence than one.
  const overlap = Math.min(1, shared.length / 2);
  const quoted = shared.map((term) => `“${term}”`).join(" and ");

  if (hoursUntil >= 0) {
    if (hoursUntil > PREP_WINDOW_HOURS) return null;

    // Nearer meetings are likelier to be what a task is about.
    const proximity = 1 - hoursUntil / PREP_WINDOW_HOURS;
    const confidence = 0.45 + overlap * 0.35 + proximity * 0.2;

    return {
      kind: "prep",
      confidence,
      reason: `Shares ${quoted} with “${event.title}”, which is coming up.`,
    };
  }

  const hoursSince = -hoursUntil;
  if (hoursSince > FOLLOW_UP_WINDOW_HOURS) return null;

  const recency = 1 - hoursSince / FOLLOW_UP_WINDOW_HOURS;
  const confidence = 0.45 + overlap * 0.35 + recency * 0.2;

  return {
    kind: "follow_up",
    confidence,
    reason: `Shares ${quoted} with “${event.title}”, which has just happened.`,
  };
}

/**
 * Words worth matching on.
 *
 * Stripped of the vocabulary that appears in every calendar — "meeting",
 * "review", "weekly" — because matching on those would relate every task to
 * every meeting. What remains is the words that make a title specific:
 * project names, systems, people, numbers.
 */
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "for",
  "with",
  "about",
  "into",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "from",
  "up",
  "out",
  "over",
  "meeting",
  "call",
  "sync",
  "syncup",
  "catchup",
  "chat",
  "session",
  "review",
  "weekly",
  "monthly",
  "daily",
  "quarterly",
  "standup",
  "draft",
  "prep",
  "prepare",
  "preparation",
  "follow",
  "followup",
  "notes",
  "note",
  "agenda",
  "discuss",
  "discussion",
  "update",
  "my",
  "our",
  "your",
  "this",
  "that",
  "these",
  "those",
  "new",
]);

/** Ignore very short tokens — "q3" is meaningful, "is" is not. */
const MIN_TERM_LENGTH = 3;

export function sharedTerms(taskTitle: string, eventTitle: string): string[] {
  const taskTerms = significantTerms(taskTitle);
  const eventTerms = new Set(significantTerms(eventTitle));

  // Stable order, and no duplicates.
  return [...new Set(taskTerms.filter((term) => eventTerms.has(term)))].sort();
}

function significantTerms(title: string): string[] {
  return (
    title
      .toLowerCase()
      // Keep alphanumerics; "Q3" and "SOC2" are exactly the kind of term that
      // makes a title specific.
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((term) => term.length >= MIN_TERM_LENGTH && !STOPWORDS.has(term))
  );
}

/* ── The offered note ─────────────────────────────────────────────────── */

/**
 * The note offered alongside the link.
 *
 * Prep gets a meeting note to take *into* the room; follow-up gets one to
 * write *after* it. Both are offered, never created — accepting the link and
 * wanting a note are two different decisions, and bundling them means the
 * owner ends up with notes they did not ask for cluttering the vault.
 */
function offerNote(
  task: Task,
  event: EventContext,
  kind: SuggestionKind,
): OfferedNote | null {
  if (kind === "related") return null;

  if (kind === "prep") {
    return {
      kind: "meeting",
      title: event.title,
      context: `Prep for ${event.title}. Linked to “${task.title}”.`,
    };
  }

  return {
    kind: "follow_up",
    title: `${event.title} — follow-up`,
    context: `Follow-up from ${event.title}. Linked to “${task.title}”.`,
  };
}

/* ── Presentation ─────────────────────────────────────────────────────── */

/**
 * Confidence in words.
 *
 * Never a percentage. "72% confident" invites the owner to do arithmetic on a
 * number we made up, and implies a precision the heuristic does not have.
 */
export function describeConfidence(confidence: number): string {
  if (confidence >= 0.8) return "This looks like a match";
  if (confidence >= 0.65) return "This might be related";
  return "This could be related";
}

/** The question, phrased so the answer is obvious. */
export function phraseQuestion(suggestion: LinkSuggestion): string {
  return suggestion.kind === "prep"
    ? "Is this preparation for that meeting?"
    : suggestion.kind === "follow_up"
      ? "Did this come out of that meeting?"
      : "Are these related?";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
