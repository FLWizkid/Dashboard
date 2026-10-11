"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Timer } from "lucide-react";

import { usePomodoro } from "@/lib/hours/client";
import { formatRemaining } from "@/lib/hours/pomodoro";
import { usePomodoroTimer } from "@/lib/hours/use-pomodoro";

/**
 * The persistent "currently focusing" indicator.
 *
 * The specification asks for it and the reason is behavioural: a timer you
 * can't see while you work in another module is a timer you forget to stop,
 * and a forgotten timer produces hours you don't believe.
 *
 * It is deliberately absent on the Pomodoro page itself — the dial is right
 * there — and absent when nothing is running, rather than showing a dormant
 * chip that becomes furniture.
 */
export function FocusIndicator() {
  const pathname = usePathname();
  const timer = usePomodoroTimer();
  const server = usePomodoro();

  const active = timer.running || timer.state.paused;
  const onPomodoroPage = pathname?.startsWith("/dashboard/pomodoro") ?? false;

  // The server's running row is the fallback for a device that has just been
  // opened: the local machine is idle but there genuinely is a session.
  const serverRunning = server.data?.running ?? null;
  if (!active && !serverRunning) return null;
  if (onPomodoroPage) return null;

  const label = timer.state.paused ? "Paused" : "Focusing";

  return (
    <Link
      href="/dashboard/pomodoro"
      data-testid="focus-indicator"
      className="no-print fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full border border-line-strong bg-surface-raised px-3.5 py-2 text-sm shadow-[0_2px_8px_rgb(0_0_0/0.12)] transition-colors duration-fast hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:bottom-6"
    >
      <span
        className={
          timer.running
            ? "size-2 shrink-0 rounded-full bg-primary motion-safe:animate-pulse"
            : "size-2 shrink-0 rounded-full bg-fg-subtle"
        }
        aria-hidden="true"
      />
      <span className="text-fg-subtle [&_svg]:size-3.5" aria-hidden="true">
        <Timer />
      </span>
      <span className="font-mono tabular-nums text-fg">
        {formatRemaining(timer.remaining)}
      </span>
      <span className="sr-only">
        {label}. {Math.ceil(timer.remaining / 60)} minutes left. Open the
        Pomodoro timer.
      </span>
    </Link>
  );
}
