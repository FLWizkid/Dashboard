"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { taskKeys } from "@/lib/tasks/client";

import type { Explanation } from "./rank";
import type { StoredSuggestion } from "./repository";
import type { TaskLinkRelation } from "@/lib/tasks/types";

/** Client data access for the priority engine. */

export const priorityKeys = {
  all: ["priority"] as const,
  ranking: ["priority", "ranking"] as const,
};

export interface RankedRow {
  taskId: string;
  total: number;
  overridden: boolean;
  manualRank: number | null;
  summary: string;
  explanation: Explanation;
  drivingEventId: string | null;
  drivingEventTitle: string | null;
  drivingRelation: TaskLinkRelation | null;
}

export interface RankingResponse {
  ranked: RankedRow[];
  suggestions: StoredSuggestion[];
  pendingCount: number;
  computedAt: string;
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

export function useRanking(): UseQueryResult<RankingResponse> {
  return useQuery({
    queryKey: priorityKeys.ranking,
    queryFn: async () => request<RankingResponse>("/api/priority"),
    // The ranking is a function of the clock as well as the data — a task
    // becomes overdue without anything being edited. A minute's staleness
    // keeps it honest without polling hard.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useAnswerSuggestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      decision,
      withNote,
    }: {
      id: string;
      decision: "accept" | "dismiss";
      withNote?: boolean;
    }) =>
      request<unknown>(`/api/priority/suggestions/${id}`, {
        method: "POST",
        body: JSON.stringify({ decision, withNote: withNote ?? false }),
      }),

    onSettled: () => {
      // Accepting creates a confirmed link, which changes the ranking *and*
      // the task's own links — and possibly a note. Invalidate all three.
      void queryClient.invalidateQueries({ queryKey: priorityKeys.all });
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
    },
  });
}
