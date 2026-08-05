import * as React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A card whose module hasn't been built yet.
 *
 * It shows the real frame and says plainly what will fill it and when. No
 * sample meetings, no invented numbers — a dashboard that lies to you during
 * development is a dashboard you learn to distrust.
 */
export function PlaceholderCard({
  title,
  description,
  phase,
  icon,
  className,
}: {
  title: string;
  description: string;
  phase: string;
  icon: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <span className="text-fg-subtle [&_svg]:size-4">{icon}</span>
            {title}
          </CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>
        <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[0.625rem] font-medium text-fg-muted">
          {phase}
        </span>
      </CardHeader>
      <CardContent className="flex flex-1 items-center">
        <div
          aria-hidden="true"
          className="w-full space-y-2 rounded-md border border-dashed border-line-strong p-4"
        >
          {/* `bg-line`, not `bg-surface-muted`: in the dark theme the muted
              surface and the raised surface are the same value, so these bars
              would be invisible. */}
          <div className="h-2 w-2/3 rounded-full bg-line" />
          <div className="h-2 w-1/2 rounded-full bg-line" />
          <div className="h-2 w-3/5 rounded-full bg-line" />
        </div>
        <span className="sr-only">
          This module arrives in phase {phase}. Nothing to show yet.
        </span>
      </CardContent>
    </Card>
  );
}
