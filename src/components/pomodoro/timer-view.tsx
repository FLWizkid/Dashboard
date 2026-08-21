"use client";

import { m, useReducedMotion } from "framer-motion";
import { Coffee, Pause, Play, SkipForward, Square, Timer } from "lucide-react";
import * as React from "react";

import { FocusSetup } from "@/components/pomodoro/focus-setup";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { formatMinutes } from "@/lib/hours/aggregate";
import { usePomodoro } from "@/lib/hours/client";
import {
  formatRemaining,
  POMODORO_KIND_LABELS,
  plannedMinutes,
  type PomodoroKind,
} from "@/lib/hours/pomodoro";
import { upNext, usePomodoroTimer } from "@/lib/hours/use-pomodoro";
import { pick } from "@/lib/motion";
import { useTasks } from "@/lib/tasks/client";
import type { PomodoroSession } from "@/lib/hours/types";

/**
 * The Pomodoro module.
 *
 * The timer is the whole page rather than a widget in a corner: during a focus
 * interval this is the screen that should be open, and a large calm dial is
 * the point of the technique.
 *
 * Keyboard first, like the rest of the product — space starts and pauses, `s`
 * stops, `n` skips — because reaching for a mouse to start focusing is a small
 * absurdity.
 */
export function TimerView() {
  const timer = usePomodoroTimer();
  const sessions = usePomodoro();
  const tasks = useTasks("open");
  const reduced = useReducedMotion();

  const kindLabel = POMODORO_KIND_LABELS[timer.state.kind];
  const total = plannedMinutes(timer.state.kind, timer.settings) * 60;

  /* ── Keyboard ─────────────────────────────────────────────────────── */

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never steal a key from a field the owner is typing in.
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.code === "Space") {
        event.preventDefault();
        if (timer.running) timer.pause();
        else if (timer.state.paused) timer.resume();
        // Same guard the button carries: starting before the stored state has
        // been read back would be discarded by the restore.
        else if (!timer.busy) void timer.start();
        return;
      }

      if (event.key === "s" && (timer.running || timer.state.paused)) {
        event.preventDefault();
        void timer.stop();
        return;
      }

      if (event.key === "n" && !timer.running) {
        event.preventDefault();
        timer.skip();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timer]);

  const idle = !timer.running && !timer.state.paused;
  const next = upNext(timer.state, timer.settings);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-fg">
          Pomodoro
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          {timer.settings.focusMinutes} minutes of focus,{" "}
          {timer.settings.shortBreakMinutes} off, a longer break every{" "}
          {timer.settings.longBreakEvery}. Completed focus time counts toward
          your hours; breaks don&rsquo;t.
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-col items-center gap-6 p-8">
          <Dial
            kind={timer.state.kind}
            remaining={timer.remaining}
            progress={timer.progress}
            total={total}
            running={timer.running}
            reduced={reduced}
          />

          <div className="text-center">
            <p className="text-sm font-medium text-fg">{kindLabel}</p>
            <p
              className="mt-0.5 text-xs text-fg-muted"
              data-testid="pomodoro-status"
            >
              {timer.running
                ? "Running"
                : timer.state.paused
                  ? "Paused"
                  : timer.complete
                    ? "Finished"
                    : "Ready"}
              {timer.state.completedFocus > 0 && (
                <> · {timer.state.completedFocus} completed today</>
              )}
            </p>
          </div>

          {/* Controls. Only the applicable ones are rendered — a disabled
              "Pause" on an idle timer is noise, not information. */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {idle && (
              <Button
                size="lg"
                onClick={() => void timer.start()}
                disabled={timer.busy}
              >
                <Play />
                Start {kindLabel.toLowerCase()}
                <Kbd className="ml-1">space</Kbd>
              </Button>
            )}

            {timer.running && (
              <Button size="lg" variant="secondary" onClick={timer.pause}>
                <Pause />
                Pause
                <Kbd className="ml-1">space</Kbd>
              </Button>
            )}

            {timer.state.paused && (
              <Button size="lg" onClick={timer.resume}>
                <Play />
                Resume
                <Kbd className="ml-1">space</Kbd>
              </Button>
            )}

            {(timer.running || timer.state.paused) && (
              <Button
                size="lg"
                variant="secondary"
                onClick={() => void timer.stop()}
                disabled={timer.busy}
              >
                <Square />
                Stop
                <Kbd className="ml-1">s</Kbd>
              </Button>
            )}

            {idle && (
              <Button variant="ghost" size="lg" onClick={timer.skip}>
                <SkipForward />
                Skip to {POMODORO_KIND_LABELS[next].toLowerCase()}
                <Kbd className="ml-1">n</Kbd>
              </Button>
            )}
          </div>

          {/* Stopping early is not a failure state and the copy says so: the
              time you did spend is recorded. */}
          {(timer.running || timer.state.paused) &&
            timer.state.kind === "focus" && (
              <p className="max-w-sm text-center text-xs text-fg-subtle">
                Stopping early still records the time you spent.
              </p>
            )}

          {timer.error && (
            <p
              role="status"
              className="max-w-sm rounded-md bg-priority-high-soft px-3 py-2 text-center text-xs text-priority-high"
            >
              {timer.error}
            </p>
          )}
        </CardContent>
      </Card>

      <FocusSetup
        categoryId={timer.state.categoryId}
        onCategoryChange={timer.setCategory}
        plannedOverrideMinutes={timer.state.plannedOverrideMinutes}
        onLengthChange={timer.setPlannedOverride}
        defaultMinutes={timer.settings.focusMinutes}
        disabled={timer.running || timer.state.paused}
      />

      <TaskPicker
        value={timer.state.taskId}
        onChange={timer.setTask}
        disabled={timer.running}
        tasks={(tasks.data ?? []).map((task) => ({
          id: task.id,
          title: task.title,
        }))}
      />

      <History
        sessions={sessions.data?.sessions ?? []}
        loading={sessions.isLoading}
      />
    </div>
  );
}

