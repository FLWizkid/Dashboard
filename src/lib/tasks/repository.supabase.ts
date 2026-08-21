import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import {
  completedAtFor,
  DuplicateTaskError,
  TaskNotFoundError,
  type TaskRepository,
} from "./repository";
import type {
  CreateTaskPayload,
  ListTasksQuery,
  UpdateTaskPayload,
} from "./schema";
import type { ActivityCategory, Task, TaskLink } from "./types";

type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type TaskLinkRow = Database["public"]["Tables"]["task_links"]["Row"];
type CategoryRow = Database["public"]["Tables"]["activity_categories"]["Row"];

const TASK_COLUMNS =
  "id, title, notes, priority, due_at, category_id, status, pinned, source_link, owner, is_ready, is_draft, can_activate, manual_rank, manual_rank_set_at, completed_at, created_at, updated_at";

/** Postgres's unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

const LINK_COLUMNS =
  "id, task_id, kind, relation, target_id, target_label, target_url, confirmed_at, created_at";

function toTask(row: TaskRow, links: TaskLinkRow[]): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    priority: row.priority,
    dueAt: row.due_at,
    categoryId: row.category_id,
    status: row.status,
    pinned: row.pinned,
    sourceLink: row.source_link,
    owner: row.owner,
    isReady: row.is_ready,
    isDraft: row.is_draft,
    canActivate: row.can_activate,
    manualRank: row.manual_rank,
    manualRankSetAt: row.manual_rank_set_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    links: links.map(toTaskLink),
  };
}

function toTaskLink(row: TaskLinkRow): TaskLink {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    relation: row.relation,
    targetId: row.target_id,
    targetLabel: row.target_label,
    targetUrl: row.target_url,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  };
}

function toCategory(row: CategoryRow): ActivityCategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    color: row.color,
    position: row.position,
    isDefault: row.is_default,
    isArchived: row.is_archived,
  };
}

/**
 * Supabase-backed repository.
 *
 * Access control is Row Level Security, not application code: every statement
 * below runs as the signed-in user via the request's cookie, so a query that
 * forgot a `user_id` filter still cannot see anyone else's rows. `user_id`
 * itself is never sent — the column defaults to `auth.uid()`.
 */
