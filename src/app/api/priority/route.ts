import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { detectSuggestions } from "@/lib/priority/suggest";
import { explain, rankTasks } from "@/lib/priority/rank";
import {
  decidedKeys,
  getPriorityRepository,
  scoringWindow,
} from "@/lib/priority/repository";
import { getTaskRepository } from "@/lib/tasks/repository";

export const dynamic = "force-dynamic";

/**
 * The ranked list, with its explanations.
 *
 * Computed here rather than in the browser for the same reason the hours
 * rollup is: the dashboard, the task list and the Phase 6 digest must produce
 * the same order from the same code, and a phone shouldn't download two weeks
 * of calendar to sort five tasks.
 *
 * Detection runs on the same request. It is cheap — a word-overlap check over
 * the tasks and events already in memory — and doing it here means a new
 * meeting produces its question the next time the owner looks at their list,
 * with no background job to fail silently.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const now = new Date();
  const window = scoringWindow(now);
  const includeDone =
    request.nextUrl.searchParams.get("includeDone") === "true";

  try {
    const [tasks, priority] = await Promise.all([
      getTaskRepository().then((repo) =>
        repo.listTasks({ scope: "all", limit: 200 }),
      ),
      getPriorityRepository(),
    ]);

    const [events, existing] = await Promise.all([
      priority.eventsInWindow(window),
      priority.listSuggestions(),
    ]);

    const ranked = rankTasks({ tasks, events, now, includeDone });

    const fresh = detectSuggestions({
      tasks,
      events: [...events.values()],
      now,
      decided: decidedKeys(existing),
    });

    // Only ones we haven't already asked about.
    const asked = new Set(
      existing.map((s) => `${s.taskId}:${s.eventId}:${s.kind}`),
    );
    const unasked = fresh.filter(
      (s) => !asked.has(`${s.taskId}:${s.eventId}:${s.kind}`),
    );

    if (unasked.length > 0) {
      await priority.recordSuggestions(unasked);
    }

    const pending = [
      ...existing,
      ...unasked.map((s) => ({
        ...s,
        id: "",
        state: "pending" as const,
        createdAt: now.toISOString(),
        createdNoteId: null,
      })),
    ].filter((s) => s.state === "pending");

    return NextResponse.json({
      ranked: ranked.map((item) => ({
        taskId: item.task.id,
        total: item.score.total,
        overridden: item.score.overridden,
        manualRank: item.score.manualRank,
        summary: item.summary,
        explanation: explain(item),
        drivingEventId: item.drivingEvent?.id ?? null,
        drivingEventTitle: item.drivingEvent?.title ?? null,
        drivingRelation: item.drivingRelation,
      })),
      suggestions: await priority
        .listSuggestions()
        .then((all) => all.filter((s) => s.state === "pending")),
      pendingCount: pending.length,
      computedAt: now.toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
