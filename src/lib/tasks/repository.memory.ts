import { randomUUID } from "node:crypto";

import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";

import {
  completedAtFor,
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
    };
  }

  return globalStore[STORE_KEY];
}

/** Test-only reset hook, exposed through the E2E route handler. */
export function resetMemoryStore(): void {
  getStore().tasks = [];
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
      completedAt: completedAtFor(input.status, null, now) ?? null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      links,
    });

    store.tasks.push(task);
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
      ...(completedAt !== undefined ? { completedAt } : {}),
      updatedAt: new Date().toISOString(),
    });

    store.tasks[index] = updated;
    return updated;
  },

  async deleteTask(id: string) {
    const store = getStore();
    store.tasks = store.tasks.filter((task) => task.id !== id);
  },
};
