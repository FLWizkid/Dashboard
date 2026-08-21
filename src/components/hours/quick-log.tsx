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
import { useToast } from "@/components/ui/toast";
import { formatMinutes } from "@/lib/hours/aggregate";
import { useOutbox } from "@/lib/hours/use-outbox";
import { useCategories } from "@/lib/tasks/client";

/**
 * One-tap logging.
 *
 * The specification's mobile requirement, and the constraint that shapes it is
 * that this gets used standing in a corridor between two meetings. So: no
 * form, no date picker, no task selector. Tap "30m" and the last half hour is
 * logged, backdated from now, and it is durable before the button finishes
 * animating.
 *
 * Everything else — attributing it to a task, correcting the time — is
 * editable afterwards on a real screen. Capture first; classify later is the
 * same principle the task inbox runs on.
 *
 * ── The one classification worth doing up front ──────────────────────────
 * Which category it was. Not because the corridor is the right place to file
 * things, but because it is the only place you still remember: an hour logged
 * as "unfiled" on Tuesday is an hour nobody can attribute on Friday, and the
 * weekly split — the thing the hours module exists to produce — quietly
 * degrades. The choice sticks between logs, so the common case stays one tap.
 *
 * ── Thirty minutes is the floor ──────────────────────────────────────────
 * A quarter of an hour is below the resolution anyone reconstructs
 * accurately after the fact, and offering it invites a precision the memory
 * cannot supply.
 */

const PRESETS = [30, 45, 60, 90] as const;

export function QuickLog() {
  const outbox = useOutbox();
  const { toast } = useToast();
  const categories = useCategories();
  const [busy, setBusy] = React.useState<number | null>(null);

  // Remembered across logs. Consecutive entries in a working day are usually
  // the same kind of work, so re-picking every time would be the friction
  // this control exists to remove.
  const [categoryId, setCategoryId] = React.useState<string>("");

  const chosen = (categories.data ?? []).find(
    (category) => category.id === categoryId,
  );

  const log = async (minutes: number) => {
    setBusy(minutes);
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - minutes * 60_000);

    try {
      await outbox.log({
        source: "manual",
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        categoryId: categoryId || null,
        note: null,
      });

      toast({
        title: `${formatMinutes(minutes)} logged`,
        description: [
          chosen ? `Filed under ${chosen.name}.` : "Unfiled.",
          outbox.online
            ? "Saved."
            : "Saved on this device — it'll sync when you're back online.",
        ].join(" "),
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

      <CardContent className="space-y-3">
        <div className="space-y-1">
          <label
            htmlFor="quick-log-category"
            className="text-xs font-medium text-fg"
          >
            File it under
          </label>
          <select
            id="quick-log-category"
            className="w-full rounded-md border border-line bg-surface px-2 py-2 text-sm sm:max-w-xs"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            data-testid="quick-log-category"
          >
            {/* Unfiled stays available and stays first. Forcing a category
                here would mean the honest answer — "I do not remember" — is
                the one thing the control will not accept. */}
            <option value="">Unfiled</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2" data-testid="quick-log">
          {PRESETS.map((minutes) => (
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
              {minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
