"use client";

import { CloudOff, RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatMinutes } from "@/lib/hours/aggregate";
import { useOutbox } from "@/lib/hours/use-outbox";

/**
 * What the outbox is holding.
 *
 * Silence would be the wrong default here. "Three entries waiting to sync —
 * 1h 45m" is the difference between trusting the number on the dashboard and
 * wondering whether this afternoon made it in.
 *
 * Nothing is shown when the queue is empty and the browser is online, which is
 * almost always: a permanent "everything is fine" strip is furniture.
 */
export function OutboxBanner() {
  const outbox = useOutbox();

  const waiting = outbox.queue.length;
  const showQueue = waiting > 0;
  const showOffline = !outbox.online;
  const showRejected = outbox.rejected.length > 0;
  const showUnavailable = !outbox.available;

  if (!showQueue && !showOffline && !showRejected && !showUnavailable) {
    return null;
  }

  return (
    <div className="space-y-2" data-testid="outbox-banner">
      {(showQueue || showOffline) && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-muted px-3 py-2 text-sm text-fg-muted"
        >
          <span className="shrink-0 [&_svg]:size-4" aria-hidden="true">
            {outbox.online ? <RefreshCw /> : <CloudOff />}
          </span>

          <span className="min-w-0 flex-1">
            {showQueue ? (
              <>
                <strong className="font-medium text-fg">
                  {waiting} {waiting === 1 ? "entry" : "entries"} waiting to
                  sync
                </strong>{" "}
                — {formatMinutes(outbox.pendingMinutes)}.{" "}
                {outbox.online
                  ? "Sending now."
                  : "Saved on this device; they'll go up when you're back online."}
              </>
            ) : (
              <>
                Offline. Anything you log is saved here and sent when the
                connection is back.
              </>
            )}
          </span>

          {showQueue && outbox.online && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void outbox.flush()}
              disabled={outbox.flushing}
            >
              {outbox.flushing ? "Syncing…" : "Sync now"}
            </Button>
          )}
        </div>
      )}

      {/* A rejection is the one case where time really might not be recorded,
          so it is loud, it is dismissible only by the owner, and it repeats
          the entry so it can be re-entered. */}
      {outbox.rejected.map(({ entry, error }) => (
        <div
          key={entry.clientKey}
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-priority-critical/40 bg-priority-critical-soft px-3 py-2 text-sm text-priority-critical"
        >
          <span className="shrink-0 [&_svg]:size-4" aria-hidden="true">
            <TriangleAlert />
          </span>
          <span className="min-w-0 flex-1">
            The server refused an entry from{" "}
            {new Date(entry.startedAt).toLocaleString()} —{" "}
            {formatMinutes(
              Math.round(
                (Date.parse(entry.endedAt) - Date.parse(entry.startedAt)) /
                  60_000,
              ),
            )}
            . {error}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => outbox.dismissRejected(entry.clientKey)}
          >
            Dismiss
          </Button>
        </div>
      ))}

      {showUnavailable && (
        <p
          role="alert"
          className="rounded-md border border-priority-high/40 bg-priority-high-soft px-3 py-2 text-sm text-priority-high"
        >
          This browser won&rsquo;t let the app store anything locally, so
          offline logging isn&rsquo;t available here. Time logged while
          disconnected would be lost.
        </p>
      )}
    </div>
  );
}