export function createSupabaseTaskRepository(): TaskRepository {
  return {
    async listCategories() {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("activity_categories")
        .select(
          "id, slug, name, description, color, position, is_default, is_archived",
        )
        .eq("is_archived", false)
        .order("position", { ascending: true })
        .returns<CategoryRow[]>();

      if (error) throw new Error(error.message);
      return (data ?? []).map(toCategory);
    },

    async listTasks(query: ListTasksQuery) {
      const supabase = await createClient();

      let builder = supabase.from("tasks").select(TASK_COLUMNS);

      if (query.status) {
        builder = builder.eq("status", query.status);
      } else if (query.scope === "open") {
        builder = builder.neq("status", "done");
      } else if (query.scope === "done") {
        builder = builder.eq("status", "done");
      }

      const { data, error } = await builder
        .order("created_at", { ascending: false })
        .limit(query.limit)
        .returns<TaskRow[]>();

      if (error) throw new Error(error.message);

      const rows = data ?? [];
      if (rows.length === 0) return [];

      const { data: linkRows, error: linkError } = await supabase
        .from("task_links")
        .select(LINK_COLUMNS)
        .in(
          "task_id",
          rows.map((row) => row.id),
        )
        .returns<TaskLinkRow[]>();

      if (linkError) throw new Error(linkError.message);

      const linksByTask = new Map<string, TaskLinkRow[]>();
      for (const link of linkRows ?? []) {
        const bucket = linksByTask.get(link.task_id);
        if (bucket) bucket.push(link);
        else linksByTask.set(link.task_id, [link]);
      }

      return rows.map((row) => toTask(row, linksByTask.get(row.id) ?? []));
    },

    async getTask(id: string) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("tasks")
        .select(TASK_COLUMNS)
        .eq("id", id)
        .maybeSingle<TaskRow>();

      if (error) throw new Error(error.message);
      if (!data) return null;

      const { data: linkRows, error: linkError } = await supabase
        .from("task_links")
        .select(LINK_COLUMNS)
        .eq("task_id", id)
        .returns<TaskLinkRow[]>();

      if (linkError) throw new Error(linkError.message);
      return toTask(data, linkRows ?? []);
    },

    async createTask(input: CreateTaskPayload) {
      const supabase = await createClient();
      const now = new Date();

      const { data, error } = await supabase
        .from("tasks")
        .insert({
          title: input.title,
          notes: input.notes,
          priority: input.priority,
          due_at: input.dueAt,
          category_id: input.categoryId,
          status: input.status,
          pinned: input.pinned,
          source_link: input.sourceLink,
          owner: input.owner,
          is_draft: input.isDraft,
          client_key: input.clientKey,
          completed_at: completedAtFor(input.status, null, now) ?? null,
        })
        .select(TASK_COLUMNS)
        .single<TaskRow>();

      if (error) {
        // A unique violation on `client_key` means a previous attempt got
        // through and its response did not. That is a success: hand back the
        // row that exists rather than an error the queue would retry forever.
        if (error.code === UNIQUE_VIOLATION && input.clientKey) {
          const existing = await findByClientKey(supabase, input.clientKey);
          if (existing) throw new DuplicateTaskError(existing);
        }

        throw new Error(error.message);
      }

      let linkRows: TaskLinkRow[] = [];
      if (input.links.length > 0) {
        const { data: inserted, error: linkError } = await supabase
          .from("task_links")
          .insert(
            input.links.map((link) => ({
              task_id: data.id,
              kind: link.kind,
              relation: link.relation,
              target_id: link.targetId,
              target_label: link.targetLabel,
              target_url: link.targetUrl,
              // Only ever set from an explicit user confirmation.
              confirmed_at: link.confirmed ? now.toISOString() : null,
            })),
          )
          .select(LINK_COLUMNS)
          .returns<TaskLinkRow[]>();

        if (linkError) throw new Error(linkError.message);
        linkRows = inserted ?? [];
      }

      return toTask(data, linkRows);
    },

    async updateTask(id: string, patch: UpdateTaskPayload) {
      const supabase = await createClient();

      // Read first so the status/completed_at pair stays consistent, and so a
      // missing row is a clean 404 rather than a silent no-op.
      const { data: existing, error: readError } = await supabase
        .from("tasks")
        .select("id, status, completed_at")
        .eq("id", id)
        .maybeSingle<Pick<TaskRow, "id" | "status" | "completed_at">>();

      if (readError) throw new Error(readError.message);
      if (!existing) throw new TaskNotFoundError(id);

      const completedAt = completedAtFor(
        patch.status,
        existing.completed_at,
        new Date(),
      );

      const update: Database["public"]["Tables"]["tasks"]["Update"] = {};
      if (patch.title !== undefined) update.title = patch.title;
      if (patch.notes !== undefined) update.notes = patch.notes;
      if (patch.priority !== undefined) update.priority = patch.priority;
      if (patch.dueAt !== undefined) update.due_at = patch.dueAt;
      if (patch.categoryId !== undefined) update.category_id = patch.categoryId;
      if (patch.status !== undefined) update.status = patch.status;
      if (patch.pinned !== undefined) update.pinned = patch.pinned;
      if (patch.sourceLink !== undefined) update.source_link = patch.sourceLink;
      if (patch.owner !== undefined) update.owner = patch.owner;
      // The only write path to the manual override. The trigger stamps
      // `manual_rank_set_at`, so nothing here has to remember to.
      if (patch.manualRank !== undefined) update.manual_rank = patch.manualRank;
      if (completedAt !== undefined) update.completed_at = completedAt;

      const { data, error } = await supabase
        .from("tasks")
        .update(update)
        .eq("id", id)
        .select(TASK_COLUMNS)
        .single<TaskRow>();

      if (error) throw new Error(error.message);

      const { data: linkRows, error: linkError } = await supabase
        .from("task_links")
        .select(LINK_COLUMNS)
        .eq("task_id", id)
        .returns<TaskLinkRow[]>();

      if (linkError) throw new Error(linkError.message);
      return toTask(data, linkRows ?? []);
    },

    async deleteTask(id: string) {
      const supabase = await createClient();
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}

/**
 * The task a replayed capture already created.
 *
 * Looked up rather than returned by the failed insert, because Postgres tells
 * you a constraint was violated, not which row won. Returns null if it has
 * since been deleted — in which case the original error is the honest answer.
 */
async function findByClientKey(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientKey: string,
): Promise<Task | null> {
  const { data } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("client_key", clientKey)
    .maybeSingle<TaskRow>();

  if (!data) return null;

  const { data: linkRows } = await supabase
    .from("task_links")
    .select(LINK_COLUMNS)
    .eq("task_id", data.id)
    .returns<TaskLinkRow[]>();

  return toTask(data, linkRows ?? []);
}
