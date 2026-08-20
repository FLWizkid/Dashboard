"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { ThreadQuery, ThreadSummary } from "./repository";
import type {
  Calendar,
  CalendarEvent,
  MailAccount,
  MailProvider,
  Message,
  SenderImportance,
} from "./types";

/** Client data access for the mail and calendar modules. */

export const mailKeys = {
  all: ["mail"] as const,
  accounts: ["mail", "accounts"] as const,
  threads: (key: string) => ["mail", "threads", key] as const,
  thread: (id: string) => ["mail", "thread", id] as const,
  senders: ["mail", "senders"] as const,
  events: (key: string) => ["calendar", "events", key] as const,
};

export interface ProviderAvailability {
  provider: MailProvider;
  configured: boolean;
  reason?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }

  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}

export function useMailAccounts(): UseQueryResult<{
  accounts: MailAccount[];
  providers: ProviderAvailability[];
}> {
  return useQuery({
    queryKey: mailKeys.accounts,
    queryFn: async () =>
      request<{ accounts: MailAccount[]; providers: ProviderAvailability[] }>(
        "/api/mail/accounts",
      ),
  });
}

function threadParams(query: ThreadQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.accountId) params.set("accountId", query.accountId);
  if (query.mailboxKind) params.set("mailboxKind", query.mailboxKind);
  if (query.q) params.set("q", query.q);
  if (query.unreadOnly) params.set("unreadOnly", "true");
  if (query.flaggedOnly) params.set("flaggedOnly", "true");
  if (query.minImportance) params.set("minImportance", query.minImportance);
  if (query.limit) params.set("limit", String(query.limit));
  return params;
}

export function useThreads(
  query: ThreadQuery,
): UseQueryResult<{ threads: ThreadSummary[] }> {
  const params = threadParams(query);

  return useQuery({
    queryKey: mailKeys.threads(params.toString()),
    queryFn: async () =>
      request<{ threads: ThreadSummary[] }>(`/api/mail/threads?${params}`),
  });
}

export function useThread(
  id: string | null,
): UseQueryResult<{ thread: ThreadSummary; messages: Message[] }> {
  return useQuery({
    queryKey: mailKeys.thread(id ?? "none"),
    queryFn: async () =>
      request<{ thread: ThreadSummary; messages: Message[] }>(
        `/api/mail/threads/${id}`,
      ),
    enabled: id !== null,
  });
}

export function useMarkRead() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: { messageIds: string[]; read: boolean }) =>
      request<void>("/api/mail/messages/read", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: mailKeys.all });
    },
  });
}

export function useRateSender() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      address: string;
      importance: SenderImportance;
    }) =>
      request<{ sender: unknown }>("/api/mail/senders", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      // Rating a sender changes the ranking of mail already on screen, so the
      // whole module is refetched rather than just the sender list.
      void client.invalidateQueries({ queryKey: mailKeys.all });
    },
  });
}

export function useUpdateAccount() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string;
      cachingPolicy?: MailAccount["cachingPolicy"];
      isCorporate?: boolean;
      syncMailEnabled?: boolean;
      syncCalendarEnabled?: boolean;
      retentionMonths?: number;
    }) =>
      request<{ account: MailAccount }>(`/api/mail/accounts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: mailKeys.all });
    },
  });
}

export function useCalendarEvents(options: {
  from: string;
  to: string;
  enabled?: boolean;
}): UseQueryResult<{ events: CalendarEvent[]; calendars: Calendar[] }> {
  const params = new URLSearchParams({ from: options.from, to: options.to });

  return useQuery({
    queryKey: mailKeys.events(params.toString()),
    queryFn: async () =>
      request<{ events: CalendarEvent[]; calendars: Calendar[] }>(
        `/api/calendar/events?${params}`,
      ),
    enabled: options.enabled ?? true,
  });
}
