"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ExternalLinkRelation, ExternalRef, LinkedRef } from "./model";

/**
 * The browser's view of external context.
 *
 * Every call goes to this app's own API. The browser never talks to GitHub —
 * `connect-src 'self'` forbids it, and that is what keeps the token on the
 * server rather than in a bundle.
 */

export const connectorKeys = {
  all: ["connectors"] as const,
  links: (subject: { taskId?: string; noteId?: string } = {}) =>
    [
      "connectors",
      "links",
      subject.taskId ?? null,
      subject.noteId ?? null,
    ] as const,
  search: (query: string, scope: string) =>
    ["connectors", "search", scope, query] as const,
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });

  if (response.status === 204) return undefined as T;

  const body = (await response.json().catch(() => null)) as
    (T & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }

  return body as T;
}

/** What is attached to one task or note. */
export function useExternalLinks(subject: {
  taskId?: string;
  noteId?: string;
  enabled?: boolean;
}) {
  const params = new URLSearchParams();
  if (subject.taskId) params.set("taskId", subject.taskId);
  if (subject.noteId) params.set("noteId", subject.noteId);

  return useQuery({
    queryKey: connectorKeys.links(subject),
    enabled:
      subject.enabled !== false && Boolean(subject.taskId ?? subject.noteId),
    queryFn: () =>
      request<{ links: LinkedRef[] }>(
        `/api/connectors/links?${params.toString()}`,
      ).then((data) => data.links),
  });
}

export interface AttachVariables {
  url?: string;
  refId?: string;
  taskId?: string;
  noteId?: string;
  relation?: ExternalLinkRelation;
}

export function useAttachRef() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AttachVariables) =>
      request<{ link: LinkedRef }>("/api/connectors/links", {
        method: "POST",
        body: JSON.stringify(input),
      }).then((data) => data.link),

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: connectorKeys.all });
    },
  });
}

export function useUnlinkRef() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/api/connectors/links/${id}`, { method: "DELETE" }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: connectorKeys.all });
    },
  });
}

export function useConfirmLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      request<{ link: LinkedRef }>(`/api/connectors/links/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ confirmed: true }),
      }).then((data) => data.link),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: connectorKeys.all });
    },
  });
}

/**
 * Searching.
 *
 * `linked` is local and always available; `provider` asks the service and can
 * legitimately return a reason instead of results — an unconnected provider is
 * a configuration, not a failure.
 */
export function useConnectorSearch(
  query: string,
  scope: "linked" | "provider",
  enabled = true,
) {
  return useQuery({
    queryKey: connectorKeys.search(query, scope),
    enabled: enabled && query.trim().length > 0,
    queryFn: () =>
      request<{
        refs?: ExternalRef[];
        results?: ExternalRef[];
        reason?: string;
      }>(
        `/api/connectors/search?q=${encodeURIComponent(query)}&scope=${scope}`,
      ),
  });
}
