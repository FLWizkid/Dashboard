/**
 * The weighted priority score.
 *
 * Five factors, weighted as the specification sets out:
 *
 *   | factor              | weight | answers                                  |
 *   | ------------------- | -----: | ---------------------------------------- |
 *   | importance          |    35% | how much does this matter?               |
 *   | overdue             |    25% | how late is it already?                  |
 *   | due proximity       |    20% | how soon is it due?                      |
 *   | calendar proximity  |    15% | is there a meeting about it, and when?   |
 *   | manual              |     5% | what did you say about it by hand?       |
 *
 * ── Three rules this file exists to keep ─────────────────────────────────
 *
 * 1. **Deterministic.** The same inputs and the same `now` produce the same
 *    score, every time, on every device. No randomness, no ordering
 *    dependence, no reading the clock inside a comparator. The dashboard, the
 *    board and the digest must be able to agree.
 *
 * 2. **Explainable.** Every score carries the contribution of each factor and
 *    a sentence for the ones that actually moved it. A ranking nobody can
 *    interrogate is a ranking nobody trusts, and an untrusted ranking gets
 *    ignored — at which point the whole engine is decoration.
 *
 * 3. **Overridable.** A manual rank always wins, and says so. The weights
 *    below are a good guess about your priorities; you are the authority on
 *    your priorities.
 *
 * Each factor returns a value in **0–1**, and the weighted sum is scaled to
 * 0–100. Keeping factors normalised is what makes the weights mean what they
 * say: changing a weight changes that factor's influence and nothing else.
 */

import type { TaskPriority } from "@/lib/tasks/types";

export const FACTORS = [
  "importance",
  "overdue",
  "dueProximity",
  "calendarProximity",
  "manual",
] as const;
export type Factor = (typeof FACTORS)[number];

/** The specification's weights. They sum to 1; the test suite asserts it. */
export const WEIGHTS: Record<Factor, number> = {
  importance: 0.35,
  overdue: 0.25,
  dueProximity: 0.2,
  calendarProximity: 0.15,
  manual: 0.05,
};

export const FACTOR_LABELS: Record<Factor, string> = {
  importance: "Importance",
  overdue: "Overdue",
  dueProximity: "Due soon",
  calendarProximity: "Meeting coming up",
  manual: "Your ordering",
};

/* ── Inputs ───────────────────────────────────────────────────────────── */

/**
 * Everything the scorer needs, already gathered.
 *
 * A plain data structure rather than a `Task` so the scorer cannot reach for
 * anything it hasn't been given — no lazy loads, no surprise queries, and a
 * test can construct any situation directly.
 */
export interface ScoreInput {
  id: string;
  priority: TaskPriority | null;
  dueAt: string | null;
  createdAt: string;
  pinned: boolean;
  /** Set by hand; when present it wins outright. See `manualRank`. */
  manualRank: number | null;

  /**
   * Inferred importance in 0–1, from `importance.ts`.
   *
   * Separate from `priority` on purpose: `priority` is what you *said*, and
   * this is what the surrounding context *implies*. They are combined below
   * rather than one overwriting the other.
   */
  inferredImportance?: number;

  /** The nearest linked meeting, if any. */
  linkedEvent?: {
    startsAt: string;
    /** `prep` runs before the meeting, `follow_up` after it. */
    relation: "prep" | "follow_up" | "related" | "source";
  } | null;
}

export interface FactorScore {
  factor: Factor;
  /** 0–1, before weighting. */
  raw: number;
  /** `raw * WEIGHTS[factor] * 100` — the points this factor contributed. */
  points: number;
  /** One sentence, shown in the explanation. `null` when it contributed nothing. */
  reason: string | null;
}

export interface Score {
  taskId: string;
  /** 0–100. */
  total: number;
  factors: FactorScore[];
  /** True when a manual rank is in force, in which case `total` is advisory. */
  overridden: boolean;
  /** The manual position, when set. Lower sorts first. */
  manualRank: number | null;
}

/* ── The factors ──────────────────────────────────────────────────────── */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Importance: what you said, combined with what the context implies.
 *
 * The stated priority is the floor and inference can only raise it. That
 * asymmetry is deliberate — the engine is allowed to notice that an untriaged
 * task is attached to tomorrow's board meeting, but it is not allowed to
 * decide that something you called Critical is not.
 */
