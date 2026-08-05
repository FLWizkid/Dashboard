"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import * as React from "react";

import { riseIn } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { Button } from "./button";
import { Kbd } from "./kbd";

/**
 * Toasts, with a first-class undo.
 *
 * Undo is the safety net that makes one-tap complete safe to make *actually*
 * one tap, so it gets more than a button: the most recent undoable toast is
 * reachable with the `u` key from anywhere (see `useUndoHotkey`).
 *
 * The region is `aria-live="polite"` and the message carries the same words a
 * sighted user reads — an undo the screen reader can't hear about is not an
 * undo.
 */

export interface ToastAction {
  label: string;
  onAction: () => void | Promise<void>;
  /** Shown next to the label; also the key that triggers it globally. */
  shortcut?: string;
}

export interface ToastOptions {
  title: string;
  description?: string;
  action?: ToastAction;
  /** Milliseconds before auto-dismiss. `0` keeps it until dismissed. */
  duration?: number;
  tone?: "neutral" | "success" | "danger";
}

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
  /** Runs the newest toast action bound to `key`, if there is one. */
  triggerShortcut: (key: string) => boolean;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 8000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const nextId = React.useRef(1);
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = React.useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...options, id }]);

      const duration = options.duration ?? DEFAULT_DURATION;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }

      return id;
    },
    [dismiss],
  );

  // Keep the newest toasts in a ref so the global hotkey reads current state
  // without re-binding its listener on every toast.
  const toastsRef = React.useRef<ToastRecord[]>([]);
  React.useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  const triggerShortcut = React.useCallback(
    (key: string) => {
      const match = [...toastsRef.current]
        .reverse()
        .find((item) => item.action?.shortcut === key);
      if (!match?.action) return false;
      void match.action.onAction();
      dismiss(match.id);
      return true;
    },
    [dismiss],
  );

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = React.useMemo(
    () => ({ toast, dismiss, triggerShortcut }),
    [toast, dismiss, triggerShortcut],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside a ToastProvider");
  }
  return context;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: number) => void;
}) {
  const reduced = useReducedMotion();

  return (
    <div
      // `role="status"` + polite: announced without interrupting.
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        "no-print pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4",
        "sm:bottom-4 sm:left-auto sm:right-4 sm:items-end sm:p-0",
      )}
    >
      <AnimatePresence initial={false}>
        {toasts.map((item) => (
          <motion.div
            key={item.id}
            layout={!reduced}
            variants={riseIn(reduced, 10)}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 shadow-lg",
              item.tone === "danger"
                ? "border-danger/40 bg-surface-raised"
                : "border-line bg-surface-raised",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">{item.title}</p>
              {item.description ? (
                <p className="mt-0.5 text-xs text-fg-muted">
                  {item.description}
                </p>
              ) : null}
            </div>

            {item.action ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void item.action?.onAction();
                  onDismiss(item.id);
                }}
              >
                {item.action.label}
                {item.action.shortcut ? (
                  <Kbd aria-hidden="true">{item.action.shortcut}</Kbd>
                ) : null}
              </Button>
            ) : null}

            <button
              type="button"
              onClick={() => onDismiss(item.id)}
              className="rounded-sm p-0.5 text-fg-subtle transition-colors duration-fast hover:text-fg"
            >
              <span className="sr-only">Dismiss</span>
              <svg
                viewBox="0 0 12 12"
                className="size-3"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
