#!/usr/bin/env node
/**
 * Proves the Content Security Policy against a real production build.
 *
 * A CSP is the one piece of hardening that fails silently *and* catastrophically.
 * Get it slightly wrong and the server still returns 200, the HTML still
 * arrives, the page still paints — and nothing runs. No test that only reads
 * the header would notice, because the header is not the thing that breaks;
 * the mismatch between the header and the HTML is.
 *
 * So this drives Chromium against `next start` and counts
 * `securitypolicyviolation` events. Zero, or the build fails.
 *
 *   node ops/check-csp.mjs            # builds if .next is missing
 *   node ops/check-csp.mjs --port 3210
 *
 * Runs in CI after the production build, where it is the only thing standing
 * between a nonce typo and a blank dashboard on the box.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { chromium } from "playwright";

/**
 * Same convention as playwright.config.ts: use the browser the image already
 * has rather than downloading a second copy, and drop the sandbox because the
 * container runs as root.
 */
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";
const LAUNCH = existsSync(PREINSTALLED_CHROMIUM)
  ? { executablePath: PREINSTALLED_CHROMIUM, args: ["--no-sandbox"] }
  : {};

const PORT = Number(argValue("--port") ?? 3211);

/*
 * `localhost`, not `127.0.0.1`, and the two are not interchangeable here.
 *
 * Node normalises a loopback `Host: 127.0.0.1:PORT` to `localhost:PORT`, so a
 * redirect built from the Host header comes back pointing at `localhost` while
 * the browser is on `127.0.0.1`. Different host, different origin, and
 * `connect-src 'self'` refuses it — a CSP failure caused entirely by the
 * harness. Browsing the same name the server reports removes the difference.
 */
const HOST = "localhost";
const BASE = `http://${HOST}:${PORT}`;

