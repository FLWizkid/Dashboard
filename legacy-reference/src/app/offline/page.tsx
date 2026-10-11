import { WifiOff } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline",
};

/**
 * Served by the service worker when a navigation can't reach the box.
 *
 * Static on purpose: it has to render from cache with no data and no session.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <WifiOff aria-hidden="true" className="mx-auto size-8 text-fg-subtle" />
        <h1 className="mt-4 text-lg font-semibold text-fg">
          You&apos;re offline
        </h1>
        <p className="mt-2 text-sm text-fg-muted">
          The dashboard lives on your own machine and is reachable over your
          private network. Reconnect to the tailnet and this page will come back
          on its own.
        </p>
      </div>
    </main>
  );
}
