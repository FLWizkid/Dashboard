"use client";

import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { ChevronDown, Link2, Pin, PinOff, Trash2 } from "lucide-react";
import * as React from "react";

import { useSettings } from "@/components/settings-provider";
import { ContextPanel } from "@/components/connectors/context-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { canMoveTo } from "@/lib/kanban/board";
import { DURATION, EASE } from "@/lib/motion";
import type { UpdateTaskPayload } from "@/lib/tasks/schema";
import { isProvisionalTask } from "@/lib/tasks/client";
import { isOverdue } from "@/lib/tasks/sort";
import {
  LINK_RELATION_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type ActivityCategory,
  type Task,
  type TaskStatus,
} from "@/lib/tasks/types";
import { toDateTimeLocalValue } from "@/lib/time/format";
import { zonedTimeToUtc } from "@/lib/time/zone";
import { cn } from "@/lib/utils";

import { CompleteButton } from "./complete-button";
import { DueDate, PinIndicator, PriorityBadge, ReadyBadge } from "./task-meta";

/**
 * Parse the value of a `datetime-local` input as wall-clock time in the
 * owner's zone. The browser's own zone is irrelevant and must not leak in.
 */
function localInputToIso(value: string, timeZone: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;

  return zonedTimeToUtc(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: 0,
    },
    timeZone,
  ).toISOString();
}

export interface TaskRowProps {
  task: Task;
  categories: ActivityCategory[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onUpdate: (patch: UpdateTaskPayload) => void;
  onComplete: (completed: boolean) => void;
  onDelete: () => void;
  /** Called when a status change is refused, with the reason. */
  onRefuseStatus?: (reason: string) => void;
  /** Roving tabindex: only the focused row is in the tab order. */
  tabIndex: number;
  onFocus: () => void;
}

export const TaskRow = React.forwardRef<HTMLLIElement, TaskRowProps>(
  function TaskRow(
    {
      task,
      categories,
      expanded,
      onToggleExpanded,
      onUpdate,
      onComplete,
      onDelete,
      onRefuseStatus,
      tabIndex,
      onFocus,
    },
    ref,
  ) {
    const reduced = useReducedMotion();
    const { timeZone } = useSettings();
    const completed = task.status === "done";
    const overdue = isOverdue(task);
    const detailsId = `task-details-${task.id}`;

    const category = categories.find((item) => item.id === task.categoryId);
    const confirmedLinks = task.links.filter((link) => link.confirmedAt);
    // An optimistic row the server has not confirmed yet. Visible, inert,
    // and gone without ceremony the moment the real row replaces it.
    const provisional = isProvisionalTask(task);

    return (
      <m.li
        ref={ref}
        layout={!reduced}
        initial={reduced ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={
          reduced || provisional
            ? { opacity: 0, transition: { duration: 0 } }
            : {
                opacity: 0,
                height: 0,
                marginBottom: 0,
                transition: { duration: DURATION.slow, ease: EASE.out },
              }
        }
        transition={{ duration: reduced ? 0 : DURATION.base, ease: EASE.out }}
        data-task-id={task.id}
        data-testid="task-row"
        className={cn(
          "group overflow-hidden rounded-lg border bg-surface-raised",
          "transition-colors duration-base ease-standard",
          completed
            ? "border-line opacity-60"
            : "border-line hover:border-line-strong",
          task.pinned && !completed ? "border-l-2 border-l-accent-bright" : "",
        )}
      >
        <div
          // No tabindex at all while provisional, rather than -1: a
          // tabindex="-1" is still a tabindex, and anything auditing the page
          // for interactive targets (the headset raycast check, for one) will
          // measure a row that is on its way out.
          tabIndex={provisional ? undefined : tabIndex}
          onFocus={onFocus}
          data-task-focusable={provisional ? undefined : "true"}
          aria-label={task.title}
          aria-busy={provisional || undefined}
          className="flex items-start gap-3 rounded-lg p-3"
        >
          <CompleteButton
            completed={completed}
            disabled={provisional}
            onToggle={onComplete}
            label={task.title}
            className="mt-0.5"
          />

          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onToggleExpanded}
              aria-expanded={expanded}
              aria-controls={detailsId}
              className="flex w-full items-start gap-2 text-left"
            >
              <span
                className={cn(
                  "min-w-0 flex-1 text-sm text-fg",
                  completed ? "text-fg-muted line-through" : "",
                )}
              >
                {task.title}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-4 shrink-0 text-fg-subtle transition-transform duration-base ease-standard",
                  expanded ? "rotate-180" : "",
                )}
              />
              <span className="sr-only">
                {expanded ? "Hide details" : "Show details"}
              </span>
            </button>

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <PinIndicator pinned={task.pinned} />
              <PriorityBadge priority={task.priority} />
              {task.dueAt ? (
                <DueDate dueAt={task.dueAt} overdue={overdue} />
              ) : null}
              {category ? <Badge tone="neutral">{category.name}</Badge> : null}
              {confirmedLinks.map((link) => (
                <Badge key={link.id} tone="accent" title={link.targetLabel}>
                  <Link2 aria-hidden="true" />
                  {LINK_RELATION_LABELS[link.relation]}: {link.targetLabel}
                </Badge>
              ))}
              {completed ? null : <ReadyBadge task={task} />}
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onUpdate({ pinned: !task.pinned })}
            aria-pressed={task.pinned}
            aria-label={
              task.pinned ? `Unpin ${task.title}` : `Pin ${task.title}`
            }
            className={cn(
              "mt-0.5 shrink-0",
              task.pinned
                ? "text-accent"
                : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
            )}
          >
            {task.pinned ? <PinOff /> : <Pin />}
          </Button>
        </div>

