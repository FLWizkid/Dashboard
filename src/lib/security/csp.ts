/**
 * The Content Security Policy.
 *
 * ── Why this moved out of Caddy ──────────────────────────────────────────
 * Phase 0 set the policy in the reverse proxy, with `script-src
 * 'unsafe-inline'` and a comment admitting it. That admission was honest and
 * the gap was real: `'unsafe-inline'` means any injected `<script>` runs, so
 * the policy stopped being a defence against XSS and became a defence only
 * against loading someone else's origin.
 *
 * The fix needs a **per-request nonce**, and a reverse proxy cannot mint one
 * that the HTML it is forwarding already knows about. So the application owns
 * the policy now: middleware generates a nonce, hands it to the renderer
 * through a request header, and sets the matching response header. Caddy keeps
 * the headers that are genuinely static (HSTS, frame options, and a fixed
 * policy over the Supabase API paths, which never serve HTML).
 *
 * ── `strict-dynamic` ─────────────────────────────────────────────────────
 * Next's bootstrap is one inline script that then loads every chunk. Listing
 * the chunk paths is impossible — they are content-hashed at build time — so
 * the nonce authorises the bootstrap and `strict-dynamic` extends that trust
 * to what the bootstrap loads. The `'self'` in `script-src` is deliberately
 * kept as a fallback for browsers that do not implement `strict-dynamic`:
 * where it is understood it is ignored, and where it is not, the policy still
 * refuses third-party origins.
 *
 * ── What is deliberately still loose ─────────────────────────────────────
 * `style-src 'unsafe-inline'`. Framer Motion animates by writing inline
 * styles, and Next's font loader injects a `<style>` element. Nonces cannot
 * reach either. The exposure from injected CSS is real but small — it is a
 * defacement and exfiltration-by-selector risk, not code execution — and the
 * alternative is losing all motion in the product. Recorded in
 * docs/threat-model.md rather than quietly accepted.
 */

/** Directives that never vary. */
const STATIC_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // `blob:` is what the print path and any future export uses; `data:` is the
  // inline SVG icons.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  // Both, because `frame-ancestors` is the modern one and `X-Frame-Options`
  // is what older clients read. Caddy still sends the latter.
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
];

export interface CspOptions {
  /**
   * Development needs `'unsafe-eval'` for React Refresh and a websocket for
   * hot reload. Neither is ever sent by a production build — the flag is read
   * from `NODE_ENV`, not from a request, so it cannot be turned on remotely.
   */
  development?: boolean;
  /**
   * Where Supabase lives, when it is not this origin.
   *
   * On the box it *is* this origin — Caddy serves the app and the Supabase
   * paths from one hostname — so `connect-src 'self'` covers it and this is
   * empty. Locally it is usually `http://127.0.0.1:54321`, and omitting it
   * would make every query fail with an error that does not mention CSP.
   */
  supabaseOrigin?: string | null;
  /**
   * Whether the browser reached us over TLS.
   *
   * Gates `upgrade-insecure-requests`, and it has to be gated. On an http
   * page the directive rewrites *every* subresource and fetch to https —
   * including same-origin ones — and `'self'` then stops matching, because a
   * scheme change is an origin change. The symptom is oddly specific: pages
   * render, but every client-side navigation prefetch is blocked, so the app
   * feels broken only when you click something.
   *
   * On the box Caddy terminates TLS and sends `X-Forwarded-Proto: https`, so
   * this is true and the directive does its job. Over a plain-http hop it is
   * false, which is the correct answer rather than a concession: there is no
   * mixed content to upgrade on a page that was never secure.
   */
  secure?: boolean;
}

/**
 * Builds the policy for one request.
 *
 * Takes the nonce rather than generating it: the same value has to reach the
 * renderer, and a function that quietly minted its own would produce a policy
 * that no script on the page can satisfy.
 */
export function buildCsp(nonce: string, options: CspOptions = {}): string {
  const {
    development = false,
    supabaseOrigin = null,
    secure = false,
  } = options;

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // Production only.
    //
    // `strict-dynamic` makes browsers that understand it ignore `'self'`, and
    // Next's development server loads lazy chunks and HMR updates through
    // paths the nonce does not reach — so in dev the effect is a card that
    // silently never arrives, with the reason buried in the console. That is
    // a bad trade for a policy whose job is to harden the deployed box, which
    // runs a production build and keeps the directive.
    ...(development ? [] : ["'strict-dynamic'"]),
    ...(development ? ["'unsafe-eval'"] : []),
  ];

  const connectSrc = [
    "'self'",
    ...(supabaseOrigin ? [supabaseOrigin, toWebSocket(supabaseOrigin)] : []),
    ...(development ? ["ws:", "wss:"] : []),
  ];

  return [
    ...STATIC_DIRECTIVES,
    `script-src ${scriptSrc.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    // Only when the page itself arrived over TLS — see `secure` above.
    ...(secure ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * The policy for pages that cannot carry a nonce.
 *
 * Exactly one page qualifies: `/offline`, which is statically prerendered so
 * the service worker can cache it and serve it with no network at all. A
 * static page and a per-request nonce are mutually exclusive — the HTML is
 * written once, the nonce changes every request, and the mismatch would leave
 * the page rendered but inert.
 *
 * It is a fixed string with no user data, no fetches and nothing personal, so
 * the loosening is bounded to a page where there is nothing to steal.
 */
export function buildStaticCsp(): string {
  return [
    ...STATIC_DIRECTIVES,
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** A nonce, from the platform CSPRNG. 16 bytes, base64. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toWebSocket(origin: string): string {
  return origin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}
