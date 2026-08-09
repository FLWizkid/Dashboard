// Hand-written to match supabase/migrations. Because the database is
// self-hosted and unreachable from CI/this environment, these types are
// maintained by hand instead of generated via `supabase gen types`. Keep them
// in sync with the migration SQL.

import type {
  TaskLinkKind,
  TaskLinkRelation,
  TaskPriority,
  TaskStatus,
} from "@/lib/tasks/types";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// The Postgres enums are declared once, in the domain layer, and re-exported
// here so a row type and the value the UI holds can never disagree.
type TaskPriorityEnum = TaskPriority;
type TaskStatusEnum = TaskStatus;
type TaskLinkKindEnum = TaskLinkKind;
type TaskLinkRelationEnum = TaskLinkRelation;

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      activity_categories: {
        Row: {
          id: string;
          user_id: string;
          slug: string;
          name: string;
          description: string | null;
          color: string;
          position: number;
          is_default: boolean;
          is_archived: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          slug: string;
          name: string;
          description?: string | null;
          color?: string;
          position?: number;
          is_default?: boolean;
          is_archived?: boolean;
        };
        Update: {
          slug?: string;
          name?: string;
          description?: string | null;
          color?: string;
          position?: number;
          is_archived?: boolean;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          notes: string | null;
          priority: TaskPriorityEnum | null;
          due_at: string | null;
          category_id: string | null;
          status: TaskStatusEnum;
          pinned: boolean;
          source_link: string | null;
          owner: string | null;
          /** Generated column — never written by the client. */
          is_ready: boolean;
          is_draft: boolean;
          can_activate: boolean;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          title: string;
          notes?: string | null;
          priority?: TaskPriorityEnum | null;
          due_at?: string | null;
          category_id?: string | null;
          status?: TaskStatusEnum;
          pinned?: boolean;
          source_link?: string | null;
          owner?: string | null;
          completed_at?: string | null;
        };
        Update: {
          title?: string;
          notes?: string | null;
          priority?: TaskPriorityEnum | null;
          due_at?: string | null;
          category_id?: string | null;
          status?: TaskStatusEnum;
          pinned?: boolean;
          source_link?: string | null;
          owner?: string | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      task_links: {
        Row: {
          id: string;
          user_id: string;
          task_id: string;
          kind: TaskLinkKindEnum;
          relation: TaskLinkRelationEnum;
          target_id: string | null;
          target_label: string;
          target_url: string | null;
          confirmed_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          task_id: string;
          kind: TaskLinkKindEnum;
          relation?: TaskLinkRelationEnum;
          target_id?: string | null;
          target_label: string;
          target_url?: string | null;
          confirmed_at?: string | null;
          metadata?: Json;
        };
        Update: {
          relation?: TaskLinkRelationEnum;
          target_id?: string | null;
          target_label?: string;
          target_url?: string | null;
          confirmed_at?: string | null;
          metadata?: Json;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      task_priority: TaskPriorityEnum;
      task_status: TaskStatusEnum;
      task_link_kind: TaskLinkKindEnum;
      task_link_relation: TaskLinkRelationEnum;
    };
    CompositeTypes: { [_ in never]: never };
  };
}
