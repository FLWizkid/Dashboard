"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useCategories } from "@/lib/tasks/client";

/**
 * What the next focus block is for, and how long you have.
 *
 * ── Asked before, not after ──────────────────────────────────────────────
 * Focused hours were the only source arriving unfiled: scheduled time
 * inherits its category from the calendar event and manual entries are filed
 * as they are typed, while a Pomodoro landed in the weekly split with no
 * category at all — despite being the source most likely to represent the
 * actual work. Asking at the end does not fix it, because by then the answer
 * has faded and the honest response is "whatever, skip".
 *
 * ── A length, not a preference ───────────────────────────────────────────
 * "I have forty minutes before the next meeting" is a fact about this
 * afternoon. It sets the length of this block and leaves the configured
 * 25/5/15 alone.
 *
 * Both lock while the timer runs: changing what a block was for halfway
 * through is a different session, and the honest way to have one is to stop
 * this and start that.
 */

/** Offered lengths. Thirty is the floor everywhere in this product. */
const LENGTHS = [30, 45, 60, 90] as const;

export function FocusSetup({
  categoryId,
  onCategoryChange,
  plannedOverrideMinutes,
  onLengthChange,
  defaultMinutes,
  disabled,
}: {
  categoryId: string | null;
  onCategoryChange: (categoryId: string | null) => void;
  plannedOverrideMinutes: number | null;
  onLengthChange: (minutes: number | null) => void;
  defaultMinutes: number;
  disabled: boolean;
}) {
  const categories = useCategories();

  return (
    <Card data-testid="focus-setup">
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1">
          <label
            htmlFor="focus-category"
            className="text-sm font-medium text-fg"
          >
            What kind of work is this?
          </label>
          <select
            id="focus-category"
            className="w-full rounded-md border border-line bg-surface px-2 py-2 text-sm sm:max-w-xs"
            value={categoryId ?? ""}
            disabled={disabled}
            onChange={(event) => onCategoryChange(event.target.value || null)}
            data-testid="focus-category"
          >
            {/* Unfiled stays available: refusing to start without a category
                would make the honest answer the one thing you cannot give. */}
            <option value="">Unfiled</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-fg-subtle">
            Carried onto the time entry when the session ends.
          </p>
        </div>

        <div className="space-y-1">
          <span id="focus-length-label" className="text-sm font-medium text-fg">
            How long have you got?
          </span>
          <div
            role="group"
            aria-labelledby="focus-length-label"
            className="flex flex-wrap gap-2"
          >
            <button
              type="button"
              disabled={disabled}
              aria-pressed={plannedOverrideMinutes === null}
              onClick={() => onLengthChange(null)}
              className={buttonClass(plannedOverrideMinutes === null)}
            >
              {defaultMinutes}m
              <span className="ml-1 text-xs opacity-70">default</span>
            </button>

            {LENGTHS.filter((minutes) => minutes !== defaultMinutes).map(
              (minutes) => (
                <button
                  key={minutes}
                  type="button"
                  disabled={disabled}
                  aria-pressed={plannedOverrideMinutes === minutes}
                  onClick={() => onLengthChange(minutes)}
                  className={buttonClass(plannedOverrideMinutes === minutes)}
                >
                  {minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}
                </button>
              ),
            )}
          </div>
          <p className="text-xs text-fg-subtle">
            Just this block — your 25/5/15 settings are untouched.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function buttonClass(active: boolean): string {
  return [
    "min-h-11 rounded-md border px-3 text-sm font-medium transition-colors",
    "disabled:opacity-40 disabled:pointer-events-none",
    active
      ? "border-primary bg-primary-soft text-primary-soft-fg"
      : "border-line text-fg hover:bg-surface-muted",
  ].join(" ");
}
