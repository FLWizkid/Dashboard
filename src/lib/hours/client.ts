"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { Bucket, HoursTotals } from "./aggregate";
import type {
  CreateRulePayload,
  CreateTimeEntryPayload,
  EndSessionPayload,
  OverrideEventPayload,
  StartSessionPayload,
  UpdateRulePayload,
} from "./schema";
import type {
  PomodoroSession,
  ScheduledBlock,
  TimeEntry,
  WorkCategoryRule,
} from "./types";

/**
 * Client data access for the hours module.
 *
 * The one thing worth reading closely: logging time does **not** go through
 * here. It goes through the outbox (`use-outbox.ts`), which writes to
 * IndexedDB first and only then talks to the network. Everything in this file
 * is a read, or a write where losing it costs nothing but a retry.
 */

export const hoursKeys = {
  all: ["hours"] as const,
  window: (from: string, to: string, timeZone: string) =>
    ["hours", "window", from, to, timeZone] as const,
  pomodoro: ["hours", "pomodoro"] as const,
  rules: ["hours", "rules"] as const,
};

export interface HoursResponse {
  window: { from: string; to: string; timeZone: string };
  totals: HoursTotals;
  days: Bucket[];
  /** The last six months, for the other half of "weekly and monthly". */
  months: Bucket[];
  entries: TimeEntry[];
  blocks: ScheduledBlock[];
}

export interface PomodoroResponse {
  running: PomodoroSession | null;
  sessions: PomodoroSession[];
}

export async function hoursRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
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

/* ── Reads ────────────────────────────────────────────────────────────── */

export function useHours(options: {
  from?: string;
  to?: string;
  timeZone: string;
  enabled?: boolean;
}): UseQueryResult<HoursResponse> {
  const { from = "", to = "", timeZone } = options;

  return useQuery({
    queryKey: hoursKeys.window(from, to, timeZone),
    queryFn: async () => {
      const params = new URLSearchParams({ timeZone });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return hoursRequest<HoursResponse>(`/api/hours?${params}`);
    },
    enabled: options.enabled ?? true,
    // Hours change when a session ends or an entry is logged, both of which
    // invalidate explicitly. A short stale time keeps a second tab honest
    // without polling.
    staleTime: 30_000,
  });
}

export function usePomodoro(): UseQueryResult<PomodoroResponse> {
  return useQuery({
    queryKey: hoursKeys.pomodoro,
    queryFn: async () => hoursRequest<PomodoroResponse>("/api/pomodoro"),
    // The running session is the recovery path after a reload or a second
    // device, so it is refetched when the window regains focus.
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

export function useRules(): UseQueryResult<WorkCategoryRule[]> {
  return useQuery({
    queryKey: hoursKeys.rules,
    queryFn: async () => {
      const data = await hoursRequest<{ rules: WorkCategoryRule[] }>(
        "/api/hours/rules",
      );
      return data.rules;
    },
    staleTime: 5 * 60_000,
  });
}

/* ── Pomodoro ─────────────────────────────────────────────────────────── */

export function useStartSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: StartSessionPayload) => {
      const data = await hoursRequest<{ session: PomodoroSession }>(
        "/api/pomodoro",
        { method: "POST", body: JSON.stringify(input) },
      );
      return data.session;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: hoursKeys.pomodoro });
    },
  });
}

export function useEndSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: EndSessionPayload & { id: string }) => {
      return hoursRequest<{
        session: PomodoroSession;
        entry: TimeEntry | null;
      }>(`/api/pomodoro/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: hoursKeys.all });
    },
  });
}

/* ── Ledger edits ─────────────────────────────────────────────────────── */

/**
 * Direct create, bypassing the outbox.
 *
 * Used only where the caller already knows it is online and wants the failure
 * surfaced immediately. The mobile logging path uses the outbox instead.
 */
export function useCreateTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTimeEntryPayload) => {
      const data = await hoursRequest<{ entry: TimeEntry }>("/api/hours", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return data.entry;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: hoursKeys.all });
    },
  });
}

export function useDeleteTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await hoursRequest<void>(`/api/hours/entries/${id}`, {
        method: "DELETE",
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: hoursKeys.all });
    },
  });
}

/* ── Classification ───────────────────────────────────────────────────── */

export function useCreateRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateRulePayload) => {
      const data = await hoursRequest<{ rule: WorkCategoryRule }>(
        "/api/hours/rules",
        { method: "POST", body: JSON.stringify(input) },
      );
      return data.rule;
    },
    onSettled: () => {
      // Rules change what the scheduled column contains, so the window has to
      // go too — not just the rule list.
      void queryClient.invalidateQueries({ queryKey: hoursKeys.all });
    },
  });
}

export function useUpdateRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: UpdateRulePayload;
    }) => {
      const data = await hoursRequest<{ rule: WorkCategoryRule }>(
        `/api/hours/rules/${id}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      return data.rule;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: hoursKeys.all });
    },
  });
}

export function useDeleteRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await hoursRequest<void>(`/api/hours/rules/${id}`, { method: "DELETE" });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: hoursKeys.all });
    },
  });
}

export function useOverrideEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      eventId,
      patch,
    }: {
      eventId: string;
      patch: OverrideEventPayload;
    }) => {
      const data = await hoursRequest<{ block: ScheduledBlock }>(
        `/api/hours/events/${eventId}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      return data.block;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: hoursKeys.all });
    },
  });
}
