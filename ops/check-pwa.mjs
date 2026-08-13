#!/usr/bin/env node
/**
 * Proves the PWA against a real production build.
 *
 * The service worker only registers when `NODE_ENV === "production"` — in
 * development it would serve stale chunks and make every change look like it
 * had not applied. That is the right call, and it means the end-to-end suite,
 * which runs `next dev`, can never exercise any of this. Installability and
 * offline behaviour would be things nobody ever checked.
 *
 *   node ops/check-pwa.mjs              # after `next build`
 *   node ops/check-pwa.mjs --port 3212
 *
 * What it checks is what actually goes wrong: a manifest with a broken icon
 * path, a worker that registers but never takes control, and an offline page
 * that is only reachable while online.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { chromium } from "playwright";

const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";
const LAUNCH = existsSync(PREINSTALLED_CHROMIUM)
  ? { executablePath: PREINSTALLED_CHROMIUM, args: ["--no-sandbox"] }
  : {};

const PORT = Number(argValue("--port") ?? 3212);
const HOST = "localhost";
const BASE = `http://${HOST}:${PORT}`;

let failures = 0;

function fail(message) {
  console.error(`  FAILED  ${message}`);
  failures += 1;
}

function pass(message) {
  console.log(`  ok      ${message}`);
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/* ── The server ───────────────────────────────────────────────────────── */

let server = null;
let serverLog = "";

function startServer() {
  server = spawn(
    "npx",
    ["next", "start", "--port", String(PORT), "--hostname", HOST],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: {
        ...process.env,
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL:
          process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY:
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "pwa-check-placeholder",
      },
    },
  );

  server.stdout.on("data", (chunk) => (serverLog += chunk));
  server.stderr.on("data", (chunk) => (serverLog += chunk));
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await sleep(500);
  }
  throw new Error(`server never started:\n${serverLog}`);
}

async function portAnswers() {
  try {
    await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

function stopServer() {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

/* ── Checks ───────────────────────────────────────────────────────────── */

async function checkManifest() {
  const response = await fetch(`${BASE}/manifest.webmanifest`);

  if (!response.ok) {
    fail(`the manifest is not served (${response.status})`);
    return;
  }

  const manifest = await response.json();

  for (const field of ["name", "short_name", "start_url", "display", "icons"]) {
    if (!manifest[field]) {
      fail(`the manifest has no ${field}`);
      return;
    }
  }
  pass("the manifest has the fields an install prompt needs");

  if (manifest.display !== "standalone" && manifest.display !== "fullscreen") {
    fail(`display is "${manifest.display}" — it will open in a browser tab`);
  } else {
    pass(`display is "${manifest.display}"`);
  }

  // The classic broken install: a manifest that validates and points at
  // icons that 404. The prompt simply never appears, with no error anywhere.
  let iconsOk = true;
  for (const icon of manifest.icons) {
    const iconResponse = await fetch(new URL(icon.src, BASE));
    if (!iconResponse.ok) {
      fail(`icon ${icon.src} is missing (${iconResponse.status})`);
      iconsOk = false;
    }
  }
  if (iconsOk) pass(`all ${manifest.icons.length} manifest icons resolve`);

  const sizes = manifest.icons.map((icon) => icon.sizes ?? "");
  if (sizes.some((size) => size.includes("512"))) {
    pass("a 512px icon is present, which installability requires");
  } else {
    fail("no 512px icon — most browsers will refuse to offer an install");
  }
}

async function checkServiceWorker() {
  const browser = await chromium.launch(LAUNCH);

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${BASE}/login`, { waitUntil: "load" });

    const registered = await page
      .waitForFunction(
        async () => {
          const registration =
            await navigator.serviceWorker?.getRegistration?.();
          return Boolean(registration?.active);
        },
        undefined,
        { timeout: 20_000 },
      )
      .then(() => true)
      .catch(() => false);

    if (!registered) {
      fail("no service worker became active on a production build");
      await context.close();
      return;
    }
    pass("the service worker registers and activates");

    // Registered is not the same as controlling. The first load is usually
    // uncontrolled unless the worker claims clients — and a worker that never
    // claims is a worker that does nothing until the second visit, which is
    // exactly the visit that has no network.
    await page.reload({ waitUntil: "load" });

    const controlled = await page.evaluate(
      () => navigator.serviceWorker.controller !== null,
    );

    if (controlled) pass("it controls the page");
    else
      fail("it never took control — offline would fall through to the network");

    /* The point of all of it: the offline page with the network gone. */
    await context.setOffline(true);

    const response = await page
      .goto(`${BASE}/dashboard`, { waitUntil: "load" })
      .catch(() => null);

    if (!response) {
      fail("navigating offline produced the browser's own error page");
    } else {
      const body = await page.textContent("body");
      if (body && /offline/i.test(body)) {
        pass("navigating offline serves the app's own offline page");
      } else {
        fail("navigating offline served something, but not the offline page");
      }
    }

    await context.setOffline(false);
    await context.close();
  } finally {
    await browser.close();
  }
}

/* ── Run ──────────────────────────────────────────────────────────────── */

try {
  if (await portAnswers()) {
    throw new Error(
      `something is already serving ${BASE} — kill it, or pass --port`,
    );
  }

  startServer();
  await waitForServer();

  await checkManifest();
  await checkServiceWorker();
} catch (error) {
  fail(String(error));
} finally {
  stopServer();
}

if (failures > 0) {
  console.error(`\n${failures} PWA check(s) failed\n`);
  process.exit(1);
}

console.log("\nPWA verified against a production build\n");
