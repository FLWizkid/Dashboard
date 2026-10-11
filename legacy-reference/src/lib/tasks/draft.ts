/**
 * Draft tasks.
 *
 * A follow-up action captured in a note arrives as a **draft**: visible on the
 * note it came from, absent from the board, the dashboard and every count,
 * until someone commits to it.
 *
 * Committing means three things, from the specification: an **owner**, a **due
 * date** and a **priority**. That is deliberately a higher bar than Ready
 * state (title + priority + due), and the extra field is the interesting one —
 * a follow-up with no owner is a wish, and a decision log full of wishes is
 * how a decision log stops being read.
 *
 * The same rule is a generated column in the database (`tasks.can_activate`)
 * and a trigger refuses the transition, so the UI and the API cannot disagree
 * with each other or with the schema. This module is the client-side twin; the
 * test below asserts the field list matches.
 */

import type { Task } from "./types";

/** The fields a draft needs before it can become live work. */
export const ACTIVATION_FIELDS = ["owner", "dueAt", "priority"] as const;
export type ActivationField = (typeof ACTIVATION_FIELDS)[number];

export const ACTIVATION_FIELD_LABELS: Record<ActivationField, string> = {
  owner: "an owner",
  dueAt: "a due date",
  priority: "a priority",
};

type ActivatableTask = Pick<Task, "owner" | "dueAt" | "priority">;

/** Which of the three are still missing, in a stable order. */
export function missingForActivation(task: ActivatableTask): ActivationField[] {
  const missing: ActivationField[] = [];

  if (!task.owner || task.owner.trim() === "") missing.push("owner");
  if (!task.dueAt) missing.push("dueAt");
  if (task.priority === null || task.priority === undefined)
    missing.push("priority");

  return missing;
}

export function canActivate(task: ActivatableTask): boolean {
  return missingForActivation(task).length === 0;
}

/**
 * "Needs an owner and a due date" — the sentence shown on the draft.
 *
 * Naming what is missing rather than showing a disabled button with no
 * explanation is the same choice the Ready badge makes.
 */
export function describeMissingForActivation(
  task: ActivatableTask,
): string | null {
  const missing = missingForActivation(task);
  if (missing.length === 0) return null;

  const labels = missing.map((field) => ACTIVATION_FIELD_LABELS[field]);
  const joined =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;

  return `Needs ${joined}`;
}

/**
 * Whether a task should appear in the working views at all.
 *
 * One predicate, used by the board, the dashboard and the counts, so a draft
 * cannot leak into one of them because a filter was written twice.
 */
export function isLiveWork(task: Pick<Task, "isDraft">): boolean {
  return task.isDraft !== true;
}
