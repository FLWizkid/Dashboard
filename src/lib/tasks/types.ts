/**
 * Domain types for the task module.
 *
 * These are the shapes the UI and the API speak. They are deliberately
 * separate from `src/lib/supabase/database.types.ts` (the row shapes) so a
 * schema change doesn't ripple straight into every component, and so the
 * in-memory repository used by E2E can satisfy the same contract.
 */

export const TASK_PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Kanban lanes, in board order. Phase 3 renders the board itself. */
export const TASK_STATUSES = [
  "inbox",
  "ready",
  "in_progress",
  "waiting",
  "done",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_LINK_KINDS = ["message", "event", "note", "kanban"] as const;
export type TaskLinkKind = (typeof TASK_LINK_KINDS)[number];

export const TASK_LINK_RELATIONS = [
  "source",
  "prep",
  "follow_up",
  "related",
] as const;
export type TaskLinkRelation = (typeof TASK_LINK_RELATIONS)[number];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: "Inbox",
  ready: "Ready",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
};

export const LINK_RELATION_LABELS: Record<TaskLinkRelation, string> = {
  source: "Source",
  prep: "Prep for",
  follow_up: "Follow-up to",
  related: "Related to",
};

export interface TaskLink {
  id: string;
  taskId: string;
  kind: TaskLinkKind;
  relation: TaskLinkRelation;
  /** Provider record id. `null` while the link is still unresolved. */
  targetId: string | null;
  targetLabel: string;
  targetUrl: string | null;
  /** `null` means suggested-but-unconfirmed. Never set this automatically. */
  confirmedAt: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  /** `null` = untriaged, which is what keeps the task out of Ready state. */
  priority: TaskPriority | null;
  dueAt: string | null;
  categoryId: string | null;
  status: TaskStatus;
  pinned: boolean;
  sourceLink: string | null;
  owner: string | null;
  /** Server-computed: title + priority + due date are all present. */
  isReady: boolean;
  /**
   * A follow-up captured in a note, not yet committed to.
   *
   * Drafts stay off the board, out of the dashboard and out of every count
   * until they are activated — which needs owner, due date and priority. See
   * `tasks/draft.ts`.
   */
  isDraft: boolean;
  /** Server-computed: the three fields activation requires are all present. */
  canActivate: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  links: TaskLink[];
}

export interface ActivityCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  color: string;
  position: number;
  isDefault: boolean;
  isArchived: boolean;
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return (
    typeof value === "string" &&
    (TASK_PRIORITIES as readonly string[]).includes(value)
  );
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === "string" &&
    (TASK_STATUSES as readonly string[]).includes(value)
  );
}
