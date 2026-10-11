"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const controlClasses = cn(
  "w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-fg",
  "placeholder:text-fg-subtle",
  "transition-colors duration-fast ease-standard",
  "hover:border-fg-subtle",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(controlClasses, "h-10", className)}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(controlClasses, "min-h-20 py-2 leading-relaxed", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

/**
 * A plain native select. Radix's Select is lovely but a native control is
 * faster to operate with the keyboard and is what a "type, tab, done" capture
 * flow actually wants.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(controlClasses, "h-10 cursor-pointer pr-8", className)}
    {...props}
  />
));
Select.displayName = "Select";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "text-xs font-medium uppercase tracking-wide text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}
