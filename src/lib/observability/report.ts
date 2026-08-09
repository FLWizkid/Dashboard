/**
 * Error reporting.
 *
 * "Sentry-ready" rather than "Sentry": the hook points, the event shape and
 * the redaction all exist and run on every error, but nothing leaves the box
 * unless a DSN is configured. That default is deliberate. This product holds
 * a CIO's calendar, tasks and — from P2 — mail; shipping its exceptions to a
 * third party is a decision to make on purpose, not to inherit from a
 * dependency. docs/threat-model.md carries the trade-off.
 *
 * When a DSN is set, `@sentry/nextjs` is loaded if it happens to be
 * installed. It is not a dependency of this repository, so the import is
 * dynamic and its absence is not an error — you install it on the box, set
 * the DSN and restart.
 */

import { scrub, scrubError, type ScrubbedError } from "./scrub";

export type Severity = "fatal" | "error" | "warning" | "info";

export type ReportContext = {
  /** Where this came from: "api/tasks", "quick-add", "instrumentation". */
  source?: string;
  severity?: Severity;
  /** Anything else worth knowing. Deep-redacted before it goes anywhere. */
  extra?: Record<string, unknown>;
};

export type ErrorEvent = {
  timestamp: string;
  severity: Severity;
  source: string;
  environment: string;
  runtime: "server" | "browser" | "edge";
  error: ScrubbedError;
  extra?: Record<string, unknown>;
};

/* ── configuration ────────────────────────────────────────────────────── */

function dsn(): string | undefined {
  const value = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  return value && value.trim() !== "" ? value.trim() : undefined;
}

/** True when a remote reporter is configured. Exported for the tests. */
export function isRemoteReportingEnabled(): boolean {
  return dsn() !== undefined;
}

function runtime(): ErrorEvent["runtime"] {
  if (typeof window !== "undefined") return "browser";
  // Next sets this on the edge runtime; anything else is a Node server.
  return process.env.NEXT_RUNTIME === "edge" ? "edge" : "server";
}

/* ── event construction ───────────────────────────────────────────────── */

/**
 * Builds the redacted event.
 *
 * Separate from delivery so the shape can be asserted in tests without any
 * transport, and so the same event goes to the local log and to a remote
 * reporter — one of them being more careful than the other is exactly the
 * kind of drift that leaks.
 */
export function buildEvent(
  error: unknown,
  context: ReportContext = {},
): ErrorEvent {
  const normalized =
    error instanceof Error
      ? error
      : new Error(typeof error === "string" ? error : JSON.stringify(error));

  const event: ErrorEvent = {
    timestamp: new Date().toISOString(),
    severity: context.severity ?? "error",
    source: context.source ?? "unknown",
    environment: process.env.DASHBOARD_ENVIRONMENT ?? "development",
    runtime: runtime(),
    error: scrubError(normalized),
  };

  if (context.extra && Object.keys(context.extra).length > 0) {
    event.extra = scrub(context.extra) as Record<string, unknown>;
  }

  return event;
}

/* ── delivery ─────────────────────────────────────────────────────────── */

type SentryLike = {
  captureException: (error: unknown, hint?: unknown) => void;
};

/** Installed on the box, never in this repository. See loadSentry below. */
const SENTRY_MODULE = "@sentry/nextjs";

let sentry: SentryLike | null | undefined;

async function loadSentry(): Promise<SentryLike | null> {
  if (sentry !== undefined) return sentry;

  try {
    // Held in a variable rather than written inline: `@sentry/nextjs` is not
    // a dependency of this repository, and a literal specifier would make
    // both TypeScript and the bundler insist that it is. This resolves at
    // runtime, on the box, if and only if it has been installed there.
    const specifier = SENTRY_MODULE;
    const mod = await import(/* webpackIgnore: true */ specifier);
    sentry =
      typeof (mod as Partial<SentryLike>)?.captureException === "function"
        ? (mod as unknown as SentryLike)
        : null;
  } catch {
    sentry = null;
  }

  return sentry;
}

/**
 * Reports an error.
 *
 * Never throws and never rejects: an error in the error reporter must not
 * replace the error being reported. Returns the event so callers (and tests)
 * can assert on exactly what was recorded.
 */
export function reportError(
  error: unknown,
  context: ReportContext = {},
): ErrorEvent {
  let event: ErrorEvent;

  try {
    event = buildEvent(error, context);
  } catch {
    // Building the event failed — almost certainly the attached context.
    // Fall back to the error alone rather than losing the report.
    event = buildEvent(error, {
      source: context.source,
      severity: context.severity,
      extra: { contextOmitted: "context could not be processed" },
    });
  }

  // The local record. Structured, so `docker compose logs app` is greppable.
  try {
    const line = JSON.stringify({ type: "error-report", ...event });
    if (event.severity === "warning" || event.severity === "info") {
      console.warn(line);
    } else {
      console.error(line);
    }
  } catch {
    // A context object that cannot be serialised is not a reason to lose the
    // error entirely.
    console.error(`[error-report] ${event.source}: ${event.error.message}`);
  }

  if (!isRemoteReportingEnabled()) return event;

  void loadSentry()
    .then((client) => {
      // The scrubbed event is sent, not the original error: the remote
      // reporter never sees a message this module has not been through.
      client?.captureException(new Error(event.error.message), {
        extra: { ...event, dsnConfigured: true },
      });
    })
    .catch(() => {
      /* reporting must never surface as a second failure */
    });

  return event;
}
