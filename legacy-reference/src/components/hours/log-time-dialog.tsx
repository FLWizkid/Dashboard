"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatMinutes } from "@/lib/hours/aggregate";
import { LOG_PRESETS, presetLabel } from "@/lib/hours/presets";
import { readRemembered, writeRemembered } from "@/lib/hours/remembered";
import { useOutbox } from "@/lib/hours/use-outbox";
import { useCategories } from "@/lib/tasks/client";
import type { Task } from "@/lib/tasks/types";

/**
 * Log time against the task you just finished.
 *
 * The gap this closes: ticking a task recorded that it was done and nothing
 * about how long it took, so the hours module and the task list were two
 * separate ledgers that never agreed. Reconstructing the answer later is
 * guesswork — the moment you finish something is the only moment you actually
 * know.
 *
 * ── Offered, never demanded ──────────────────────────────────────────────
 * Completing a task stays one tap. This opens only if the offer in the
 * confirmation toast is taken, and closing it costs nothing: the task is
 * already complete before this dialog exists. Time tracking that can block
 * finishing work is time tracking that gets switched off.
 *
 * ── The same controls as the quick-log, deliberately ─────────────────────
 * Same durations from `lib/hours/presets`, same description carried between
 * entries from `lib/hours/remembered`, same outbox — so a block logged here
 * is indistinguishable from one logged on the dashboard, and there is one
 * place to change what "log some time" means.
 *
 * The task is fixed rather than chosen: you got here from that task, and a
 * task picker would be an invitation to file it against the wrong one.
 */
export function LogTimeDialog({
  task,
  onOpenChange,
}: {
  /** The task the time belongs to. `null` closes the dialog. */
  task: Task | null;
  onOpenChange: (open: boolean) => void;
}) {
  const outbox = useOutbox();
  const { toast } = useToast();
  const categories = useCategories();
  const [busy, setBusy] = React.useState<number | null>(null);

  const [note, setNote] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");

  /**
   * Seeded each time the dialog opens, not once on mount.
   *
   * The defaults come from the last entry logged anywhere, and the dialog
   * outlives several of those — reading them at mount would pin it to
   * whatever was true when the page loaded.
   *
   * The description starts as the task's own title. That is the single most
   * likely answer to "what were you doing", it is already on screen, and it
   * beats a carried-over description from unrelated work.
   */
  React.useEffect(() => {
    if (!task) return;
    setNote(task.title);
    setCategoryId(task.categoryId ?? readRemembered("categoryId"));
  }, [task]);

  const chosen = (categories.data ?? []).find(
    (category) => category.id === categoryId,
  );

  const log = async (minutes: number) => {
    if (!task) return;

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
        taskId: task.id,
        note: trimmedNote || null,
      });

      // Written back to the shared memory so the next quick-log starts from
      // what was actually just logged, wherever it was logged from.
      writeRemembered("note", trimmedNote);
      writeRemembered("categoryId", categoryId);

      toast({
        title: `${formatMinutes(minutes)} logged`,
        description: [
          `Against “${task.title}”.`,
          chosen ? `Filed under ${chosen.name}.` : "Unfiled.",
          outbox.online
            ? "Saved."
            : "Saved on this device — it'll sync when you're back online.",
        ].join(" "),
        tone: "success",
      });

      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent data-testid="log-time-dialog">
        <DialogTitle>How long did that take?</DialogTitle>
        <DialogDescription>
          Logged against{" "}
          <span className="font-medium text-fg">
            {task?.title ?? "this task"}
          </span>
          , counting backwards from now. Skip it and the task stays completed
          either way.
        </DialogDescription>

        <div className="mt-4 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="log-time-note">What you did</Label>
            <Input
              id="log-time-note"
              value={note}
              maxLength={500}
              autoComplete="off"
              onChange={(event) => setNote(event.target.value)}
              data-testid="log-time-note"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="log-time-category">File it under</Label>
            <Select
              id="log-time-category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              data-testid="log-time-category"
            >
              <option value="">Unfiled</option>
              {(categories.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </div>

          <div
            className="flex flex-wrap gap-2 pt-1"
            data-testid="log-time-presets"
          >
            {LOG_PRESETS.map((minutes) => (
              <Button
                key={minutes}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
