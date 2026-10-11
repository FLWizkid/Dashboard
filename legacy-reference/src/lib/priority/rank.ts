/**
 * Assembling a ranking.
 *
 * `score.ts` scores one task from data it is handed. `importance.ts` turns a
 * meeting into a number. This is the piece that gathers the inputs: for each
 * task, find its confirmed event links, infer importance from those meetings,
 * pick the one that matters most, and score.
 *
 * Pure, and deliberately so — it takes tasks, links and events as arguments
 * rather than fetching them. That is what lets the E2E suite, the integration
 * tests and the browser all produce provably identical orderings, and what
 * keeps "why is this ranked here" answerable without a database.
 */

import type { Task, TaskLinkRelation } from "@/lib/tasks/types";

import {
  inferImportance,
  inheritedImportance,
  strongestImportance,
  type EventContext,
  type ImportanceResult,
} from "./importance";
import {
  compareScored,
  contributingFactors,
  explainBriefly,
  scoreTask,
  type Score,
  type ScoreInput,
} from "./score";

export interface RankedTask {
  task: Task;
  score: Score;
  /** The meeting that drove the ranking, when one did. */
  drivingEvent: EventContext | null;
  /** How that meeting relates to the task. */
  drivingRelation: TaskLinkRelation | null;
  /** The importance inference, kept so the panel can show its signals. */
  importance: ImportanceResult;
  /** One line, for a list row. */
  summary: string;
}

export interface RankOptions {
  tasks: readonly Task[];
  /** Every event the tasks might link to, by id. */
  events: ReadonlyMap<string, EventContext>;
  now?: Date;
  /**
   * Include completed tasks. Off by default — a ranking of things you have
   * already done is a report, not a to-do list.
   */
  includeDone?: boolean;
}

/**
 * The relations that carry calendar weight.
 *
 * `related` and `source` are included but weighted down inside the scorer;
 * `kanban` and the note relations carry no calendar meaning at all.
 */
const CALENDAR_RELATIONS: readonly TaskLinkRelation[] = [
  "prep",
  "follow_up",
  "related",
  "source",
];

/**
 * Scores and orders a set of tasks.
 *
 * Only **confirmed** event links count. An unconfirmed link is a suggestion
 * the owner has not answered, and letting it move the ranking would be
 * auto-linking through the back door — the visible relationship would still
 * be absent, but the order would already have changed.
 */
export function rankTasks(options: RankOptions): RankedTask[] {
  const now = options.now ?? new Date();
  const tasks = options.includeDone
    ? options.tasks
    : options.tasks.filter((task) => task.status !== "done");

  const ranked = tasks.map((task) => rankOne(task, options.events, now));

  return ranked.sort((a, b) =>
    compareScored(
      { score: a.score, createdAt: a.task.createdAt },
      { score: b.score, createdAt: b.task.createdAt },
    ),
  );
}

function rankOne(
  task: Task,
  events: ReadonlyMap<string, EventContext>,
  now: Date,
): RankedTask {
  const linked = task.links
    .filter(
      (link) =>
        link.kind === "event" &&
        // Confirmed only. See the note above.
        link.confirmedAt !== null &&
        link.targetId !== null &&
        CALENDAR_RELATIONS.includes(link.relation),
    )
    .map((link) => ({
      link,
      event: events.get(link.targetId!),
    }))
    .filter(
      (
        pair,
      ): pair is { link: (typeof task.links)[number]; event: EventContext } =>
        pair.event !== undefined && !pair.event.isCancelled,
    );

  const inferences = linked.map((pair) => ({
    pair,
    result: inferImportance(pair.event, {
      relation: narrowRelation(pair.link.relation),
      now,
    }),
  }));

  const strongest = strongestImportance(inferences.map((i) => i.result));
  const driver =
    inferences.find((i) => i.result === strongest)?.pair ?? linked[0] ?? null;

  // Linked work inherits *part* of the meeting's importance — see
  // `inheritedImportance` for why part rather than all.
  const inferredImportance = driver
    ? inheritedImportance(strongest.value, narrowRelation(driver.link.relation))
    : 0;

  const input: ScoreInput = {
    id: task.id,
    priority: task.priority,
    dueAt: task.dueAt,
    createdAt: task.createdAt,
    pinned: task.pinned,
    manualRank: task.manualRank,
    inferredImportance,
    linkedEvent: driver
      ? {
          startsAt: driver.event.startsAt,
          relation: narrowRelation(driver.link.relation),
        }
      : null,
  };

  const score = scoreTask(input, now);

  return {
    task,
    score,
    drivingEvent: driver?.event ?? null,
    drivingRelation: driver?.link.relation ?? null,
    importance: strongest,
    summary: explainBriefly(score),
  };
}

