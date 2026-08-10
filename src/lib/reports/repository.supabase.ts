import { createClient } from "@/lib/supabase/server";

import type { DigestKind } from "./digest";
import type { InboxWrite } from "./delivery";
import {
  DEFAULT_DIGEST_SETTINGS,
  InboxMessageNotFoundError,
  type DigestSettings,
  type InboxMessage,
  type ReportRepository,
} from "./repository";

/**
 * Supabase-backed report store.
 *
 * The interesting method is `claimPeriod`. It inserts the run row *before* the
 * digest is composed, and relies on the unique index to reject a second claim
 * for the same period. That is what makes the schedule idempotent under the
 * conditions that actually happen: a cron firing twice, a container restarting
 * mid-run, a manual trigger while the scheduled one is in flight.
 *
 * Claiming first also means a crash during composition leaves the period
 * claimed and no digest sent — which is the right failure. A missing brief is
 * visible; two contradictory briefs are confusing.
 */

interface InboxRow {
  id: string;
  kind: DigestKind;
  subject: string;
  preview: string;
  body: string;
  html: string | null;
  read_at: string | null;
  generated_at: string;
}

interface SettingsRow {
  daily_enabled: boolean;
  weekly_enabled: boolean;
  monthly_enabled: boolean;
  daily_hour: number;
  weekly_dow: number;
  time_zone: string;
  email_to: string | null;
}

const INBOX_COLUMNS =
  "id, kind, subject, preview, body, html, read_at, generated_at";

const SETTINGS_COLUMNS =
  "daily_enabled, weekly_enabled, monthly_enabled, daily_hour, weekly_dow, time_zone, email_to";

/** Postgres unique-violation; here it always means the period was taken. */
const UNIQUE_VIOLATION = "23505";

function toMessage(row: InboxRow): InboxMessage {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    preview: row.preview,
    body: row.body,
    html: row.html,
    readAt: row.read_at,
    generatedAt: row.generated_at,
  };
}

function toSettings(row: SettingsRow): DigestSettings {
  return {
    dailyEnabled: row.daily_enabled,
    weeklyEnabled: row.weekly_enabled,
    monthlyEnabled: row.monthly_enabled,
    dailyHour: row.daily_hour,
    weeklyDow: row.weekly_dow,
    timeZone: row.time_zone,
    emailTo: row.email_to,
  };
}

export function createSupabaseReportRepository(): ReportRepository {
  return {
    async writeInbox(message: InboxWrite) {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from("inbox_messages")
        .insert({
          kind: message.kind,
          subject: message.subject,
          preview: message.preview,
          body: message.body,
          html: message.html,
          generated_at: message.generatedAt,
        })
        .select("id")
        .single<{ id: string }>();

      if (error) throw new Error(error.message);
      return data.id;
    },

    async recordRun(run) {
      const supabase = await createClient();

      // The row already exists — `claimPeriod` created it. This fills in what
      // happened to the email.
      const { error } = await supabase
        .from("digest_runs")
        .update({
          inbox_message_id: run.inboxMessageId,
          email_attempted: run.emailAttempted,
          email_ok: run.emailOk,
          email_error: run.emailError,
          channel: run.channel,
        })
        .eq("kind", run.kind)
        .is("inbox_message_id", null);

      if (error) throw new Error(error.message);
    },

    async listInbox(options = {}) {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from("inbox_messages")
        .select(INBOX_COLUMNS)
        .order("generated_at", { ascending: false })
        .limit(options.limit ?? 50)
        .returns<InboxRow[]>();

      if (error) throw new Error(error.message);
      return (data ?? []).map(toMessage);
    },

    async markRead(id: string, read: boolean) {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from("inbox_messages")
        .update({ read_at: read ? new Date().toISOString() : null })
        .eq("id", id)
        .select(INBOX_COLUMNS)
        .maybeSingle<InboxRow>();

      if (error) throw new Error(error.message);
      if (!data) throw new InboxMessageNotFoundError(id);
      return toMessage(data);
    },

    async unreadCount() {
      const supabase = await createClient();

      const { count, error } = await supabase
        .from("inbox_messages")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);

      if (error) throw new Error(error.message);
      return count ?? 0;
    },

    async getSettings() {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from("digest_settings")
        .select(SETTINGS_COLUMNS)
        .maybeSingle<SettingsRow>();

      if (error) throw new Error(error.message);
      // No row yet is not an error — it means the defaults apply.
      return data ? toSettings(data) : { ...DEFAULT_DIGEST_SETTINGS };
    },

    async saveSettings(patch) {
      const supabase = await createClient();
      const current = await this.getSettings();
      const merged = { ...current, ...patch };

      const { data, error } = await supabase
        .from("digest_settings")
        .upsert(
          {
            daily_enabled: merged.dailyEnabled,
            weekly_enabled: merged.weeklyEnabled,
            monthly_enabled: merged.monthlyEnabled,
            daily_hour: merged.dailyHour,
            weekly_dow: merged.weeklyDow,
            time_zone: merged.timeZone,
            email_to: merged.emailTo,
          },
          { onConflict: "user_id" },
        )
        .select(SETTINGS_COLUMNS)
        .single<SettingsRow>();

      if (error) throw new Error(error.message);
      return toSettings(data);
    },

    async alreadySent(kind: DigestKind, periodDate: string) {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from("digest_runs")
        .select("id")
        .eq("kind", kind)
        .eq("period_date", periodDate)
        .maybeSingle<{ id: string }>();

      if (error) throw new Error(error.message);
      return data !== null;
    },

    async claimPeriod(kind: DigestKind, periodDate: string) {
      const supabase = await createClient();

      // Insert first and let the unique index arbitrate. Checking then
      // inserting would leave a window two concurrent runs can both pass.
      const { error } = await supabase
        .from("digest_runs")
        .insert({ kind, period_date: periodDate });

      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false;

      throw new Error(error.message);
    },
  };
}
