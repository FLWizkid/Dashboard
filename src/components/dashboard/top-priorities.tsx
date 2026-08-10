"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ListChecks } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { CompleteButton } from "@/components/tasks/complete-button";
import {
  DueDate,
  PinIndicator,
  PriorityBadge,
  ReadyBadge,
} from "@/components/tasks/task-meta";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { riseIn, staggerList } from "@/lib/motion";
import { useRanking } from "@/lib/priority/client";
import { WhyLine, WhyPanel } from "@/components/priority/why-panel";
import { useTasks, useUpdateTask } from "@/lib/tasks/client";
import { isOverdue, topPriorities } from "@/lib/tasks/sort";
import type { Task } from "@/lib/tasks/types";

/**
 * The dashboard's live task card.
 *
 * Completion works here too — the whole point of the top section is that the
 * owner can run their day from it without navigating anywhere.
 *
 * Ordered by the **priority engine** when it has answered, and by the Phase 1
 * manual comparator until then. Falling back rather than blocking is
 * deliberate: a card that shows nothing while a score is computed is worse
 * than one that shows a slightly different order for half a second, and the
 * two orderings agree about the obvious cases anyway.
 */
export function TopPriorities({ limit = 5 }: { limit?: number }) {
  const reduced = useReducedMotion();
  const tasksQuery = useTasks("open");
  const updateTask = useUpdateTask();
  const { toast } = useToast();

  const ranking = useRanking();

  const byTaskId = React.useMemo(
    () => new Map((ranking.data?.ranked ?? []).map((row) => [row.taskId, row])),
    [ranking.data],
  );

  const tasks = React.useMemo(() => {
    const open = (tasksQuery.data ?? []).filter((t) => t.status !== "done");
    const ranked = ranking.data?.ranked;

    if (!ranked || ranked.length === 0) {
      return topPriorities(tasksQuery.data ?? [], limit);
    }

    // The engine has already decided the order; this just projects it back
    // onto the task objects the card renders.
    const position = new Map(ranked.map((row, index) => [row.taskId, index]));
    return open
      .filter((task) => position.has(task.id))
      .sort((a, b) => position.get(a.id)! - position.get(b.id)!)
      .slice(0, limit);
  }, [limit, tasksQuery.data, ranking.data]);

  const openCount = (tasksQuery.data ?? []).length;

  function complete(task: Task) {
    const previousStatus = task.status;
    updateTask.mutate({ id: task.id, patch: { status: "done" } });
    toast({
      title: "Task completed",
      description: task.title,
      tone: "success",
      action: {
        label: "Undo",
        shortcut: "U",
        onAction: () =>
          updateTask.mutate({ id: task.id, patch: { status: previousStatus } }),
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <ListChecks aria-hidden="true" className="size-4 text-fg-subtle" />
            Top priorities
          </CardTitle>
          <CardDescription className="mt-1">
            {tasksQuery.isPending
              ? "Loading…"
              : openCount === 0
                ? "Nothing open."
                : `${openCount} open · showing the top ${Math.min(limit, openCount)}`}
          </CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/tasks">
            All tasks
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </CardHeader>

      <CardContent>
        {tasksQuery.isPending ? (
          <ul className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <li
                key={index}
                className="h-10 animate-pulse rounded-md bg-surface-muted"
              />
            ))}
          </ul>
        ) : tasksQuery.isError ? (
          <p role="alert" className="text-sm text-danger">
            Couldn&apos;t load your tasks: {tasksQuery.error.message}
          </p>
        ) : tasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-line-strong px-4 py-6 text-center">
            <p className="text-sm text-fg-muted">Your list is clear.</p>
            <Button asChild variant="link" size="sm" className="mt-1">
              <Link href="/dashboard/tasks">Capture something</Link>
            </Button>
          </div>
        ) : (
          <motion.ul
            variants={staggerList(reduced)}
            initial="hidden"
            animate="visible"
            className="space-y-1"
            data-testid="top-priorities-list"
          >
            <AnimatePresence initial={false}>
              {tasks.map((task) => (
                <motion.li
                  key={task.id}
                  layout={!reduced}
                  variants={riseIn(reduced)}
                  exit="exit"
                  className="flex items-start gap-3 rounded-md px-1 py-1.5"
                >
                  <CompleteButton
                    completed={false}
                    size="sm"
                    label={task.title}
                    onToggle={() => complete(task)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-fg">{task.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <PinIndicator pinned={task.pinned} />
                      <PriorityBadge priority={task.priority} />
                      {task.dueAt ? (
                        <DueDate dueAt={task.dueAt} overdue={isOverdue(task)} />
                      ) : null}
                      <ReadyBadge task={task} />
                      {byTaskId.get(task.id) && (
                        <WhyLine row={byTaskId.get(task.id)!} />
                      )}
                    </div>
                    {byTaskId.get(task.id) && (
                      <WhyPanel row={byTaskId.get(task.id)!} />
                    )}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </CardContent>
    </Card>
  );
}
