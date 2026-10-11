import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The surface everything sits on.
 *
 * The shadow used to be a hard-coded `rgb(0 0 0 / 0.04)` — nearly invisible
 * on paper and entirely invisible on a dark page, which left every card as a
 * hairline rectangle and made the whole interface read as flat. It now takes
 * the theme's own elevation token: navy-tinted in daylight, because a grey
 * shadow over a blue page reads as grime, and in the dark it leans on
 * `--surface-raised` instead, where nothing casts a visible shadow against
 * near-black and separation has to come from the surface being genuinely
 * lighter than what is behind it.
 */
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface-raised shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 p-5 pb-3",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("text-sm font-semibold tracking-tight text-fg", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-fg-muted", className)} {...props} />;
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-line px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}
