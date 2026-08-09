"use client";

import { AnimatePresence } from "framer-motion";
import { Inbox, Keyboard } from "lucide-react";
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
import type { CreateTaskPayload, UpdateTaskPayload } from "@/lib/tasks/schema";
import { sortTasks } from "@/lib/tasks/sort";
import type { ActivityCategory, Task, TaskStatus } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

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

  const [filter, setFilter] = React.useState<Filter>("open");
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);

  const listRef = React.useRef<HTMLDivElement>(null);
  const moveFocus = useRovingFocus(listRef);

  const allTasks = tasksQuery.data ?? EMPTY_TASKS;
  const categories = categoriesQuery.data ?? EMPTY_CATEGORIES;

  const visible = React.useMemo(() => {
    const filtered = allTasks.filter((task) => {
      if (filter === "open") return task.status !== "done";
      if (filter === "done") return task.status === "done";
      return true;
    });
    return sortTasks(filtered);
  }, [allTasks, filter]);

  const openCount = allTasks.filter((task) => task.status !== "done").length;

  const handleCreate = React.useCallback(
    (payload: CreateTaskPayload) => {
      createTask.mutate(payload, {
        onError: (error) =>
          toast({
            title: "Couldn't add that task",
            description: error.message,
            tone: "danger",
          }),
      });
    },
    [createTask, toast],
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
