"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { CreateTaskPayload, UpdateTaskPayload } from "./schema";
import type { ActivityCategory, Task } from "./types";

/**
 * Client data access for the task module.
 *
 * Every mutation is optimistic. Capture and completion have to feel
 * instantaneous — the spec asks for "extremely easy to add and to mark done",
 * and a spinner between the click and the checkmark is the thing that makes a
 * list feel slow. On failure the cache rolls back and the caller surfaces it.
 */

export const taskKeys = {
  all: ["tasks"] as const,
  list: (scope: TaskScope) => ["tasks", "list", scope] as const,
  categories: ["categories"] as const,
};

export type TaskScope = "open" | "all" | "done";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
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

export function useTasks(scope: TaskScope = "all"): UseQueryResult<Task[]> {
  return useQuery({
    queryKey: taskKeys.list(scope),
    queryFn: async () => {
      const data = await request<{ tasks: Task[] }>(
        `/api/tasks?scope=${scope}`,
      );
      return data.tasks;
    },
  });
}

export function useCategories(): UseQueryResult<ActivityCategory[]> {
  return useQuery({
    queryKey: taskKeys.categories,
    queryFn: async () => {
      const data = await request<{ categories: ActivityCategory[] }>(
        "/api/categories",
      );
      return data.categories;
    },
    // The taxonomy changes about once a quarter.
    staleTime: 5 * 60_000,
  });
}

/** Everything a list query holds, so optimistic edits can patch each one. */
function eachTaskList(
  queryClient: ReturnType<typeof useQueryClient>,
  update: (tasks: Task[]) => Task[],
  /**
   * Which scopes to touch. Editing a task is right for every list it appears
   * in; *inserting* one is not — a brand new task has no business showing up
   * in the completed list, which is the one place optimism would read as a
   * bug rather than as speed.
   */
  scopes: (scope: TaskScope) => boolean = () => true,
) {
  const snapshots = queryClient.getQueriesData<Task[]>({
    queryKey: taskKeys.all,
  });

  for (const [key, value] of snapshots) {
    const scope = key[2] as TaskScope | undefined;
    if (!value) continue;
    if (scope && !scopes(scope)) continue;
    queryClient.setQueryData(key, update(value));
  }

  return snapshots;
}

function restore(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshots: ReturnType<typeof eachTaskList>,
) {
  for (const [key, value] of snapshots) {
    queryClient.setQueryData(key, value);
  }
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTaskPayload) => {
      const data = await request<{ task: Task }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return data.task;
    },

    /**
     * Show the task before the server has agreed to it.
     *
     * Completion has been optimistic since P1 and capture never was, so the
     * two halves of "extremely easy to add and to mark done" behaved
     * differently: ticking a task was instant, while capturing one cleared
     * the input and then showed nothing until a round-trip and a refetch had
     * both finished. On a fast machine that is a flicker — but it is exactly
     * the moment you look at to decide whether what you just typed was
     * recorded, and this module's own description has claimed since P1 that
     * every mutation is optimistic.
     *
     * The provisional row is replaced wholesale by the refetch in
     * `onSettled`, so its temporary id never outlives the request.
     */
    onMutate: async (input: CreateTaskPayload) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });

      const provisional = provisionalTask(input);
      const snapshots = eachTaskList(
        queryClient,
        (tasks) => [...tasks, provisional],
        (scope) => scope !== "done",
      );

      return { snapshots };
    },

    onError: (_error, _input, context) => {
      if (context?.snapshots) restore(queryClient, context.snapshots);
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

/**
 * The row shown while the server is still thinking.
 *
 * Derived fields are computed the way the database computes them, so the
 * provisional row never claims a Ready badge the real one will not have.
 *
 * Exported for its unit test: the derived fields are the part worth pinning,
 * because getting them wrong shows the owner a badge that disappears a
 * moment later.
 */
export function provisionalTask(input: CreateTaskPayload): Task {
  const now = new Date().toISOString();

  return {
    // Deliberately not a uuid: if one of these ever survives a refetch, the
    // id says where it came from.
    id: `optimistic:${now}:${input.title}`,
    title: input.title,
    notes: input.notes ?? null,
    priority: input.priority ?? null,
    dueAt: input.dueAt ?? null,
    categoryId: input.categoryId ?? null,
    status: input.status ?? "inbox",
    pinned: input.pinned ?? false,
    sourceLink: input.sourceLink ?? null,
    owner: input.owner ?? null,
    isDraft: input.isDraft ?? false,
    isReady:
      input.title.trim().length > 0 &&
      (input.priority ?? null) !== null &&
      (input.dueAt ?? null) !== null,
    canActivate: Boolean(input.owner && input.dueAt && input.priority),
    manualRank: null,
    manualRankSetAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    links: [],
  };
}

export interface UpdateTaskVariables {
  id: string;
  patch: UpdateTaskPayload;
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, patch }: UpdateTaskVariables) => {
      const data = await request<{ task: Task }>(`/api/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      return data.task;
    },

    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });

      const snapshots = eachTaskList(queryClient, (tasks) =>
        tasks.map((task) =>
          task.id === id ? applyOptimisticPatch(task, patch) : task,
        ),
      );

      return { snapshots };
    },

    onError: (_error, _variables, context) => {
      if (context?.snapshots) restore(queryClient, context.snapshots);
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await request<void>(`/api/tasks/${id}`, { method: "DELETE" });
    },

    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });
      const snapshots = eachTaskList(queryClient, (tasks) =>
        tasks.filter((task) => task.id !== id),
      );
      return { snapshots };
    },

    onError: (_error, _id, context) => {
      if (context?.snapshots) restore(queryClient, context.snapshots);
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

/**
 * Mirror the server's derived fields locally so an optimistic row looks
 * exactly like the one that comes back — no flicker on reconcile.
 */
function applyOptimisticPatch(task: Task, patch: UpdateTaskPayload): Task {
  const next: Task = { ...task, ...patch } as Task;

  if (patch.status !== undefined) {
    next.completedAt =
      patch.status === "done"
        ? (task.completedAt ?? new Date().toISOString())
        : null;
  }

  next.isReady =
    next.title.trim().length > 0 &&
    next.priority !== null &&
    next.dueAt !== null;
  next.updatedAt = new Date().toISOString();

  return next;
}
