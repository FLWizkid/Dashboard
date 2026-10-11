/**
 * The board.
 *
 * Five lanes: Inbox → Ready → In Progress → Waiting → Done. The board is a
 * view of `tasks.status`, not a separate record — moving a card *is* changing
 * the task, which is what makes the board and the task list agree without a
 * synchronisation step between them.
 *
 * ── The rule the board exists to enforce ─────────────────────────────────
 * Everything captured lands in **Inbox**, and leaving Inbox for **Ready**
 * requires the Ready minimum: title, priority, due date. That is the triage
 * step the whole product is arranged around — the difference between a list
 * of things you wrote down and a list of things you have decided to do.
 *
 * Every other move is free. Nobody needs a workflow engine telling them they
 * may not put something back.
 */

import {
  canPromoteToReady,
  describeMissingReadyFields,
  isReady,
} from "@/lib/tasks/ready";
import type { Task, TaskStatus } from "@/lib/tasks/types";

export const LANES: TaskStatus[] = [
  "inbox",
  "ready",
  "in_progress",
  "waiting",
  "done",
];

export const LANE_LABELS: Record<TaskStatus, string> = {
  inbox: "Inbox",
  ready: "Ready",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
};

export const LANE_DESCRIPTIONS: Record<TaskStatus, string> = {
  inbox: "Everything you capture lands here. Triage it to move on.",
  ready: "Decided, scheduled, and ready to pick up.",
  in_progress: "Being worked on now.",
  waiting: "Blocked on someone else.",
  done: "Finished.",
};

export interface MoveResult {
  allowed: boolean;
  /** Why not, in a sentence, when it isn't. */
  reason: string | null;
  /** Which Ready fields are missing, when that is the blocker. */
  missing: string | null;
}

/**
 * Whether a card may move to `target`.
 *
 * Only one transition is gated — Inbox → Ready — and it is gated on the data,
 * not on where the card came from.
 */
export function canMoveTo(task: Task, target: TaskStatus): MoveResult {
  if (task.isDraft) {
    return {
      allowed: false,
      reason:
        "This is a draft follow-up. Give it an owner, a due date and a priority to activate it.",
      missing: null,
    };
  }

  if (target === "ready" && !isReady(task)) {
    return {
      allowed: false,
      reason: "A card needs a title, a priority and a due date to be Ready.",
      missing: describeMissingReadyFields(task),
    };
  }

  return { allowed: true, reason: null, missing: null };
}

/**
 * True when an Inbox card has everything it needs to be promoted.
 *
 * The Ready rule itself lives in `tasks/ready.ts` and is not restated here —
 * this adds only the two conditions that are the board's business: the card is
 * in the Inbox, and it is not a draft.
 */
export function canPromoteFromInbox(task: Task): boolean {
  return !task.isDraft && task.status === "inbox" && canPromoteToReady(task);
}

/* ── Triage suggestions ───────────────────────────────────────────────── */

export type TriageAction =
  "promote" | "set_priority" | "set_due" | "set_title" | "start" | "complete";

export interface TriageSuggestion {
  action: TriageAction;
  /** Shown on the card. Imperative, short. */
  label: string;
  /** Why this is being suggested; shown on hover and to screen readers. */
  reason: string;
  /** The single most useful next action gets this. */
  primary: boolean;
}

/**
 * What to offer on a card sitting in Inbox.
 *
 * At most one primary suggestion, because a card offering three equally
 * weighted choices is a card you skip. The order is fixed: fill in what is
 * missing, then promote.
 */
export function triageSuggestions(task: Task): TriageSuggestion[] {
  if (task.isDraft) return [];
  if (task.status !== "inbox") return inProgressSuggestions(task);

  const suggestions: TriageSuggestion[] = [];

  if (task.title.trim() === "") {
    suggestions.push({
      action: "set_title",
      label: "Add a title",
      reason: "A card with no title is not a task yet.",
      primary: true,
    });
    return suggestions;
  }

  if (task.priority === null) {
    suggestions.push({
      action: "set_priority",
      label: "Set priority",
      reason: "Untriaged. Deciding how much this matters is the triage step.",
      primary: true,
    });
  }

  if (task.dueAt === null) {
    suggestions.push({
      action: "set_due",
      label: "Set a due date",
      reason: "Ready needs a date, even an approximate one.",
      primary: task.priority !== null,
    });
  }

  if (canPromoteFromInbox(task)) {
    suggestions.push({
      action: "promote",
      label: "Promote to Ready",
      reason: "This has everything it needs. Move it out of the Inbox.",
      primary: true,
    });
  }

  return suggestions;
}

function inProgressSuggestions(task: Task): TriageSuggestion[] {
  if (task.status === "ready") {
    return [
      {
        action: "start",
        label: "Start",
        reason: "Move this into In progress.",
        primary: false,
      },
    ];
  }

  if (task.status === "in_progress" || task.status === "waiting") {
    return [
      {
        action: "complete",
        label: "Complete",
        reason: "Mark this done.",
        primary: false,
      },
    ];
  }

  return [];
}

/* ── Grouping ─────────────────────────────────────────────────────────── */

export interface Lane {
  status: TaskStatus;
  label: string;
  description: string;
  tasks: Task[];
}

/**
 * Splits tasks into lanes, in board order.
 *
 * Drafts are excluded everywhere — they belong to the note that created them
 * until someone activates them.
 */
export function groupIntoLanes(
  tasks: Task[],
  sort: (tasks: Task[]) => Task[],
): Lane[] {
  const live = tasks.filter((task) => !task.isDraft);

  return LANES.map((status) => ({
    status,
    label: LANE_LABELS[status],
    description: LANE_DESCRIPTIONS[status],
    tasks: sort(live.filter((task) => task.status === status)),
  }));
}

/** Where a keyboard move should land, given a direction. */
export function laneAfterMove(
  status: TaskStatus,
  direction: -1 | 1,
): TaskStatus {
  const index = LANES.indexOf(status);
  const next = Math.min(Math.max(index + direction, 0), LANES.length - 1);
  return LANES[next];
}
