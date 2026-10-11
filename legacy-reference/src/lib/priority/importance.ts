/**
 * Inferred importance, from calendar context.
 *
 * The question this answers: *given that a task is attached to a meeting, how
 * much should that meeting raise the task?*
 *
 * ── Why this is separate from the stated priority ────────────────────────
 * `task.priority` is what the owner said. This is what the surrounding
 * context implies. `score.ts` takes the **maximum** of the two, so inference
 * can raise a task but never lower one — the engine may notice that an
 * untriaged item is attached to tomorrow's board meeting, but it may not
 * decide that something called Critical isn't.
 *
 * ── Why the signals are so few ───────────────────────────────────────────
 * Every signal here is one the owner can verify by looking at the meeting.
 * "It's within 48 hours", "someone outside the company is invited", "you
 * organised it" — each is checkable in a second. The tempting additions are
 * all unfalsifiable: sentiment in the title, seniority guessed from an email
 * address, "importance" scraped from the description. Those produce a number
 * nobody can argue with, which sounds good and is actually the failure mode —
 * you can't correct what you can't interrogate.
 */

export const IMPORTANCE_SIGNALS = [
  "imminent",
  "external",
  "leadership",
  "decision",
  "organiser",
  "inherited",
] as const;
export type ImportanceSignal = (typeof IMPORTANCE_SIGNALS)[number];

export interface SignalHit {
  signal: ImportanceSignal;
  /** How much this added, in 0–1 of the final importance. */
  weight: number;
  /** Shown to the owner. Must name something they can check. */
  reason: string;
}

export interface ImportanceResult {
  /** 0–1, fed to `score.ts` as `inferredImportance`. */
  value: number;
  hits: SignalHit[];
}

/** A meeting, as the inference needs it. */
export interface EventContext {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  attendeeCount: number;
  /** At least one attendee outside the owner's domains. */
  isExternal: boolean;
  isCancelled: boolean;
  organizerAddress: string | null;
  /** True when the owner organised it. */
  isOwnerOrganiser: boolean;
}

export interface InferenceOptions {
  /** How the task relates to the event. */
  relation: "prep" | "follow_up" | "related" | "source";
  now: Date;
  /**
   * The importance already computed for the meeting's *own* work, when this
   * task inherits from another. See `inheritedImportance`.
   */
  inheritFrom?: number;
}

/* ── Signal weights ───────────────────────────────────────────────────── */

/**
 * Each signal's maximum contribution.
 *
 * They deliberately do **not** sum to 1: a meeting that is imminent, external,
 * leadership-sized *and* a decision point should saturate, because it is
 * genuinely the most important thing on the calendar. The result is clamped.
 */
const SIGNAL_WEIGHTS: Record<ImportanceSignal, number> = {
  imminent: 0.35,
  external: 0.3,
  leadership: 0.25,
  decision: 0.3,
  organiser: 0.1,
  inherited: 1,
};

/**
 * Words that mark a meeting as a decision point.
 *
 * A deliberately short, boring list of words that mean the same thing in every
 * organisation. "Sync" and "catch-up" are absent because they mean everything
 * and nothing; "board" and "approval" are here because a meeting called
 * "Budget approval" is a meeting where a decision gets made.
 */
const DECISION_WORDS = [
  "decision",
  "approval",
  "approve",
  "sign-off",
  "signoff",
  "go/no-go",
  "board",
  "steering",
  "review",
  "escalation",
];

const LEADERSHIP_WORDS = [
  "exec",
  "executive",
  "leadership",
  "board",
  "cabinet",
  "all-hands",
  "town hall",
];

/** Meetings at or above this size read as leadership/organisational. */
const LEADERSHIP_ATTENDEES = 8;

/* ── Inference ────────────────────────────────────────────────────────── */

