import "server-only";

import { isMemoryMode } from "@/lib/data-mode";
import { reportError } from "@/lib/observability/report";

/**
 * Loads the demo week once, on first use.
 *
 * ── Why not `instrumentation.ts` ─────────────────────────────────────────
 * That was the obvious home for it and it does not work: Next compiles
 * instrumentation for the edge runtime as well as Node, so importing the
 * seed from there pulled `node:crypto` into an edge bundle and took the whole
 * application down with it. This module is `server-only` and is reached from
 * a server component, which is Node by definition.
 *
 * ── Three guards, all required ───────────────────────────────────────────
 * `DASHBOARD_DEMO_DATA` must be set; memory mode must be on (and memory mode
 * itself cannot exist under `NODE_ENV=production`); and the work happens
 * once per process. The end-to-end suite runs in memory mode *without* the
 * flag, so its fixtures are untouched — a demo that quietly changed what the
 * tests see would be worse than no demo.
 */

let started: Promise<void> | null = null;

export function ensureDemoSeeded(): Promise<void> {
  if (!process.env.DASHBOARD_DEMO_DATA) return Promise.resolve();
  if (!isMemoryMode()) {
    // Said out loud rather than ignored: whoever set the flag is expecting
    // data, and silence would look like the seed failing.
    console.warn(
      JSON.stringify({
        type: "demo-data",
        status: "skipped",
        reason:
          "DASHBOARD_DEMO_DATA is set but memory mode is off. Demo data is never written to a real database.",
      }),
    );
    return Promise.resolve();
  }

  // Memoised on the promise, not on a boolean: two requests arriving together
  // would otherwise both start seeding and interleave their writes.
  started ??= (async () => {
    try {
      const { seedDemoWeek } = await import("./seed");
      await seedDemoWeek();
      console.info(
        JSON.stringify({
          type: "demo-data",
          status: "loaded",
          detail: "A week of demo activity is in memory. Nothing persisted.",
        }),
      );
    } catch (error) {
      reportError(error, { source: "demo-data", severity: "warning" });
    }
  })();

  return started;
}
