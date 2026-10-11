#!/usr/bin/env node
/**
 * Removes code from the runtime output that the product never executes.
 *
 * Runs automatically after `next build` (see the `postbuild` script), so the
 * standalone server the container ships is the pruned one and nobody has to
 * remember.
 *
 * ── sharp ────────────────────────────────────────────────────────────────
 * `sharp` is an optional dependency of Next and carries four high-severity
 * libvips advisories (CVE-2026-33327, -33328, -35590, -35591) that no Next 15
 * release clears — the only upgrade path is a major version, which would move
 * the product off the stack it is specified on.
 *
 * It is reachable from exactly one place: the `/_next/image` optimiser, which
 * exists to serve `next/image`. This product imports `next/image` nowhere —
 * every graphic is an inline SVG or a PWA icon served straight out of
 * `public/` — and `images.unoptimized` in next.config.mjs turns the route off
 * regardless.
 *
 * That is two layers of "it never runs", and Next still copies the package
 * into `.next/standalone`. "Present but unreachable" is a claim about today's
 * configuration; **absent** is a property of the artefact. A scanner pointed
 * at the running container should find nothing, not find something and be
 * argued with.
 *
 * If a future phase genuinely needs image optimisation, delete this and take
 * the advisories seriously instead — the honest options are pinning a patched
 * libvips or moving to a Next release that has one.
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const STANDALONE = join(".next", "standalone", "node_modules");

/** Package name → why it is not needed at runtime. */
const PRUNE = {
  sharp: "image optimiser is disabled; see docs/security-review.md",
  "@img": "sharp's platform-specific libvips binaries",
};

let removed = 0;

for (const [name, reason] of Object.entries(PRUNE)) {
  const path = join(STANDALONE, name);
  if (!existsSync(path)) continue;

  rmSync(path, { recursive: true, force: true });
  console.log(`  pruned  ${name} — ${reason}`);
  removed += 1;
}

if (removed === 0) {
  // Not an error: a build that never produced a standalone output (or a Next
  // version that stopped bundling these) has nothing to do here.
  console.log("  pruned  nothing — runtime output already clean");
}
