"use client";

import * as React from "react";

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
import { LOG_PRESETS, presetLabel } from "@/lib/hours/presets";
import { readRemembered, writeRemembered } from "@/lib/hours/remembered";
import { useOutbox } from "@/lib/hours/use-outbox";
import { useCategories, useTasks } from "@/lib/tasks/client";

/**
 * One-tap logging.
 *
 * The specification's mobile requirement, and the constraint that shapes it is
 * that this gets used standing in a corridor between two meetings. So: no
 * date picker, no dialog, nothing required. Tap "30m" and the last half hour
 * is logged, backdated from now, and it is durable before the button finishes
 * animating.
 *
 * Everything else — attributing it to a task, correcting the time — is
 * editable afterwards on a real screen. Capture first; classify later is the
 * same principle the task inbox runs on.
 *
 * ── The classifications worth offering up front ──────────────────────────
 * Which category it was, and what you actually did. Not because the corridor
 * is the right place to file things, but because it is the only place you
 * still remember: an hour logged as "unfiled" on Tuesday is an hour nobody can
 * attribute on Friday, and the weekly split — the thing the hours module
 * exists to produce — quietly degrades. Every one of them carries over between
 * logs, so the common case stays one tap.
 *
 * ── The durations live in `lib/hours/presets` ────────────────────────────
 * Shared with the log-on-complete dialog, so the two can never drift into
 * offering different blocks of time for the same action.
 *
 * ── Why the fields sit in two columns ────────────────────────────────────
 * The selects are narrow by nature and left the right half of the card empty,
 * which is exactly where the one field that wants room — the description —
 * belongs. On a phone the grid collapses and the order is unchanged.
 */

