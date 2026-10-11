import { zonedDayDifference } from "@/lib/time/zone";
import type { Task, TaskPriority } from "./types";

/**
 * Manual task ordering for Phase 1.
 *
 * Everything here is driven by what the owner set by hand: the pin, then the
 * priority, then the due date. The weighted automatic ranking (importance /
 * overdue / due-proximity / calendar-proximity / manual) arrives in Phase 5
 * and will sit *beside* this, not replace it — manual override stays
 * available at all times, so this comparator remains the fallback and the
 * tie-breaker.
 */

/**
 * Lower sorts first.
 *
 * An untriaged task (no priority) sits between Normal and Low: it should not
 * outrank something the owner explicitly called Normal, but it must not sink
 * below something they explicitly called Low either, or new captures would
 * disappear before they were ever triaged.
 */
export const PRIORITY_RANK: Record<TaskPriority | "untriaged", number> = {
  critical: 0,
  high: 1,
  normal: 2,
  untriaged: 3,
  low: 4,
};

export function priorityRank(priority: TaskPriority | null): number {
  return PRIORITY_RANK[priority ?? "untriaged"];
}

function dueRank(dueAt: string | null): number {
  // No due date sorts last within its priority band.
  return dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(dueAt);
}

/**
 * The Phase 1 ordering, in full:
 *   1. pinned first
 *   2. priority (critical → high → normal → untriaged → low)
 *   3. soonest due date, undated last
 *   4. oldest first, so nothing quietly ages out of view
 *   5. id, purely so the order is stable across renders
 *
 * Status is deliberately NOT part of this. A row that was just completed has
 * to hold its place while the undo window is open, so callers decide what to
 * include — see `topPriorities`, which filters to open tasks.
 */
export function compareTasks(a: Task, b: Task): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

  const priority = priorityRank(a.priority) - priorityRank(b.priority);
  if (priority !== 0) return priority;

  // Compared rather than subtracted: both being undated is Infinity on each
  // side, and Infinity - Infinity is NaN.
  const aDue = dueRank(a.dueAt);
  const bDue = dueRank(b.dueAt);
  if (aDue !== bDue) return aDue < bDue ? -1 : 1;

  const created = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (created !== 0) return created;

  return a.id.localeCompare(b.id);
}

export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(compareTasks);
}

export function isOpen(task: Task): boolean {
  return task.status !== "done";
}

export function isOverdue(task: Task, now: Date = new Date()): boolean {
  if (!isOpen(task) || !task.dueAt) return false;
  return Date.parse(task.dueAt) < now.getTime();
}

/**
 * The dashboard's "top priorities" card: open tasks only, in manual order,
 * capped so the card never dominates the page.
 */
export function topPriorities(tasks: readonly Task[], limit = 5): Task[] {
  return sortTasks(tasks.filter(isOpen)).slice(0, limit);
}

/**
 * First-level grouping: Overdue / Due Soon / Current / Upcoming.
 * Phase 6's reports reuse this, which is why the day boundaries are resolved
 * in the owner's timezone rather than the runtime's.
 */
export type DueBucket = "overdue" | "today" | "soon" | "later" | "undated";

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Due today",
  soon: "Due soon",
  later: "Upcoming",
  undated: "No due date",
};

export function dueBucket(
  task: Task,
  now: Date = new Date(),
  timeZone: string = "UTC",
  soonWithinDays = 2,
): DueBucket {
  if (!task.dueAt) return "undated";

  const due = new Date(task.dueAt);
  if (due.getTime() < now.getTime()) return "overdue";

  const days = zonedDayDifference(now, due, timeZone);
  if (days <= 0) return "today";
  return days <= soonWithinDays ? "soon" : "later";
}
