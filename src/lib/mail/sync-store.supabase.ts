import "server-only";

import { recordAudit } from "@/lib/audit/record";
import { owned, ownerFilter, type DataScope } from "@/lib/db/scope";
import type { StoredMessage, SyncResult } from "./sync";
import type { CachingPolicy, MailProvider } from "./types";

/**
 * Persistence for a sync pass.
 *
 * The sync engine deliberately returns rows rather than writing them — that is
 * what makes it testable without a database. This is the other half: it takes
 * what the engine produced and lands it, then records where the next run
 * should resume.
 */

export interface SyncableAccount {
  id: string;
  provider: MailProvider;
  cachingPolicy: CachingPolicy;
  emailAddress: string;
  credentialsCipher: string | null;
  syncMailEnabled: boolean;
  cursor: string | null;
  failureCount: number;
  lastRunAt: string | null;
}

export interface SyncStore {
  listSyncableAccounts(): Promise<SyncableAccount[]>;
  writeCredentials(accountId: string, cipher: string): Promise<void>;
  persist(accountId: string, result: SyncResult): Promise<number>;
}

interface AccountRow {
  id: string;
  provider: MailProvider;
  caching_policy: CachingPolicy;
  email_address: string;
  credentials_cipher: string | null;
  sync_mail_enabled: boolean;
}

interface SyncStateRow {
  account_id: string;
  cursor: string | null;
  failure_count: number;
  last_run_at: string | null;
}

export function createSyncStore(scope: DataScope): SyncStore {
  return {
    async listSyncableAccounts() {
      const client = await scope.client();

      const { data: accounts, error } = await client
        .from("mail_accounts")
        .select(
          "id, provider, caching_policy, email_address, credentials_cipher, sync_mail_enabled",
        )
        .match(ownerFilter(scope))
        .eq("sync_mail_enabled", true)
        .returns<AccountRow[]>();

      if (error) throw new Error(error.message);
      if (!accounts?.length) return [];

      const { data: states, error: stateError } = await client
        .from("sync_state")
        .select("account_id, cursor, failure_count, last_run_at")
        .match(ownerFilter(scope))
        .eq("resource", "messages")
        .in(
          "account_id",
          accounts.map((account) => account.id),
        )
        .returns<SyncStateRow[]>();

      if (stateError) throw new Error(stateError.message);

      const stateFor = new Map(
        (states ?? []).map((state) => [state.account_id, state]),
      );

      return accounts.map((account) => {
        const state = stateFor.get(account.id);
        return {
          id: account.id,
          provider: account.provider,
          cachingPolicy: account.caching_policy,
          emailAddress: account.email_address,
          credentialsCipher: account.credentials_cipher,
          syncMailEnabled: account.sync_mail_enabled,
          cursor: state?.cursor ?? null,
          failureCount: state?.failure_count ?? 0,
          lastRunAt: state?.last_run_at ?? null,
        };
      });
    },

    async writeCredentials(accountId, cipher) {
      const client = await scope.client();
      const { error } = await client
        .from("mail_accounts")
        .update({
          credentials_cipher: cipher,
          credentials_updated_at: new Date().toISOString(),
        })
        .match({ id: accountId, ...ownerFilter(scope) });

      if (error) throw new Error(error.message);

      // Credentials changing is worth a line: a refresh nobody asked for is
      // one of the few signals that a token has been used elsewhere.
      await recordAudit(scope, {
        action: "credentials.written",
        subjectType: "mail_account",
        subjectId: accountId,
        actor: scope.userId ? "scheduler" : "session",
      });
    },

    async persist(accountId, result) {
      const client = await scope.client();
      const now = new Date().toISOString();

      let written = 0;
      if (result.messages.length > 0) {
        written = await writeMessages(client, scope, accountId, result.messages);
      }

      // The account carries the human-facing status; sync_state carries the
      // machinery. Both are written even on failure — an account that has been
      // failing for a day should say so in the interface, not look idle.
      const { error: accountError } = await client
        .from("mail_accounts")
        .update({
          status: result.status,
          status_detail: result.detail,
          last_sync_at: now,
          ...(result.error
            ? { last_error: result.error, last_error_at: now }
            : { last_success_at: now, last_error: null, last_error_at: null }),
        })
        .match({ id: accountId, ...ownerFilter(scope) });

      if (accountError) throw new Error(accountError.message);

      const stateRow: Record<string, unknown> = {
        account_id: accountId,
        resource: "messages",
        // A failed run keeps the previous cursor, so the next attempt
        // resumes rather than silently skipping whatever it missed.
        cursor: result.requiresFullResync ? null : result.cursor,
        last_run_at: now,
        last_error: result.error,
        failure_count: result.error ? await nextFailureCount() : 0,
      };

      // Only stamped on success. Writing null here on a failed run would
      // erase the record of when this mailbox last actually worked, which is
      // the one fact worth having when diagnosing a quiet account.
      if (!result.error) stateRow.last_success_at = now;

      const { error: stateError } = await client
        .from("sync_state")
        .upsert(owned(scope, stateRow), { onConflict: "account_id,resource" });

      if (stateError) throw new Error(stateError.message);

      await recordAudit(scope, {
        action: "mail.synced",
        subjectType: "mail_account",
        subjectId: accountId,
        actor: scope.userId ? "scheduler" : "session",
        detail: { stored: written, status: result.status, error: result.error },
      });

      return written;

      async function nextFailureCount(): Promise<number> {
        const { data } = await client
          .from("sync_state")
          .select("failure_count")
          .match({
            account_id: accountId,
            resource: "messages",
            ...ownerFilter(scope),
          })
          .maybeSingle<{ failure_count: number }>();

        return (data?.failure_count ?? 0) + 1;
      }
    },
  };
}