export function importanceFactor(input: ScoreInput): FactorScore {
  const stated = statedImportance(input.priority);
  const inferred = clamp01(input.inferredImportance ?? 0);
  const raw = Math.max(stated, inferred);

  let reason: string | null = null;
  if (input.priority) {
    reason = `You marked it ${input.priority}.`;
    if (inferred > stated) {
      reason += " Its calendar context raises it further.";
    }
  } else if (inferred > 0) {
    reason = "Raised by the meetings it is attached to.";
  }

  return weigh("importance", raw, reason);
}

function statedImportance(priority: TaskPriority | null): number {
  switch (priority) {
    case "critical":
      return 1;
    case "high":
      return 0.75;
    case "normal":
      return 0.45;
    case "low":
      return 0.15;
    // Untriaged sits above Low and below Normal — the same judgement the
    // Phase 1 comparator makes, for the same reason: a new capture must not
    // sink out of sight before anyone has looked at it.
    case null:
      return 0.3;
  }
}

/**
 * Overdue: how late, saturating at a fortnight.
 *
 * Saturating matters. Without a ceiling, one task forgotten in March would
 * outrank everything else forever, and the list would have a permanent
 * occupant nobody can dislodge. Two weeks late is "very late"; six months late
 * is also "very late", and the difference between them is not what should
 * decide today.
 */
export function overdueFactor(input: ScoreInput, now: Date): FactorScore {
  if (!input.dueAt) return weigh("overdue", 0, null);

  const due = Date.parse(input.dueAt);
  if (!Number.isFinite(due)) return weigh("overdue", 0, null);

  const lateMs = now.getTime() - due;
  if (lateMs <= 0) return weigh("overdue", 0, null);

  const days = lateMs / DAY;
  const raw = clamp01(days / 14);

  return weigh(
    "overdue",
    raw,
    days < 1
      ? "Overdue since earlier today."
      : `Overdue by ${Math.floor(days)} ${Math.floor(days) === 1 ? "day" : "days"}.`,
  );
}

/**
 * Due proximity: how soon, over a seven-day horizon.
 *
 * Only counts while the task is still in the future — once it is late,
 * `overdueFactor` takes over, and letting both fire would double-count the
 * same fact at 45% of the total.
 */
export function dueProximityFactor(input: ScoreInput, now: Date): FactorScore {
  if (!input.dueAt) return weigh("dueProximity", 0, null);

  const due = Date.parse(input.dueAt);
  if (!Number.isFinite(due)) return weigh("dueProximity", 0, null);

  const aheadMs = due - now.getTime();
  if (aheadMs < 0) return weigh("dueProximity", 0, null);

  const days = aheadMs / DAY;
  const raw = clamp01(1 - days / 7);
  if (raw <= 0) return weigh("dueProximity", 0, null);

  return weigh(
    "dueProximity",
    raw,
    days < 1
      ? "Due within a day."
      : `Due in ${Math.round(days)} ${Math.round(days) === 1 ? "day" : "days"}.`,
  );
}

/**
 * Calendar proximity: a linked meeting inside 48 hours.
 *
 * The window is the specification's. What is worth noting is the asymmetry
 * between the two relations:
 *
 *   **Prep** work peaks as the meeting approaches — the deck is needed
 *   *before* the meeting, and being late is not recoverable.
 *
 *   **Follow-up** work is worthless before the meeting happens and becomes
 *   urgent immediately afterwards, decaying over the following days. A
 *   follow-up that ranks highly the day *before* its meeting is the engine
 *   telling you to do something you cannot yet do.
 */
export function calendarProximityFactor(
  input: ScoreInput,
  now: Date,
): FactorScore {
  const event = input.linkedEvent;
  if (!event) return weigh("calendarProximity", 0, null);

  const starts = Date.parse(event.startsAt);
  if (!Number.isFinite(starts)) return weigh("calendarProximity", 0, null);

  const untilMs = starts - now.getTime();
  const hours = untilMs / HOUR;

  if (event.relation === "follow_up") {
    // Not yet happened: nothing to follow up on.
    if (untilMs > 0) {
      return weigh(
        "calendarProximity",
        0,
        "Waiting on a meeting that hasn't happened yet.",
      );
    }

    const sinceHours = -hours;
    const raw = clamp01(1 - sinceHours / 72);
    if (raw <= 0) return weigh("calendarProximity", 0, null);

    return weigh(
      "calendarProximity",
      raw,
      sinceHours < 24
        ? "Follow-up from a meeting today."
        : `Follow-up from a meeting ${Math.round(sinceHours / 24)} days ago.`,
    );
  }

  // Prep and the weaker relations: only the run-up counts.
  if (untilMs < 0) return weigh("calendarProximity", 0, null);

  const raw = clamp01(1 - hours / 48);
  if (raw <= 0) return weigh("calendarProximity", 0, null);

  // A merely "related" meeting is a weaker signal than one you said is prep.
  const strength = event.relation === "prep" ? 1 : 0.6;

  return weigh(
    "calendarProximity",
    raw * strength,
    hours < 24
      ? "There's a meeting about this within a day."
      : "There's a meeting about this within two days.",
  );
}

