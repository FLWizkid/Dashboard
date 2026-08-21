import { randomUUID } from "node:crypto";

import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";

import {
  completedAtFor,
  DuplicateTaskError,
  TaskNotFoundError,
  type TaskRepository,
} from "./repository";
import { isReady } from "./ready";
import type {
  CreateTaskPayload,
  ListTasksQuery,
  UpdateTaskPayload,
} from "./schema";
import type { ActivityCategory, Task, TaskLink } from "./types";

/**
 * In-process repository used by end-to-end tests.
 *
 * It is not a mock: it implements the same contract with the same rules,
 * including deriving `isReady` and keeping `status`/`completedAt` in step, so
 * an E2E run exercises the real UI against real behaviour. It is unreachable
 * in production — see `src/lib/data-mode.ts`.
 *
 * State hangs off `globalThis` so it survives the dev server's module
 * reloading; without that, a hot reload mid-test would empty the list.
 */
interface MemoryStore {
  categories: ActivityCategory[];
  tasks: Task[];
  /**
   * `clientKey` → task id, standing in for the partial unique index on
   * `tasks (user_id, client_key)`.
   *
   * Kept beside the tasks rather than on them because a client key is a
   * transport detail — the device's way of making a retry safe — and not
   * something the product knows or shows about a task.
   *
   * It is here at all because **an end-to-end suite that passes against a
   * permissive fake is a statement about nothing.** If this fake accepted a
   * replayed capture and created a second task, the offline tests would go
   * green while the real database was the only thing preventing duplicates.
   */
  clientKeys: Map<string, string>;
}

const STORE_KEY = Symbol.for("dashboard.memoryTaskStore");

function getStore(): MemoryStore {
  const globalStore = globalThis as typeof globalThis & {
    [STORE_KEY]?: MemoryStore;
  };

  if (!globalStore[STORE_KEY]) {
    globalStore[STORE_KEY] = {
      categories: DEFAULT_CATEGORIES.map((category) => ({
        // Deterministic ids keep test fixtures readable.
        id: `00000000-0000-4000-9000-${String(category.position).padStart(12, "0")}`,
        slug: category.slug,
        name: category.name,
        description: category.description,
        color: category.color,
        position: category.position,
        isDefault: true,
        isArchived: false,
      })),
      tasks: [],
      clientKeys: new Map(),
    };
  }

  return globalStore[STORE_KEY];
}

/**
 * Seeds tasks wholesale.
 *
 * Takes finished `Task` rows rather than create payloads so a demo can set
 * what the create path deliberately will not: a completion timestamp in the
 * past, a manual rank, a draft awaiting an owner. Those are the states worth
 * looking at, and none of them can be reached by capturing a task now.
 */
export function seedMemoryTasks(tasks: Task[]): void {
  getStore().tasks = [...tasks];
}

/** Test-only reset hook, exposed through the E2E route handler. */
export function resetMemoryStore(): void {
  const store = getStore();
  store.tasks = [];
  // Leaving these behind would make a reset test fail its *second* run only,
  // with a duplicate error about a task that no longer exists.
  store.clientKeys.clear();
}

function withDerived(task: Task): Task {
  return { ...task, isReady: isReady(task) };
}

export const memoryTaskRepository: TaskRepository = {
  async listCategories() {
    return getStore().categories.filter((category) => !category.isArchived);
  },

  async listTasks(query: ListTasksQuery) {
    const { tasks } = getStore();

    const filtered = tasks.filter((task) => {
      if (query.status) return task.status === query.status;
      if (query.scope === "open") return task.status !== "done";
      if (query.scope === "done") return task.status === "done";
      return true;
    });

    return filtered
      .slice()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, query.limit);
  },

  async getTask(id: string) {
    return getStore().tasks.find((task) => task.id === id) ?? null;
  },

  async createTask(input: CreateTaskPayload) {
    const store = getStore();
    const now = new Date();
    const id = randomUUID();

    // The unique index, enforced here too. A replayed flush is the *normal*
    // outcome of a connection that died after the write, so answering it with
    // the row that already exists is the whole mechanism — not an edge case.
    if (input.clientKey) {
      const existingId = store.clientKeys.get(input.clientKey);
      const existing = existingId
        ? store.tasks.find((task) => task.id === existingId)
        : undefined;

      if (existing) throw new DuplicateTaskError(existing);
    }

    const links: TaskLink[] = input.links.map((link) => ({
      id: randomUUID(),
      taskId: id,
      kind: link.kind,
      relation: link.relation,
      targetId: link.targetId,
      targetLabel: link.targetLabel,
      targetUrl: link.targetUrl,
      confirmedAt: link.confirmed ? now.toISOString() : null,
      createdAt: now.toISOString(),
    }));

    const task = withDerived({
      id,
      title: input.title,
      notes: input.notes,
      priority: input.priority,
      dueAt: input.dueAt,
      categoryId: input.categoryId,
      status: input.status,
      pinned: input.pinned,
      sourceLink: input.sourceLink,
      owner: input.owner,
      isReady: false,
      isDraft: input.isDraft ?? false,
      canActivate: Boolean(input.owner && input.dueAt && input.priority),
      // A new task is never manually placed — only an explicit act sets this.
      manualRank: null,
      manualRankSetAt: null,
      completedAt: completedAtFor(input.status, null, now) ?? null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      links,
    });

    store.tasks.push(task);
    if (input.clientKey) store.clientKeys.set(input.clientKey, id);

    return task;
  },

  async updateTask(id: string, patch: UpdateTaskPayload) {
    const store = getStore();
    const index = store.tasks.findIndex((task) => task.id === id);
    if (index === -1) throw new TaskNotFoundError(id);

    const existing = store.tasks[index];
    const completedAt = completedAtFor(
      patch.status,
      existing.completedAt,
      new Date(),
    );

    const updated = withDerived({
      ...existing,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
      ...(patch.categoryId !== undefined
        ? { categoryId: patch.categoryId }
        : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      ...(patch.sourceLink !== undefined
        ? { sourceLink: patch.sourceLink }
        : {}),
      ...(patch.owner !== undefined ? { owner: patch.owner } : {}),
      ...(patch.manualRank !== undefined
        ? {
            manualRank: patch.manualRank,
            // The database stamps this with a trigger; the fake does it here
            // so an E2E run sees the same shape a deployment would.
            manualRankSetAt:
              patch.manualRank === null ? null : new Date().toISOString(),
          }
        : {}),
      ...(completedAt !== undefined ? { completedAt } : {}),
      updatedAt: new Date().toISOString(),
    });

    store.tasks[index] = updated;
    return updated;
  },

  async deleteTask(id: string) {
    const store = getStore();
    store.tasks = store.tasks.filter((task) => task.id !== id);

    // Free the key, exactly as the row going away does in Postgres. Holding
    // it would make a re-capture with the same key report a duplicate and
    // hand back a task that has been deleted.
    for (const [key, taskId] of store.clientKeys) {
      if (taskId === id) store.clientKeys.delete(key);
    }
  },
};
