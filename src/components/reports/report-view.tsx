"use client";

import { Printer, SlidersHorizontal } from "lucide-react";
import * as React from "react";

import { useSettings } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import { formatMinutes } from "@/lib/hours/aggregate";
import { describeChange } from "@/lib/reports/context";
import { useReport, type ReportResponse } from "@/lib/reports/client";
import { TASK_PRIORITIES, PRIORITY_LABELS } from "@/lib/tasks/types";
import type { TaskPriority } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

/**
 * The report workspace.
 *
 * ── One page, two renderings ─────────────────────────────────────────────
 * There is no separate print route. The same markup prints, driven by
 * `@media print` in `globals.css` — controls disappear, sections get page
 * breaks, colours flatten. A second implementation for print is a second thing
 * to keep correct, and the one that gets stale is always the one nobody looks
 * at until they need a PDF at 23:00.
 *
 * The printed structure is the specification's:
 *   1. Executive summary
 *   2. Prioritised tasks
 *   3. The next two days
 *
 * ── The summary is never filtered ────────────────────────────────────────
 * Filters narrow the task list below. They deliberately do **not** touch the
 * summary: "3 overdue" has to mean three overdue, not three among whichever
 * subset a dropdown is currently showing. A headline figure that changes when
 * you change a filter is a headline figure nobody can quote.
 */
export function ReportView() {
  const { timeZone, ready } = useSettings();

  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [priority, setPriority] = React.useState<TaskPriority | "">("");
  const [categoryId, setCategoryId] = React.useState("");
  const [incompleteOnly, setIncompleteOnly] = React.useState(true);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const report = useReport({
    timeZone,
    enabled: ready,
    filters: {
      q: debounced,
      priorities: priority ? [priority] : [],
      categories: categoryId ? [categoryId] : [],
      incompleteOnly,
    },
  });

  const data = report.data;

  return (
    <div className="space-y-6">
      <header className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">
            Reports
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            The same page you read is the page that prints. Use your
            browser&rsquo;s print dialog to save a PDF.
          </p>
        </div>

        <Button onClick={() => window.print()}>
          <Printer />
          Print
        </Button>
      </header>

      {/* Only on paper — the screen has a heading already. */}
      <header className="hidden print:block">
        <h1 className="text-xl font-semibold text-fg">Executive report</h1>
        {data && (
          <p className="mt-1 text-xs text-fg-muted">
            Generated {new Date(data.generatedAt).toLocaleString()} ·{" "}
            {data.timeZone}
          </p>
        )}
      </header>

      <Filters
        className="no-print"
        query={query}
        onQuery={setQuery}
        priority={priority}
        onPriority={setPriority}
        categoryId={categoryId}
        onCategory={setCategoryId}
        incompleteOnly={incompleteOnly}
        onIncompleteOnly={setIncompleteOnly}
        categories={data?.categories ?? []}
        filteredOut={data?.filteredOut ?? 0}
      />

      {report.isError && (
        <p role="alert" className="text-sm text-priority-critical">
          {report.error instanceof Error
            ? report.error.message
            : "Couldn't build the report."}
        </p>
      )}

      <Summary data={data} loading={report.isLoading} />
      <TaskSections data={data} loading={report.isLoading} />
      <WhatMoved data={data} loading={report.isLoading} />
      <TwoDays data={data} loading={report.isLoading} />
    </div>
  );
}

/* ── Filters ──────────────────────────────────────────────────────────── */

