import type { Instrumentation } from "next";

import {
  isRemoteReportingEnabled,
  reportError,
} from "@/lib/observability/report";

/**
 * Next.js instrumentation hooks.
 *
 * `register` runs once per runtime at start-up; `onRequestError` catches
 * every server-side error Next would otherwise only log. Together they are
 * the seam a reporter plugs into — see src/lib/observability/report.ts for
 * why nothing leaves the box by default.
 */

export function register() {
  // One line at boot, so `docker compose logs app` says plainly whether
  // errors are staying on this machine. Silence about where diagnostics go
  // is how people end up surprised.
  const destination = isRemoteReportingEnabled()
    ? "local logs + remote reporter (SENTRY_DSN is set)"
    : "local logs only";

  console.info(
    JSON.stringify({
      type: "startup",
      runtime: process.env.NEXT_RUNTIME ?? "nodejs",
      environment: process.env.DASHBOARD_ENVIRONMENT ?? "development",
      errorReporting: destination,
    }),
  );
}

export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  reportError(error, {
    source: `request:${context.routeType}`,
    severity: "error",
    extra: {
      path: request.path,
      method: request.method,
      routePath: context.routePath,
      renderSource: context.renderSource,
      revalidateReason: context.revalidateReason,
      // request.headers deliberately omitted. It carries the session cookie
      // and the apikey header, and the scrubber should not be the only thing
      // standing between those and a log line.
    },
  });
};
