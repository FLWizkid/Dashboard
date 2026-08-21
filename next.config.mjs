/*
 * The static policy, spelled out.
 *
 * This file is loaded by Next before any TypeScript exists, so it cannot
 * import `src/lib/security/csp.ts` — which means the string below is a second
 * copy of a policy that has to stay identical to the first. Copies drift, so
 * `src/lib/security/csp.test.ts` imports this config and the real builder and
 * asserts they produce the same string. Edit one without the other and the
 * unit suite fails.
 */
export const OFFLINE_CSP = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /*
   * Which hosts may pull `/_next/*` from the development server.
   *
   * Without this, Next logs a cross-origin warning for requests the E2E suite
   * makes — it browses `127.0.0.1` while the server considers itself
   * `localhost` — and says a future major version will refuse them outright.
   *
   * The warning is worth fixing on its own account. The reason it got chased
   * down is stranger: an unresolved warning raises the "1 Issue" badge in the
   * development overlay, and at phone width that badge sits over the bottom
   * navigation bar and swallows taps meant for it. Two runs in three, some
   * test that clicks the bottom bar timed out with `<nextjs-portal>
   * intercepts pointer events` — and *which* test failed moved between runs,
   * which is the signature of an overlay appearing partway through a session
   * rather than of a broken control.
   *
   * Development only; the built server ignores it.
   */
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  // Emits .next/standalone — a self-contained server with only the modules it
  // actually imports. The container copies that instead of node_modules, which
  // is what keeps the image small enough to rebuild comfortably on the box.
  output: "standalone",

  // Never advertise the framework version to anything on the tailnet.
  poweredByHeader: false,

  images: {
    /*
     * The image optimiser is off, and this is a security decision rather than
     * a performance one.
     *
     * `sharp` is an optional dependency of Next and carries four high-severity
     * libvips advisories that only a major-version bump would clear. It is
     * reachable from exactly one place: the `/_next/image` route, which only
     * exists to serve `next/image`. This product does not use `next/image` —
     * every graphic is an inline SVG or a PWA icon served straight from
     * `public/`. Turning the optimiser off makes that unreachability a
     * property of the configuration instead of an observation about today's
     * imports, and `ops/check-bundle.mjs` fails the build if `sharp` ever
     * appears in the runtime output.
     *
     * See docs/security-review.md § Dependencies.
     */
    unoptimized: true,
  },

  async headers() {
    return [
      {
        /*
         * The one page the nonce cannot reach.
         *
         * `/offline` is statically prerendered so the service worker can cache
         * it and serve it with no network at all, which rules out a
         * per-request nonce — the HTML is written once and the nonce changes
         * every request. Middleware skips it; this is its policy instead.
         */
        source: "/offline",
        headers: [
          { key: "Content-Security-Policy", value: OFFLINE_CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
      {
        // The service worker must never be served stale: a cached copy of an
        // old worker is a cached copy of an old caching strategy, and it
        // outlives every deploy until someone clears site data by hand.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
