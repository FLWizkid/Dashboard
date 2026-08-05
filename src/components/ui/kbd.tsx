import * as React from "react";

import { cn } from "@/lib/utils";

/** A keycap. Used in the shortcut sheet and inline hints. */
export function Kbd({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong",
        "bg-surface-muted px-1.5 font-sans text-[0.6875rem] font-medium text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}