/** `TaskLinkRelation` is wider than the scorer needs; this narrows it safely. */
function narrowRelation(
  relation: TaskLinkRelation,
): "prep" | "follow_up" | "related" | "source" {
  switch (relation) {
    case "prep":
    case "follow_up":
    case "source":
      return relation;
    default:
      return "related";
  }
}

/* ── Explanation for the UI ───────────────────────────────────────────── */

export interface Explanation {
  /** The headline: what is going on with this task's rank. */
  headline: string;
  /** Each factor that moved it, strongest first. */
  lines: { label: string; detail: string; points: number }[];
  /** The importance signals behind the calendar boost, when there was one. */
  signals: { detail: string }[];
  total: number;
  overridden: boolean;
}

/**
 * The full "why is this here" panel.
 *
 * Everything shown is traceable to something the owner can look at: a
 * priority they set, a date they chose, a meeting on their calendar. Nothing
 * here is a number without a sentence attached, because a number without a
 * sentence is not an explanation — it is a receipt.
 */
export function explain(ranked: RankedTask): Explanation {
  if (ranked.score.overridden) {
    return {
      headline: "You placed this by hand, so nothing else moves it.",
      lines: [],
      signals: [],
      total: ranked.score.total,
      overridden: true,
    };
  }

  const lines = contributingFactors(ranked.score).map((factor) => ({
    label: labelFor(factor.factor),
    detail: factor.reason ?? "",
    points: factor.points,
  }));

  return {
    headline:
      lines.length === 0
        ? "Nothing is pushing this up or down — it sits where new work sits."
        : `Mostly: ${lines[0].detail}`,
    lines,
    signals: ranked.importance.hits.map((hit) => ({ detail: hit.reason })),
    total: ranked.score.total,
    overridden: false,
  };
}

function labelFor(factor: Score["factors"][number]["factor"]): string {
  switch (factor) {
    case "importance":
      return "Importance";
    case "overdue":
      return "Overdue";
    case "dueProximity":
      return "Due soon";
    case "calendarProximity":
      return "Meeting coming up";
    case "manual":
      return "Your ordering";
  }
}

/* ── Manual placement ─────────────────────────────────────────────────── */

/**
 * The ranks to write when the owner drags a task to a position.
 *
 * Renumbers the whole manual set from zero rather than inserting fractional
 * ranks between neighbours. The set is small — these are the handful of things
 * someone has deliberately placed — and integer ranks with no gaps are what
 * make the order legible when you are looking at the rows in a database.
 */
export function reorderManual(
  currentOrder: readonly string[],
  taskId: string,
  toIndex: number,
): { taskId: string; manualRank: number }[] {
  const without = currentOrder.filter((id) => id !== taskId);
  const index = Math.max(0, Math.min(toIndex, without.length));

  const next = [...without.slice(0, index), taskId, ...without.slice(index)];

  return next.map((id, position) => ({ taskId: id, manualRank: position }));
}

/**
 * Releasing a task back to the engine.
 *
 * Returns the renumbering for everything that stays pinned, so the remaining
 * ranks close up rather than leaving a hole at position 3 forever.
 */
export function releaseManual(
  currentOrder: readonly string[],
  taskId: string,
): { taskId: string; manualRank: number }[] {
  return currentOrder
    .filter((id) => id !== taskId)
    .map((id, position) => ({ taskId: id, manualRank: position }));
}