export function inferImportance(
  event: EventContext,
  options: InferenceOptions,
): ImportanceResult {
  // A cancelled meeting is not a reason to do anything, and a task still
  // pointing at one should fall back to whatever its own priority says.
  if (event.isCancelled) {
    return { value: 0, hits: [] };
  }

  const hits: SignalHit[] = [];
  const title = event.title.toLowerCase();

  /* Imminent — within 48 hours, decaying across the window. */
  const proximity = imminence(event, options);
  if (proximity > 0) {
    hits.push({
      signal: "imminent",
      weight: SIGNAL_WEIGHTS.imminent * proximity,
      reason:
        options.relation === "follow_up"
          ? "The meeting has just happened."
          : "The meeting is within the next two days.",
    });
  }

  /* External party present. */
  if (event.isExternal) {
    hits.push({
      signal: "external",
      weight: SIGNAL_WEIGHTS.external,
      reason: "Someone outside your organisation is in the meeting.",
    });
  }

  /* Leadership, by name or by size. */
  const namedLeadership = LEADERSHIP_WORDS.find((word) => title.includes(word));
  if (namedLeadership) {
    hits.push({
      signal: "leadership",
      weight: SIGNAL_WEIGHTS.leadership,
      reason: `“${namedLeadership}” in the meeting title.`,
    });
  } else if (event.attendeeCount >= LEADERSHIP_ATTENDEES) {
    hits.push({
      signal: "leadership",
      // Size alone is the weaker version of the same signal, so it carries
      // less than the title match it stands in for.
      weight: SIGNAL_WEIGHTS.leadership * 0.6,
      reason: `${event.attendeeCount} people are invited.`,
    });
  }

  /* Decision significance. */
  const decisionWord = DECISION_WORDS.find((word) => title.includes(word));
  if (decisionWord) {
    hits.push({
      signal: "decision",
      weight: SIGNAL_WEIGHTS.decision,
      reason: `“${decisionWord}” in the meeting title — something gets decided.`,
    });
  }

  /* You called it. */
  if (event.isOwnerOrganiser) {
    hits.push({
      signal: "organiser",
      weight: SIGNAL_WEIGHTS.organiser,
      reason: "You organised it.",
    });
  }

  const value = clamp01(hits.reduce((sum, hit) => sum + hit.weight, 0));

  return { value: round2(value), hits };
}

/**
 * How much of the 48-hour window is left, as 0–1.
 *
 * Follow-up work runs on the other side of the meeting: it is worth nothing
 * beforehand and decays over the three days after. Prep is the mirror image.
 * This is the same asymmetry `score.ts` applies to calendar proximity, and it
 * lives in both places because they are answering different questions —
 * *how urgent is this now* versus *how important is this at all*.
 */
function imminence(event: EventContext, options: InferenceOptions): number {
  const starts = Date.parse(event.startsAt);
  if (!Number.isFinite(starts)) return 0;

  const untilMs = starts - options.now.getTime();
  const hours = untilMs / 3_600_000;

  if (options.relation === "follow_up") {
    if (untilMs > 0) return 0;
    return clamp01(1 - -hours / 72);
  }

  if (untilMs < 0) return 0;
  return clamp01(1 - hours / 48);
}

/**
 * Importance inherited by work linked to a meeting that is itself important.
 *
 * The specification's rule: *linked prep + follow-up work inherit part of the
 * boost.* "Part" is the operative word — the prep for the board meeting is
 * important because the board meeting is, but it is not as important as the
 * board meeting, or every three-line task attached to a big meeting would
 * outrank the meeting's own preparation.
 *
 * Prep inherits more than follow-up because prep has a deadline it cannot
 * miss: the meeting happens whether or not the deck is ready.
 */
export function inheritedImportance(
  parentImportance: number,
  relation: InferenceOptions["relation"],
): number {
  const share =
    relation === "prep"
      ? 0.7
      : relation === "follow_up"
        ? 0.5
        : relation === "source"
          ? 0.4
          : 0.3;

  return round2(clamp01(parentImportance * share));
}

/**
 * The strongest importance across several linked events.
 *
 * Maximum, not sum. A task attached to four unimportant meetings is not more
 * important than one attached to the board — and summing would make "link
 * everything to everything" a way to game your own ranking.
 */
export function strongestImportance(
  results: readonly ImportanceResult[],
): ImportanceResult {
  if (results.length === 0) return { value: 0, hits: [] };

  return results.reduce((best, current) =>
    current.value > best.value ? current : best,
  );
}

/** One sentence naming the strongest signal, for a compact explanation. */
export function explainImportance(result: ImportanceResult): string | null {
  if (result.hits.length === 0) return null;

  const strongest = [...result.hits].sort((a, b) => b.weight - a.weight)[0];
  return strongest.reason;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
