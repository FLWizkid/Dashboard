#!/usr/bin/env node
/**
 * The performance budget.
 *
 * This product is opened dozens of times a day on a laptop, a phone and a
 * headset browser, over a tailnet that is sometimes a hotel wifi away. What
 * matters is not a synthetic score, it is **how much JavaScript has to arrive
 * and parse before the page is usable** — so that is what this measures, and
 * it fails the build rather than printing a number nobody reads.
 *
 *   node ops/check-bundle.mjs           # after `next build`
 *   node ops/check-bundle.mjs --report  # print the table, never fail
 *
 * ── Why the manifest and not the CLI table ───────────────────────────────
 * `next build` prints First Load JS, but scraping stdout means the budget
 * breaks whenever Next changes its formatting. The app build manifest lists
 * exactly which chunks each route loads; summing their real sizes on disk is
 * the same number, computed from the artefact instead of from a log.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const NEXT_DIR = ".next";
const REPORT_ONLY = process.argv.includes("--report");

/**
 * Budgets, in kilobytes of uncompressed first-load JavaScript.
 *
 * ── Where these came from ────────────────────────────────────────────────
 * They are the measured sizes at the time the budget was introduced, rounded
 * up to leave a little room. That is deliberate: a budget picked from an
 * article is a number nobody can defend, and one set far above today's size
 * never fires. These are set to catch the *next* regression, not to describe
 * an aspiration.
 *
 * Raising one is allowed. Raising one without saying why in the commit is
 * how a budget quietly becomes decoration.
 */
const BUDGETS = {
  /** Everything every route pays for, before its own code. */
  shared: 360,
  /** The heaviest single route. Tasks is the one people live in. */
  route: 570,
  /** Sum of the top three — catches "each one only grew a little". */
  worstThree: 1600,
  /** The first page anyone loads, and the only one an unauthenticated
   *  visitor can reach. Kept separate and tight because it is the cold-start
   *  cost of the whole product. */
  login: 400,
};

/** Chunks that appear on every route make up the shared baseline. */
function analyse() {
  const manifest = JSON.parse(
    readFileSync(join(NEXT_DIR, "app-build-manifest.json"), "utf8"),
  );

  const pages = Object.entries(manifest.pages)
    // Only real pages. The manifest also lists layouts and error boundaries,
    // whose chunks are already counted inside the pages that use them —
    // measuring them separately would report a `/dashboard/layout` "route"
    // heavier than any page a person can actually navigate to.
    .filter(([route]) => route.endsWith("/page"));

  const sizeOf = (chunk) => statSync(join(NEXT_DIR, chunk)).size;

  const counts = new Map();
  for (const [, chunks] of pages) {
    for (const chunk of new Set(chunks)) {
      counts.set(chunk, (counts.get(chunk) ?? 0) + 1);
    }
  }

  const shared = [...counts.entries()]
    .filter(([, count]) => count === pages.length)
    .map(([chunk]) => chunk);

  const sharedBytes = shared.reduce((total, chunk) => total + sizeOf(chunk), 0);

  const routes = pages
    .map(([route, chunks]) => {
      const unique = [...new Set(chunks)];
      const total = unique.reduce((sum, chunk) => sum + sizeOf(chunk), 0);
      return {
        route: route.replace(/\/page$/, "") || "/",
        firstLoad: total,
        own: total - sharedBytes,
      };
    })
    .sort((a, b) => b.firstLoad - a.firstLoad);

  return { sharedBytes, routes };
}

const kb = (bytes) => Math.round(bytes / 1024);

/* ── Report ───────────────────────────────────────────────────────────── */

const { sharedBytes, routes } = analyse();

console.log("\n  First-load JavaScript, uncompressed\n");
console.log(
  `  ${"route".padEnd(34)}${"first load".padStart(12)}${"own".padStart(10)}`,
);
console.log(`  ${"─".repeat(56)}`);

for (const route of routes) {
  console.log(
    `  ${route.route.padEnd(34)}${`${kb(route.firstLoad)} kB`.padStart(12)}${`${kb(route.own)} kB`.padStart(10)}`,
  );
}

console.log(`  ${"─".repeat(56)}`);
console.log(
  `  ${"shared by every route".padEnd(34)}${`${kb(sharedBytes)} kB`.padStart(12)}\n`,
);

if (REPORT_ONLY) process.exit(0);

/* ── Budget ───────────────────────────────────────────────────────────── */

let failures = 0;

function check(label, actual, budget) {
  if (actual > budget) {
    console.error(`  OVER    ${label}: ${actual} kB > ${budget} kB`);
    failures += 1;
  } else {
    console.log(`  ok      ${label}: ${actual} kB (budget ${budget} kB)`);
  }
}

check("shared baseline", kb(sharedBytes), BUDGETS.shared);
check("heaviest route", kb(routes[0].firstLoad), BUDGETS.route);
check(
  "three heaviest routes",
  routes.slice(0, 3).reduce((total, route) => total + kb(route.firstLoad), 0),
  BUDGETS.worstThree,
);

const login = routes.find((route) => route.route === "/login");
if (!login) {
  console.error("  OVER    /login is missing from the build manifest");
  failures += 1;
} else {
  check("/login (cold start)", kb(login.firstLoad), BUDGETS.login);
}

/* ── Dependency reachability ──────────────────────────────────────────── */

/**
 * `sharp` must not be in the runtime image.
 *
 * It carries four high-severity libvips advisories that no Next 15 release
 * clears, and it is reachable from exactly one place: the `/_next/image`
 * optimiser. `images.unoptimized` in next.config.mjs turns that off, which
 * makes the advisories unreachable — but "unreachable" is a claim about
 * configuration, and configuration changes. This is the check that notices.
 *
 * See docs/security-review.md § Dependencies.
 */
try {
  statSync(join(NEXT_DIR, "standalone", "node_modules", "sharp"));
  console.error(
    "  OVER    sharp is in the standalone output — the image optimiser is back on",
  );
  failures += 1;
} catch {
  console.log("  ok      sharp is absent from the runtime output");
}

if (failures > 0) {
  console.error(`\n${failures} budget check(s) failed\n`);
  process.exit(1);
}

console.log("\nWithin budget\n");
