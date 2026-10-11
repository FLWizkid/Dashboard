"use client";

import { AlertTriangle, CloudOff, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCaptureQueue } from "@/lib/tasks/use-capture-queue";

/**
 * What is captured but not yet on the server.
 *
 * The queue is only useful if you can see it. An invisible queue asks the
 * owner to trust that the task they typed on a train is somewhere — and the
 * moment they doubt it, they type it again, which is how you end up with
 * duplicates that no idempotency key can prevent because they are genuinely
 * two different captures.
 *
 * So this shows the count, the titles, and — the part that matters — the
 * difference between "waiting" and "refused". Waiting resolves itself.
 * Refused never will, and the text is only recoverable from here.
 */
export function PendingCaptures() {
  const {
    queue,
    rejected,
    flushing,
    online,
    available,
    flush,
    dismissRejected,
  } = useCaptureQueue();

  if (queue.length === 0 && rejected.length === 0 && available) return null;

  return (
    <div className="space-y-2" data-testid="pending-captures">
      {!available && (
        <p
          role="status"
          className="rounded-md border border-priority-high/40 bg-priority-high-soft px-3 py-2 text-xs text-priority-high"
        >
          This browser won&rsquo;t let the dashboard store anything locally, so
          a task captured without a connection can&rsquo;t be held for later.
          Everything still works while you&rsquo;re online.
        </p>
      )}

      {queue.length > 0 && (
        <div className="rounded-md border border-line bg-surface-muted px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs text-fg">
              <span
                aria-hidden="true"
                className="text-fg-muted [&_svg]:size-3.5"
              >
                <CloudOff />
              </span>
              <span data-testid="pending-capture-count">
                {queue.length === 1
                  ? "1 task saved on this device"
                  : `${queue.length} tasks saved on this device`}
              </span>
              <span className="text-fg-muted">
                {online
                  ? flushing
                    ? "· sending…"
                    : "· waiting to send"
                  : "· you're offline"}
              </span>
            </p>

            <Button
              size="sm"
              variant="ghost"
              disabled={flushing || !online}
              onClick={() => void flush()}
            >
              <RefreshCw />
              Try now
            </Button>
          </div>

          {/* The titles, not just a count. "3 tasks waiting" is a number;
              seeing what they are is what makes it believable. */}
          <ul className="mt-1.5 space-y-0.5 pl-5">
            {queue.map((capture) => (
              <li
                key={capture.clientKey}
                className="truncate text-xs text-fg-muted"
              >
                {capture.payload.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rejected.map(({ capture, error }) => (
        <div
          key={capture.clientKey}
          role="alert"
          className="rounded-md border border-priority-critical/40 bg-priority-critical-soft px-3 py-2.5"
        >
          <p className="flex items-start gap-2 text-xs text-priority-critical">
            <span aria-hidden="true" className="mt-px [&_svg]:size-3.5">
              <AlertTriangle />
            </span>
            <span className="min-w-0">
              <strong className="font-medium">
                Couldn&rsquo;t add &ldquo;{capture.payload.title}&rdquo;
              </strong>
              <br />
              {error}
            </span>
          </p>

          <div className="mt-2 flex justify-end">
            {/* Dismissing is the only way this leaves the screen, and it is a
                deliberate act. Auto-hiding a refused capture would delete the
                only remaining copy of what was typed. */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => dismissRejected(capture.clientKey)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
