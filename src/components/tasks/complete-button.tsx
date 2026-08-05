"use client";

import { motion, useReducedMotion } from "framer-motion";
import * as React from "react";

import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The task-complete moment.
 *
 * One tap, and three things happen at once: the ring fills forest green, the
 * checkmark draws itself, and a single brass ring pulses outward and is gone.
 * It lasts about 400ms, is never blocking, and under `prefers-reduced-motion`
 * it becomes a plain state change with no travel at all.
 *
 * The control is a real `role="checkbox"` so it is operable and announced
 * exactly like one.
 */
export function CompleteButton({
  completed,
  onToggle,
  label,
  size = "md",
  className,
}: {
  completed: boolean;
  onToggle: (next: boolean) => void;
  /** The task title, so the accessible name says what is being completed. */
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [celebrating, setCelebrating] = React.useState(false);

  const dimension = size === "sm" ? "size-5" : "size-6";

  function handleToggle() {
    const next = !completed;
    if (next && !reduced) {
      setCelebrating(true);
      window.setTimeout(() => setCelebrating(false), DURATION.celebrate * 1000);
    }
    onToggle(next);
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={completed}
      aria-label={completed ? `Reopen ${label}` : `Complete ${label}`}
      onClick={handleToggle}
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full",
        "transition-transform duration-fast ease-standard",
        reduced ? "" : "active:scale-90",
        dimension,
        className,
      )}
    >
      {/* Brass pulse — decorative, so it never announces anything. */}
      {celebrating ? (
        <motion.span
          aria-hidden="true"
          initial={{ opacity: 0.55, scale: 1 }}
          animate={{ opacity: 0, scale: 2.1 }}
          transition={{ duration: DURATION.celebrate, ease: EASE.out }}
          className="absolute inset-0 rounded-full border-2 border-accent-bright"
        />
      ) : null}

      <svg
        viewBox="0 0 24 24"
        className={cn(dimension, "relative")}
        aria-hidden="true"
      >
        <motion.circle
          cx="12"
          cy="12"
          r="10"
          fill="none"
          strokeWidth="2"
          initial={false}
          animate={{
            stroke: completed
              ? "rgb(var(--primary))"
              : "rgb(var(--border-strong))",
            fill: completed ? "rgb(var(--primary))" : "rgba(0,0,0,0)",
          }}
          transition={{ duration: reduced ? 0 : DURATION.fast }}
        />
        <motion.path
          d="M7.5 12.4l3.1 3.1 6-6.2"
          fill="none"
          stroke="rgb(var(--primary-fg))"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          style={{ pathLength: 1 }}
          animate={{
            pathLength: completed ? 1 : 0,
            opacity: completed ? 1 : 0,
          }}
          transition={{
            duration: reduced ? 0 : DURATION.base,
            ease: EASE.out,
            delay: completed && !reduced ? 0.04 : 0,
          }}
        />
      </svg>
    </button>
  );
}
