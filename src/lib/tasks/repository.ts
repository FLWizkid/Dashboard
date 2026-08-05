import { isMemoryMode } from "@/lib/data-mode";

import type {
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
  listTasks(query: ListTasksQuery): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  createTask(input: CreateTaskPayload): Promise<Task>;
  updateTask(id: string, patch: UpdateTaskPayload): Promise<Task>;
  deleteTask(id: string): Promise<void>;
}

/** Thrown when a row exists but doesn't belong to the caller, or is absent. */
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