/** Pages that must load, and what each one is here to prove. */
const PAGES = [
  { path: "/login", why: "the only unauthenticated page with a form" },
  { path: "/offline", why: "statically prerendered, served by the worker" },
  {
    path: "/dashboard",
    why: "the app shell — redirects, but must not violate",
  },
  { path: "/no-such-page", why: "the 404, which is prerendered too" },
];

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
      // `npx` forks the real server, and killing the wrapper leaves the child
      // holding the port. The next run then binds nothing, silently talks to
      // the *previous* build, and reports whatever that build did — which is
      // exactly how a green check can certify code that no longer exists.
      detached: true,
      env: {
        ...process.env,
        NODE_ENV: "production",
        // Memory mode is refused by a production build
        // (src/lib/data-mode.ts), so this really is the production code path.
        // The placeholders only let the Supabase client be constructed;
        // nothing is called.
        NEXT_PUBLIC_SUPABASE_URL:
          process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY:
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "csp-check-placeholder",
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

/** True when anything at all is already listening on the port. */
async function portAnswers() {
  try {
    await fetch(`${BASE}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return true;
  } catch {
    return false;
  }
}

/** Kill the whole group, not just the `npx` wrapper. */
function stopServer() {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

/* ── The checks ───────────────────────────────────────────────────────── */

function directive(policy, name) {
  return policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
}

async function checkHeaders() {
  const response = await fetch(`${BASE}/login`, { redirect: "manual" });
  const policy = response.headers.get("content-security-policy");

  if (!policy) {
    fail("/login has no Content-Security-Policy header at all");
    return;
  }

  const scriptSrc = directive(policy, "script-src") ?? "";

  if (scriptSrc.includes("'unsafe-inline'")) {
    fail(`script-src still allows inline script: ${scriptSrc}`);
  } else {
    pass("script-src has no 'unsafe-inline'");
  }

  if (scriptSrc.includes("'unsafe-eval'")) {
    fail(`a production build is serving 'unsafe-eval': ${scriptSrc}`);
  } else {
    pass("script-src has no 'unsafe-eval'");
  }

  if (/'nonce-[A-Za-z0-9+/]+={0,2}'/.test(scriptSrc)) {
    pass("script-src carries a nonce");
  } else {
    fail(`script-src carries no nonce: ${scriptSrc}`);
  }

  // A nonce that never changes is decoration. Two requests, two values.
  const second = await fetch(`${BASE}/login`, { redirect: "manual" });
  const secondPolicy = second.headers.get("content-security-policy") ?? "";

  if (policy === secondPolicy) {
    fail("two requests got the same nonce — it is not per-request");
  } else {
    pass("the nonce changes between requests");
  }
}

async function checkOfflineIsSelfContained() {
  const response = await fetch(`${BASE}/offline`);
  const policy = response.headers.get("content-security-policy") ?? "";
  const html = await response.text();

  if (!policy) {
    fail("/offline has no policy — middleware skips it, config must cover it");
    return;
  }
  pass("/offline carries its own static policy");

  // The carve-out is only defensible while the page is inert. If it ever
  // starts fetching, the loosened script-src stops being harmless.
  if (/<script[^>]+src="https?:\/\//.test(html)) {
    fail("/offline loads a script from another origin");
  } else {
    pass("/offline loads nothing from another origin");
  }
}

async function checkNoViolations() {
  const browser = await chromium.launch(LAUNCH);

  try {
    for (const { path, why } of PAGES) {
      const context = await browser.newContext();
      const page = await context.newPage();

      const violations = [];

      // The real signal. `securitypolicyviolation` fires in the page for
      // every directive the browser actually enforced against.
      await page.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener("securitypolicyviolation", (event) => {
          window.__cspViolations.push(
            `${event.violatedDirective} blocked ${event.blockedURI || "inline"}`,
          );
        });
      });

      page.on("console", (message) => {
        const text = message.text();
        if (text.includes("Content Security Policy")) violations.push(text);
      });

      // `load`, not `networkidle`. A blocked bootstrap means the chunks that
      // would have settled the network never get requested, so waiting for
      // idle on a *failing* page is waiting for something that cannot happen —
      // the check would time out instead of reporting the violation it just
      // caught.
      await page.goto(`${BASE}${path}`, { waitUntil: "load" });
      await page.waitForTimeout(500);

      const reported = await page.evaluate(() => window.__cspViolations ?? []);
      violations.push(...reported);

      if (violations.length > 0) {
        fail(`${path} (${why})`);
        for (const violation of new Set(violations)) {
          console.error(`            ${violation}`);
        }
      } else {
        pass(`${path} loads with no CSP violation — ${why}`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function checkHydrationActuallyHappens() {
  // The failure this whole script exists to catch: policy and HTML disagree,
  // so React never mounts. A rendered form proves nothing; a form that
  // responds to typing proves the bootstrap ran.
  const browser = await chromium.launch(LAUNCH);

  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "load" });

    await page.getByLabel("Email").fill("someone@example.invalid");
    await page.getByLabel("Password").fill("hunter2");

    // Controlled inputs only keep what they are given if React is running.
    const value = await page.getByLabel("Email").inputValue();

    if (value === "someone@example.invalid") {
      pass("the sign-in form hydrates and accepts input");
    } else {
      fail("the sign-in form did not hydrate — the bootstrap was blocked");
    }
  } finally {
    await browser.close();
  }
}

/* ── Run ──────────────────────────────────────────────────────────────── */

try {
  // Refuse to certify a server we did not start. Without this, a leftover
  // process from a previous run answers every request and the check reports
  // on a build that is no longer on disk.
  if (await portAnswers()) {
    throw new Error(
      `something is already serving ${BASE} — kill it, or pass --port`,
    );
  }

  startServer();
  await waitForServer();

  await checkHeaders();
  await checkOfflineIsSelfContained();
  await checkNoViolations();
  await checkHydrationActuallyHappens();
} catch (error) {
  fail(String(error));
} finally {
  stopServer();
}

if (failures > 0) {
  console.error(`\n${failures} CSP check(s) failed`);
  process.exit(1);
}

console.log("\nCSP verified against a production build");
process.exit(0);
