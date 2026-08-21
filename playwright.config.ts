import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Some container images ship a pre-installed Chromium whose build number
 * doesn't match the pinned `@playwright/test`. Point at it when it is there
 * rather than downloading a second copy; on CI the path is absent and
 * Playwright uses the browser it installed itself.
 */
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";
const launchOptions = existsSync(PREINSTALLED_CHROMIUM)
  ? {
      executablePath: PREINSTALLED_CHROMIUM,
      // The container runs as root, where the sandbox can't initialise.
      args: ["--no-sandbox"],
    }
  : {};

/**
 * End-to-end configuration.
 *
 * The app runs in memory mode (see `src/lib/data-mode.ts`): a real Next.js
 * server, the real UI, the real repository contract — but rows in process
 * instead of Postgres, and auth bypassed. That is the only way CI can drive
 * the actual interface without a self-hosted Supabase to point at.
 *
 * It runs `next dev` rather than a production build on purpose: memory mode
 * refuses to activate when NODE_ENV is production, which is the guard that
 * makes it impossible to enable on the box.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // One in-memory store, shared by the server.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  /*
   * Ten seconds, not Playwright's default five.
   *
   * These specs drive `next dev`, which compiles a route the first time
   * anything asks for it. On a loaded machine that first hit can take longer
   * than five seconds on its own, so whichever test happened to reach a route
   * first would fail — and pass on the next run, because the route was then
   * warm. Two different notes specs failed that way on consecutive Phase 7
   * runs before this was set.
   *
   * A raised timeout does not make a slow assertion pass; it makes a *cold*
   * one wait long enough to be measured. The individual `timeout: 10_000`
   * arguments scattered through the specs were the same fix applied one test
   * at a time, by whoever was unlucky enough to hit it.
   */
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // The owner's timezone is a first-class input; pin it so date assertions
    // mean something.
    timezoneId: "America/New_York",
    locale: "en-US",
  },

  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], launchOptions },
      testIgnore: /responsive\.spec\.ts/,
    },
    {
      // The PWA is used from a phone; the shell swaps to a bottom bar there.
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], launchOptions },
      testMatch: /responsive\.spec\.ts/,
    },
  ],

  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `${BASE_URL}/dashboard`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      DASHBOARD_DATA_MODE: "memory",
      // The same zone the browser runs in (`timezoneId` above).
      //
      // The memory fixtures seed meetings at "nine o'clock this morning",
      // computed with the *server's* clock, while the agenda asks for "today"
      // in the *browser's*. On a UTC machine those are the same day for
      // twenty hours and different days for four: run the suite between
      // 00:00 and 04:00 UTC and every calendar spec fails, because the seeded
      // meetings genuinely fall outside the day being asked for. Pinning the
      // server to the browser's zone makes "today" mean one thing.
      TZ: "America/New_York",
      // Present but unused — memory mode never calls Supabase.
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-placeholder",
    },
  },
});
