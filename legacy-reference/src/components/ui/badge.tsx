import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-surface-muted text-fg-muted",
        outline: "border border-line-strong text-fg-muted",
        primary: "bg-primary-soft text-primary-soft-fg",
        accent: "bg-accent-soft text-accent",
        critical: "bg-priority-critical-soft text-priority-critical",
        high: "bg-priority-high-soft text-priority-high",
        normal: "bg-priority-normal-soft text-priority-normal",
        low: "bg-priority-low-soft text-priority-low",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };
