import { isMemoryMode } from "@/lib/data-mode";
import type { DataScope } from "@/lib/db/scope";

import type { DigestKind } from "./digest";
import type { DeliveryStore, InboxWrite } from "./delivery";

/**
 * Stored state for the reports module.
 *
 * Small, because reports are computed. What Postgres holds is the delivered
 * copies, the schedule settings, and the record of what already went out.
 */

export interface InboxMessage {
  id: string;
  kind: DigestKind;
  subject: string;
  preview: string;
  body: string;
  html: string | null;
  readAt: string | null;
  generatedAt: string;
}

export interface DigestSettings {
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
  monthlyEnabled: boolean;
  dailyHour: number;
  weeklyDow: number;
  timeZone: string;
  emailTo: string | null;
}

export const DEFAULT_DIGEST_SETTINGS: DigestSettings = {
  dailyEnabled: true,
  weeklyEnabled: true,
  monthlyEnabled: false,
  dailyHour: 7,
  weeklyDow: 1,
  timeZone: "UTC",
  emailTo: null,
};

export interface ReportRepository extends DeliveryStore {
  listInbox(options?: { limit?: number }): Promise<InboxMessage[]>;
  markRead(id: string, read: boolean): Promise<InboxMessage>;
  unreadCount(): Promise<number>;

  getSettings(): Promise<DigestSettings>;
  saveSettings(patch: Partial<DigestSettings>): Promise<DigestSettings>;

  /**
   * Whether a digest of this kind has already gone out for this period.
   *
   * The guard that makes the schedule idempotent: a cron that fires late, or
   * twice, or after a restart must not produce two morning briefs.
   */
  alreadySent(kind: DigestKind, periodDate: string): Promise<boolean>;
  claimPeriod(kind: DigestKind, periodDate: string): Promise<boolean>;
}

export class InboxMessageNotFoundError extends Error {
  constructor(id: string) {
    super(`Inbox message ${id} was not found`);
    this.name = "InboxMessageNotFoundError";
  }
}

/**
 * @param scope Whose rows to work with. Omitted means the signed-in session,
 *   which is every browser request. A scheduled job has no session and must
 *   pass one — see `src/lib/db/scope.ts`.
 */
export async function getReportRepository(
  scope?: DataScope,
): Promise<ReportRepository> {
  if (isMemoryMode()) {
    const { memoryReportRepository } = await import("./repository.memory");
    return memoryReportRepository;
  }
  const { createSupabaseReportRepository } =
    await import("./repository.supabase");
  const { sessionScope } = await import("@/lib/db/scope");
  return createSupabaseReportRepository(scope ?? sessionScope());
}

export type { InboxWrite };