function Filters({
  className,
  query,
  onQuery,
  priority,
  onPriority,
  categoryId,
  onCategory,
  incompleteOnly,
  onIncompleteOnly,
  categories,
  filteredOut,
}: {
  className?: string;
  query: string;
  onQuery: (value: string) => void;
  priority: TaskPriority | "";
  onPriority: (value: TaskPriority | "") => void;
  categoryId: string;
  onCategory: (value: string) => void;
  incompleteOnly: boolean;
  onIncompleteOnly: (value: boolean) => void;
  categories: { id: string; name: string }[];
  filteredOut: number;
}) {
  const checkboxId = React.useId();

  return (
    <Card className={className}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <span className="text-fg-subtle [&_svg]:size-4">
              <SlidersHorizontal />
            </span>
            Filters
          </CardTitle>
          <CardDescription className="mt-1">
            These narrow the task list. The summary above always describes
            everything.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="report-search">Search</Label>
            <Input
              id="report-search"
              value={query}
              placeholder="Title contains…"
              onChange={(event) => onQuery(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="report-priority">Priority</Label>
            <Select
              id="report-priority"
              value={priority}
              onChange={(event) =>
                onPriority(event.target.value as TaskPriority | "")
              }
            >
              <option value="">Any priority</option>
              {TASK_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {PRIORITY_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="report-category">Category</Label>
            <Select
              id="report-category"
              value={categoryId}
              onChange={(event) => onCategory(event.target.value)}
            >
              <option value="">Any category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-end">
            <label
              htmlFor={checkboxId}
              className="flex items-center gap-2 text-sm text-fg"
            >
              <input
                id={checkboxId}
                type="checkbox"
                className="size-4 accent-[rgb(var(--primary))]"
                checked={incompleteOnly}
                onChange={(event) => onIncompleteOnly(event.target.checked)}
              />
              Incomplete only
            </label>
          </div>
        </div>

        {filteredOut > 0 && (
          <p className="mt-3 text-xs text-fg-muted" role="status">
            {filteredOut} {filteredOut === 1 ? "task is" : "tasks are"} hidden
            by these filters.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ── 1. Executive summary ─────────────────────────────────────────────── */

function Summary({
  data,
  loading,
}: {
  data: ReportResponse | undefined;
  loading: boolean;
}) {
  const summary = data?.summary;

  const stats: { label: string; value: string; note?: string }[] = [
    { label: "Open", value: loading ? "—" : String(summary?.openTasks ?? 0) },
    { label: "Overdue", value: loading ? "—" : String(summary?.overdue ?? 0) },
    { label: "Due soon", value: loading ? "—" : String(summary?.dueSoon ?? 0) },
    {
      label: "Untriaged",
      value: loading ? "—" : String(summary?.untriaged ?? 0),
    },
    {
      label: "Completed this week",
      value: loading ? "—" : String(summary?.completedThisWeek ?? 0),
    },
    {
      label: "Hours this week",
      value:
        loading || !summary?.hoursThisWeek
          ? "—"
          : formatMinutes(summary.hoursThisWeek.combined),
      // Never a confident zero for something the system cannot see.
      note:
        !loading && !summary?.hoursThisWeek
          ? "nothing recorded yet"
          : undefined,
    },
    {
      label: "Critical unread",
      value:
        loading || summary?.criticalUnread == null
          ? "—"
          : String(summary.criticalUnread),
      note:
        !loading && summary?.criticalUnread == null
          ? "no mail account connected"
          : undefined,
    },
  ];

  return (
    <section aria-labelledby="report-summary" className="break-inside-avoid">
      <h2
        id="report-summary"
        className="mb-3 text-sm font-semibold tracking-tight text-fg"
      >
        Executive summary
      </h2>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="print:border-line">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-fg-muted">
                {stat.label}
              </p>
              <p
                className="mt-1 text-2xl font-semibold tabular-nums text-fg"
                data-testid={`report-stat-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {stat.value}
              </p>
              {stat.note && (
                <p className="mt-0.5 text-xs text-fg-muted">{stat.note}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {!loading && (data?.summary.topPriorities.length ?? 0) > 0 && (
        <Card className="mt-3">
          <CardHeader>
            <CardTitle>Top priorities</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-1.5" data-testid="report-top">
              {data!.summary.topPriorities.map((task) => (
                <li key={task.id} className="text-sm text-fg">
                  {task.title}
                  {task.priority && (
                    <span className="ml-2 text-xs text-fg-muted">
                      {PRIORITY_LABELS[task.priority]}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

/* ── 2. Prioritised tasks ─────────────────────────────────────────────── */

function TaskSections({
  data,
  loading,
}: {
  data: ReportResponse | undefined;
  loading: boolean;
}) {
  return (
    <section aria-labelledby="report-tasks" className="break-before-page">
      <h2
        id="report-tasks"
        className="mb-3 text-sm font-semibold tracking-tight text-fg"
      >
        Prioritised tasks
      </h2>

      {loading ? (
        <p className="text-sm text-fg-muted">Building…</p>
      ) : (
        <div className="space-y-4" data-testid="report-groups">
          {data?.groups.map((group) => (
            <Card key={group.group} className="break-inside-avoid">
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle>
                    {group.label}
                    <span className="ml-2 text-xs font-normal text-fg-muted">
                      {group.tasks.length}
                    </span>
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {group.description}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {/* An empty group says so rather than being omitted: an absent
                    "Overdue" heading and an empty one mean opposite things. */}
                {group.tasks.length === 0 ? (
                  <p className="text-sm text-fg-muted">Nothing here.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {group.tasks.map((task) => (
                      <li
                        key={task.id}
                        className="flex items-baseline justify-between gap-3 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 text-fg">
                          {task.title}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-xs",
                            group.group === "overdue"
                              ? "text-priority-critical"
                              : "text-fg-muted",
                          )}
                        >
                          {task.dueAt
                            ? new Date(task.dueAt).toLocaleDateString()
                            : "no date"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── 3. The next two days ─────────────────────────────────────────────── */

function TwoDays({
  data,
  loading,
}: {
  data: ReportResponse | undefined;
  loading: boolean;
}) {
  return (
    <section aria-labelledby="report-two-day" className="break-before-page">
      <h2
        id="report-two-day"
        className="mb-3 text-sm font-semibold tracking-tight text-fg"
      >
        The next two days
      </h2>

      {loading ? (
        <p className="text-sm text-fg-muted">Building…</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="report-two-day">
          {data?.twoDay.map((slot) => (
            <Card key={slot.start} className="break-inside-avoid">
              <CardHeader>
                <CardTitle>{slot.label}</CardTitle>
              </CardHeader>
              <CardContent>
                {slot.events.length === 0 && slot.tasks.length === 0 ? (
                  <p className="text-sm text-fg-muted">Nothing scheduled.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {slot.events.map((event) => (
                      <li key={event.id} className="flex gap-2">
                        <span className="shrink-0 tabular-nums text-fg-muted">
                          {new Date(event.startsAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="min-w-0 text-fg">{event.title}</span>
                      </li>
                    ))}
                    {slot.tasks.map((task) => (
                      <li key={task.id} className="flex gap-2">
                        <span className="shrink-0 text-fg-muted">due</span>
                        <span className="min-w-0 text-fg">{task.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── What moved elsewhere ─────────────────────────────────────────────── */

/**
 * External context that changed, shown between the task list and the
 * two-day preview.
 *
 * Absent entirely when nothing changed — including when nothing is connected.
 * An empty "What moved elsewhere" heading on a box with no connectors would
 * read as a broken integration rather than as a quiet week, and unlike the
 * task groups there is no meaningful difference between "nothing moved" and
 * "nothing to move".
 */
function WhatMoved({
  data,
  loading,
}: {
  data: ReportResponse | undefined;
  loading: boolean;
}) {
  const changes = data?.contextChanges ?? [];
  if (loading || changes.length === 0) return null;

  return (
    <section aria-labelledby="report-context" className="break-inside-avoid">
      <h2
        id="report-context"
        className="mb-3 text-sm font-semibold tracking-tight text-fg"
      >
        What moved elsewhere
      </h2>

      <Card>
        <CardContent className="p-4">
          <ul className="space-y-1.5" data-testid="report-context">
            {changes.map((change) => (
              <li key={change.link.id} className="text-sm">
                <a
                  href={change.link.ref.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-fg underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {describeChange(change)}
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
