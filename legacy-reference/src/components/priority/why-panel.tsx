"use client";

import { Info } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import type { RankedRow } from "@/lib/priority/client";
import { cn } from "@/lib/utils";

/**
 * "Why is this here?"
 *
 * The gate says the ranking has to be *explainable*, and this is where that
 * claim is cashed. Every line names something the owner can go and look at: a
 * priority they set, a date they chose, a meeting on their calendar.
 *
 * The score itself is shown, but quietly and last. Leading with "68" invites
 * the reader to compare numbers and reverse-engineer the weights; leading with
 * "overdue by three days" tells them what to actually do.
 */
export function WhyPanel({ row }: { row: RankedRow }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();

  return (
    <div className="text-xs">
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        data-testid="why-toggle"
      >
        <Info />
        Why here?
      </Button>

      {open && (
        <div
          id={id}
          data-testid="why-panel"
          className="mt-1.5 space-y-2 rounded-md border border-line bg-surface-muted p-3"
        >
          <p className="text-fg">{row.explanation.headline}</p>

          {row.explanation.lines.length > 0 && (
            <ul className="space-y-1">
              {row.explanation.lines.map((line) => (
                <li
                  key={line.label}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="text-fg-muted">{line.detail}</span>
                  {/* `fg-muted`, not `fg-subtle`: the subtle token clears AA
                      on the page background but not on `surface-muted`, which
                      is what this panel is painted with. */}
                  <span className="shrink-0 tabular-nums text-fg-muted">
                    +{line.points}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {row.explanation.signals.length > 0 && (
            <div className="border-t border-line pt-2">
              <p className="text-fg-muted">What raised its importance:</p>
              <ul className="mt-1 space-y-0.5">
                {row.explanation.signals.map((signal, index) => (
                  <li key={index} className="text-fg-muted">
                    · {signal.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Last, and quiet. The sentences above are the explanation; this is
              just the arithmetic they add up to. */}
          {!row.overridden && (
            <p className="border-t border-line pt-2 text-fg-muted">
              Score {row.total} out of 100.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The one-line version, for a dense row. */
export function WhyLine({
  row,
  className,
}: {
  row: RankedRow;
  className?: string;
}) {
  return (
    <span
      className={cn("text-xs text-fg-subtle", className)}
      data-testid="why-line"
    >
      {row.summary}
    </span>
  );
}
