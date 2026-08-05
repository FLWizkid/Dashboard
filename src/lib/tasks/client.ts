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
) {
  const snapshots = queryClient.getQueriesData<Task[]>({
    queryKey: taskKeys.all,
  });

  for (const [key, value] of snapshots) {
    if (value) queryClient.setQueryData(key, update(value));
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
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
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
