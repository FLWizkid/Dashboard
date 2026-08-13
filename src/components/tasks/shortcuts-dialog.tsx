"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

export const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ["N"], description: "Jump to the quick-add box" },
  { keys: ["/"], description: "Jump to the quick-add box" },
  { keys: ["Enter"], description: "Add the task (from quick-add)" },
  { keys: ["J", "↓"], description: "Move to the next task" },
  { keys: ["K", "↑"], description: "Move to the previous task" },
  { keys: ["X"], description: "Complete or reopen the focused task" },
  { keys: ["E"], description: "Expand or collapse the focused task" },
  { keys: ["P"], description: "Pin or unpin the focused task" },
  { keys: ["U"], description: "Undo the last completion" },
  { keys: ["Esc"], description: "Close, collapse, or clear" },
  { keys: ["?"], description: "Show this list" },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="shortcuts-description">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription id="shortcuts-description">
          Capture and clear your list without reaching for the mouse.
        </DialogDescription>

        <ul className="mt-4 divide-y divide-line">
          {SHORTCUTS.map((shortcut) => (
            <li
              key={shortcut.description + shortcut.keys.join()}
              className="flex items-center justify-between gap-4 py-2"
            >
              <span className="text-sm text-fg-muted">
                {shortcut.description}
              </span>
              <span className="flex shrink-0 gap-1">
                {shortcut.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
