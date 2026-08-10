/**
 * The executive summary, and the two-day rollup.
 *
 * These are the numbers that go at the top of the printed report and at the
 * top of the morning brief — the same function feeds both, so the page you
 * print and the email you receive cannot disagree about how many things are
 * overdue.
 *
 * ── One rule ─────────────────────────────────────────────────────────────
 * **A number that cannot be computed is `null`, never `0`.** Unread mail with
 * no mail account connected is not "0 unread", it is "not connected", and
 * printing a confident zero for something the system cannot see is the fastest
 * way to make a report untrustworthy. Every consumer here renders `null` as
 * "—" with a reason rather than as a figure.
 */

import type { HoursTotals } from "@/lib/hours/aggregate";
import { isOpen, isOverdue } from "@/lib/tasks/sort";
import type { Task } from "@/lib/tasks/types";

import { groupForReport, type ReportGroup } from "./group";

export interface ExecutiveSummary {
  /** Open, not done. */
  openTasks: number;
  overdue: number;
  dueSoon: number;
  /** Ready to start: title, priority and due date all present. */
  ready: number;
  /** Captured but not triaged — the queue that grows when you're busy. */
  untriaged: number;
  completedThisWeek: number;

  /** `null` until the hours module has anything to report. */
  hoursThisWeek: HoursTotals | null;

  /**
   * `null` when no mail account is connected — see the note at the top of
   * this file. Zero would be a lie in the common case.
   */
  criticalUnread: number | null;

  /** The highest-ranked open work, already ordered by the caller. */
  topPriorities: Task[];
}

export interface SummaryOptions {
  tasks: readonly Task[];
  now: Date;
  timeZone: string;
  hours?: HoursTotals | null;
  criticalUnread?: number | null;
  /** Ranked ids, strongest first, from the priority engine. */
  rankedIds?: readonly string[];
  topCount?: number;
  weekStart: Date;
}

export function buildSummary(options: SummaryOptions): ExecutiveSummary {
  const { tasks, now, timeZone } = options;
  const open = tasks.filter(isOpen);

  const groups = groupForReport(tasks, { now, timeZone });
  const count = (group: ReportGroup) =>
    groups.find((g) => g.group === group)?.tasks.length ?? 0;

  const weekStartMs = options.weekStart.getTime();
  const completedThisWeek = tasks.filter((task) => {
    if (task.status !== "done" || !task.completedAt) return false;
    const at = Date.parse(task.completedAt);
    return Number.isFinite(at) && at >= weekStartMs && at <= now.getTime();
  }).length;

  return {
    openTasks: open.length,
    overdue: count("overdue"),
    dueSoon: count("dueSoon"),
    ready: open.filter((task) => task.isReady).length,
    untriaged: open.filter((task) => task.priority === null).length,
    completedThisWeek,
    hoursThisWeek: options.hours ?? null,
    criticalUnread: options.criticalUnread ?? null,
    topPriorities: pickTop(open, options.rankedIds, options.topCount ?? 5),
  };
}

/**
 * The top of the list, in the priority engine's order when it has one.
 *
 * Falls back to overdue-then-dated rather than to nothing: a summary that
 * omits its most important section because a score wasn't available is worse
 * than one that orders it slightly differently.
 */
