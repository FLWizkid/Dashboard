import { headers } from "next/headers";
import Link from "next/link";

/**
 * The 404.
 *
 * ── Why it reads a header it does not use ────────────────────────────────
 * Next prerenders the root not-found page at build time. Prerendered HTML has
 * no CSP nonce in it, so the per-request policy refuses to run its bootstrap
 * and the page arrives inert — every link on it falls back to a full page
 * load, and the console fills with violations that look like a broken deploy.
 *
 * `headers()` is a dynamic API: awaiting it opts this route out of
 * prerendering, which is the whole point of the call. `ops/check-csp.mjs`
 * drives a browser at an unknown URL and fails the build if this regresses,
 * so the reason cannot be quietly lost.
 *
 * There is no `export const dynamic` here on purpose — route segment config is
 * ignored on the root not-found page, and a line that looks like it works but
 * does nothing is worse than the call above.
 */
export default async function NotFound() {
  await headers();

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-surface-raised p-8 text-center shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">
          404
        </p>
        <h1 className="text-lg font-semibold tracking-tight text-fg">
          There is nothing here
        </h1>
        <p className="text-sm text-fg-muted">
          The page you asked for does not exist. It may have been renamed, or
          the link may be from a version of the dashboard that has moved on.
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-colors duration-fast hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
