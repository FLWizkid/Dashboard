import { createClient } from "@/lib/supabase/server";

import {
  classifyEvent,
  type ClassifiableCalendar,
  type ClassificationSource,
  type RuleField,
} from "./classify";
import {
  DuplicateClientKeyError,
  HoursRecordNotFoundError,
  SessionAlreadyRunningError,
  type HoursRepository,
} from "./repository";
import type {
  CreateRulePayload,
  CreateTimeEntryPayload,
  EndSessionPayload,
  OverrideEventPayload,
  StartSessionPayload,
  UpdateRulePayload,
  UpdateTimeEntryPayload,
} from "./schema";
import type {
  PomodoroSession,
  ScheduledBlock,
  TimeEntry,
  WorkCategoryRule,
} from "./types";
import type { PomodoroKind } from "./pomodoro";

/**
 * Supabase-backed hours repository.
 *
 * Access control is Row Level Security, exactly as in the task module: every
 * statement runs as the signed-in user through the request cookie, and
 * `user_id` is never sent because the column defaults to `auth.uid()`.
 *
 * Row shapes are declared locally rather than pulled from
 * `database.types.ts`, which is generated from the Phase 1 schema only. The
 * queries below name their columns explicitly, so a schema drift shows up as
 * a failing integration test rather than as a silent `undefined`.
 */

