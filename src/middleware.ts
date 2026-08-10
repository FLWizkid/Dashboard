import { type NextRequest } from "next/server";

import { buildCsp, generateNonce } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Two jobs, in this order: mint the request's CSP nonce, then refresh the auth
 * session.
 *
 * The nonce has to exist before anything renders, which is why it is minted
 * here rather than in a layout. It travels two ways at once:
 *
 *   • as the `content-security-policy` **request** header, which is where Next
 *     looks when deciding what nonce to stamp on its bootstrap script, and
 *   • as the **response** header the browser actually enforces.
 *
 * They have to be the same string. If they drift, the page renders and none of
 * its JavaScript runs — a blank dashboard with a console full of CSP errors
 * and no other symptom. `ops/check-csp.mjs` drives a real browser against a
 * production build and fails the build if a single violation fires.
 */
export async function middleware(request: NextRequest) {
  const nonce = generateNonce();

  const csp = buildCsp(nonce, {
    development: process.env.NODE_ENV !== "production",
    supabaseOrigin: supabaseOrigin(),
    secure: isSecure(request),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = await updateSession(request, requestHeaders);
  response.headers.set("content-security-policy", csp);

  return response;
}

/**
 * Did the *browser* reach us over TLS?
 *
 * Not "did this Node process receive a TLS connection" — it never does. Caddy
 * terminates TLS and forwards plain HTTP over the compose network, setting
 * `X-Forwarded-Proto: https` as it goes (ops/caddy/Caddyfile). That header is
 * the only thing here that knows what the browser saw.
 *
 * Trusting a client-supplied header would normally be a mistake. It is safe
 * here because the app container publishes no port of its own — Caddy is the
 * only thing that can reach it — and because the worst a forged `https` does
 * is add `upgrade-insecure-requests` to a policy, which tightens it.
 */
function isSecure(request: NextRequest): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";

  return request.nextUrl.protocol === "https:";
}

/**
 * The Supabase origin, when it differs from ours.
 *
 * On the box Caddy serves the app and the Supabase paths from one hostname, so
 * this returns null and `connect-src 'self'` is the whole story. Locally they
 * are different ports, which is a different origin as far as CSP is concerned.
 */
function supabaseOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured) return null;

  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

export const config = {
  matcher: [
    /*
     * Everything except static assets, image files, the container healthcheck
     * and the two files that must be reachable with no session at all.
     *
     * `/api/health` is excluded because the probe runs every few seconds and
     * refreshing an auth session for it would be pure waste.
     *
     * `/offline`, `/sw.js` and the manifest are excluded because the service
     * worker caches them and serves them with no network. A per-request nonce
     * cannot survive that — see `buildStaticCsp`. Their headers come from
     * `next.config.mjs` instead.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|api/health|offline|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
