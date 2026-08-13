import { describe, expect, it } from "vitest";

// Imported from the Next config on purpose: the policy string in there is a
// second copy, and the point of this file is that it cannot drift.
import { OFFLINE_CSP } from "../../../next.config.mjs";

import { buildCsp, buildStaticCsp, generateNonce } from "./csp";

/**
 * The policy.
 *
 * These tests are mostly about what must **not** be in the string. A CSP that
 * is slightly too permissive looks exactly like a correct one until someone
 * reads it, and by then it has been shipped for a year.
 */

function directive(policy: string, name: string): string {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));

  if (!found) throw new Error(`no ${name} directive in: ${policy}`);
  return found;
}

describe("the production policy", () => {
  const policy = buildCsp("TESTNONCE");

  it("carries the nonce it was given", () => {
    expect(directive(policy, "script-src")).toContain("'nonce-TESTNONCE'");
  });

  it("never allows inline script", () => {
    // The whole reason this file exists.
    expect(directive(policy, "script-src")).not.toContain("'unsafe-inline'");
  });

  it("never allows eval outside development", () => {
    expect(directive(policy, "script-src")).not.toContain("'unsafe-eval'");
  });

  it("trusts what the bootstrap loads, not a list of chunk paths", () => {
    expect(directive(policy, "script-src")).toContain("'strict-dynamic'");
  });

  it("keeps 'self' as the fallback for browsers without strict-dynamic", () => {
    // Where strict-dynamic is understood this is ignored; where it is not,
    // this is the only thing standing between the page and any origin.
    expect(directive(policy, "script-src")).toContain("'self'");
  });

  it("refuses to be framed, and says so twice", () => {
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(policy, "frame-src")).toBe("frame-src 'none'");
  });

  it("allows no plugin content and no base-tag rewriting", () => {
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'self'");
  });

  it("keeps form posts on this origin", () => {
    // An injected <form action="https://elsewhere"> is how a CSP that only
    // thinks about scripts still loses the password.
    expect(directive(policy, "form-action")).toBe("form-action 'self'");
  });

  it("upgrades any stray http:// reference when the page is secure", () => {
    expect(buildCsp("N", { secure: true })).toContain(
      "upgrade-insecure-requests",
    );
  });

  it("talks to nothing but this origin by default", () => {
    expect(directive(policy, "connect-src")).toBe("connect-src 'self'");
  });
});

describe("a same-origin Supabase", () => {
  it("needs no extra connect-src — that is the point of one hostname", () => {
    const policy = buildCsp("N", { supabaseOrigin: null });
    expect(directive(policy, "connect-src")).toBe("connect-src 'self'");
  });

  it("gets both the http and the websocket origin when it is elsewhere", () => {
    // Realtime is a websocket, and `connect-src` treats ws:// as a different
    // scheme from http:// even when the host is identical.
    const policy = buildCsp("N", {
      supabaseOrigin: "http://127.0.0.1:54321",
    });

    const connect = directive(policy, "connect-src");
    expect(connect).toContain("http://127.0.0.1:54321");
    expect(connect).toContain("ws://127.0.0.1:54321");
  });

  it("maps https to wss, not to ws", () => {
    const policy = buildCsp("N", { supabaseOrigin: "https://box.ts.net" });
    const connect = directive(policy, "connect-src");

    expect(connect).toContain("wss://box.ts.net");
    expect(connect).not.toContain("ws://box.ts.net");
  });
});

describe("upgrade-insecure-requests", () => {
  it("is absent on a page the browser did not reach over TLS", () => {
    // Not a concession — a correctness fix. On an http page the directive
    // rewrites same-origin requests to https, which is a different origin, so
    // `connect-src 'self'` stops matching and every client-side navigation
    // prefetch is blocked. Found by ops/check-csp.mjs, which caught the RSC
    // prefetch on the 404 page being refused.
    expect(buildCsp("N", { secure: false })).not.toContain(
      "upgrade-insecure-requests",
    );
  });

  it("is present the moment TLS is involved, production or not", () => {
    expect(buildCsp("N", { secure: true, development: true })).toContain(
      "upgrade-insecure-requests",
    );
  });
});

describe("development", () => {
  const policy = buildCsp("N", { development: true });

  it("allows eval, because React Refresh needs it", () => {
    expect(directive(policy, "script-src")).toContain("'unsafe-eval'");
  });

  it("allows the hot-reload socket", () => {
    expect(directive(policy, "connect-src")).toContain("ws:");
  });
});

describe("the offline page's static policy", () => {
  it("matches the copy in next.config.mjs exactly", () => {
    // Two files have to agree on this string and Next cannot import the
    // TypeScript one. This assertion is the only thing making that safe.
    expect(OFFLINE_CSP).toBe(buildStaticCsp());
  });

  it("loosens script-src and nothing else", () => {
    const staticPolicy = buildStaticCsp();
    const noncedPolicy = buildCsp("N");

    expect(directive(staticPolicy, "script-src")).toContain("'unsafe-inline'");

    // Every other directive is identical to the strict policy. A carve-out
    // that quietly widened `connect-src` on a cached page would be a way to
    // exfiltrate from a page nobody thinks about.
    for (const name of [
      "default-src",
      "connect-src",
      "img-src",
      "object-src",
      "frame-ancestors",
      "base-uri",
      "form-action",
    ]) {
      expect(directive(staticPolicy, name)).toBe(directive(noncedPolicy, name));
    }
  });
});

describe("the nonce", () => {
  it("is different every time", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateNonce()));
    expect(seen.size).toBe(200);
  });

  it("is long enough to be unguessable", () => {
    // 16 bytes. Anything shorter and an attacker who can inject a script can
    // also brute-force the attribute that authorises it.
    expect(atob(generateNonce())).toHaveLength(16);
  });

  it("contains nothing that would terminate the header", () => {
    for (let i = 0; i < 100; i += 1) {
      expect(generateNonce()).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    }
  });
});