export function QuickLog() {
  const outbox = useOutbox();
  const { toast } = useToast();
  const categories = useCategories();
  const tasks = useTasks("open");
  const [busy, setBusy] = React.useState<number | null>(null);

  // Which task the time is against. Optional, and remembered for the session —
  // logging three blocks against the same piece of work is the common case.
  //
  // Deliberately *not* persisted, unlike the other two. A task reference that
  // survives until tomorrow is a trap: the work gets finished, the task gets
  // closed, and Thursday's hour lands silently against Monday's completed
  // item. A category or a description going stale is visible in the box; a
  // task id going stale is not.
  const [taskId, setTaskId] = React.useState<string>("");

  // Carried between logs and across reloads. Consecutive entries in a working
  // day are usually the same kind of work, so re-picking every time would be
  // the friction these controls exist to remove.
  const [categoryId, setCategoryId] = React.useState<string>("");

  /**
   * What you did — the owner's "description".
   *
   * The one free-text field, and the reason the rest of this is worth having:
   * "45m, Admin & Inbox" tells you nothing in a month's time, and "45m, Admin
   * & Inbox, board pack review" tells you everything.
   */
  const [note, setNote] = React.useState<string>("");

  /**
   * True while the box holds a value the owner did not type just now.
   *
   * Worth tracking separately, because a pre-filled field that says nothing
   * about where its contents came from is how the wrong description gets
   * attached to an hour. When it is carried over, the card says so and offers
   * to clear it. The moment it is edited, it is the owner's text and the note
   * disappears.
   */
  const [carriedOver, setCarriedOver] = React.useState(false);

  // Restored after mount rather than in the initial state: reading storage
  // during render would disagree with the server-rendered markup.
  React.useEffect(() => {
    const storedNote = readRemembered("note");
    const storedCategory = readRemembered("categoryId");
    if (storedNote) {
      setNote(storedNote);
      setCarriedOver(true);
    }
    if (storedCategory) setCategoryId(storedCategory);
  }, []);

  const chosen = (categories.data ?? []).find(
    (category) => category.id === categoryId,
  );
  const chosenTask = (tasks.data ?? []).find((task) => task.id === taskId);

  /**
   * A category that no longer exists must not stay selected.
   *
   * The taxonomy is editable, so a remembered id can outlive the category it
   * points at. Left alone, the select would fall back to showing "Unfiled"
   * while still holding the dead id, and the entry would be filed against
   * nothing at all — the failure looks like success.
   */
  React.useEffect(() => {
    if (!categoryId || !categories.data) return;
    if (!categories.data.some((category) => category.id === categoryId)) {
      setCategoryId("");
      writeRemembered("categoryId", "");
    }
  }, [categoryId, categories.data]);

  function updateNote(value: string) {
    setNote(value);
    setCarriedOver(false);
  }

  function clearNote() {
    setNote("");
    setCarriedOver(false);
    writeRemembered("note", "");
  }

  function updateCategory(value: string) {
    setCategoryId(value);
    writeRemembered("categoryId", value);
  }

  const log = async (minutes: number) => {
    setBusy(minutes);
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - minutes * 60_000);
    const trimmedNote = note.trim();

    try {
      await outbox.log({
        source: "manual",
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        categoryId: categoryId || null,
        taskId: taskId || null,
        note: trimmedNote || null,
      });

      // Remembered now rather than on every keystroke: what gets carried to
      // the next entry is what was actually logged, not an abandoned draft.
      writeRemembered("note", trimmedNote);
      setNote(trimmedNote);
      setCarriedOver(Boolean(trimmedNote));

      toast({
        title: `${formatMinutes(minutes)} logged`,
        description: [
          // The description leads. It is the field most likely to be carried
          // over from a previous entry, so it is the one that most needs
          // reading back — a wrong description confirmed out loud gets fixed;
          // a wrong description logged in silence does not.
          trimmedNote ? `“${trimmedNote}”.` : null,
          chosenTask ? `Against “${chosenTask.title}”.` : null,
          chosen ? `Filed under ${chosen.name}.` : "Unfiled.",
          outbox.online
            ? "Saved."
            : "Saved on this device — it'll sync when you're back online.",
        ]
          .filter(Boolean)
          .join(" "),
        tone: "success",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Just finished something?</CardTitle>
          <CardDescription className="mt-1">
            Logs backwards from now. Works offline — the entry is saved on this
            device first and sent when it can be.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="quick-log-category">File it under</Label>
              <Select
                id="quick-log-category"
                value={categoryId}
                onChange={(event) => updateCategory(event.target.value)}
                data-testid="quick-log-category"
              >
                {/* Unfiled stays available and stays first. Forcing a category
                    here would mean the honest answer — "I do not remember" —
                    is the one thing the control will not accept. */}
                <option value="">Unfiled</option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="quick-log-task">Against a task</Label>
              <Select
                id="quick-log-task"
                value={taskId}
                onChange={(event) => setTaskId(event.target.value)}
                data-testid="quick-log-task"
              >
                {/* Optional, and first: most logged time is not against one
                    specific task, and pretending otherwise would make the
                    common case the awkward one. */}
                <option value="">No particular task</option>
                {(tasks.data ?? [])
                  .filter((task) => !task.isDraft)
                  .map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="quick-log-note">What you did (optional)</Label>
            <Input
              id="quick-log-note"
              value={note}
              // The server caps the note at 500 characters. Matching it here
              // means the limit is felt as a full box, not discovered as a
              // rejected entry after the fact.
              maxLength={500}
              placeholder="e.g. Board pack review"
              autoComplete="off"
              onChange={(event) => updateNote(event.target.value)}
              data-testid="quick-log-note"
            />

            {carriedOver ? (
              <p
                className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted"
                data-testid="quick-log-note-carried"
              >
                Carried over from your last entry.
                <button
                  type="button"
                  onClick={clearNote}
                  className="rounded-sm font-medium text-fg underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Clear it
                </button>
              </p>
            ) : (
              <p className="text-xs text-fg-muted">
                Kept for next time, so repeat work is one tap.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2" data-testid="quick-log">
          {LOG_PRESETS.map((minutes) => (
            <Button
              key={minutes}
              // Comfortably above the 44px touch target minimum: this is the
              // control most likely to be pressed one-handed while walking.
              size="lg"
              variant="secondary"
              className="min-w-20 flex-1"
              disabled={busy !== null}
              onClick={() => void log(minutes)}
            >
              {presetLabel(minutes)}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
