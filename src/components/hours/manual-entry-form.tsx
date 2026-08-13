"use client";

import { PencilLine } from "lucide-react";
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
import { useToast } from "@/components/ui/toast";
import { formatMinutes } from "@/lib/hours/aggregate";
import { useOutbox } from "@/lib/hours/use-outbox";
import { useCategories, useTasks } from "@/lib/tasks/client";
import { getTimeZoneOffset } from "@/lib/time/zone";

/**
 * Logging time by hand.
 *
 * Everything this form produces goes through the **outbox**, not straight to
 * the network. Pressing "Log time" writes to IndexedDB and returns; the send
 * happens afterwards and its failure is a sync state, not a lost hour. That is
 * the whole reason the outbox exists, and routing the desktop form through it
 * too means the offline path is exercised constantly rather than only on a
 * phone in a basement.
 *
 * Duration rather than an end time. "I spent 45 minutes on this" is how the
 * thought arrives; making someone compute 14:15 from 13:30 is a small tax on
 * every single entry.
 */

const DURATIONS = [15, 30, 45, 60, 90, 120] as const;

export function ManualEntryForm() {
  const { timeZone } = useSettings();
  const outbox = useOutbox();
  const { toast } = useToast();
  const tasks = useTasks("open");
  const categories = useCategories();

  const [startLocal, setStartLocal] = React.useState("");
  const [minutes, setMinutes] = React.useState(30);
  const [taskId, setTaskId] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Default to "now, rounded back to the last quarter hour" — the usual case
  // is logging something that just finished.
  React.useEffect(() => {
    setStartLocal(defaultStart(timeZone));
  }, [timeZone]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const startedAt = fromLocalInput(startLocal, timeZone);
    if (!startedAt) {
      setError("That start time isn't a date I can read.");
      return;
    }
    if (minutes <= 0) {
      setError("How long was it?");
      return;
    }

    const endedAt = new Date(startedAt.getTime() + minutes * 60_000);

    await outbox.log({
      source: "manual",
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      taskId: taskId || null,
      categoryId: categoryId || null,
      note: note.trim() || null,
    });

    toast({
      title: `${formatMinutes(minutes)} logged`,
      description: outbox.online
        ? "Saved."
        : "Saved on this device. It'll sync when you're back online.",
      tone: "success",
    });

    setNote("");
    setStartLocal(defaultStart(timeZone));
  };

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <span className="text-fg-subtle [&_svg]:size-4">
              <PencilLine />
            </span>
            Log time
          </CardTitle>
          <CardDescription className="mt-1">
            Recorded as manual, and always labelled that way — a number you
            typed and a number the timer measured are different kinds of fact.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hours-start">Started</Label>
              <Input
                id="hours-start"
                type="datetime-local"
                value={startLocal}
                onChange={(event) => setStartLocal(event.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hours-minutes">How long</Label>
              <div className="flex gap-2">
                <Input
                  id="hours-minutes"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1440}
                  className="w-24"
                  value={minutes}
                  onChange={(event) =>
                    setMinutes(Number(event.target.value) || 0)
                  }
                />
                <div className="flex flex-wrap gap-1">
                  {DURATIONS.map((value) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={minutes === value ? "primary" : "secondary"}
                      onClick={() => setMinutes(value)}
                      aria-pressed={minutes === value}
                    >
                      {value >= 60 ? `${value / 60}h` : `${value}m`}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hours-task">Task</Label>
              <Select
                id="hours-task"
                value={taskId}
                onChange={(event) => setTaskId(event.target.value)}
              >
                <option value="">No task</option>
                {(tasks.data ?? []).map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hours-category">Category</Label>
              <Select
                id="hours-category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">Unclassified</option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hours-note">Note</Label>
            <Input
              id="hours-note"
              value={note}
              maxLength={500}
              placeholder="What was it?"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-priority-critical">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit">Log time</Button>
            {!outbox.online && (
              <span className="text-xs text-fg-muted">
                Offline — it&rsquo;ll be saved here and sent later.
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Local-time plumbing ──────────────────────────────────────────────── */

/**
 * `datetime-local` speaks wall-clock time with no zone, and the owner's zone
 * is a setting rather than necessarily the browser's. These two functions are
 * the only place that gap is bridged, so a manual entry logged while travelling
 * lands at the time they meant.
 */
function fromLocalInput(value: string, timeZone: string): Date | null {
  if (!value) return null;

  const asUtc = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(asUtc)) return null;

  // Offset is evaluated at the target instant, so a time on the far side of a
  // DST change converts with the offset actually in force then.
  const guess = new Date(asUtc);
  const offset = getTimeZoneOffset(guess, timeZone);
  return new Date(asUtc - offset);
}

function defaultStart(timeZone: string): string {
  const now = new Date();
  const offset = getTimeZoneOffset(now, timeZone);
  const local = new Date(now.getTime() + offset);

  // Round back to the previous quarter hour.
  local.setUTCMinutes(Math.floor(local.getUTCMinutes() / 15) * 15, 0, 0);

  return local.toISOString().slice(0, 16);
}
