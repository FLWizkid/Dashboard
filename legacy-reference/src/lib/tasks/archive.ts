import type { Task } from "./types";

/**
 * When a finished task stops being shown.
 *
 * A Done list that keeps everything ever completed answers the wrong
 * question. What is useful is "what did I finish recently" — the last few
 * weeks, the span you might still be asked about in a review or a status
 * update. Beyond that it is a filing cabinet, and scrolling past nine months
 * of finished work to find last Tuesday's is how the list stops being opened.
 *
 * ── Archived, not deleted ────────────────────────────────────────────────
 * Nothing is removed and nothing is written. This is a *view* rule computed
 * from `completedAt`, which the task already carries: it needs no column, no
 * migration and no scheduled job that could fall over and quietly eat a
 * month of history. Reopening a task un-archives it by definition, because
 * the rule only ever looks at tasks that are currently done.
 *
 * The reports and the digest deliberately do not use this. They answer
 * "what happened in this period", and a period that has scrolled past thirty
 * days is exactly when you most want the answer.
 */

/** Long enough to cover a monthly review, short enough to stay a list. */
export const ARCHIVE_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True once a completed task has aged out of the Done list.
 *
 * A task that is not done is never archived, whatever `completedAt` says —
 * a reopened task carrying a stale completion timestamp must come back.
 * A done task with no timestamp at all is *kept*: the honest reading of "I
 * do not know when this finished" is not "it finished long ago".
 */
export function isArchived(task: Task, now: Date): boolean {
  if (task.status !== "done") return false;
  if (!task.completedAt) return false;

  const completedAt = Date.parse(task.completedAt);
  if (Number.isNaN(completedAt)) return false;

  return now.getTime() - completedAt > ARCHIVE_AFTER_DAYS * DAY_MS;
}

/** The completed tasks still worth showing, oldest rule applied once. */
export function withoutArchived(tasks: readonly Task[], now: Date): Task[] {
  return tasks.filter((task) => !isArchived(task, now));
}

/** How many were hidden — so the list can say so rather than just be short. */
export function countArchived(tasks: readonly Task[], now: Date): number {
  return tasks.reduce(
    (total, task) => total + (isArchived(task, now) ? 1 : 0),
    0,
  );
}
