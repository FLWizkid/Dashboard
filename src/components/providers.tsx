"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LazyMotion, domAnimation } from "framer-motion";
import * as React from "react";

import { OutboxProvider } from "@/lib/hours/use-outbox";
import { PomodoroProvider } from "@/lib/hours/use-pomodoro";

import { SettingsProvider } from "./settings-provider";
import { ToastProvider } from "./ui/toast";

/**
 * Client providers, mounted once in the dashboard layout.
 *
 * The QueryClient is created inside state so a Fast Refresh (or a second
 * render pass) doesn't hand two trees different caches.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Capture-and-complete is a foreground activity: data is fresh
            // enough for a few seconds, and mutations invalidate explicitly.
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
          mutations: { retry: 0 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        {/*
          Framer Motion, loaded as features rather than as a component library.

          The full `motion` export drags every animation feature into the
          first-load bundle of every route that animates anything — gestures,
          layout projection, drag, SVG path morphing — when this product uses
          opacity, transform and `AnimatePresence`. `domAnimation` is the
          subset that covers exactly that, and it is a fraction of the size.

          `strict` is the part that keeps it honest: with it, `motion.div`
          throws at runtime and only `m.div` works. Without it, one import of
          `motion` in a new component silently pulls the whole library back in
          and the saving disappears with nothing to show for it. The bundle
          budget in ops/check-bundle.mjs would eventually notice; a thrown
          error in development notices immediately.
        */}
        <LazyMotion features={domAnimation} strict>
          <ToastProvider>
            {/* Inside the query client — the outbox invalidates hours queries
                when a flush lands — and mounted once, so the whole tab shares
                one queue. */}
            <OutboxProvider>
              <PomodoroProvider>{children}</PomodoroProvider>
            </OutboxProvider>
          </ToastProvider>
        </LazyMotion>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
