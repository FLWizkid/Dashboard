"use client";

import { AlertTriangle } from "lucide-react";
import * as React from "react";

import { reportError } from "@/lib/observability/report";

// `global-error` replaces the root layout, so it cannot rely on the layout's
// stylesheet import to have run. Importing it here is deduplicated by the
// bundler and guarantees this page is styled rather than raw HTML.
import "./globals.css";

/**
 * The last line of defence: a client-side error that escaped every boundary.
 *
 * `global-error` replaces the root layout, so it has to carry its own <html>
 * and <body> and cannot use anything from the app shell.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Same redaction path as the server: the digest identifies the failure in
    // the logs without putting anything sensitive in the browser's report.
    reportError(error, {
      source: "global-error",
      severity: "fatal",
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-bg font-sans text-fg antialiased">
        <main className="flex min-h-screen items-center justify-center px-4">
          <div className="max-w-sm text-center">
            <AlertTriangle
              aria-hidden="true"
              className="mx-auto size-8 text-danger"
            />
            <h1 className="mt-4 text-lg font-semibold text-fg">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-fg-muted">
              The error has been logged on your box. Nothing was sent anywhere
              else.
            </p>
            {error.digest ? (
              <p className="mt-2 font-mono text-xs text-fg-subtle">
                {error.digest}
              </p>
            ) : null}
            <button
              type="button"
              onClick={reset}
              className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-colors duration-fast hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
