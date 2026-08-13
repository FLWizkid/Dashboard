import "server-only";

import { aad, decryptField, isEnvelope } from "@/lib/crypto/envelope";
import { ownerFilter, owned, type DataScope } from "@/lib/db/scope";

import {
  MailAccountNotFoundError,
  MessageNotFoundError,
  PolicyForbidsError,
  type EventQuery,
  type MailRepository,
  type ThreadQuery,
  type ThreadSummary,
} from "./repository";
import { policyAllowsBodies, policyAllowsStorage } from "./sync";
import {
  SENDER_IMPORTANCE_RANK,
  normalizeAddress,
  type Calendar,
  type CalendarEvent,
  type MailAccount,
  type Mailbox,
  type Message,
  type SenderImportance,
} from "./types";

/**
 * Mail and calendar, backed by Postgres.
 *
 * ── Bodies ───────────────────────────────────────────────────────────────
 * A body is an encryption envelope in `body_cipher`, and it is only ever
 * decrypted in `getMessage` and `getThread` — never in a list. Two reasons,
 * and the second is the one that matters: a list of forty threads would
 * decrypt forty bodies to render forty subjects, and a rendering mistake in
 * that view would put mail content on a page whose only job was headers.
 *
 * A decryption failure is **not** swallowed. `decryptField` throws on a wrong
 * key or a tampered payload, and letting that surface as an empty body would
 * make a corrupted mailbox look like an empty one.
 */

const ACCOUNT_COLUMNS =
  "id, provider, remote_id, email_address, display_name, status, status_detail, " +
  "caching_policy, is_corporate, admin_consent, retention_months, " +
  "sync_mail_enabled, sync_calendar_enabled, credentials_cipher, last_sync_at, " +
  "last_success_at, last_error, last_error_at, created_at";

const MESSAGE_COLUMNS =
  "id, account_id, thread_id, mailbox_id, remote_id, message_id_header, " +
  "subject, snippet, from_address, from_name, to_addresses, cc_addresses, " +
  "sent_at, received_at, is_read, is_flagged, is_draft, has_attachments, " +
  "body_format";

interface AccountRow {
  id: string;
  provider: MailAccount["provider"];
  remote_id: string;
  email_address: string;
  display_name: string | null;
  status: MailAccount["status"];
  status_detail: string | null;
  caching_policy: MailAccount["cachingPolicy"];
  is_corporate: boolean;
  admin_consent: MailAccount["adminConsent"];
  retention_months: number;
  sync_mail_enabled: boolean;
  sync_calendar_enabled: boolean;
  credentials_cipher: string | null;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
}

interface MessageRow {
  id: string;
  account_id: string;
  thread_id: string | null;
  mailbox_id: string | null;
  remote_id: string;
  message_id_header: string | null;
  subject: string | null;
  snippet: string | null;
  from_address: string;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  sent_at: string | null;
  received_at: string;
  is_read: boolean;
  is_flagged: boolean;
  is_draft: boolean;
  has_attachments: boolean;
  body_format: "text" | "html" | null;
  body_cipher?: string | null;
}

function toAccount(row: AccountRow): MailAccount {
  return {
    id: row.id,
    provider: row.provider,
    remoteId: row.remote_id,
    emailAddress: row.email_address,
    displayName: row.display_name,
    status: row.status,
    statusDetail: row.status_detail,
    cachingPolicy: row.caching_policy,
    isCorporate: row.is_corporate,
    adminConsent: row.admin_consent,
    retentionMonths: row.retention_months,
    syncMailEnabled: row.sync_mail_enabled,
    syncCalendarEnabled: row.sync_calendar_enabled,
    // A boolean, never the envelope. There is no shape of this type that
    // could carry a credential to a browser.
    hasCredentials: Boolean(row.credentials_cipher),
    lastSyncAt: row.last_sync_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    createdAt: row.created_at,
  };
}

