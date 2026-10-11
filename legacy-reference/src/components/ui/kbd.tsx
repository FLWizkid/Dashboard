import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A keycap. Used in the shortcut sheet and inline hints.
 *
 * 12px, not the 11px it used to be. Keycaps are the smallest text in the
 * product, and the headset checks (tests/e2e/headset.spec.ts) put a floor
 * under that: read through headset optics at a simulated arm's length, 11px
 * is guesswork. The extra pixel costs nothing here and is the difference
 * between a hint and a smudge — on a laptop too, for anyone whose eyes are
 * not twenty-five.
 */
export function Kbd({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong",
        "bg-surface-muted px-1.5 font-sans text-xs font-medium text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}
