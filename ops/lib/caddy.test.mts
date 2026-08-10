import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The reverse proxy's headers.
 *
 * Caddy is the only thing on the box that a browser talks to, so its header
 * block is the last word on everything the application does not set itself.
 * The one that matters most here is the header it must **not** set.
 */
const CADDYFILE = readFileSync(
  fileURLToPath(new URL("../caddy/Caddyfile", import.meta.url)),
  "utf8",
);

/** The site-wide `header { … }` block, before any `handle`. */
const GLOBAL_HEADERS = CADDYFILE.slice(
  CADDYFILE.indexOf("\theader {"),
  CADDYFILE.indexOf("# ── Supabase APIs"),
);

describe("the site-wide header block", () => {
  it("does not set a Content-Security-Policy", () => {
    // This is the regression guard for the whole Phase 7 CSP change.
    //
    // Caddy's `header` directive *replaces*. If a policy is ever set here it
    // overwrites the one the application built for that request — nonce and
    // all — and every page in the product silently stops running its own
    // JavaScript. The page still renders, so nothing looks broken until you
    // click something.
    //
    // The policy lives in src/lib/security/csp.ts. Leave this block alone.
    const lines = GLOBAL_HEADERS.split("\n").filter(
      (line) => !line.trim().startsWith("#"),
    );

    expect(lines.join("\n")).not.toMatch(/Content-Security-Policy/i);
  });

  it("still sends the headers a proxy is the right place for", () => {
    // These are static, apply to every response including static assets, and
    // need no per-request knowledge — so they belong here rather than in the
    // application, where a missed route would silently drop them.
    expect(GLOBAL_HEADERS).toMatch(/Strict-Transport-Security/);
    expect(GLOBAL_HEADERS).toMatch(/X-Content-Type-Options "nosniff"/);
    expect(GLOBAL_HEADERS).toMatch(/X-Frame-Options "DENY"/);
    expect(GLOBAL_HEADERS).toMatch(/Referrer-Policy/);
    expect(GLOBAL_HEADERS).toMatch(/Permissions-Policy/);
  });

  it("strips the banners that name the software", () => {
    expect(GLOBAL_HEADERS).toMatch(/-Server/);
    expect(GLOBAL_HEADERS).toMatch(/-X-Powered-By/);
  });

  it("keeps HSTS long and inclusive of sub-names", () => {
    expect(GLOBAL_HEADERS).toMatch(/max-age=63072000/);
    expect(GLOBAL_HEADERS).toMatch(/includeSubDomains/);
  });
});

describe("the Supabase API paths", () => {
  const block = CADDYFILE.slice(
    CADDYFILE.indexOf("handle @supabase {"),
    CADDYFILE.indexOf("# ── Application"),
  );

  it("get their own fixed policy", () => {
    // They never serve HTML, so there is no nonce to carry and no reason to
    // let the app's per-request policy be the only thing covering them.
    expect(block).toMatch(/Content-Security-Policy/);
  });

  it("deny everything rather than narrowing it", () => {
    // A JSON response has no legitimate reason to load anything at all.
    expect(block).toMatch(/default-src 'none'/);
    expect(block).toMatch(/frame-ancestors 'none'/);
  });
});

describe("exposure", () => {
  it("never turns on the admin API", () => {
    // No public endpoint means no ACME and no reason for an admin socket —
    // which would otherwise listen on localhost inside the container.
    expect(CADDYFILE).toMatch(/admin off/);
  });

  it("refuses a request whose Host does not match the certificate", () => {
    // `strict_sni_host` is what makes reading the Host header safe in
    // src/lib/supabase/middleware.ts. If it goes, that reasoning goes with it.
    expect(CADDYFILE).toMatch(/strict_sni_host/);
  });

  it("keeps query strings out of the access log", () => {
    // Request URIs carry search terms, and from P2 those can contain
    // fragments of mail.
    expect(CADDYFILE).toMatch(/request>uri regexp/);
    expect(CADDYFILE).toMatch(/request>headers>Authorization delete/);
    expect(CADDYFILE).toMatch(/request>headers>Cookie delete/);
  });
});

describe("the immersive seam", () => {
  it("grants xr-spatial-tracking to this origin", () => {
    // Denied — or simply omitted and later tightened — `navigator.xr` is
    // unavailable however good the code on top of it is, and the failure only
    // ever shows up in a headset. Listing it makes the intent explicit.
    expect(CADDYFILE).toMatch(/xr-spatial-tracking=\(self\)/);
  });

  it("still denies everything the product does not use", () => {
    for (const feature of [
      "camera",
      "microphone",
      "geolocation",
      "payment",
      "usb",
    ]) {
      expect(CADDYFILE).toMatch(new RegExp(`${feature}=\\(\\)`));
    }
  });
});