/**
 * Lands messages, with their threads.
 *
 * Threads first, because a message references one. Both are upserted on the
 * provider's own identifier so a re-run of the same page updates rather than
 * duplicates — which matters more than usual here, since a cursor that fails
 * to advance would otherwise multiply the mailbox on every pass.
 */
async function writeMessages(
  client: Awaited<ReturnType<DataScope["client"]>>,
  scope: DataScope,
  accountId: string,
  messages: StoredMessage[],
): Promise<number> {
  const threadIds = new Map<string, string>();
  const remoteThreadIds = [
    ...new Set(
      messages
        .map((message) => message.threadRemoteId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (remoteThreadIds.length > 0) {
    const { data, error } = await client
      .from("mail_threads")
      .upsert(
        remoteThreadIds.map((remoteId) => {
          const inThread = messages.filter(
            (message) => message.threadRemoteId === remoteId,
          );
          const latest = inThread.reduce((newest, message) =>
            message.receivedAt > newest.receivedAt ? message : newest,
          );

          return owned(scope, {
            account_id: accountId,
            remote_id: remoteId,
            subject: latest.subject,
            last_message_at: latest.receivedAt,
            message_count: inThread.length,
            unread_count: inThread.filter((message) => !message.isRead).length,
            has_attachments: inThread.some((message) => message.hasAttachments),
          });
        }),
        { onConflict: "account_id,remote_id" },
      )
      .select("id, remote_id")
      .returns<{ id: string; remote_id: string }[]>();

    if (error) throw new Error(error.message);
    for (const row of data ?? []) threadIds.set(row.remote_id, row.id);
  }

  const rows = messages.map((message) =>
    owned(scope, {
      account_id: accountId,
      thread_id: message.threadRemoteId
        ? (threadIds.get(message.threadRemoteId) ?? null)
        : null,
      remote_id: message.remoteId,
      message_id_header: message.messageIdHeader,
      subject: message.subject,
      snippet: message.snippet,
      from_address: message.fromAddress,
      from_name: message.fromName,
      to_addresses: message.toAddresses,
      cc_addresses: message.ccAddresses,
      sent_at: message.sentAt,
      received_at: message.receivedAt,
      is_read: message.isRead,
      is_flagged: message.isFlagged,
      is_draft: message.isDraft,
      has_attachments: message.hasAttachments,
      body_cipher: message.bodyCipher,
      body_format: message.bodyFormat,
    }),
  );

  const { data, error } = await client
    .from("messages")
    .upsert(rows, { onConflict: "account_id,remote_id" })
    .select("id, remote_id")
    .returns<{ id: string; remote_id: string }[]>();

  if (error) throw new Error(error.message);

  // The search vector is built from plaintext that must not be stored, so it
  // is written separately, through a function that takes the text and keeps
  // only the tsvector. Messages with nothing indexable are skipped.
  const indexable = messages.filter((message) => message.searchIndexInput);
  if (indexable.length > 0) {
    const idFor = new Map((data ?? []).map((row) => [row.remote_id, row.id]));

    await Promise.all(
      indexable.map((message) => {
        const id = idFor.get(message.remoteId);
        if (!id) return Promise.resolve();
        return client.rpc("set_message_search_vector", {
          p_message_id: id,
          p_text: message.searchIndexInput,
        });
      }),
    );
  }

  return data?.length ?? 0;
}
