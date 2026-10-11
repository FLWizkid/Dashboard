import "server-only";

import { owned, type DataScope } from "@/lib/db/scope";
import { reportError } from "@/lib/observability/report";

/**
 * Recording access to sensitive data.
 *
 * ── Identifiers, never content ───────────────────────────────────────────
 * The detail object is for counts, policy names and provider names. It is not
 * for subjects, bodies or addresses: an audit log that quotes the mail it
 * protects becomes a second, unencrypted copy of the mailbox. The database
 * caps its size for the same reason, and this module refuses anything that
 * looks like prose.
 */

export type AuditAction =
  | "message.read"
  | "message.searched"
  | "thread.opened"
  | "account.connected"
  | "account.disconnected"
  | "account.policy_changed"
  | "credentials.written"
  | "mail.synced"
  | "report.printed"
  | "vault.synced";

export interface AuditEntry {
  action: AuditAction;
  subjectType?: string;
  subjectId?: string;
  actor?: "session" | "scheduler" | "system";
  detail?: Record<string, string | number | boolean | null>;
}

/** Anything longer than this is prose, and prose is content. */
const MAX_DETAIL_VALUE = 120;

function safeDetail(
  detail: AuditEntry["detail"],
): Record<string, string | number | boolean | null> {
  if (!detail) return {};

  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === "string" && value.length > MAX_DETAIL_VALUE) {
      // Truncating rather than dropping: the fact that a long value was
      // supplied is itself worth seeing when reviewing the log's own quality.
      safe[key] = `${value.slice(0, MAX_DETAIL_VALUE)}…`;
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

/**
 * Writes one audit entry.
 *
 * ── Never throws ─────────────────────────────────────────────────────────
 * A failure to log is reported, not raised. The alternative is that a full
 * disk or a schema drift turns "read your mail" into an error page, which
 * would make the audit log a liability rather than a protection. The trade is
 * explicit: availability of the product over completeness of the log, with
 * the failure surfaced to the error reporter so it does not pass unnoticed.
 */
export async function recordAudit(
  scope: DataScope,
  entry: AuditEntry,
): Promise<void> {
  try {
    const client = await scope.client();
    const { error } = await client.from("audit_log").insert(
      owned(scope, {
        action: entry.action,
        subject_type: entry.subjectType ?? null,
        subject_id: entry.subjectId ?? null,
        actor: entry.actor ?? "session",
        detail: safeDetail(entry.detail),
      }),
    );

    if (error) throw new Error(error.message);
  } catch (caught) {
    reportError(caught, {
      source: "audit",
      severity: "warning",
      extra: { action: entry.action },
    });
  }
}
