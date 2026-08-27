"use client";

import { AnimatePresence } from "framer-motion";
import { Inbox, Keyboard } from "lucide-react";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useToast } from "@/components/ui/toast";
import {
  useCategories,
  useCreateTask,
  useDeleteTask,
  useTasks,
  useUpdateTask,
} from "@/lib/tasks/client";
import {
  ARCHIVE_AFTER_DAYS,
  countArchived,
  withoutArchived,
} from "@/lib/tasks/archive";
import type { CreateTaskPayload, UpdateTaskPayload } from "@/lib/tasks/schema";
import { useCaptureQueue } from "@/lib/tasks/use-capture-queue";
import { sortTasks } from "@/lib/tasks/sort";
import type { ActivityCategory, Task, TaskStatus } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

import { PendingCaptures } from "./pending-captures";
import { QuickAdd } from "./quick-add";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { TaskRow } from "./task-row";
import {
  focusedTaskId,
  useGlobalShortcuts,
  useRovingFocus,
} from "./use-list-keyboard";

// Stable empty arrays. A fresh `[]` on every render would give the quick-add
// box a new `categories` reference each time, which its re-parse effect reads
// as "the taxonomy just arrived".
const EMPTY_TASKS: Task[] = [];
const EMPTY_CATEGORIES: ActivityCategory[] = [];

type Filter = "open" | "all" | "done";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "all", label: "All" },
  { value: "done", label: "Done" },
];