        <AnimatePresence initial={false}>
          {expanded ? (
            <m.div
              id={detailsId}
              key="details"
              initial={reduced ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{
                duration: reduced ? 0 : DURATION.base,
                ease: EASE.out,
              }}
              className="overflow-hidden border-t border-line"
            >
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor={`${task.id}-title`}>Title</Label>
                  <Input
                    id={`${task.id}-title`}
                    defaultValue={task.title}
                    maxLength={500}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value && value !== task.title) {
                        onUpdate({ title: value });
                      } else if (!value) {
                        event.target.value = task.title;
                      }
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`${task.id}-priority`}>Priority</Label>
                  <Select
                    id={`${task.id}-priority`}
                    value={task.priority ?? ""}
                    onChange={(event) =>
                      onUpdate({
                        priority:
                          event.target.value === ""
                            ? null
                            : (event.target
                                .value as (typeof TASK_PRIORITIES)[number]),
                      })
                    }
                  >
                    <option value="">Untriaged</option>
                    {TASK_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {PRIORITY_LABELS[priority]}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`${task.id}-status`}>Status</Label>
                  {/*
                    The same field the Kanban lane is. Editing it here moves
                    the card, and moving the card changes it here — because
                    the board is a view of this column, not a second record.
                  */}
                  <Select
                    id={`${task.id}-status`}
                    value={task.status}
                    onChange={(event) => {
                      const next = event.target.value as TaskStatus;
                      const verdict = canMoveTo(task, next);
                      if (!verdict.allowed) {
                        onRefuseStatus?.(
                          verdict.missing ?? verdict.reason ?? "Not allowed",
                        );
                        return;
                      }
                      onUpdate({ status: next });
                    }}
                  >
                    {TASK_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`${task.id}-due`}>Due</Label>
                  <Input
                    id={`${task.id}-due`}
                    type="datetime-local"
                    defaultValue={
                      task.dueAt
                        ? toDateTimeLocalValue(task.dueAt, timeZone)
                        : ""
                    }
                    onChange={(event) =>
                      onUpdate({
                        dueAt: localInputToIso(event.target.value, timeZone),
                      })
                    }
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`${task.id}-category`}>Category</Label>
                  <Select
                    id={`${task.id}-category`}
                    value={task.categoryId ?? ""}
                    onChange={(event) =>
                      onUpdate({
                        categoryId: event.target.value || null,
                      })
                    }
                  >
                    <option value="">No category</option>
                    {categories.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`${task.id}-owner`}>Owner (optional)</Label>
                  <Input
                    id={`${task.id}-owner`}
                    defaultValue={task.owner ?? ""}
                    maxLength={120}
                    placeholder="You"
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value !== (task.owner ?? "")) {
                        onUpdate({ owner: value || null });
                      }
                    }}
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor={`${task.id}-notes`}>Notes</Label>
                  <Textarea
                    id={`${task.id}-notes`}
                    defaultValue={task.notes ?? ""}
                    maxLength={20_000}
                    onBlur={(event) => {
                      const value = event.target.value;
                      if (value !== (task.notes ?? "")) {
                        onUpdate({ notes: value || null });
                      }
                    }}
                  />
                </div>

                {task.links.length > 0 ? (
                  <div className="space-y-1 sm:col-span-2">
                    <Label>Links</Label>
                    <ul className="space-y-1">
                      {task.links.map((link) => (
                        <li
                          key={link.id}
                          className="flex items-center gap-2 text-xs text-fg-muted"
                        >
                          <Link2 aria-hidden="true" className="size-3" />
                          <span>
                            {LINK_RELATION_LABELS[link.relation]}:{" "}
                            {link.targetLabel}
                          </span>
                          {link.confirmedAt ? null : (
                            <Badge tone="outline">Unconfirmed</Badge>
                          )}
                          {link.targetId ? null : (
                            <Badge tone="outline">
                              Resolves when calendar connects
                            </Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* External context. Rendered only while the row is
                    expanded, so a long list does not fetch links for every
                    task on screen. */}
                <div className="sm:col-span-2">
                  <ContextPanel taskId={task.id} />
                </div>

                <div className="sm:col-span-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onDelete}
                    className="text-danger hover:bg-priority-critical-soft hover:text-priority-critical"
                  >
                    <Trash2 />
                    Delete task
                  </Button>
                </div>
              </div>
            </m.div>
          ) : null}
        </AnimatePresence>
      </m.li>
    );
  },
);
