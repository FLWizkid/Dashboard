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
 */

const PRESETS = [15, 30, 45, 60, 90] as const;

export function QuickLog() {
  const outbox = useOutbox();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<number | null>(null);

  const log = async (minutes: number) => {
    setBusy(minutes);
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - minutes * 60_000);

    try {
      await outbox.log({
        source: "manual",
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        note: null,
      });

      toast({
        title: `${formatMinutes(minutes)} logged`,
        description: outbox.online
          ? "Saved."
          : "Saved on this device — it'll sync when you're back online.",
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

      <CardContent>
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
