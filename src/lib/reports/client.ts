"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { ActivityCategory } from "@/lib/tasks/types";

import type { ActivitySplit, ExecutiveSummary, TwoDaySlot } from "./summary";
import type { GroupedTasks } from "./group";

/** Client data access for the reports module. */

export const reportKeys = {
  all: ["reports"] as const,
  report: (key: string) => ["reports", "report", key] as const,
  inbox: ["reports", "inbox"] as const,
};

export interface ReportResponse {
  generatedAt: string;
  timeZone: string;
  summary: ExecutiveSummary;
  groups: GroupedTasks[];
  splits: ActivitySplit[];
  twoDay: TwoDaySlot[];
  categories: ActivityCategory[];
  filteredOut: number;
}

export interface ReportFilterInput {
  q?: string;
  priorities?: readonly string[];
  categories?: readonly string[];
  statuses?: readonly string[];
  incompleteOnly?: boolean;
  uncategorisedOnly?: boolean;
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

function toParams(
  timeZone: string,
  filters: ReportFilterInput,
): URLSearchParams {
  const params = new URLSearchParams({ timeZone });

  if (filters.q) params.set("q", filters.q);
  if (filters.priorities?.length)
    params.set("priorities", filters.priorities.join(","));
  if (filters.categories?.length)
    params.set("categories", filters.categories.join(","));
  if (filters.statuses?.length)
    params.set("statuses", filters.statuses.join(","));
  if (filters.incompleteOnly) params.set("incompleteOnly", "true");
  if (filters.uncategorisedOnly) params.set("uncategorisedOnly", "true");

  return params;
}

export function useReport(options: {
  timeZone: string;
  filters?: ReportFilterInput;
  enabled?: boolean;
}): UseQueryResult<ReportResponse> {
  const params = toParams(options.timeZone, options.filters ?? {});

  return useQuery({
    queryKey: reportKeys.report(params.toString()),
    queryFn: async () => request<ReportResponse>(`/api/reports?${params}`),
    enabled: options.enabled ?? true,
    // A report is a snapshot; refetching it under the reader is disorienting
    // when they are halfway through reading a column of numbers.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export interface InboxMessageView {
  id: string;
  kind: "daily" | "weekly" | "monthly";
  subject: string;
  preview: string;
  body: string;
  html: string | null;
  readAt: string | null;
  generatedAt: string;
}

export function useInbox(): UseQueryResult<{
  messages: InboxMessageView[];
  unread: number;
}> {
  return useQuery({
    queryKey: reportKeys.inbox,
    queryFn: async () =>
      request<{ messages: InboxMessageView[]; unread: number }>("/api/inbox"),
    refetchOnWindowFocus: true,
  });
}
