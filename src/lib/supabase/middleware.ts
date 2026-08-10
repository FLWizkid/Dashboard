import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isMemoryMode } from "@/lib/data-mode";

/**
 * Refreshes the Supabase auth session on every request and guards the
 * protected area. If Supabase isn't configured yet (fresh clone, no
 * `.env.local`), it passes through so the app still boots.
 *
 * `requestHeaders` carries the CSP nonce the caller minted. It has to be
 * threaded into **every** `NextResponse.next()` below rather than set once:
 * the cookie-refresh path throws the first response away and builds a second
 * one, and a nonce that survives only the no-cookie path would go missing on
 * exactly the requests that matter — the ones with a session.
 */
export async function updateSession(
  request: NextRequest,
  requestHeaders: Headers,
) {
  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // End-to-end tests run without an auth server. This can only be true in a
  // non-production build — see src/lib/data-mode.ts.
  if (isMemoryMode()) return supabaseResponse;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[],
      ) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({
          request: { headers: requestHeaders },
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unauthenticated users may not enter the dashboard.
  if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
    return redirectToSignIn(request);
  }

  return supabaseResponse;
}

/**
 * Sends the browser to the sign-in page, at an address it can actually reach.
 *
 * The obvious version of this was `NextResponse.redirect(nextUrl.clone())`,
 * and it was wrong in a way nothing caught until the Phase 7 CSP work put a
 * real browser in front of it. **`request.nextUrl` is built from the address
 * the server is bound to, not from the `Host` header the browser sent.**
 * Behind Caddy, an unauthenticated visit to the dashboard answered with
 *
 *     Location: http://localhost:3000/login
 *
 * — the container's own bind address. On the user's laptop that is either
 * nothing at all or some unrelated service; the tailnet hostname never appears
 * anywhere in the response. Every first sign-in would have dead-ended.
 *
 * A relative `Location` would sidestep the whole problem, and RFC 7231 allows
 * one, but Next's middleware runtime rejects it with `TypeError: Invalid URL`.
 * So the origin is rebuilt from the forwarded headers instead.
 *
 * ── Trusting `Host` ──────────────────────────────────────────────────────
 * Reading the host from a request header is how host-header injection works,
 * so it is worth saying why it is safe here. The path is a constant — this can
 * only ever send you to `/login` on some host, never to an attacker's URL, so
 * it is not an open redirect. The app container publishes no port of its own,
 * so Caddy is the only thing that can reach it, and Caddy is configured with
 * `strict_sni_host`: a request whose Host does not match the certificate's
 * name is refused before it gets here.
 */
function redirectToSignIn(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/login", externalOrigin(request)));
}

/**
 * The origin the browser used, as opposed to the one Node bound to.
 *
 * `Host` is read **before** `X-Forwarded-Host`, which is the opposite of the
 * usual advice, because Next itself synthesises an `X-Forwarded-Host` from the
 * address it was started on. Preferring it hands you the bind address —
 * `localhost:3000` — which is the very bug this function exists to fix. Caddy
 * passes the browser's `Host` through untouched, so it is both the correct
 * value and the one nothing downstream has rewritten.
 */
function externalOrigin(request: NextRequest): string {
  const host =
    request.headers.get("host") ??
    firstValue(request.headers.get("x-forwarded-host"));

  if (!host) return request.nextUrl.origin;

  const protocol =
    firstValue(request.headers.get("x-forwarded-proto")) ??
    request.nextUrl.protocol.replace(":", "");

  return `${protocol}://${host}`;
}

/**
 * The first entry of a comma-separated forwarded header.
 *
 * Proxies append rather than replace, so a second hop turns `https` into
 * `https, http`. The first value is the one the browser saw.
 */
function firstValue(header: string | null): string | null {
  if (!header) return null;
  const first = header.split(",")[0]?.trim();
  return first ? first : null;
}