function toMessage(
  row: MessageRow,
  importance: SenderImportance,
  body: string | null,
): Message {
  return {
    id: row.id,
    accountId: row.account_id,
    threadId: row.thread_id,
    mailboxId: row.mailbox_id,
    remoteId: row.remote_id,
    messageIdHeader: row.message_id_header,
    subject: row.subject,
    snippet: row.snippet,
    from: { address: row.from_address, name: row.from_name },
    to: row.to_addresses ?? [],
    cc: row.cc_addresses ?? [],
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    isRead: row.is_read,
    isFlagged: row.is_flagged,
    isDraft: row.is_draft,
    hasAttachments: row.has_attachments,
    body,
    bodyFormat: body === null ? null : row.body_format,
    senderImportance: importance,
  };
}

export function createSupabaseMailRepository(scope: DataScope): MailRepository {
  /** Importance by normalised address, for the whole result set at once. */
  async function importanceMap(
    addresses: string[],
  ): Promise<Map<string, SenderImportance>> {
    if (addresses.length === 0) return new Map();

    const supabase = await scope.client();
    const { data, error } = await supabase
      .from("senders")
      .select("address, importance")
      .match(ownerFilter(scope))
      .in("address", [...new Set(addresses.map(normalizeAddress))])
      .returns<{ address: string; importance: SenderImportance }[]>();

    if (error) throw new Error(error.message);

    return new Map((data ?? []).map((row) => [row.address, row.importance]));
  }

  async function requireAccount(id: string): Promise<MailAccount> {
    const supabase = await scope.client();
    const { data, error } = await supabase
      .from("mail_accounts")
      .select(ACCOUNT_COLUMNS)
      .match({ ...ownerFilter(scope), id })
      .maybeSingle<AccountRow>();

    if (error) throw new Error(error.message);
    if (!data) throw new MailAccountNotFoundError(id);
    return toAccount(data);
  }

  return {
    async listAccounts() {
      const supabase = await scope.client();
      const { data, error } = await supabase
        .from("mail_accounts")
        .select(ACCOUNT_COLUMNS)
        .match(ownerFilter(scope))
        .order("created_at", { ascending: true })
        .returns<AccountRow[]>();

      if (error) throw new Error(error.message);
      return (data ?? []).map(toAccount);
    },

    async getAccount(id) {
      const supabase = await scope.client();
      const { data, error } = await supabase
        .from("mail_accounts")
        .select(ACCOUNT_COLUMNS)
        .match({ ...ownerFilter(scope), id })
        .maybeSingle<AccountRow>();

      if (error) throw new Error(error.message);
      return data ? toAccount(data) : null;
    },

    async updateAccount(id, patch) {
      const supabase = await scope.client();
      await requireAccount(id);

      const { data, error } = await supabase
        .from("mail_accounts")
        .update({
          ...(patch.cachingPolicy !== undefined && {
            caching_policy: patch.cachingPolicy,
          }),
          ...(patch.syncMailEnabled !== undefined && {
            sync_mail_enabled: patch.syncMailEnabled,
          }),
          ...(patch.syncCalendarEnabled !== undefined && {
            sync_calendar_enabled: patch.syncCalendarEnabled,
          }),
          ...(patch.retentionMonths !== undefined && {
            retention_months: patch.retentionMonths,
          }),
        })
        .match({ ...ownerFilter(scope), id })
        .select(ACCOUNT_COLUMNS)
        .single<AccountRow>();

      if (error) throw new Error(error.message);

      const account = toAccount(data);

      // Tightening the policy discards what it now forbids, immediately.
      // Leaving bodies behind under Metadata would make the setting a label
      // rather than a rule, and the owner changed it for a reason.
      if (!policyAllowsBodies(account.cachingPolicy)) {
        const { error: clearError } = await supabase
          .from("messages")
          .update({ body_cipher: null, body_format: null })
          .match({ ...ownerFilter(scope), account_id: id })
          .not("body_cipher", "is", null);

        if (clearError) throw new Error(clearError.message);
      }

      if (!policyAllowsStorage(account.cachingPolicy)) {
        const { error: purgeError } = await supabase
          .from("messages")
          .delete()
          .match({ ...ownerFilter(scope), account_id: id });

        if (purgeError) throw new Error(purgeError.message);
      }

      return account;
    },

    async disconnectAccount(id) {
      const supabase = await scope.client();
      await requireAccount(id);

      // Cascades handle mailboxes, threads, messages, calendars and events.
      // The credential envelope goes with the row, which is the point: a
      // disconnected account must not leave a usable token behind.
      const { error } = await supabase
        .from("mail_accounts")
        .delete()
        .match({ ...ownerFilter(scope), id });

      if (error) throw new Error(error.message);
    },

    async listMailboxes(accountId) {
      const supabase = await scope.client();
      const { data, error } = await supabase
        .from("mailboxes")
        .select(
          "id, account_id, remote_id, name, kind, unread_count, total_count, sync_enabled, position",
        )
        .match({ ...ownerFilter(scope), account_id: accountId })
        .order("position", { ascending: true })
        .returns<
          {
            id: string;
            account_id: string;
            remote_id: string;
            name: string;
            kind: Mailbox["kind"];
            unread_count: number;
            total_count: number;
            sync_enabled: boolean;
            position: number;
          }[]
        >();

      if (error) throw new Error(error.message);

      return (data ?? []).map((row) => ({
        id: row.id,
        accountId: row.account_id,
        remoteId: row.remote_id,
        name: row.name,
        kind: row.kind,
        unreadCount: row.unread_count,
        totalCount: row.total_count,
        syncEnabled: row.sync_enabled,
        position: row.position,
      }));
    },

    async listThreads(query: ThreadQuery) {
      const supabase = await scope.client();

      let builder = supabase
        .from("messages")
        .select(
          `${MESSAGE_COLUMNS}, mail_accounts!inner(email_address, provider), mailboxes(kind)`,
        )
        .match(ownerFilter(scope))
        .order("received_at", { ascending: false })
        // Threads are assembled from messages, so the row budget has to be
        // generous enough that the newest threads are complete.
        .limit((query.limit ?? 50) * 8);

      if (query.accountId) builder = builder.eq("account_id", query.accountId);
      if (query.unreadOnly) builder = builder.eq("is_read", false);
      if (query.flaggedOnly) builder = builder.eq("is_flagged", true);
      if (query.q) {
        // The vector was built from the plaintext before encryption; see the
        // disclosure note in the migration.
        builder = builder.textSearch("search_vector", query.q, {
          type: "websearch",
          config: "english",
        });
      }

      const { data, error } = await builder.returns<
        (MessageRow & {
          mail_accounts: {
            email_address: string;
            provider: MailAccount["provider"];
          };
          mailboxes: { kind: Mailbox["kind"] } | null;
        })[]
      >();

      if (error) throw new Error(error.message);

      const rows = data ?? [];
      const importance = await importanceMap(rows.map((r) => r.from_address));

      const byThread = new Map<string, typeof rows>();
      for (const row of rows) {
        const key = row.thread_id ?? row.id;
        const bucket = byThread.get(key);
        if (bucket) bucket.push(row);
        else byThread.set(key, [row]);
      }

      const summaries: ThreadSummary[] = [];

      for (const [id, group] of byThread) {
        const ordered = [...group].sort((a, b) =>
          a.received_at.localeCompare(b.received_at),
        );
        const latest = ordered[ordered.length - 1];

        if (
          query.mailboxKind &&
          !ordered.some((m) => m.mailboxes?.kind === query.mailboxKind)
        ) {
          continue;
        }

        // The highest importance anyone in the thread carries: a critical
        // sender's message stays critical after you reply to it.
        const best = ordered.reduce<SenderImportance>((carried, row) => {
          const rated =
            importance.get(normalizeAddress(row.from_address)) ?? "normal";
          return SENDER_IMPORTANCE_RANK[rated] < SENDER_IMPORTANCE_RANK[carried]
            ? rated
            : carried;
        }, "normal");

        if (
          query.minImportance &&
          SENDER_IMPORTANCE_RANK[best] >
            SENDER_IMPORTANCE_RANK[query.minImportance]
        ) {
          continue;
        }

        // Who you would be replying to — see `correspondentOf`.
        const speaker = correspondentOf(
          ordered,
          latest.mail_accounts.email_address,
        );

        summaries.push({
          id,
          accountId: latest.account_id,
          accountAddress: latest.mail_accounts.email_address,
          provider: latest.mail_accounts.provider,
          subject: ordered[0].subject,
          from: { address: speaker.from_address, name: speaker.from_name },
          snippet: speaker.snippet,
          lastMessageAt: latest.received_at,
          messageCount: ordered.length,
          unreadCount: ordered.filter((m) => !m.is_read).length,
          hasAttachments: ordered.some((m) => m.has_attachments),
          senderImportance: best,
        });
      }

      return summaries
        .sort((a, b) =>
          (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
        )
        .slice(0, query.limit ?? 50);
    },

    async getThread(id) {
      const supabase = await scope.client();

      const { data, error } = await supabase
        .from("messages")
        .select(
          `${MESSAGE_COLUMNS}, body_cipher, mail_accounts!inner(email_address, provider, caching_policy)`,
        )
        .match(ownerFilter(scope))
        .or(`thread_id.eq.${id},id.eq.${id}`)
        .order("received_at", { ascending: true })
        .returns<
          (MessageRow & {
            mail_accounts: {
              email_address: string;
              provider: MailAccount["provider"];
              caching_policy: MailAccount["cachingPolicy"];
            };
          })[]
        >();

      if (error) throw new Error(error.message);

      const rows = data ?? [];
      if (rows.length === 0) return null;

      const importance = await importanceMap(rows.map((r) => r.from_address));
      const latest = rows[rows.length - 1];

      const messages = rows.map((row) =>
        toMessage(
          row,
          importance.get(normalizeAddress(row.from_address)) ?? "normal",
          bodyFor(row, row.mail_accounts.caching_policy),
        ),
      );

      const best = messages.reduce<SenderImportance>(
        (carried, message) =>
          SENDER_IMPORTANCE_RANK[message.senderImportance] <
          SENDER_IMPORTANCE_RANK[carried]
            ? message.senderImportance
            : carried,
        "normal",
      );

      const speaker = correspondentOf(rows, latest.mail_accounts.email_address);

      return {
        thread: {
          id,
          accountId: latest.account_id,
          accountAddress: latest.mail_accounts.email_address,
          provider: latest.mail_accounts.provider,
          subject: rows[0].subject,
          from: { address: speaker.from_address, name: speaker.from_name },
          snippet: speaker.snippet,
          lastMessageAt: latest.received_at,
          messageCount: rows.length,
          unreadCount: rows.filter((m) => !m.is_read).length,
          hasAttachments: rows.some((m) => m.has_attachments),
          senderImportance: best,
        },
        messages,
      };
    },

    async getMessage(id) {
      const supabase = await scope.client();

      const { data, error } = await supabase
        .from("messages")
        .select(
          `${MESSAGE_COLUMNS}, body_cipher, mail_accounts!inner(caching_policy)`,
        )
        .match({ ...ownerFilter(scope), id })
        .maybeSingle<
          MessageRow & {
            mail_accounts: { caching_policy: MailAccount["cachingPolicy"] };
          }
        >();

      if (error) throw new Error(error.message);
      if (!data) return null;

      const policy = data.mail_accounts.caching_policy;
      if (!policyAllowsStorage(policy)) throw new PolicyForbidsError(policy);

      const importance = await importanceMap([data.from_address]);

      return toMessage(
        data,
        importance.get(normalizeAddress(data.from_address)) ?? "normal",
        bodyFor(data, policy),
      );
    },

    async markRead(messageIds, read) {
      if (messageIds.length === 0) return;

      const supabase = await scope.client();
      const { error } = await supabase
        .from("messages")
        .update({ is_read: read })
        .match(ownerFilter(scope))
        .in("id", messageIds);

      if (error) throw new Error(error.message);
    },

    async setFlag(messageId, flagged) {
      const supabase = await scope.client();
      const { data, error } = await supabase
        .from("messages")
        .update({ is_flagged: flagged })
        .match({ ...ownerFilter(scope), id: messageId })
        .select(MESSAGE_COLUMNS)
        .maybeSingle<MessageRow>();

      if (error) throw new Error(error.message);
      if (!data) throw new MessageNotFoundError(messageId);

      const importance = await importanceMap([data.from_address]);
      return toMessage(
        data,
        importance.get(normalizeAddress(data.from_address)) ?? "normal",
        null,
      );
    },

    async listSenders() {
      const supabase = await scope.client();
      const { data, error } = await supabase
        .from("senders")
        .select("id, address, display_name, importance, notes, updated_at")
        .match(ownerFilter(scope))
        .order("importance", { ascending: true })
        .returns<
          {
            id: string;
            address: string;
            display_name: string | null;
            importance: SenderImportance;
            notes: string | null;
            updated_at: string;
          }[]
        >();

      if (error) throw new Error(error.message);

      return (data ?? []).map((row) => ({
        id: row.id,
        address: row.address,
        displayName: row.display_name,
        importance: row.importance,
        notes: row.notes,
        updatedAt: row.updated_at,
      }));
    },

    async rateSender(address, importance, notes) {
      const supabase = await scope.client();
      const normalized = normalizeAddress(address);

      const { data, error } = await supabase
        .from("senders")
        .upsert(
          owned(scope, {
            address: normalized,
            importance,
            ...(notes !== undefined && { notes }),
          }),
          { onConflict: "user_id,address" },
        )
        .select("id, address, display_name, importance, notes, updated_at")
        .single<{
          id: string;
          address: string;
          display_name: string | null;
          importance: SenderImportance;
          notes: string | null;
          updated_at: string;
        }>();

      if (error) throw new Error(error.message);

      return {
        id: data.id,
        address: data.address,
        displayName: data.display_name,
        importance: data.importance,
        notes: data.notes,
        updatedAt: data.updated_at,
      };
    },

    async listCalendars() {
      const supabase = await scope.client();
      const { data, error } = await supabase
        .from("calendars")
        .select(
          "id, account_id, remote_id, name, description, color, time_zone, is_primary, is_visible, access",
        )
        .match(ownerFilter(scope))
        .order("is_primary", { ascending: false })
        .returns<
          {
            id: string;
            account_id: string;
            remote_id: string;
            name: string;
            description: string | null;
            color: string;
            time_zone: string | null;
            is_primary: boolean;
            is_visible: boolean;
            access: Calendar["access"];
          }[]
        >();

      if (error) throw new Error(error.message);

      return (data ?? []).map((row) => ({
        id: row.id,
        accountId: row.account_id,
        remoteId: row.remote_id,
        name: row.name,
        description: row.description,
        color: row.color,
        timeZone: row.time_zone,
        isPrimary: row.is_primary,
        isVisible: row.is_visible,
        access: row.access,
      }));
    },

    async listEvents(query: EventQuery) {
      const supabase = await scope.client();

      let builder = supabase
        .from("calendar_events")
        .select(
          "id, calendar_id, remote_id, series_id, title, location, starts_at, ends_at, " +
            "all_day, time_zone, organizer_address, organizer_name, attendee_count, " +
            "is_external, response, is_cancelled, meeting_url, calendars!inner(is_visible)",
        )
        .match(ownerFilter(scope))
        .lte("starts_at", query.to)
        .gte("ends_at", query.from)
        .eq("calendars.is_visible", true)
        .order("starts_at", { ascending: true });

      if (query.calendarId) {
        builder = builder.eq("calendar_id", query.calendarId);
      }
      if (query.hideDeclined ?? true) {
        builder = builder.neq("response", "declined");
      }

      const { data, error } = await builder.returns<
        {
          id: string;
          calendar_id: string;
          remote_id: string;
          series_id: string | null;
          title: string;
          location: string | null;
          starts_at: string;
          ends_at: string;
          all_day: boolean;
          time_zone: string | null;
          organizer_address: string | null;
          organizer_name: string | null;
          attendee_count: number;
          is_external: boolean;
          response: CalendarEvent["response"];
          is_cancelled: boolean;
          meeting_url: string | null;
        }[]
      >();

      if (error) throw new Error(error.message);

      return (data ?? []).map((row) => ({
        id: row.id,
        calendarId: row.calendar_id,
        remoteId: row.remote_id,
        seriesId: row.series_id,
        title: row.title,
        location: row.location,
        // Descriptions are encrypted and are not needed to render an agenda.
        description: null,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        allDay: row.all_day,
        timeZone: row.time_zone,
        organizer: row.organizer_address
          ? { address: row.organizer_address, name: row.organizer_name }
          : null,
        attendeeCount: row.attendee_count,
        isExternal: row.is_external,
        response: row.response,
        isCancelled: row.is_cancelled,
        meetingUrl: row.meeting_url,
      }));
    },

    async setCalendarVisible(id, visible) {
      const supabase = await scope.client();
      const { data, error } = await supabase
        .from("calendars")
        .update({ is_visible: visible })
        .match({ ...ownerFilter(scope), id })
        .select(
          "id, account_id, remote_id, name, description, color, time_zone, is_primary, is_visible, access",
        )
        .single<{
          id: string;
          account_id: string;
          remote_id: string;
          name: string;
          description: string | null;
          color: string;
          time_zone: string | null;
          is_primary: boolean;
          is_visible: boolean;
          access: Calendar["access"];
        }>();

      if (error) throw new Error(error.message);

      return {
        id: data.id,
        accountId: data.account_id,
        remoteId: data.remote_id,
        name: data.name,
        description: data.description,
        color: data.color,
        timeZone: data.time_zone,
        isPrimary: data.is_primary,
        isVisible: data.is_visible,
        access: data.access,
      };
    },
  };
}

/**
 * The last message in a thread from someone who is not you.
 *
 * A thread you replied to last would otherwise carry *your own name*, which on
 * the attention card reads as "you are waiting on yourself". Falls back to the
 * newest message when every message is yours — a thread of your own drafts is
 * still from you.
 */
function correspondentOf<T extends { from_address: string }>(
  ordered: readonly T[],
  ownAddress: string,
): T {
  const own = ownAddress.toLowerCase();
  return (
    [...ordered]
      .reverse()
      .find((row) => row.from_address.toLowerCase() !== own) ??
    ordered[ordered.length - 1]
  );
}

/**
 * The plaintext body, or null.
 *
 * Null means "there is none stored", which under Metadata is the normal state
 * and not an error. A decryption *failure* is a different thing entirely and
 * is allowed to throw: showing an empty body for a corrupted one would make a
 * damaged mailbox indistinguishable from an empty one.
 */
function bodyFor(
  row: MessageRow,
  policy: MailAccount["cachingPolicy"],
): string | null {
  if (!policyAllowsBodies(policy)) return null;
  if (!row.body_cipher || !isEnvelope(row.body_cipher)) return null;

  return decryptField(row.body_cipher, aad.messageBody(row.id));
}