/**
 * Manual: the pin.
 *
 * Only 5% by weight, which sounds like an insult to the owner's judgement
 * until you notice the other lever: `manualRank` bypasses scoring entirely.
 * This factor is the *soft* signal — "keep this near the top" — while a manual
 * rank is the hard one. Two different intentions, two different mechanisms.
 */
export function manualFactor(input: ScoreInput): FactorScore {
  if (!input.pinned) return weigh("manual", 0, null);
  return weigh("manual", 1, "You pinned it.");
}

/* ── The whole score ──────────────────────────────────────────────────── */

export function scoreTask(input: ScoreInput, now: Date = new Date()): Score {
  const factors = [
    importanceFactor(input),
    overdueFactor(input, now),
    dueProximityFactor(input, now),
    calendarProximityFactor(input, now),
    manualFactor(input),
  ];

  const total = round2(factors.reduce((sum, factor) => sum + factor.points, 0));

  return {
    taskId: input.id,
    total,
    factors,
    overridden: input.manualRank !== null,
    manualRank: input.manualRank,
  };
}

export function scoreAll(
  inputs: readonly ScoreInput[],
  now: Date = new Date(),
): Map<string, Score> {
  return new Map(
    inputs.map((input) => [input.id, scoreTask(input, now)] as const),
  );
}

/* ── Ordering ─────────────────────────────────────────────────────────── */

/**
 * The comparator.
 *
 * **Manual rank wins outright**, and manually ranked tasks sit above every
 * scored one. That is the specification's "manual override always available
 * and sticky" taken literally: if you have said this goes first, no
 * recalculation moves it, and no meeting appearing on your calendar moves it.
 *
 * Below that, score descending, then a deterministic tie-break chain. The
 * tie-break matters more than it looks: equal scores are common (two untriaged
 * tasks with no dates score identically), and an unstable order there makes
 * the list appear to shuffle itself between renders.
 */
export function compareScored(
  a: { score: Score; createdAt: string },
  b: { score: Score; createdAt: string },
): number {
  const aRank = a.score.manualRank;
  const bRank = b.score.manualRank;

  if (aRank !== null && bRank !== null) {
    if (aRank !== bRank) return aRank - bRank;
  } else if (aRank !== null) {
    return -1;
  } else if (bRank !== null) {
    return 1;
  }

  if (a.score.total !== b.score.total) return b.score.total - a.score.total;

  // Oldest first, so nothing quietly ages out of view.
  const created = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (created !== 0) return created;

  // Purely for stability across renders.
  return a.score.taskId.localeCompare(b.score.taskId);
}

/* ── Explanation ──────────────────────────────────────────────────────── */

/** The factors that actually moved the score, strongest first. */
export function contributingFactors(score: Score): FactorScore[] {
  return score.factors
    .filter((factor) => factor.points > 0 && factor.reason !== null)
    .sort((a, b) => b.points - a.points);
}

/**
 * One line, for a list row where a panel would be too much.
 *
 * Deliberately names the single largest contributor rather than summarising
 * all five: "Overdue by 3 days" is a reason, and "importance 0.35, overdue
 * 0.21, …" is a debug dump.
 */
export function explainBriefly(score: Score): string {
  if (score.overridden) return "You placed this by hand.";

  const top = contributingFactors(score)[0];
  if (!top) return "Nothing is pushing this up or down.";
  return top.reason ?? FACTOR_LABELS[top.factor];
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function weigh(
  factor: Factor,
  raw: number,
  reason: string | null,
): FactorScore {
  const bounded = clamp01(raw);
  return {
    factor,
    raw: round2(bounded * 100) / 100,
    points: round2(bounded * WEIGHTS[factor] * 100),
    reason: bounded > 0 ? reason : null,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Two decimal places.
 *
 * Not cosmetic: without rounding, two tasks that are mathematically equal can
 * differ in the sixteenth decimal place and sort inconsistently, which reads
 * as the list shuffling itself for no reason.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
