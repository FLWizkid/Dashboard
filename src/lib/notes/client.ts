"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { NoteKind } from "./markdown";
import type { CreateNotePayload, UpdateNotePayload } from "./schema";
import type { Backlink, Note, NoteSummary } from "./types";

/** Client data access for the notes module. */

export const noteKeys = {
  all: ["notes"] as const,
  list: (kind: string, q: string) => ["notes", "list", kind, q] as const,
  detail: (id: string) => ["notes", "detail", id] as const,
  backlinks: (id: string) => ["notes", "backlinks", id] as const,
  titles: ["notes", "titles"] as const,
};

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

export function useNotes(options: {
  kind?: NoteKind | "";
  q?: string;
}): UseQueryResult<NoteSummary[]> {
  const kind = options.kind ?? "";
  const q = options.q ?? "";

  return useQuery({
    queryKey: noteKeys.list(kind, q),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (kind) params.set("kind", kind);
      if (q) params.set("q", q);
      const data = await request<{ notes: NoteSummary[] }>(
        `/api/notes?${params}`,
      );
      return data.notes;
    },
  });
}

export function useNote(id: string | null): UseQueryResult<Note> {
  return useQuery({
    queryKey: noteKeys.detail(id ?? ""),
    queryFn: async () => {
      const data = await request<{ note: Note }>(`/api/notes/${id}`);
      return data.note;
    },
    enabled: Boolean(id),
  });
}

export function useBacklinks(id: string | null): UseQueryResult<Backlink[]> {
  return useQuery({
    queryKey: noteKeys.backlinks(id ?? ""),
    queryFn: async () => {
      const data = await request<{ backlinks: Backlink[] }>(
        `/api/notes/${id}/backlinks`,
      );
      return data.backlinks;
    },
    enabled: Boolean(id),
  });
}

export function useNoteTitles(): UseQueryResult<
  { id: string; title: string; kind: string }[]
> {
  return useQuery({
    queryKey: noteKeys.titles,
    queryFn: async () => {
      const data = await request<{
        titles: { id: string; title: string; kind: string }[];
      }>("/api/notes/titles");
      return data.titles;
    },
    // Refetched on every save anyway; this keeps the `[[` menu instant.
    staleTime: 60_000,
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateNotePayload) => {
      const data = await request<{ note: Note }>("/api/notes", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return data.note;
    },
    onSettled: () => {
      // Everything: a new note can resolve links held by any other note, so
      // invalidating only the list would leave stale "unresolved" badges.
      void queryClient.invalidateQueries({ queryKey: noteKeys.all });
    },
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: UpdateNotePayload;
    }) => {
      const data = await request<{ note: Note }>(`/api/notes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      return data.note;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: noteKeys.all });
    },
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await request<void>(`/api/notes/${id}`, { method: "DELETE" });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: noteKeys.all });
    },
  });
}
