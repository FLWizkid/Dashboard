"use client";

import * as React from "react";

/**
 * Global single-key shortcuts.
 *
 * Two rules keep them out of the way:
 *   • They never fire while the caret is in a text field, a select, or
 *     anything contenteditable — `Escape` is the one exception, because
 *     "get me out of here" has to work everywhere.
 *   • They never fire alongside a modifier, so browser and OS shortcuts win.
 */
export function useGlobalShortcuts(
  handlers: Record<string, (event: KeyboardEvent) => void>,
) {
  const handlersRef = React.useRef(handlers);
  React.useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const isTextEntry =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;

      if (isTextEntry && event.key !== "Escape") return;

      const handler =
        handlersRef.current[event.key] ??
        handlersRef.current[event.key.toLowerCase()];

      if (handler) handler(event);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * Roving focus over the task rows.
 *
 * Focus is read from the DOM rather than mirrored in state: the list
 * reorders as priorities change, and an index would point at the wrong row
 * the moment it did.
 */
export function useRovingFocus(
  containerRef: React.RefObject<HTMLElement | null>,
) {
  const rows = React.useCallback((): HTMLElement[] => {
    const container = containerRef.current;
    if (!container) return [];
    return Array.from(
      container.querySelectorAll<HTMLElement>("[data-task-focusable='true']"),
    );
  }, [containerRef]);

  return React.useCallback(
    (direction: 1 | -1) => {
      const all = rows();
      if (all.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const currentIndex = active ? all.indexOf(active) : -1;

      if (currentIndex === -1) {
        (direction === 1 ? all[0] : all[all.length - 1]).focus();
        return;
      }

      const nextIndex = Math.min(
        Math.max(currentIndex + direction, 0),
        all.length - 1,
      );
      all[nextIndex].focus();
    },
    [rows],
  );
}

/** The task id of the row that currently holds focus, if any. */
export function focusedTaskId(container: HTMLElement | null): string | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !container?.contains(active)) return null;
  return active.closest<HTMLElement>("[data-task-id]")?.dataset.taskId ?? null;
}
