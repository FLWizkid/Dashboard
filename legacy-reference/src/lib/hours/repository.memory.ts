import { randomUUID } from "node:crypto";

import {
  classifyEvent,
  type ClassifiableCalendar,
  type ClassifiableEvent,
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

/**
 * In-process hours repository, used by end-to-end tests.
 *
 * Not a mock. It enforces the same invariants the database does — one running
 * session, client-key idempotency, the manual-override guard, the refusal to
 * store scheduled time — because an E2E run that passes against a permissive
 * fake tells you nothing about the deployment. Unreachable in production; see
 * `src/lib/data-mode.ts`.
 */

interface MemoryHoursStore {
  sessions: PomodoroSession[];
  entries: TimeEntry[];
  rules: WorkCategoryRule[];
  /**
   * Stand-in calendar. Phase 2's sync fills the real table; until the mail and
   * calendar interface lands, E2E seeds this directly through the reset route
   * so the scheduled column of the hours view is exercised for real.
   */
  events: MemoryEvent[];
  calendars: MemoryCalendar[];
}

export interface MemoryCalendar {
  id: string;
  name: string;
  countsTowardHours: boolean;
  defaultCategoryId: string | null;
}

export interface MemoryEvent {
  id: string;
  calendarId: string;
  title: string;
  location: string | null;
  organizerAddress: string | null;
  attendeeAddresses: string[];
  attendeeCount: number;
  isExternal: boolean;
  isCancelled: boolean;
  startsAt: string;
  endsAt: string;
  categoryId: string | null;
  categorySource: ClassifiableEvent["categorySource"];
  categoryReason: string | null;
  hoursInclude: boolean | null;
}

const STORE_KEY = Symbol.for("dashboard.memoryHoursStore");

function getStore(): MemoryHoursStore {
  const globalStore = globalThis as typeof globalThis & {
    [STORE_KEY]?: MemoryHoursStore;
  };

  globalStore[STORE_KEY] ??= {
    sessions: [],
    entries: [],
    rules: [],
    events: [],
    calendars: [
      {
        id: "00000000-0000-4000-a000-000000000001",
        name: "Work",
        countsTowardHours: true,
        defaultCategoryId: null,
      },
    ],
  };

  return globalStore[STORE_KEY];
}

/** Test-only reset hook, exposed through the E2E route handler. */
export function resetMemoryHoursStore(): void {
  const store = getStore();
  store.sessions = [];
  store.entries = [];
  store.rules = [];
  store.events = [];
}

/**
 * Seeds the stored halves of the hours module.
 *
 * Scheduled time is derived from events and never stored, so it is absent
 * here on purpose — `seedMemoryEvents` is how that column gets its data.
 */
export function seedMemoryHours(input: {
  sessions?: PomodoroSession[];
  entries?: TimeEntry[];
  rules?: WorkCategoryRule[];
}): void {
  const store = getStore();
  if (input.sessions) store.sessions = [...input.sessions];
  if (input.entries) store.entries = [...input.entries];
  if (input.rules) store.rules = [...input.rules];
}

/** Test-only seeding hook for the derived scheduled column. */
export function seedMemoryEvents(events: MemoryEvent[]): void {
  getStore().events = events;
}

function overlaps(
  startedAt: string,
  endedAt: string,
  from: Date,
  to: Date,
): boolean {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return end > from.getTime() && start < to.getTime();
}

export const memoryHoursRepository: HoursRepository = {
  async getRunningSession() {
    return getStore().sessions.find((s) => s.endedAt === null) ?? null;
  },

  async listSessions({ from, to }) {
    return getStore()
      .sessions.filter((s) =>
        overlaps(s.startedAt, s.endedAt ?? new Date().toISOString(), from, to),
      )
      .slice()
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  },

  async startSession(input: StartSessionPayload) {
    const store = getStore();

    // The partial unique index in Postgres says the same thing. Enforcing it
    // here too means the E2E suite would catch a UI that lets you start two.
    const running = store.sessions.find((s) => s.endedAt === null);
    if (running) throw new SessionAlreadyRunningError(running);

    const now = new Date().toISOString();
    const session: PomodoroSession = {
      id: randomUUID(),
      kind: input.kind,
      taskId: input.taskId,
      categoryId: input.categoryId ?? null,
      plannedMinutes: input.plannedMinutes,
      startedAt: input.startedAt ?? now,
      endedAt: null,
      completed: false,
      seconds: null,
      note: null,
      createdAt: now,
      updatedAt: now,
    };

    store.sessions.push(session);
    return session;
  },

  async endSession(id: string, input: EndSessionPayload) {
    const store = getStore();
    const index = store.sessions.findIndex((s) => s.id === id);
    if (index === -1) throw new HoursRecordNotFoundError("Session", id);

    const existing = store.sessions[index];
    const endedAt =
      Date.parse(input.endedAt) < Date.parse(existing.startedAt)
        ? existing.startedAt
        : input.endedAt;

    const session: PomodoroSession = {
      ...existing,
      endedAt,
      completed: input.completed,
      note: input.note,
      seconds: Math.max(
        0,
        Math.round(
          (Date.parse(endedAt) - Date.parse(existing.startedAt)) / 1000,
        ),
      ),
      updatedAt: new Date().toISOString(),
    };

    store.sessions[index] = session;

    if (!input.logHours || (session.seconds ?? 0) <= 0) {
      return { session, entry: null };
    }

    // A focused entry is not a new decision, it is the session written down —
    // so it reuses the session's own instants rather than re-deriving them.
    const entry = writeEntry(store, {
      source: "focused",
      taskId: session.taskId,
      // Inherited from the session. Chosen once, when starting, rather than
      // asked for again at the end when the answer is already fading.
      categoryId: session.categoryId,
      sessionId: session.id,
      startedAt: session.startedAt,
      endedAt,
      note: input.note,
      clientKey: input.clientKey ?? null,
    });

    return { session, entry };
  },

  async listTimeEntries({ from, to }) {
    return getStore()
      .entries.filter((entry) =>
        overlaps(entry.startedAt, entry.endedAt, from, to),
      )
      .slice()
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  },

  async createTimeEntry(input: CreateTimeEntryPayload) {
    return writeEntry(getStore(), {
      source: "manual",
      taskId: input.taskId,
      categoryId: input.categoryId,
      sessionId: null,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      note: input.note,
      clientKey: input.clientKey ?? null,
    });
  },

  async updateTimeEntry(id: string, patch: UpdateTimeEntryPayload) {
    const store = getStore();
    const index = store.entries.findIndex((entry) => entry.id === id);
    if (index === -1) throw new HoursRecordNotFoundError("Time entry", id);

    const existing = store.entries[index];
    const startedAt = patch.startedAt ?? existing.startedAt;
    const endedAt = patch.endedAt ?? existing.endedAt;

    const updated: TimeEntry = {
      ...existing,
      ...(patch.taskId !== undefined ? { taskId: patch.taskId } : {}),
      ...(patch.categoryId !== undefined
        ? { categoryId: patch.categoryId }
        : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      startedAt,
      endedAt,
      minutes: minutesBetween(startedAt, endedAt),
      updatedAt: new Date().toISOString(),
    };

    store.entries[index] = updated;
    return updated;
  },

  async deleteTimeEntry(id: string) {
    const store = getStore();
    store.entries = store.entries.filter((entry) => entry.id !== id);
  },

  async listScheduledBlocks({ from, to }) {
    const store = getStore();
    const rules = await memoryHoursRepository.listRules();

    return store.events
      .filter((event) => overlaps(event.startsAt, event.endsAt, from, to))
      .map((event) => {
        const calendar = store.calendars.find((c) => c.id === event.calendarId);
        return toBlock(event, calendar, rules);
      })
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  },

  async overrideEvent(eventId: string, patch: OverrideEventPayload) {
    const store = getStore();
    const index = store.events.findIndex((event) => event.id === eventId);
    if (index === -1) throw new HoursRecordNotFoundError("Event", eventId);

    const existing = store.events[index];

    const updated: MemoryEvent = {
      ...existing,
      ...(patch.hoursInclude !== undefined
        ? { hoursInclude: patch.hoursInclude }
        : {}),
      ...(patch.categoryId !== undefined
        ? {
            categoryId: patch.categoryId,
            // Setting a category by hand is what makes it manual, and the
            // database trigger will not let an automatic rule take it back.
            categorySource: patch.categoryId
              ? ("manual" as const)
              : ("unclassified" as const),
            categoryReason: patch.categoryId
              ? "You set this category yourself."
              : null,
          }
        : {}),
    };

    store.events[index] = updated;

    const calendar = store.calendars.find((c) => c.id === updated.calendarId);
    return toBlock(updated, calendar, await memoryHoursRepository.listRules());
  },

  async listRules() {
    return getStore()
      .rules.slice()
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  },

  async createRule(input: CreateRulePayload) {
    const store = getStore();
    const now = new Date().toISOString();

    const rule: WorkCategoryRule = {
      id: randomUUID(),
      pattern: input.pattern,
      field: input.field,
      categoryId: input.categoryId,
      countsTowardHours: input.countsTowardHours,
      position: input.position ?? store.rules.length,
      isEnabled: input.isEnabled,
      createdAt: now,
      updatedAt: now,
    };

    store.rules.push(rule);
    return rule;
  },

  async updateRule(id: string, patch: UpdateRulePayload) {
    const store = getStore();
    const index = store.rules.findIndex((rule) => rule.id === id);
    if (index === -1) throw new HoursRecordNotFoundError("Rule", id);

    const updated: WorkCategoryRule = {
      ...store.rules[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    store.rules[index] = updated;
    return updated;
  },

  async deleteRule(id: string) {
    const store = getStore();
    store.rules = store.rules.filter((rule) => rule.id !== id);
  },
};

/* ── Helpers ──────────────────────────────────────────────────────────── */

function minutesBetween(startedAt: string, endedAt: string): number {
  return Math.max(
    0,
    Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000),
  );
}

/**
 * The one place an entry is appended, so the client-key rule holds for both
 * the manual form and the Pomodoro path.
 */
function writeEntry(
  store: MemoryHoursStore,
  input: Omit<TimeEntry, "id" | "minutes" | "createdAt" | "updatedAt">,
): TimeEntry {
  if (input.clientKey) {
    const existing = store.entries.find(
      (entry) => entry.clientKey === input.clientKey,
    );
    // Not an error the caller should surface: the hour is already recorded,
    // which is exactly what the retry was trying to achieve.
    if (existing) throw new DuplicateClientKeyError(existing);
  }

  const now = new Date().toISOString();
  const entry: TimeEntry = {
    ...input,
    id: randomUUID(),
    minutes: minutesBetween(input.startedAt, input.endedAt),
    createdAt: now,
    updatedAt: now,
  };

  store.entries.push(entry);
  return entry;
}

function toBlock(
  event: MemoryEvent,
  calendar: MemoryCalendar | undefined,
  rules: WorkCategoryRule[],
): ScheduledBlock {
  const resolved: ClassifiableCalendar = calendar ?? {
    id: event.calendarId,
    name: "Unknown calendar",
    countsTowardHours: false,
    defaultCategoryId: null,
  };

  const classification = classifyEvent({
    event: {
      id: event.id,
      title: event.title,
      location: event.location,
      organizerAddress: event.organizerAddress,
      attendeeAddresses: event.attendeeAddresses,
      attendeeCount: event.attendeeCount,
      isExternal: event.isExternal,
      isCancelled: event.isCancelled,
      categoryId: event.categoryId,
      categorySource: event.categorySource,
      hoursInclude: event.hoursInclude,
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
    eventId: event.id,
    calendarId: event.calendarId,
    calendarName: resolved.name,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    categoryId: classification.categoryId,
    categorySource: classification.source,
    categoryReason: classification.reason,
    hoursInclude: event.hoursInclude,
    countsTowardHours: classification.countsTowardHours,
    isCancelled: event.isCancelled,
  };
}
