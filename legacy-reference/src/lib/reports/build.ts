/**
 * Assembling a report.
 *
 * The single place the on-screen report, the print view and every digest get
 * their numbers. One function, three consumers — which is the only way the
 * page you print and the email you receive can be guaranteed to agree.
 */

import { getConnectorRepository } from "@/lib/connectors/repository";
import { totalsFor, type HoursInterval } from "@/lib/hours/aggregate";
import { getHoursRepository, toIntervals } from "@/lib/hours/repository";
import {
  getPriorityRepository,
  scoringWindow,
} from "@/lib/priority/repository";
import { rankTasks } from "@/lib/priority/rank";
import { getTaskRepository } from "@/lib/tasks/repository";
import type { ActivityCategory, Task } from "@/lib/tasks/types";
import { addZonedDays, startOfZonedWeek } from "@/lib/time/zone";

import { contextChanges, type ContextChange } from "./context";
import {
  applyFilters,
  groupForReport,
  type GroupedTasks,
  type ReportFilters,
} from "./group";
import {
  activitySplits,
  buildSummary,
  twoDayRollup,
  type ActivitySplit,
  type ExecutiveSummary,
  type TwoDayEvent,
  type TwoDaySlot,
} from "./summary";

export interface ReportData {
  generatedAt: string;
  timeZone: string;
  summary: ExecutiveSummary;
  groups: GroupedTasks[];
  splits: ActivitySplit[];
  twoDay: TwoDaySlot[];
  categories: ActivityCategory[];
  /** How many tasks the filters removed, so the report can say so. */
  filteredOut: number;
  /**
   * External context that changed recently.
   *
   * Empty when nothing is connected, which is a valid configuration rather
   * than a failure — the section simply does not appear.
   */
  contextChanges: ContextChange[];
}

export interface BuildOptions {
  timeZone: string;
  now?: Date;
  /**
   * How far back "what moved elsewhere" looks. Defaults to a day, which is
   * the interval the daily brief actually covers.
   */
  contextSince?: Date;
  filters?: ReportFilters;
  includeDone?: boolean;
}

/**
 * Gathers everything a report needs.
 *
 * Each source degrades independently: no hours module data means the hours
 * figure is `null` rather than zero, and no calendar means an empty two-day
 * preview rather than a failed report. A report that refuses to render because
 * one of five inputs is unavailable is less useful than one that renders four.
 */
export async function buildReport(options: BuildOptions): Promise<ReportData> {
  const now = options.now ?? new Date();
  const { timeZone } = options;

  const weekStart = startOfZonedWeek(now, timeZone);
  const weekEnd = addZonedDays(weekStart, timeZone, 7);

  const taskRepo = await getTaskRepository();
  const [tasks, categories] = await Promise.all([
    taskRepo.listTasks({ scope: "all", limit: 500 }),
    taskRepo.listCategories(),
  ]);

  const [hours, ranked, events, contextChanges] = await Promise.all([
    loadHours(weekStart, weekEnd),
    loadRanking(tasks, now),
    loadEvents(now, timeZone),
    loadContextChanges(now, options.contextSince),
  ]);

  const filtered = applyFilters(tasks, options.filters);

  return {
    generatedAt: now.toISOString(),
    timeZone,
    summary: buildSummary({
      // The summary always describes *everything*, not the filtered view.
      // "3 overdue" meaning "3 overdue among the ones you're looking at" is a
      // number that changes when you change a dropdown, which is not what an
      // executive summary is for.
      tasks,
      now,
      timeZone,
      weekStart,
      hours: hours.totals,
      rankedIds: ranked,
    }),
    groups: groupForReport(filtered, {
      now,
      timeZone,
      includeDone: options.includeDone,
    }),
    splits: activitySplits({
      tasks: filtered,
      categories,
      minutesByCategory: hours.byCategory,
      weekStart,
      now,
    }),
    twoDay: twoDayRollup({ tasks: filtered, events, now, timeZone }),
    categories,
    filteredOut: tasks.length - filtered.length,
    contextChanges,
  };
}

/**
 * External context that moved, or nothing at all.
 *
 * Wrapped in a try/catch for the same reason `loadHours` is: a connector
 * problem must degrade this section, not take the whole report with it. A
 * dashboard that refuses to render because GitHub is down is worse than one
 * that renders without the GitHub part.
 */
async function loadContextChanges(
  now: Date,
  since: Date | undefined,
): Promise<ContextChange[]> {
  try {
    const repo = await getConnectorRepository();
    // A day back by default: the brief is daily, so "since the last one" is
    // the question being asked.
    const from = since ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const links = await repo.changedSince(from, 50);

    return contextChanges({ links, since: from });
  } catch {
    return [];
  }
}

async function loadHours(from: Date, to: Date) {
  try {
    const repo = await getHoursRepository();
    const [entries, blocks] = await Promise.all([
      repo.listTimeEntries({ from, to }),
      repo.listScheduledBlocks({ from, to }),
    ]);

    const intervals: HoursInterval[] = toIntervals(entries, blocks);

    const byCategory = new Map<string, number>();
    for (const interval of intervals) {
      if (!interval.categoryId) continue;
      const minutes = Math.max(
        0,
        Math.round(
          (Date.parse(interval.endedAt) - Date.parse(interval.startedAt)) /
            60_000,
        ),
      );
      byCategory.set(
        interval.categoryId,
        (byCategory.get(interval.categoryId) ?? 0) + minutes,
      );
    }

    return {
      totals: intervals.length > 0 ? totalsFor(intervals) : null,
      byCategory: byCategory.size > 0 ? byCategory : undefined,
    };
  } catch {
    // The hours module being unavailable makes one figure unknown, not the
    // whole report impossible.
    return { totals: null, byCategory: undefined };
  }
}

async function loadRanking(
  tasks: readonly Task[],
  now: Date,
): Promise<string[]> {
  try {
    const repo = await getPriorityRepository();
    const events = await repo.eventsInWindow(scoringWindow(now));
    return rankTasks({ tasks, events, now }).map((item) => item.task.id);
  } catch {
    // The summary falls back to overdue-then-dated ordering.
    return [];
  }
}

async function loadEvents(now: Date, timeZone: string): Promise<TwoDayEvent[]> {
  try {
    const repo = await getPriorityRepository();
    const from = new Date(now.getTime() - 3_600_000);
    const to = addZonedDays(now, timeZone, 3);

    const events = await repo.eventsInWindow({ from, to });

    return [...events.values()].map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      isCancelled: event.isCancelled,
    }));
  } catch {
    return [];
  }
}