export function TasksView() {
  const tasksQuery = useTasks("all");
  const categoriesQuery = useCategories();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const { toast, triggerShortcut } = useToast();
  const captureQueue = useCaptureQueue();

  const [filter, setFilter] = React.useState<Filter>("open");
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);

  const listRef = React.useRef<HTMLDivElement>(null);
  const moveFocus = useRovingFocus(listRef);

  const allTasks = tasksQuery.data ?? EMPTY_TASKS;
  const categories = categoriesQuery.data ?? EMPTY_CATEGORIES;

  // Arriving from a report's drill-down. The report names a problem; landing
  // on a list of forty rows and hunting for it again is most of the work the
  // link was supposed to save, so the task opens and scrolls itself into
  // view. Runs once per id: re-running on every render would fight anyone
  // who then collapsed it.
  const searchParams = useSearchParams();
  const requested = searchParams.get("task");
  const openedRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!requested || openedRef.current === requested) return;
    if (!allTasks.some((task) => task.id === requested)) return;

    openedRef.current = requested;
    setExpandedId(requested);
    document
      .querySelector(`[data-task-id="${requested}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [requested, allTasks]);

  /**
   * "Now" for the archive rule, resolved after mount.
   *
   * The server and the first client render must agree, and a clock read
   * during render cannot promise that. Until it lands nothing is archived,
   * which errs towards showing a task rather than hiding one.
   */
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
  }, []);

  const visible = React.useMemo(() => {
    const filtered = allTasks.filter((task) => {
      if (filter === "open") return task.status !== "done";
      if (filter === "done") return task.status === "done";
      return true;
    });
    // Finished work ages out of the list after a month. Nothing is deleted —
    // see `lib/tasks/archive.ts` for why this is a view rule and not a column.
    return sortTasks(now ? withoutArchived(filtered, now) : filtered);
  }, [allTasks, filter, now]);

  /** Hidden by the archive rule, so the list can say so rather than just be short. */
  const archivedCount = React.useMemo(
    () => (now ? countArchived(allTasks, now) : 0),
    [allTasks, now],
  );

  const openCount = allTasks.filter((task) => task.status !== "done").length;

  const handleCreate = React.useCallback(
    (payload: CreateTaskPayload) => {
      // Offline is known in advance, so skip a request that cannot succeed
      // and go straight to the queue.
      if (!captureQueue.online) {
        void captureQueue.enqueue(payload).then(() =>
          toast({
            title: "Saved on this device",
            description:
              "You're offline. It will be added as soon as you reconnect.",
            tone: "neutral",
          }),
        );
        return;
      }

      createTask.mutate(payload, {
        onError: (error) => {
          // The request failed, so the thought is currently nowhere. Queue it
          // rather than show an error and drop it — a capture box that loses
          // what you typed is worse than one that is slow.
          void captureQueue.enqueue(payload).then(() =>
            toast({
              title: "Saved on this device",
              description: `Couldn't reach the server (${error.message}). It will be added when the connection is back.`,
              tone: "neutral",
            }),
          );
        },
      });
    },
    [captureQueue, createTask, toast],
  );

  const handleUpdate = React.useCallback(
    (id: string, patch: UpdateTaskPayload) => {
      updateTask.mutate(
        { id, patch },
        {
          onError: (error) =>
            toast({
              title: "Couldn't save that change",
              description: error.message,
              tone: "danger",
            }),
        },
      );
    },
    [toast, updateTask],
  );

  /**
   * Complete, with a real undo.
   *
   * The previous status is captured before the mutation so reopening puts the
   * task back where it was rather than assuming Inbox.
   */
  const handleComplete = React.useCallback(
    (task: Task, completed: boolean) => {
      const previousStatus: TaskStatus = task.status;
      const nextStatus: TaskStatus = completed ? "done" : "inbox";

      handleUpdate(task.id, { status: nextStatus });

      if (completed) {
        toast({
          title: "Task completed",
          description: task.title,
          tone: "success",
          action: {
            label: "Undo",
            shortcut: "U",
            onAction: () =>
              handleUpdate(task.id, {
                status: previousStatus === "done" ? "inbox" : previousStatus,
              }),
          },
        });
      }
    },
    [handleUpdate, toast],
  );

  const handleDelete = React.useCallback(
    (task: Task) => {
      deleteTask.mutate(task.id, {
        onError: (error) =>
          toast({
            title: "Couldn't delete that task",
            description: error.message,
            tone: "danger",
          }),
      });
      toast({ title: "Task deleted", description: task.title });
    },
    [deleteTask, toast],
  );

  const focusQuickAdd = React.useCallback((event: KeyboardEvent) => {
    event.preventDefault();
    document.getElementById("quick-add-input")?.focus();
  }, []);

  const withFocusedTask = React.useCallback(
    (action: (task: Task) => void) => (event: KeyboardEvent) => {
      const id = focusedTaskId(listRef.current);
      if (!id) return;
      const task = allTasks.find((item) => item.id === id);
      if (!task) return;
      event.preventDefault();
      action(task);
    },
    [allTasks],
  );

  useGlobalShortcuts({
    n: focusQuickAdd,
    "/": focusQuickAdd,
    j: (event) => {
      event.preventDefault();
      moveFocus(1);
    },
    ArrowDown: (event) => {
      if (focusedTaskId(listRef.current)) {
        event.preventDefault();
        moveFocus(1);
      }
    },
    k: (event) => {
      event.preventDefault();
      moveFocus(-1);
    },
    ArrowUp: (event) => {
      if (focusedTaskId(listRef.current)) {
        event.preventDefault();
        moveFocus(-1);
      }
    },
    x: withFocusedTask((task) => handleComplete(task, task.status !== "done")),
    e: withFocusedTask((task) =>
      setExpandedId((current) => (current === task.id ? null : task.id)),
    ),
    p: withFocusedTask((task) =>
      handleUpdate(task.id, { pinned: !task.pinned }),
    ),
    u: (event) => {
      if (triggerShortcut("U")) event.preventDefault();
    },
    "?": (event) => {
      event.preventDefault();
      setShortcutsOpen(true);
    },
    Escape: () => setExpandedId(null),
  });

  return (
    <div className="space-y-4">
      <QuickAdd
        categories={categories}
        onCreate={handleCreate}
        pending={createTask.isPending}
      />

      <PendingCaptures />

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Filter tasks"
          className="inline-flex rounded-md border border-line p-0.5"
        >
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={cn(
                "rounded-sm px-3 py-1 text-xs font-medium transition-colors duration-fast",
                filter === option.value
                  ? "bg-primary text-primary-fg"
                  : "text-fg-muted hover:bg-surface-muted hover:text-fg",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-fg-muted" aria-live="polite">
          {openCount} open
        </p>

        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => setShortcutsOpen(true)}
        >
          <Keyboard />
          Shortcuts
          <Kbd aria-hidden="true">?</Kbd>
        </Button>
      </div>

      <div ref={listRef}>
        {tasksQuery.isPending ? (
          <ul className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <li
                key={index}
                className="h-16 animate-pulse rounded-lg border border-line bg-surface-muted"
              />
            ))}
          </ul>
        ) : tasksQuery.isError ? (
          <p role="alert" className="text-sm text-danger">
            Couldn&apos;t load your tasks: {tasksQuery.error.message}
          </p>
        ) : visible.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <ul className="space-y-2" data-testid="task-list">
            <AnimatePresence initial={false}>
              {visible.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  categories={categories}
                  expanded={expandedId === task.id}
                  onToggleExpanded={() =>
                    setExpandedId((current) =>
                      current === task.id ? null : task.id,
                    )
                  }
                  onUpdate={(patch) => handleUpdate(task.id, patch)}
                  onComplete={(completed) => handleComplete(task, completed)}
                  onDelete={() => handleDelete(task)}
                  onRefuseStatus={(reason) =>
                    toast({
                      title: "Can't change status",
                      description: reason,
                      tone: "danger",
                    })
                  }
                  tabIndex={0}
                  onFocus={() => undefined}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}

        {/* Said out loud rather than left as a mysteriously short list. A
            filter that silently removes rows is indistinguishable from data
            loss, which is the one thing a task list must never look like. */}
        {archivedCount > 0 && filter !== "open" ? (
          <p
            className="mt-3 text-xs text-fg-muted"
            data-testid="tasks-archived-note"
          >
            {archivedCount} completed{" "}
            {archivedCount === 1 ? "task is" : "tasks are"} archived — finished
            more than {ARCHIVE_AFTER_DAYS} days ago. Nothing is deleted; they
            still count in your reports.
          </p>
        ) : null}
      </div>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  return (
    <div
      data-testid="tasks-empty"
      className="rounded-lg border border-dashed border-line-strong px-6 py-10 text-center"
    >
      <Inbox aria-hidden="true" className="mx-auto size-6 text-fg-subtle" />
      <p className="mt-3 text-sm font-medium text-fg">
        {filter === "done" ? "Nothing completed yet" : "Nothing on your list"}
      </p>
      <p className="mt-1 text-xs text-fg-muted">
        {filter === "done"
          ? "Completed tasks collect here."
          : "Capture the first one above — press N from anywhere."}
      </p>
    </div>
  );
}