function pickTop(
  open: readonly Task[],
  rankedIds: readonly string[] | undefined,
  limit: number,
): Task[] {
  if (rankedIds?.length) {
    const position = new Map(rankedIds.map((id, index) => [id, index]));
    return open
      .filter((task) => position.has(task.id))
      .sort((a, b) => position.get(a.id)! - position.get(b.id)!)
      .slice(0, limit);
  }

  return [...open]
    .sort((a, b) => {
      const aLate = isOverdue(a) ? 0 : 1;
      const bLate = isOverdue(b) ? 0 : 1;
      if (aLate !== bLate) return aLate - bLate;

      const aDue = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
      const bDue = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue < bDue ? -1 : 1;

      return a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}

/* ── Activity splits ──────────────────────────────────────────────────── */

export interface ActivitySplit {
  categoryId: string | null;
  /** "Uncategorised" when `categoryId` is null. */
  name: string;
  openTasks: number;
  completed: number;
  /** Minutes, when hours data is available for the category. */
  minutes: number | null;
  /** Share of the total, 0–100, rounded to one place. */
  share: number;
}

export interface SplitOptions {
  tasks: readonly Task[];
  categories: readonly { id: string; name: string }[];
  /** Minutes by category id, from the hours module. */
  minutesByCategory?: ReadonlyMap<string, number>;
  weekStart: Date;
  now: Date;
}

/**
 * Where the work went, by activity category.
 *
 * Uncategorised is **always included**, and never quietly dropped. It is the
 * single most useful row in this table: a large uncategorised share means the
 * taxonomy isn't being used, which makes every other row less meaningful.
 */
export function activitySplits(options: SplitOptions): ActivitySplit[] {
  const names = new Map(options.categories.map((c) => [c.id, c.name] as const));
  const weekStartMs = options.weekStart.getTime();
  const nowMs = options.now.getTime();

  const rows = new Map<string | null, ActivitySplit>();

  const ensure = (categoryId: string | null): ActivitySplit => {
    const existing = rows.get(categoryId);
    if (existing) return existing;

    const row: ActivitySplit = {
      categoryId,
      name: categoryId ? (names.get(categoryId) ?? "Unknown") : "Uncategorised",
      openTasks: 0,
      completed: 0,
      minutes: null,
      share: 0,
    };
    rows.set(categoryId, row);
    return row;
  };

  // Seed every known category so a category with no activity shows as zero
  // rather than vanishing — "nothing happened here" is information.
  for (const category of options.categories) ensure(category.id);
  ensure(null);

  for (const task of options.tasks) {
    const row = ensure(task.categoryId);

    if (isOpen(task)) {
      row.openTasks += 1;
      continue;
    }

    if (task.completedAt) {
      const at = Date.parse(task.completedAt);
      if (Number.isFinite(at) && at >= weekStartMs && at <= nowMs) {
        row.completed += 1;
      }
    }
  }

  if (options.minutesByCategory) {
    for (const row of rows.values()) {
      const key = row.categoryId;
      row.minutes = key ? (options.minutesByCategory.get(key) ?? 0) : null;
    }
  }

  const list = [...rows.values()];

  // Share is of *time* where time is known, and of open task count otherwise.
  // Mixing the two in one column would be meaningless, so the basis follows
  // whichever the table can actually populate.
  const totalMinutes = list.reduce((sum, row) => sum + (row.minutes ?? 0), 0);
  const totalTasks = list.reduce((sum, row) => sum + row.openTasks, 0);

  for (const row of list) {
    const basis = totalMinutes > 0 ? totalMinutes : totalTasks;
    const value = totalMinutes > 0 ? (row.minutes ?? 0) : row.openTasks;
    row.share = basis > 0 ? Math.round((value / basis) * 1000) / 10 : 0;
  }

  return list.sort(
    (a, b) =>
      b.share - a.share ||
      b.openTasks - a.openTasks ||
      a.name.localeCompare(b.name),
  );
}

/* ── The next two days ────────────────────────────────────────────────── */

export interface TwoDayEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  isCancelled: boolean;
}

export interface TwoDaySlot {
  /** ISO instant the day starts at, in the owner's zone. */
  start: string;
  label: string;
  events: TwoDayEvent[];
  tasks: Task[];
}

export interface TwoDayOptions {
  tasks: readonly Task[];
  events: readonly TwoDayEvent[];
  now: Date;
  timeZone: string;
  days?: number;
}

/**
 * The next two days, meetings and deadlines interleaved by day.
 *
 * Deliberately one list per day rather than two parallel columns: the question
 * being answered is "what does Wednesday look like", and a calendar column
 * beside a task column makes you do the merge in your head.
 *
 * **Overdue work appears on the first day**, not in a separate section. It is
 * the most likely thing to derail the next two days, and a two-day preview
 * that omits it is describing a day you are not going to have.
 */
export function twoDayRollup(options: TwoDayOptions): TwoDaySlot[] {
  const days = options.days ?? 2;
  const { now, timeZone } = options;

  const slots: TwoDaySlot[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    const start = startOfDayIn(now, timeZone, offset);
    const end = startOfDayIn(now, timeZone, offset + 1);
    const startMs = start.getTime();
    const endMs = end.getTime();

    const events = options.events
      .filter((event) => {
        if (event.isCancelled) return false;
        const at = Date.parse(event.startsAt);
        return Number.isFinite(at) && at >= startMs && at < endMs;
      })
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

    const tasks = options.tasks
      .filter((task) => {
        if (!isOpen(task) || !task.dueAt) return false;
        const at = Date.parse(task.dueAt);
        if (!Number.isFinite(at)) return false;

        // Everything already late lands on today.
        if (offset === 0 && at < startMs) return true;
        return at >= startMs && at < endMs;
      })
      .sort(
        (a, b) =>
          Date.parse(a.dueAt!) - Date.parse(b.dueAt!) ||
          a.id.localeCompare(b.id),
      );

    slots.push({
      start: start.toISOString(),
      label: dayLabel(start, timeZone, offset),
      events,
      tasks,
    });
  }

  return slots;
}

function startOfDayIn(now: Date, timeZone: string, offset: number): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now.getTime() + offset * 86_400_000));

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  // Midnight in the owner's zone, expressed as an instant. Built from the
  // formatted local date rather than by arithmetic on UTC so a DST boundary
  // does not silently shift the day.
  const local = `${get("year")}-${get("month")}-${get("day")}T00:00:00`;
  const guess = new Date(`${local}Z`);
  const offsetMs = zoneOffset(guess, timeZone);

  return new Date(guess.getTime() - offsetMs);
}

function zoneOffset(instant: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(instant);

  const [date, time] = formatted.split(", ");
  const [month, day, year] = date.split("/");
  return (
    Date.parse(`${year}-${month}-${day}T${time.replace("24:", "00:")}Z`) -
    instant.getTime()
  );
}

function dayLabel(start: Date, timeZone: string, offset: number): string {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(start);
}
