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
      // Present but unused — memory mode never calls Supabase.
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-placeholder",
    },
  },
});