interface SessionRow {
  id: string;
  kind: PomodoroKind;
  task_id: string | null;
  category_id: string | null;
  planned_minutes: number;
  started_at: string;
  ended_at: string | null;
  completed: boolean;
  seconds: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface EntryRow {
  id: string;
  source: "focused" | "manual";
  task_id: string | null;
  category_id: string | null;
  session_id: string | null;
  started_at: string;
  ended_at: string;
  minutes: number;
  note: string | null;
  client_key: string | null;
  created_at: string;
  updated_at: string;
}

interface RuleRow {
  id: string;
  pattern: string;
  field: RuleField;
  category_id: string | null;
  counts_toward_hours: boolean;
  position: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  calendar_id: string;
  title: string | null;
  location: string | null;
  organizer_address: string | null;
  attendee_addresses: string[] | null;
  starts_at: string;
  ends_at: string;
  is_cancelled: boolean;
  category_id: string | null;
  category_source: ClassificationSource;
  category_reason: string | null;
  hours_include: boolean | null;
}

interface CalendarRow {
  id: string;
  name: string;
  counts_toward_hours: boolean;
  default_category_id: string | null;
}

const SESSION_COLUMNS =
  "id, kind, task_id, category_id, planned_minutes, started_at, ended_at, completed, seconds, note, created_at, updated_at";

const ENTRY_COLUMNS =
  "id, source, task_id, category_id, session_id, started_at, ended_at, minutes, note, client_key, created_at, updated_at";

const RULE_COLUMNS =
  "id, pattern, field, category_id, counts_toward_hours, position, is_enabled, created_at, updated_at";

const EVENT_COLUMNS =
  "id, calendar_id, title, location, organizer_address, attendee_addresses, starts_at, ends_at, is_cancelled, category_id, category_source, category_reason, hours_include";

const CALENDAR_COLUMNS = "id, name, counts_toward_hours, default_category_id";

/** Postgres unique-violation. Here it always means the client key was reused. */
const UNIQUE_VIOLATION = "23505";

function toSession(row: SessionRow): PomodoroSession {
  return {
    id: row.id,
    kind: row.kind,
    taskId: row.task_id,
    categoryId: row.category_id,
    plannedMinutes: row.planned_minutes,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    completed: row.completed,
    seconds: row.seconds,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEntry(row: EntryRow): TimeEntry {
  return {
    id: row.id,
    source: row.source,
    taskId: row.task_id,
    categoryId: row.category_id,
    sessionId: row.session_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    minutes: row.minutes,
    note: row.note,
    clientKey: row.client_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRule(row: RuleRow): WorkCategoryRule {
  return {
    id: row.id,
    pattern: row.pattern,
    field: row.field,
    categoryId: row.category_id,
    countsTowardHours: row.counts_toward_hours,
    position: row.position,
    isEnabled: row.is_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSupabaseHoursRepository(): HoursRepository {
  return {
    /* ── Pomodoro ─────────────────────────────────────────────────────── */

    async getRunningSession() {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("pomodoro_sessions")
        .select(SESSION_COLUMNS)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .returns<SessionRow[]>();

      if (error) throw new Error(error.message);
      return data?.[0] ? toSession(data[0]) : null;
    },

    async listSessions({ from, to }) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("pomodoro_sessions")
        .select(SESSION_COLUMNS)
        .gte("started_at", from.toISOString())
        .lt("started_at", to.toISOString())
        .order("started_at", { ascending: false })
        .returns<SessionRow[]>();

      if (error) throw new Error(error.message);
      return (data ?? []).map(toSession);
    },

    async startSession(input: StartSessionPayload) {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from("pomodoro_sessions")
        .insert({
          kind: input.kind,
          task_id: input.taskId,
          category_id: input.categoryId ?? null,
          planned_minutes: input.plannedMinutes,
          ...(input.startedAt ? { started_at: input.startedAt } : {}),
        })
        .select(SESSION_COLUMNS)
        .single<SessionRow>();

      if (error) {
        // The partial unique index caught a second running session. Read the
        // existing one back so the UI can adopt it rather than showing an
        // error for a timer the owner can see running in another tab.
        if (error.code === UNIQUE_VIOLATION) {
          const running = await this.getRunningSession();
          if (running) throw new SessionAlreadyRunningError(running);
        }
        throw new Error(error.message);
      }

      return toSession(data);
    },

    async endSession(id: string, input: EndSessionPayload) {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from("pomodoro_sessions")
        .update({
          ended_at: input.endedAt,
          completed: input.completed,
          note: input.note,
        })
        .eq("id", id)
        .select(SESSION_COLUMNS)
        .maybeSingle<SessionRow>();

      if (error) throw new Error(error.message);
      if (!data) throw new HoursRecordNotFoundError("Session", id);

      const session = toSession(data);

      if (!input.logHours || (session.seconds ?? 0) <= 0) {
        return { session, entry: null };
      }

      // The focused entry mirrors the session's own instants. Deriving them
      // again from a duration would let the two disagree by a second, and the
      // ledger is meant to be the session written down, not a second opinion.
      const entry = await insertEntry(
        {
          source: "focused",
          task_id: session.taskId,
          // Inherited from the session: chosen once when starting, rather
          // than asked for again at the end when the answer has faded.
          category_id: session.categoryId,
          session_id: session.id,
          started_at: session.startedAt,
          ended_at: session.endedAt ?? input.endedAt,
          note: input.note,
          client_key: input.clientKey ?? null,
        },
        input.clientKey ?? null,
      );

      return { session, entry };
    },

    /* ── The ledger ───────────────────────────────────────────────────── */

    async listTimeEntries({ from, to }) {
      const supabase = await createClient();
      // Overlap, not containment: a session that started before the window
      // and ended inside it is part of the window, and `clipToWindow` trims
      // it to the right number of minutes.
      const { data, error } = await supabase
        .from("time_entries")
        .select(ENTRY_COLUMNS)
        .lt("started_at", to.toISOString())
        .gt("ended_at", from.toISOString())
        .order("started_at", { ascending: true })
        .returns<EntryRow[]>();

      if (error) throw new Error(error.message);
      return (data ?? []).map(toEntry);
    },

    async createTimeEntry(input: CreateTimeEntryPayload) {
      return insertEntry(
        {
          source: "manual",
          task_id: input.taskId,
          category_id: input.categoryId,
          session_id: null,
          started_at: input.startedAt,
          ended_at: input.endedAt,
          note: input.note,
          client_key: input.clientKey ?? null,
        },
        input.clientKey ?? null,
      );
    },

    async updateTimeEntry(id: string, patch: UpdateTimeEntryPayload) {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from("time_entries")
        .update({
          ...(patch.taskId !== undefined ? { task_id: patch.taskId } : {}),
          ...(patch.categoryId !== undefined
            ? { category_id: patch.categoryId }
            : {}),
          ...(patch.startedAt !== undefined
            ? { started_at: patch.startedAt }
            : {}),
          ...(patch.endedAt !== undefined ? { ended_at: patch.endedAt } : {}),
          ...(patch.note !== undefined ? { note: patch.note } : {}),
        })
        .eq("id", id)
        .select(ENTRY_COLUMNS)
        .maybeSingle<EntryRow>();

      if (error) throw new Error(error.message);
      if (!data) throw new HoursRecordNotFoundError("Time entry", id);
      return toEntry(data);
    },

    async deleteTimeEntry(id: string) {
      const supabase = await createClient();
      const { error } = await supabase
        .from("time_entries")
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
    },

    /* ── Derived scheduled time ───────────────────────────────────────── */

    async listScheduledBlocks({ from, to }) {
      const supabase = await createClient();

      const [events, calendars, rules] = await Promise.all([
        supabase
          .from("calendar_events")
          .select(EVENT_COLUMNS)
          .lt("starts_at", to.toISOString())
          .gt("ends_at", from.toISOString())
          .order("starts_at", { ascending: true })
          .returns<EventRow[]>(),
        supabase
          .from("calendars")
          .select(CALENDAR_COLUMNS)
          .returns<CalendarRow[]>(),
        this.listRules(),
      ]);

      if (events.error) throw new Error(events.error.message);
      if (calendars.error) throw new Error(calendars.error.message);

      const byId = new Map(
        (calendars.data ?? []).map((row) => [row.id, row] as const),
      );

      return (events.data ?? []).map((row) =>
        toBlock(row, byId.get(row.calendar_id), rules),
      );
    },

    async overrideEvent(eventId: string, patch: OverrideEventPayload) {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from("calendar_events")
        .update({
          ...(patch.hoursInclude !== undefined
            ? { hours_include: patch.hoursInclude }
            : {}),
          ...(patch.categoryId !== undefined
            ? {
                category_id: patch.categoryId,
                // Choosing a category by hand is what marks the event manual.
                // From here the trigger refuses to let a rule take it back.
                category_source: patch.categoryId ? "manual" : "unclassified",
                category_reason: patch.categoryId
                  ? "You set this category yourself."
                  : null,
              }
            : {}),
        })
        .eq("id", eventId)
        .select(EVENT_COLUMNS)
        .maybeSingle<EventRow>();

      if (error) throw new Error(error.message);
      if (!data) throw new HoursRecordNotFoundError("Event", eventId);

      const { data: calendar } = await supabase
        .from("calendars")
        .select(CALENDAR_COLUMNS)
        .eq("id", data.calendar_id)
        .maybeSingle<CalendarRow>();

      return toBlock(data, calendar ?? undefined, await this.listRules());
    },

    /* ── Rules ────────────────────────────────────────────────────────── */

    async listRules() {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("work_category_rules")
        .select(RULE_COLUMNS)
        .order("position", { ascending: true })
        .returns<RuleRow[]>();

      if (error) throw new Error(error.message);
      return (data ?? []).map(toRule);
    },

    async createRule(input: CreateRulePayload) {
      const supabase = await createClient();

      // Append by default. A new rule silently jumping ahead of an existing
      // one would change what already-classified meetings resolve to.
      let position = input.position;
      if (position === undefined) {
        const existing = await this.listRules();
        position = existing.reduce(
          (highest, rule) => Math.max(highest, rule.position + 1),
          0,
        );
      }

      const { data, error } = await supabase
        .from("work_category_rules")
        .insert({
          pattern: input.pattern,
          field: input.field,
          category_id: input.categoryId,
          counts_toward_hours: input.countsTowardHours,
          position,
          is_enabled: input.isEnabled,
        })
        .select(RULE_COLUMNS)
        .single<RuleRow>();

      if (error) throw new Error(error.message);
      return toRule(data);
    },

    async updateRule(id: string, patch: UpdateRulePayload) {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from("work_category_rules")
        .update({
          ...(patch.pattern !== undefined ? { pattern: patch.pattern } : {}),
          ...(patch.field !== undefined ? { field: patch.field } : {}),
          ...(patch.categoryId !== undefined
            ? { category_id: patch.categoryId }
            : {}),
          ...(patch.countsTowardHours !== undefined
            ? { counts_toward_hours: patch.countsTowardHours }
            : {}),
          ...(patch.position !== undefined ? { position: patch.position } : {}),
          ...(patch.isEnabled !== undefined
            ? { is_enabled: patch.isEnabled }
            : {}),
        })
        .eq("id", id)
        .select(RULE_COLUMNS)
        .maybeSingle<RuleRow>();

      if (error) throw new Error(error.message);
      if (!data) throw new HoursRecordNotFoundError("Rule", id);
      return toRule(data);
    },

    async deleteRule(id: string) {
      const supabase = await createClient();
      const { error } = await supabase
        .from("work_category_rules")
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

/**
 * The single insert path for the ledger, so the client-key rule holds for both
 * the Pomodoro path and the manual form.
 *
 * A unique violation on `client_key` is not an error: it means this hour is
 * already recorded, which is what the retry wanted. The existing row is read
 * back and handed to the caller as a success.
 */
async function insertEntry(
  row: Omit<EntryRow, "id" | "minutes" | "created_at" | "updated_at">,
  clientKey: string | null,
): Promise<TimeEntry> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("time_entries")
    .insert(row)
    .select(ENTRY_COLUMNS)
    .single<EntryRow>();

  if (!error) return toEntry(data);

  if (error.code === UNIQUE_VIOLATION && clientKey) {
    const { data: existing } = await supabase
      .from("time_entries")
      .select(ENTRY_COLUMNS)
      .eq("client_key", clientKey)
      .maybeSingle<EntryRow>();

    if (existing) throw new DuplicateClientKeyError(toEntry(existing));
  }

  throw new Error(error.message);
}

function toBlock(
  row: EventRow,
  calendar: CalendarRow | undefined,
  rules: WorkCategoryRule[],
): ScheduledBlock {
  const resolved: ClassifiableCalendar = calendar
    ? {
        id: calendar.id,
        name: calendar.name,
        countsTowardHours: calendar.counts_toward_hours,
        defaultCategoryId: calendar.default_category_id,
      }
    : {
        // An event whose calendar we can't read is not counted. Guessing here
        // would put unattributable time into the total.
        id: row.calendar_id,
        name: "Unknown calendar",
        countsTowardHours: false,
        defaultCategoryId: null,
      };

  const addresses = row.attendee_addresses ?? [];

  const classification = classifyEvent({
    event: {
      id: row.id,
      title: row.title ?? "",
      location: row.location,
      organizerAddress: row.organizer_address,
      attendeeAddresses: addresses,
      attendeeCount: addresses.length,
      // Phase 2's sync computes this properly against the owner's domains;
      // until the calendar interface lands there is nothing to compare to,
      // and inventing an answer would classify meetings on a guess.
      isExternal: false,
      isCancelled: row.is_cancelled,
      categoryId: row.category_id,
      categorySource: row.category_source,
      hoursInclude: row.hours_include,
    },
    calendar: resolved,
    rules: rules.map((rule) => ({
      id: rule.id,
      pattern: rule.pattern,
      field: rule.field,
      categoryId: rule.categoryId,
      countsTowardHours: rule.countsTowardHours,
      position: rule.position,
      isEnabled: rule.isEnabled,
    })),
  });

  return {
    eventId: row.id,
    calendarId: row.calendar_id,
    calendarName: resolved.name,
    title: row.title ?? "Untitled",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    categoryId: classification.categoryId,
    categorySource: classification.source,
    // The stored reason is what the last sync concluded; the freshly computed
    // one reflects the rules as they are now, which is what the owner is
    // looking at while editing them.
    categoryReason: classification.reason || row.category_reason,
    hoursInclude: row.hours_include,
    countsTowardHours: classification.countsTowardHours,
    isCancelled: row.is_cancelled,
  };
}
