import type { Task, TaskPriority } from "./types";

/**
 * Ready state.
 *
 * A task is Ready when it has the three things needed to actually work it:
 * a title, a priority, and a due date. Owner is deliberately excluded — it is
 * optional in personal mode and only becomes required when teammate mode
 * lands post-v1.
 *
 * The database computes the same predicate into the generated `is_ready`
 * column (see `supabase/migrations/20260805000001_tasks_core.sql`) so queries
 * and indexes can rely on it. This module is the client-side twin, used to
 * badge a task the instant a field changes rather than after a round-trip.
 * The two definitions must agree; a unit test asserts the field list.
 */

export const READY_FIELDS = ["title", "priority", "dueAt"] as const;
export type ReadyField = (typeof READY_FIELDS)[number];

export const READY_FIELD_LABELS: Record<ReadyField, string> = {
  title: "title",
  priority: "priority",
  dueAt: "due date",
};

/** The subset of a task the Ready check looks at. */
export interface ReadyCandidate {
  title?: string | null;
  priority?: TaskPriority | null;
  dueAt?: string | Date | null;
}

/** Which of the Ready fields are still missing, in field order. */
export function missingReadyFields(task: ReadyCandidate): ReadyField[] {
  const missing: ReadyField[] = [];

  if (!task.title || task.title.trim().length === 0) missing.push("title");
  if (!task.priority) missing.push("priority");
  if (!task.dueAt) missing.push("dueAt");

  return missing;
}

export function isReady(task: ReadyCandidate): boolean {
  return missingReadyFields(task).length === 0;
}

/**
 * Human sentence for the "not Ready yet" badge, e.g.
 * "Needs priority and due date".
 */
export function describeMissingReadyFields(
  task: ReadyCandidate,
): string | null {
  const missing = missingReadyFields(task).map(
    (field) => READY_FIELD_LABELS[field],
  );
  if (missing.length === 0) return null;
  if (missing.length === 1) return `Needs ${missing[0]}`;

  const last = missing[missing.length - 1];
  return `Needs ${missing.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * Whether a task can be promoted to the Ready lane. Phase 3's Kanban uses
 * this; it is here so the rule has exactly one home.
 */
export function canPromoteToReady(task: Task): boolean {
  return task.status !== "done" && isReady(task);
}
