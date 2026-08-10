"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
        <ToastProvider>
          {/* Inside the query client — the outbox invalidates hours queries
              when a flush lands — and mounted once, so the whole tab shares
              one queue. */}
          <OutboxProvider>
            <PomodoroProvider>{children}</PomodoroProvider>
          </OutboxProvider>
        </ToastProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
