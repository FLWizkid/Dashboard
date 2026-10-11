/**
 * Report grouping.
 *
 * The specification's first-level grouping is **Overdue / Due Soon / Current /
 * Upcoming**. That is four buckets where `tasks/sort.ts` has five, and the
 * mapping is worth stating rather than leaving to be inferred:
 *
 *   | report bucket | from `dueBucket`     |
 *   | ------------- | -------------------- |
 *   | Overdue       | `overdue`            |
 *   | Due soon      | `today`, `soon`      |
 *   | Current       | `undated`, and open  |
 *   | Upcoming      | `later`              |
 *
 * **Current holds the undated work**, which is the only judgement call here.
 * The alternative — a fifth "No due date" bucket — is more literal and less
 * useful: undated work is what you are doing *now* rather than work with a
 * deadline, and burying it in its own section at the bottom is how it stops
 * getting done. A dated task always appears in a dated bucket, so nothing is
 * hidden by this.
 *
 * Everything here is pure and takes `now` explicitly, so a report rendered on
 * screen and the same report in a digest an hour later differ only by the
 * hour, not by which code computed them.
 */

import { dueBucket, isOpen, type DueBucket } from "@/lib/tasks/sort";
import type { Task } from "@/lib/tasks/types";

export const REPORT_GROUPS = [
  "overdue",
  "dueSoon",
  "current",
  "upcoming",
] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export const REPORT_GROUP_LABELS: Record<ReportGroup, string> = {
  overdue: "Overdue",
  dueSoon: "Due soon",
  current: "Current",
  upcoming: "Upcoming",
};

export const REPORT_GROUP_DESCRIPTIONS: Record<ReportGroup, string> = {
  overdue: "Past their due date.",
  dueSoon: "Due today or in the next two days.",
  current: "In hand, with no deadline attached.",
  upcoming: "Dated further out.",
};

/** Which report bucket a task falls in. */
export function reportGroup(
  task: Task,
  now: Date = new Date(),
  timeZone = "UTC",
): ReportGroup {
  const bucket: DueBucket = dueBucket(task, now, timeZone);

  switch (bucket) {
    case "overdue":
      return "overdue";
    case "today":
    case "soon":
      return "dueSoon";
    case "later":
      return "upcoming";
    case "undated":
      return "current";
  }
}

export interface GroupedTasks {
  group: ReportGroup;
  label: string;
  description: string;
  tasks: Task[];
}

export interface GroupOptions {
  now?: Date;
  timeZone?: string;
  /**
   * Include completed work. Off by default: a report of what you have already
   * finished is a different document, and mixing the two makes the counts
   * answer neither question.
   */
  includeDone?: boolean;
  /** Ordering within each group. Defaults to soonest-due, then oldest. */
  compare?: (a: Task, b: Task) => number;
}

/**
 * Groups tasks for the report, in report order.
 *
 * Every group is returned, including empty ones. An absent "Overdue" heading
 * and an "Overdue" heading with nothing under it say very different things,
 * and only one of them is the good news.
 */
export function groupForReport(
  tasks: readonly Task[],
  options: GroupOptions = {},
): GroupedTasks[] {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? "UTC";
  const compare = options.compare ?? byDueThenAge;

  const relevant = options.includeDone ? [...tasks] : tasks.filter(isOpen);

  const byGroup = new Map<ReportGroup, Task[]>(
    REPORT_GROUPS.map((group) => [group, []]),
  );

  for (const task of relevant) {
    byGroup.get(reportGroup(task, now, timeZone))!.push(task);
  }

  return REPORT_GROUPS.map((group) => ({
    group,
    label: REPORT_GROUP_LABELS[group],
    description: REPORT_GROUP_DESCRIPTIONS[group],
    tasks: byGroup.get(group)!.sort(compare),
  }));
}

/**
 * Due-date ordering, as the specification asks for.
 *
 * Undated last within a group — which only matters inside "Current", where
 * everything is undated and it falls through to age.
 */
export function byDueThenAge(a: Task, b: Task): number {
  const aDue = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
  const bDue = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;

  if (aDue !== bDue) return aDue < bDue ? -1 : 1;

  const created = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (created !== 0) return created;

  // Stability across renders, and across a report and its digest.
  return a.id.localeCompare(b.id);
}

/* ── Filters ──────────────────────────────────────────────────────────── */

export interface ReportFilters {
  /** Empty means every category, including uncategorised. */
  categoryIds?: readonly string[];
  /** Empty means every priority, including untriaged. */
  priorities?: readonly (Task["priority"] & string)[];
  /** Empty means every status. */
  statuses?: readonly Task["status"][];
  /** Free text over the title. */
  query?: string;
  /** Only tasks the report considers incomplete. */
  incompleteOnly?: boolean;
  /** Only tasks with no category, for finding what escaped triage. */
  uncategorisedOnly?: boolean;
}

/**
 * Applies the workspace's filters.
 *
 * An absent or empty filter means "everything", never "nothing". Getting that
 * backwards is the classic filter bug: the page loads, no boxes are ticked,
 * and the report is empty — which reads as "you have no work" rather than
 * "you have chosen to see none of it".
 */
export function applyFilters(
  tasks: readonly Task[],
  filters: ReportFilters = {},
): Task[] {
  const needle = filters.query?.trim().toLowerCase();

  return tasks.filter((task) => {
    if (filters.incompleteOnly && !isOpen(task)) return false;
    if (filters.uncategorisedOnly && task.categoryId !== null) return false;

    if (filters.categoryIds?.length) {
      if (!task.categoryId) return false;
      if (!filters.categoryIds.includes(task.categoryId)) return false;
    }

    if (filters.priorities?.length) {
      if (!task.priority) return false;
      if (!filters.priorities.includes(task.priority)) return false;
    }

    if (filters.statuses?.length && !filters.statuses.includes(task.status)) {
      return false;
    }

    if (needle && !task.title.toLowerCase().includes(needle)) return false;

    return true;
  });
}

/** True when any filter is actually narrowing the report. */
export function hasActiveFilters(filters: ReportFilters = {}): boolean {
  return Boolean(
    filters.categoryIds?.length ||
    filters.priorities?.length ||
    filters.statuses?.length ||
    filters.query?.trim() ||
    filters.incompleteOnly ||
    filters.uncategorisedOnly,
  );
}
