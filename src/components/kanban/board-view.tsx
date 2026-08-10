"use client";

import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { ArrowRight, Inbox } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  canMoveTo,
  groupIntoLanes,
  LANES,
  LANE_DESCRIPTIONS,
  LANE_LABELS,
  laneAfterMove,
  triageSuggestions,
} from "@/lib/kanban/board";
import { useTasks, useUpdateTask } from "@/lib/tasks/client";
import { describeMissingReadyFields } from "@/lib/tasks/ready";
import { sortTasks } from "@/lib/tasks/sort";
import { PRIORITY_LABELS, type Task, type TaskStatus } from "@/lib/tasks/types";
import { formatDueDate } from "@/lib/time/format";
import { useSettings } from "@/components/settings-provider";
import { cn } from "@/lib/utils";

const EMPTY: Task[] = [];

/**
 * The board.
 *
 * ── On drag and drop ─────────────────────────────────────────────────────
 * Dragging is an enhancement layered on top of a keyboard interaction that is
 * complete on its own: focus a card, press ← or → to move it a lane. That
 * order matters. A board where dragging is the only way to move a card is
 * unusable with a keyboard, unusable with a screen reader, and unusable on a
 * phone — and this product is meant to work in all three.
 *
 * Every move goes through `canMoveTo`, so the Inbox → Ready gate is enforced
 * identically whether the card was dragged, keyed or clicked.
 */
export function BoardView() {
  const tasksQuery = useTasks("all");
  const updateTask = useUpdateTask();
  const { toast } = useToast();
  const { timeZone } = useSettings();
  const reduceMotion = useReducedMotion();

  // One instant for the whole render, so every card's "Tomorrow" agrees.
  const [now] = React.useState(() => new Date());
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState<TaskStatus | null>(null);

  const tasks = tasksQuery.data ?? EMPTY;
  const lanes = React.useMemo(() => groupIntoLanes(tasks, sortTasks), [tasks]);

  const move = React.useCallback(
    (task: Task, target: TaskStatus) => {
      if (task.status === target) return;

      const verdict = canMoveTo(task, target);
      if (!verdict.allowed) {
        // Refusing silently would look like a broken drag. Say what is missing.
        toast({
          title: `Can't move to ${LANE_LABELS[target]}`,
          description: verdict.missing ?? verdict.reason ?? undefined,
          tone: "danger",
        });
        return;
      }

      updateTask.mutate(
        { id: task.id, patch: { status: target } },
        {
          onError: (error) =>
            toast({
              title: "Couldn't move that card",
              description: error.message,
              tone: "danger",
            }),
        },
      );
    },
    [toast, updateTask],
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent, task: Task) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      event.preventDefault();
      move(
        task,
        laneAfterMove(task.status, event.key === "ArrowRight" ? 1 : -1),
      );
    },
    [move],
  );

  if (tasksQuery.isPending) {
    return (
      <div
        className="grid gap-4 md:grid-cols-3 xl:grid-cols-5"
        aria-busy="true"
      >
        {LANES.map((lane) => (
          <div
            key={lane}
            className="h-64 animate-pulse rounded-lg border border-line bg-surface-muted"
          />
        ))}
      </div>
    );
  }

  if (tasksQuery.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        Couldn&apos;t load the board: {tasksQuery.error.message}
      </p>
    );
  }

  return (
    <div
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-5"
      data-testid="kanban-board"
    >
      {lanes.map((lane) => (
        <section
          key={lane.status}
          aria-labelledby={`lane-${lane.status}`}
          data-testid={`lane-${lane.status}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(lane.status);
          }}
          onDragLeave={() =>
            setDragOver((current) => (current === lane.status ? null : current))
          }
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(null);
            const id = event.dataTransfer.getData("text/plain") || dragging;
            const task = tasks.find((candidate) => candidate.id === id);
            if (task) move(task, lane.status);
          }}
          className={cn(
            "flex min-h-[12rem] flex-col rounded-lg border border-line bg-surface p-3 transition-colors duration-fast",
            dragOver === lane.status && "border-primary bg-primary-soft",
          )}
        >
          <header className="mb-3 flex items-baseline justify-between gap-2">
            <h2
              id={`lane-${lane.status}`}
              className="text-sm font-semibold text-fg"
            >
              {lane.label}
            </h2>
            <span className="text-xs tabular-nums text-fg-muted">
              {lane.tasks.length}
            </span>
          </header>

          <p className="sr-only">{LANE_DESCRIPTIONS[lane.status]}</p>

          <ul className="flex flex-1 flex-col gap-2">
            <AnimatePresence initial={false}>
              {lane.tasks.map((task) => (
                <m.li
                  key={task.id}
                  layout={!reduceMotion}
                  initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0 }}
                >
                  <Card
                    task={task}
                    timeZone={timeZone}
                    now={now}
                    onKeyDown={(event) => handleKeyDown(event, task)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", task.id);
                      setDragging(task.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    onMove={(target) => move(task, target)}
                  />
                </m.li>
              ))}
            </AnimatePresence>

            {lane.tasks.length === 0 ? (
              <li className="flex flex-1 items-center justify-center rounded-md border border-dashed border-line-strong p-4 text-center">
                <span className="text-xs text-fg-muted">
                  {lane.status === "inbox"
                    ? "Everything you capture lands here."
                    : "Nothing here."}
                </span>
              </li>
            ) : null}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Card({
  task,
  timeZone,
  now,
  onKeyDown,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  task: Task;
  timeZone: string;
  now: Date;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onMove: (target: TaskStatus) => void;
}) {
  const suggestions = triageSuggestions(task);
  const promote = suggestions.find(
    (suggestion) => suggestion.action === "promote",
  );
  const missing = describeMissingReadyFields(task);

  return (
    <article
      draggable
      tabIndex={0}
      data-testid="kanban-card"
      onKeyDown={onKeyDown}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      // The instruction is on the card itself, so it is discoverable by
      // keyboard users and announced by screen readers rather than hidden in
      // a shortcuts sheet.
      aria-label={`${task.title}. In ${LANE_LABELS[task.status]}. Use left and right arrow keys to move between lanes.`}
      className="cursor-grab rounded-md border border-line bg-surface-raised p-3 text-left shadow-sm transition-colors duration-fast hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing"
    >
      <p className="text-sm font-medium text-fg">{task.title}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {task.priority ? (
          <Badge tone={task.priority}>{PRIORITY_LABELS[task.priority]}</Badge>
        ) : (
          <Badge tone="outline">Untriaged</Badge>
        )}

        {task.dueAt ? (
          <span className="text-xs text-fg-muted">
            {formatDueDate(task.dueAt, now, timeZone)}
          </span>
        ) : null}
      </div>

      {missing && task.status === "inbox" ? (
        <p className="mt-2 text-xs text-fg-muted">{missing}</p>
      ) : null}

      {promote ? (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 -ml-2"
          onClick={() => onMove("ready")}
          title={promote.reason}
        >
          Promote to Ready
          <ArrowRight aria-hidden="true" />
        </Button>
      ) : null}
    </article>
  );
}

export function BoardEmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
      <Inbox aria-hidden="true" className="mx-auto size-6 text-fg-subtle" />
      <p className="mt-3 text-sm font-medium text-fg">Nothing on the board</p>
      <p className="mt-1 text-xs text-fg-muted">
        Capture something on the Tasks page and it will land in Inbox.
      </p>
    </div>
  );
}
