import { isMemoryMode } from "@/lib/data-mode";

import type {
  CreateCategoryPayload,
  UpdateCategoryPayload,
  CreateTaskPayload,
  ListTasksQuery,
  UpdateTaskPayload,
} from "./schema";
import type { ActivityCategory, Task } from "./types";

/**
 * The seam every task read and write goes through.
 *
 * One implementation talks to self-hosted Supabase (RLS does the access
 * control); the other keeps rows in process for end-to-end tests. Keeping the
 * contract this narrow is also what the Phase 2 mail/calendar adapters will
 * look like — provider logic isolated behind a normalized internal model.
 */
export interface TaskRepository {
  listCategories(): Promise<ActivityCategory[]>;
  createCategory(input: CreateCategoryPayload): Promise<ActivityCategory>;
  updateCategory(
    id: string,
    patch: UpdateCategoryPayload,
  ): Promise<ActivityCategory>;
  listTasks(query: ListTasksQuery): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  createTask(input: CreateTaskPayload): Promise<Task>;
  updateTask(id: string, patch: UpdateTaskPayload): Promise<Task>;
  deleteTask(id: string): Promise<void>;
}

/** Thrown when a row exists but doesn't belong to the caller, or is absent. */
/**
 * Thrown when a capture's `clientKey` has already been used.
 *
 * A **success**, not a failure: the task is already recorded. It carries the
 * existing row so the route can answer 200 with the task the caller wanted,
 * rather than an error the queue would treat as something to retry forever.
 *
 * The same shape as `DuplicateClientKeyError` in the hours module, on purpose
 * — two idempotency mechanisms that behave differently is one more thing for
 * a flush to get subtly wrong.
 */
export class DuplicateTaskError extends Error {
  constructor(public readonly existing: Task) {
    super(`A task with that client key already exists`);
    this.name = "DuplicateTaskError";
  }
}

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Task ${id} was not found`);
    this.name = "TaskNotFoundError";
  }
}

export async function getTaskRepository(): Promise<TaskRepository> {
  if (isMemoryMode()) {
    const { memoryTaskRepository } = await import("./repository.memory");
    return memoryTaskRepository;
  }
  const { createSupabaseTaskRepository } =
    await import("./repository.supabase");
  return createSupabaseTaskRepository();
}

/**
 * `status` and `completed_at` must move together — the database has a check
 * constraint saying so. This is the one place that derives the timestamp.
 */
export function completedAtFor(
  status: Task["status"] | undefined,
  previous: string | null,
  now: Date,
): string | null | undefined {
  if (status === undefined) return undefined;
  if (status === "done") return previous ?? now.toISOString();
  return null;
}