/* ── The dial ─────────────────────────────────────────────────────────── */

function Dial({
  kind,
  remaining,
  progress,
  total,
  running,
  reduced,
}: {
  kind: PomodoroKind;
  remaining: number;
  progress: number;
  total: number;
  running: boolean;
  reduced: boolean | null;
}) {
  const radius = 88;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative grid size-56 place-items-center">
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          strokeWidth="10"
          className="stroke-line"
        />
        <m.circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          className={
            kind === "focus" ? "stroke-primary" : "stroke-accent-bright"
          }
          strokeDasharray={circumference}
          // Drawn as "remaining", so the ring empties as the interval runs.
          animate={{ strokeDashoffset: circumference * progress }}
          transition={pick(reduced)}
        />
      </svg>

      <div className="relative text-center">
        <p
          className="font-mono text-4xl font-semibold tabular-nums tracking-tight text-fg"
          // The interval is announced at its boundaries, not every second: a
          // screen reader reciting the countdown would be unusable.
          aria-live="off"
          data-testid="pomodoro-remaining"
        >
          {formatRemaining(remaining)}
        </p>
        <p className="mt-1 text-xs text-fg-subtle">
          of {formatMinutes(Math.round(total / 60))}
        </p>
      </div>

      <span className="sr-only" role="status">
        {running
          ? `${POMODORO_KIND_LABELS[kind]} running, ${Math.ceil(remaining / 60)} minutes left.`
          : `${POMODORO_KIND_LABELS[kind]} not running.`}
      </span>
    </div>
  );
}

/* ── Task linkage ─────────────────────────────────────────────────────── */

function TaskPicker({
  value,
  onChange,
  disabled,
  tasks,
}: {
  value: string | null;
  onChange: (taskId: string | null) => void;
  disabled: boolean;
  tasks: { id: string; title: string }[];
}) {
  const id = React.useId();

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <span className="text-fg-subtle [&_svg]:size-4">
              <Timer />
            </span>
            What are you working on?
          </CardTitle>
          <CardDescription className="mt-1">
            Optional. Linking the session to a task is what lets the hours view
            answer &ldquo;how long did that actually take?&rdquo;
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <label htmlFor={id} className="sr-only">
          Task for this session
        </label>
        <select
          id={id}
          className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">No task</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
        {disabled && (
          <p className="mt-2 text-xs text-fg-subtle">
            The task is fixed while a session is running — changing it midway
            would attribute time you already spent to something else.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ── History ──────────────────────────────────────────────────────────── */

function History({
  sessions,
  loading,
}: {
  sessions: PomodoroSession[];
  loading: boolean;
}) {
  const finished = sessions.filter((session) => session.endedAt !== null);

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Recent sessions</CardTitle>
          <CardDescription className="mt-1">
            The last seven days.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : finished.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No sessions yet. The first one you finish shows up here.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {finished.map((session) => (
              <li
                key={session.id}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-fg-subtle [&_svg]:size-3.5">
                    {session.kind === "focus" ? <Timer /> : <Coffee />}
                  </span>
                  <span className="truncate text-fg">
                    {POMODORO_KIND_LABELS[session.kind]}
                  </span>
                  {!session.completed && (
                    <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[0.625rem] text-fg-muted">
                      stopped early
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums text-fg-muted">
                  {formatMinutes(Math.round((session.seconds ?? 0) / 60))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
