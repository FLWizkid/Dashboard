"use client";

import {
  AlertTriangle,
  ExternalLink as ExternalLinkIcon,
  GitPullRequest,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  freshness,
  REF_KIND_LABELS,
  REF_STATE_LABELS,
  type ExternalRef,
  type LinkedRef,
} from "@/lib/connectors/model";
import { cn } from "@/lib/utils";

/**
 * One piece of external context, as it appears next to work.
 *
 * ── What it shows and why ────────────────────────────────────────────────
 * The title, the state, and how much to trust it. That last one is the part
 * that is easy to leave out and expensive to be without: the reference is a
 * *cached* answer, and a dashboard that presents six-hour-old data with the
 * same confidence as live data is one you eventually stop believing.
 *
 * So a stale reference says so, and a failing one says why. Neither hides the
 * title — yesterday's answer beats no answer, as long as it is labelled.
 */

/**
 * Reusing the priority tones rather than inventing connector-specific ones.
 *
 * A second colour vocabulary for the same page is how a design system stops
 * being one — and these already mean "good", "in flight" and "wrong", which is
 * exactly what an external state is saying.
 */
const STATE_TONE: Record<
  string,
  "neutral" | "normal" | "critical" | "high" | "primary"
> = {
  open: "normal",
  in_progress: "high",
  blocked: "critical",
  merged: "primary",
  closed: "neutral",
  archived: "neutral",
};

export function RefChip({
  link,
  onRemove,
  removing,
}: {
  link: LinkedRef;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const { ref } = link;
  const trust = freshness(ref);
  const stateLabel = REF_STATE_LABELS[ref.state];

  return (
    <li
      data-testid="ref-chip"
      className="flex items-center gap-2 rounded-md border border-line bg-surface-raised px-2.5 py-1.5"
    >
      <span
        aria-hidden="true"
        className="shrink-0 text-fg-muted [&_svg]:size-3.5"
      >
        <GitPullRequest />
      </span>

      <a
        href={ref.url}
        target="_blank"
        rel="noreferrer noopener"
        className="min-w-0 flex-1 truncate text-sm text-fg underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {ref.title}
        <span className="sr-only">
          {" "}
          — {REF_KIND_LABELS[ref.kind]}
          {ref.subtitle ? `, ${ref.subtitle}` : ""}
          {stateLabel ? `, ${stateLabel}` : ""}, opens in a new tab
        </span>
      </a>

      {ref.subtitle && (
        <span
          aria-hidden="true"
          className="hidden shrink-0 font-mono text-xs text-fg-muted sm:inline"
        >
          {ref.subtitle}
        </span>
      )}

      {/* Hidden entirely rather than shown as a dash when the thing has no
          lifecycle — a document is not "—", it simply has no state. */}
      {stateLabel && (
        <Badge tone={STATE_TONE[ref.state] ?? "neutral"}>
          {ref.stateDetail ?? stateLabel}
        </Badge>
      )}

      {trust !== "fresh" && (
        <span
          className={cn(
            "shrink-0 text-xs",
            trust === "failing" ? "text-priority-critical" : "text-fg-muted",
          )}
          // The reason, not just the fact. "Stale" alone invites the owner to
          // wonder; "couldn't reach GitHub" tells them whether to care.
          title={ref.fetchError ?? undefined}
        >
          {trust === "failing" ? (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="[&_svg]:size-3">
                <AlertTriangle />
              </span>
              <span>out of date</span>
            </span>
          ) : trust === "never" ? (
            "not checked yet"
          ) : (
            "may be out of date"
          )}
        </span>
      )}

      <span
        aria-hidden="true"
        className="shrink-0 text-fg-subtle [&_svg]:size-3"
      >
        <ExternalLinkIcon />
      </span>

      {onRemove && (
        <button
          type="button"
          disabled={removing}
          onClick={onRemove}
          aria-label={`Detach ${ref.title}`}
          className="shrink-0 rounded-sm p-1 text-fg-muted transition-colors duration-fast hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <span aria-hidden="true" className="[&_svg]:size-3.5">
            <X />
          </span>
        </button>
      )}
    </li>
  );
}

/** The same thing, for a search result that is not attached to anything yet. */
export function RefResult({
  ref: reference,
  onAttach,
  attaching,
}: {
  ref: ExternalRef;
  onAttach: () => void;
  attaching?: boolean;
}) {
  const stateLabel = REF_STATE_LABELS[reference.state];

  return (
    <li className="flex items-center gap-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm text-fg">
        {reference.title}
        {reference.subtitle && (
          <span className="ml-2 font-mono text-xs text-fg-muted">
            {reference.subtitle}
          </span>
        )}
      </span>

      {stateLabel && (
        <Badge tone={STATE_TONE[reference.state] ?? "neutral"}>
          {stateLabel}
        </Badge>
      )}

      <button
        type="button"
        disabled={attaching}
        onClick={onAttach}
        className="shrink-0 rounded-sm px-2 py-1 text-xs font-medium text-primary transition-colors duration-fast hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        Attach
      </button>
    </li>
  );
}
