import type { Task } from "@/lib/tasks/types";
import type { Note } from "@/lib/notes/types";
import type {
  PomodoroSession,
  TimeEntry,
  WorkCategoryRule,
} from "@/lib/hours/types";
import type { MemoryEvent } from "@/lib/hours/repository.memory";
import type { InboxMessage } from "@/lib/reports/repository";

import { DEMO_IDS, PEOPLE, at, minutesAgo, weekClock } from "./week";

/**
 * Building and applying the demo week.
 *
 * Everything here is written out rather than generated. The point is not
 * volume — it is that each row exists to make one behaviour visible, and the
 * rows reference each other the way real ones would: the task that prepares
 * for Thursday's board meeting is linked to that meeting, carries the note
 * that came out of it, and shows up in the same rollup the report prints.
 *
 * Applied only in memory mode, and only when asked for. See `apply()`.
 */

const CAT = DEMO_IDS.categories;

/* ── Tasks ────────────────────────────────────────────────────────────── */

/**
 * Twenty tasks covering every state the product can hold.
 *
 * Deliberately includes the awkward ones: work that is genuinely late, a
 * draft with no owner, a task forced to the top by hand, one completed days
 * ago, and one with no category at all — because "unfiled" is a real state
 * and a demo where every row is tidy proves nothing about the untidy ones.
 */
function tasks(clock: ReturnType<typeof weekClock>): Task[] {
  const stamp = (dayOffset: number, hour = 9) => at(clock, dayOffset, hour);

  const row = (
    id: string,
    patch: Partial<Task> & Pick<Task, "title">,
  ): Task => ({
    id,
    notes: null,
    priority: null,
    dueAt: null,
    categoryId: null,
    status: "inbox",
    pinned: false,
    sourceLink: null,
    owner: null,
    isReady: false,
    isDraft: false,
    canActivate: false,
    manualRank: null,
    manualRankSetAt: null,
    completedAt: null,
    createdAt: stamp(-7),
    updatedAt: stamp(-1),
    links: [],
    ...patch,
    title: patch.title,
  });

  const ready = (task: Task): Task => ({
    ...task,
    isReady:
      task.title.trim().length > 0 &&
      task.priority !== null &&
      task.dueAt !== null,
    canActivate: Boolean(task.owner && task.dueAt && task.priority),
  });

  return [
    // ── Overdue, which is what the dashboard is for ────────────────────
    ready(
      row("d0000000-0000-4000-b000-000000000001", {
        title: "Sign the Acme Cloud renewal before the price rise",
        notes:
          "Ravi has held the 2025 rate until month end. Legal reviewed; only the signature is outstanding.",
        priority: "critical",
        dueAt: stamp(-2, 17),
        categoryId: CAT.vendor,
        status: "in_progress",
        owner: PEOPLE.self.name,
        pinned: true,
        sourceLink: "https://acme-cloud.example/quotes/AC-2026-118",
        links: [
          {
            id: "l0000000-0000-4000-b000-000000000001",
            taskId: "d0000000-0000-4000-b000-000000000001",
            kind: "message",
            relation: "source",
            targetId: "m0000000-0000-4000-c000-000000000004",
            targetLabel: "Renewal paperwork — signature needed",
            targetUrl: null,
            confirmedAt: stamp(-4),
            createdAt: stamp(-4),
          },
        ],
      }),
    ),
    ready(
      row("d0000000-0000-4000-b000-000000000002", {
        title: "Close out the Okta access review",
        notes: "Two service accounts still unattested.",
        priority: "high",
        dueAt: stamp(-1, 12),
        categoryId: CAT.security,
        status: "waiting",
        owner: PEOPLE.sam.name,
      }),
    ),

    // ── Due today ──────────────────────────────────────────────────────
    ready(
      row("d0000000-0000-4000-b000-000000000003", {
        title: "Board pack: finish the platform-spend slide",
        notes: "Priya wants the three-year view, not just next year.",
        priority: "critical",
        dueAt: stamp(0, 16),
        categoryId: CAT.stakeholder,
        status: "in_progress",
        owner: PEOPLE.self.name,
        links: [
          {
            id: "l0000000-0000-4000-b000-000000000002",
            taskId: "d0000000-0000-4000-b000-000000000003",
            kind: "event",
            relation: "prep",
            targetId: "e0000000-0000-4000-d000-000000000003",
            targetLabel: "Q3 board review",
            targetUrl: null,
            confirmedAt: stamp(-3),
            createdAt: stamp(-3),
          },
          {
            id: "l0000000-0000-4000-b000-000000000003",
            taskId: "d0000000-0000-4000-b000-000000000003",
            kind: "note",
            relation: "related",
            targetId: "n0000000-0000-4000-e000-000000000001",
            targetLabel: "Decision: consolidate on one cloud",
            targetUrl: null,
            confirmedAt: stamp(-3),
            createdAt: stamp(-3),
          },
        ],
      }),
    ),
    ready(
      row("d0000000-0000-4000-b000-000000000004", {
        title: "1:1 prep — Dana's promotion case",
        priority: "high",
        dueAt: stamp(0, 13),
        categoryId: CAT.people,
        status: "ready",
        owner: PEOPLE.self.name,
      }),
    ),

    // ── The next two days ──────────────────────────────────────────────
    ready(
      row("d0000000-0000-4000-b000-000000000005", {
        title: "Review the incident write-up for the auth outage",
        notes: "Blameless. Focus on the alerting gap, not the deploy.",
        priority: "high",
        dueAt: stamp(1, 11),
        categoryId: CAT.operational,
        status: "ready",
        owner: PEOPLE.dana.name,
      }),
    ),
    ready(
      row("d0000000-0000-4000-b000-000000000006", {
        title: "Approve the data-residency addendum",
        priority: "normal",
        dueAt: stamp(1, 15),
        categoryId: CAT.security,
        status: "inbox",
        owner: PEOPLE.tom.name,
      }),
    ),
    ready(
      row("d0000000-0000-4000-b000-000000000007", {
        title: "Draft the FY27 platform budget envelope",
        priority: "normal",
        dueAt: stamp(2, 17),
        categoryId: CAT.strategic,
        status: "in_progress",
        owner: PEOPLE.self.name,
      }),
    ),

    // ── Later this week and beyond ─────────────────────────────────────
    ready(
      row("d0000000-0000-4000-b000-000000000008", {
        title: "Shortlist two candidates for the staff SRE role",
        priority: "normal",
        dueAt: stamp(4, 12),
        categoryId: CAT.people,
        status: "ready",
        owner: PEOPLE.dana.name,
      }),
    ),
    ready(
      row("d0000000-0000-4000-b000-000000000009", {
        title: "Evaluate the agent-assist proof of concept",
        notes: "Time-boxed to a fortnight. Kill it cheerfully if it stalls.",
        priority: "low",
        dueAt: stamp(9, 17),
        categoryId: CAT.innovation,
        status: "inbox",
      }),
    ),
    ready(
      row("d0000000-0000-4000-b000-000000000010", {
        title: "Quarterly DR restore drill",
        priority: "high",
        dueAt: stamp(12, 10),
        categoryId: CAT.operational,
        status: "ready",
        owner: PEOPLE.sam.name,
      }),
    ),

    // ── Forced to the top by hand ──────────────────────────────────────
    ready(
      row("d0000000-0000-4000-b000-000000000011", {
        title: "Call Priya back about the audit committee seat",
        notes:
          "Ranked by hand: no due date and no meeting, so the engine would never surface it. That is exactly what the override is for.",
        priority: "high",
        dueAt: stamp(3, 9),
        categoryId: CAT.stakeholder,
        status: "ready",
        owner: PEOPLE.self.name,
        manualRank: 0,
        manualRankSetAt: stamp(-1, 8),
      }),
    ),

    // ── Drafts, awaiting the three fields ──────────────────────────────
    row("d0000000-0000-4000-b000-000000000012", {
      title: "Ask legal whether the addendum covers sub-processors",
      isDraft: true,
      categoryId: CAT.security,
      links: [
        {
          id: "l0000000-0000-4000-b000-000000000004",
          taskId: "d0000000-0000-4000-b000-000000000012",
          kind: "note",
          relation: "source",
          targetId: "n0000000-0000-4000-e000-000000000002",
          targetLabel: "Vendor review — Acme Cloud",
          targetUrl: null,
          confirmedAt: stamp(-2),
          createdAt: stamp(-2),
        },
      ],
    }),
    row("d0000000-0000-4000-b000-000000000013", {
      title: "Write up the on-call rotation change",
      isDraft: true,
      priority: "normal",
      categoryId: CAT.operational,
    }),

    // ── Unfiled, because that is a real state ──────────────────────────
    row("d0000000-0000-4000-b000-000000000014", {
      title: "Someone mentioned a SOC 2 gap — chase it down",
      status: "inbox",
    }),

    // ── Blocked ────────────────────────────────────────────────────────
    ready(
      row("d0000000-0000-4000-b000-000000000015", {
        title: "Sign off the network segmentation plan",
        notes: "Waiting on the vendor's diagram.",
        priority: "normal",
        dueAt: stamp(5, 16),
        categoryId: CAT.security,
        status: "waiting",
        owner: PEOPLE.sam.name,
      }),
    ),

    // ── Done, spread across the week so reports have something ─────────
    ready(
      row("d0000000-0000-4000-b000-000000000016", {
        title: "Publish the quarterly engineering update",
        priority: "normal",
        dueAt: stamp(-3, 17),
        categoryId: CAT.people,
        status: "done",
        owner: PEOPLE.self.name,
        completedAt: stamp(-3, 16),
      }),
    ),
    ready(
      row("d0000000-0000-4000-b000-000000000017", {
        title: "Approve the Q3 tooling spend",
        priority: "high",
        dueAt: stamp(-4, 12),
        categoryId: CAT.vendor,
        status: "done",
        owner: PEOPLE.self.name,
        completedAt: stamp(-4, 11),
      }),
    ),
    ready(
      row("d0000000-0000-4000-b000-000000000018", {
        title: "Interview loop debrief — platform lead",
        priority: "normal",
        dueAt: stamp(-2, 15),
        categoryId: CAT.people,
        status: "done",
        owner: PEOPLE.dana.name,
        completedAt: stamp(-2, 15),
      }),
    ),
    ready(
      row("d0000000-0000-4000-b000-000000000019", {
        title: "Patch window sign-off",
        priority: "low",
        dueAt: stamp(-1, 20),
        categoryId: CAT.operational,
        status: "done",
        owner: PEOPLE.sam.name,
        completedAt: stamp(-1, 19),
      }),
    ),
    ready(
      row("d0000000-0000-4000-b000-000000000020", {
        title: "Clear the inbox backlog to zero",
        priority: "low",
        dueAt: stamp(-5, 18),
        categoryId: CAT.admin,
        status: "done",
        owner: PEOPLE.self.name,
        completedAt: stamp(-5, 17),
      }),
    ),

    ...boardCoverage(clock, row, ready),
  ];
}

/**
 * One card in every lane, for every category.
 *
 * Forty rows that exist for a specific reason: the board's behaviour is
 * per-lane (Inbox suggests triage, Ready can be promoted, Done is terminal)
 * and the reporting is per-category, so the only way to see both working at
 * once is a grid that is actually full. Without this, half the swimlanes are
 * empty and "the Kanban works" is a claim about four cards.
 *
 * Due dates deliberately straddle the present: each category carries
 * something finished last week, something live now, and something scheduled
 * for next month, so every time-based view — overdue, due soon, upcoming,
 * and the monthly hours rollup — has data on both sides of today.
 */
function boardCoverage(
  clock: ReturnType<typeof weekClock>,
  row: (id: string, patch: Partial<Task> & Pick<Task, "title">) => Task,
  ready: (task: Task) => Task,
): Task[] {
  const stamp = (dayOffset: number, hour = 11) => at(clock, dayOffset, hour);

  const lanes = [
    { status: "inbox" as const, label: "Triage", day: 6 },
    { status: "ready" as const, label: "Scope", day: 3 },
    { status: "in_progress" as const, label: "Draft", day: 1 },
    { status: "waiting" as const, label: "Chase", day: -1 },
    { status: "done" as const, label: "Close out", day: -6 },
  ];

  const subjects: {
    id: string;
    category: string;
    work: string;
    owner: string;
  }[] = [
    {
      id: "st",
      category: CAT.strategic,
      work: "the three-year platform plan",
      owner: PEOPLE.self.name,
    },
    {
      id: "op",
      category: CAT.operational,
      work: "the incident review backlog",
      owner: PEOPLE.dana.name,
    },
    {
      id: "pe",
      category: CAT.people,
      work: "the SRE hiring loop",
      owner: PEOPLE.dana.name,
    },
    {
      id: "sb",
      category: CAT.stakeholder,
      work: "the board reporting pack",
      owner: PEOPLE.self.name,
    },
    {
      id: "vb",
      category: CAT.vendor,
      work: "the Acme Cloud contract",
      owner: PEOPLE.self.name,
    },
    {
      id: "sc",
      category: CAT.security,
      work: "the SOC 2 evidence set",
      owner: PEOPLE.sam.name,
    },
    {
      id: "in",
      category: CAT.innovation,
      work: "the agent-assist trial",
      owner: PEOPLE.maya.name,
    },
    {
      id: "ad",
      category: CAT.admin,
      work: "the expense and approvals queue",
      owner: PEOPLE.self.name,
    },
  ];

  const priorities = ["critical", "high", "normal", "low"] as const;

  const out: Task[] = [];
  let n = 100;

  for (const subject of subjects) {
    lanes.forEach((lane, laneIndex) => {
      n += 1;
      const id = `d0000000-0000-4000-b000-${String(n).padStart(12, "0")}`;
      const dueAt = stamp(lane.day + laneIndex);

      out.push(
        ready(
          row(id, {
            title: `${lane.label}: ${subject.work}`,
            notes:
              lane.status === "waiting"
                ? "Blocked on someone else. Chased once."
                : null,
            // Rotated rather than random, so every priority appears in every
            // lane across the set and the colour coding is exercised.
            priority: priorities[(laneIndex + subjects.indexOf(subject)) % 4],
            dueAt,
            categoryId: subject.category,
            status: lane.status,
            owner: subject.owner,
            completedAt: lane.status === "done" ? dueAt : null,
            createdAt: stamp(lane.day - 4),
            updatedAt: stamp(Math.min(lane.day, 0)),
          }),
        ),
      );
    });
  }

  return out;
}

/* ── Notes ────────────────────────────────────────────────────────────── */

function notes(clock: ReturnType<typeof weekClock>): Note[] {
  const stamp = (dayOffset: number, hour = 10) => at(clock, dayOffset, hour);
  const day = (dayOffset: number) => stamp(dayOffset).slice(0, 10);

  const row = (
    id: string,
    patch: Partial<Note> & Pick<Note, "title">,
  ): Note => ({
    id,
    kind: "freeform",
    decision: null,
    rationale: null,
    context: null,
    owner: null,
    decidedOn: null,
    body: "",
    vaultPath: null,
    version: 1,
    isArchived: false,
    isCompleteDecision: true,
    createdAt: stamp(-6),
    updatedAt: stamp(-1),
    links: [],
    ...patch,
    title: patch.title,
  });

  return [
    row("n0000000-0000-4000-e000-000000000001", {
      kind: "decision",
      title: "Decision: consolidate on one cloud",
      decision:
        "Consolidate production onto Acme Cloud over the next three quarters, and stop new workloads on the secondary provider immediately.",
      rationale:
        "Two providers costs roughly 19% in duplicated platform effort and a second on-call surface, and neither is a hedge we have ever used. The saving funds the SRE hire; the risk is a single vendor's pricing power, which the three-year rate lock addresses.",
      context:
        "Raised at the platform review. Dana modelled the effort; Sam checked the residency position with Tom.",
      owner: PEOPLE.self.name,
      decidedOn: day(-3),
      vaultPath: "Decisions/2026-08 Consolidate on one cloud.md",
      version: 4,
      body: [
        "Discussed with [[Vendor review — Acme Cloud]] in front of us.",
        "",
        "Follow-up actions:",
        "- [ ] Ask legal whether the addendum covers sub-processors #draft",
        "- [ ] Model the exit cost if we ever reverse this",
        "- [x] Tell Dana so hiring can assume the saving",
        "",
        "Revisit if renewal pricing moves more than 10% at the next cycle.",
      ].join("\n"),
    }),

    row("n0000000-0000-4000-e000-000000000002", {
      kind: "decision",
      title: "Vendor review — Acme Cloud",
      decision:
        "Accept the three-year rate lock rather than the annual roll-over.",
      rationale:
        "The annual option is 4% cheaper in year one and unbounded afterwards. We are about to concentrate spend with them, which is precisely when a ceiling is worth paying for.",
      context: "Ravi's quote AC-2026-118. Reviewed with finance.",
      owner: PEOPLE.self.name,
      decidedOn: day(-4),
      vaultPath: "Decisions/2026-08 Acme Cloud rate lock.md",
      version: 2,
      body: "Links back to [[Decision: consolidate on one cloud]].",
    }),

    // An incomplete decision, which the product is meant to show as such.
    row("n0000000-0000-4000-e000-000000000003", {
      kind: "decision",
      title: "Decision: on-call compensation model",
      decision: "Move to a flat weekly on-call allowance.",
      rationale: null,
      context: "Dana raised it after the auth outage.",
      owner: PEOPLE.dana.name,
      decidedOn: null,
      isCompleteDecision: false,
      version: 1,
      body: "Rationale still to be written — deliberately left open so the banner shows.",
    }),

    row("n0000000-0000-4000-e000-000000000004", {
      kind: "meeting",
      title: "Q3 board review — running notes",
      owner: PEOPLE.self.name,
      vaultPath: "Meetings/2026-08 Q3 board review.md",
      version: 3,
      body: [
        "Attendees: Priya Raman (chair), Maya Chen, Doug.",
        "",
        "- Platform spend lands 6% under plan.",
        "- Priya wants the three-year view on the spend slide.",
        "- Audit committee seat still open; she will call.",
        "",
        "Follow-up actions:",
        "- [ ] Send the three-year spend view before Thursday",
        "- [ ] Confirm whether the seat needs board approval",
      ].join("\n"),
    }),

    row("n0000000-0000-4000-e000-000000000005", {
      kind: "follow_up",
      title: "Auth outage — what we owe the team",
      owner: PEOPLE.dana.name,
      version: 2,
      body: [
        "The deploy was not the cause; the alert that should have fired at 02:10 did not.",
        "",
        "- [x] Restore service",
        "- [ ] Fix the alert rule",
        "- [ ] Write the blameless summary",
      ].join("\n"),
    }),

    row("n0000000-0000-4000-e000-000000000006", {
      kind: "action",
      title: "Weekly review checklist",
      version: 1,
      body: [
        "- [ ] Overdue list empty or explained",
        "- [ ] Hours reconciled against the calendar",
        "- [ ] Board pack progressed",
      ].join("\n"),
    }),

    row("n0000000-0000-4000-e000-000000000007", {
      kind: "freeform",
      title: "Reading — platform engineering, second-order costs",
      version: 1,
      isArchived: true,
      body: "Archived on purpose, so the archived filter has something to find.",
    }),
  ];
}

/* ── Calendar, in the shape the hours module consumes ─────────────────── */

function events(clock: ReturnType<typeof weekClock>): MemoryEvent[] {
  const CAL = "00000000-0000-4000-a000-000000000001";

  const row = (
    id: string,
    patch: Partial<MemoryEvent> &
      Pick<MemoryEvent, "title" | "startsAt" | "endsAt">,
  ): MemoryEvent => ({
    id,
    calendarId: CAL,
    location: null,
    organizerAddress: PEOPLE.self.address,
    attendeeAddresses: [],
    attendeeCount: 1,
    isExternal: false,
    isCancelled: false,
    categoryId: null,
    categorySource: "rule",
    categoryReason: null,
    hoursInclude: null,
    ...patch,
    title: patch.title,
    startsAt: patch.startsAt,
    endsAt: patch.endsAt,
  });

  return [
    row("e0000000-0000-4000-d000-000000000001", {
      title: "Platform stand-up",
      startsAt: at(clock, -2, 9, 15),
      endsAt: at(clock, -2, 9, 30),
      attendeeAddresses: [PEOPLE.dana.address, PEOPLE.sam.address],
      attendeeCount: 8,
      categoryId: CAT.operational,
      categorySource: "rule",
      categoryReason: "Recurring stand-up, matched on title",
    }),
    row("e0000000-0000-4000-d000-000000000002", {
      title: "Vendor call — Acme Cloud renewal",
      startsAt: at(clock, -1, 14, 0),
      endsAt: at(clock, -1, 15, 0),
      location: "Meet",
      organizerAddress: PEOPLE.vendor.address,
      attendeeAddresses: [PEOPLE.vendor.address, PEOPLE.self.address],
      attendeeCount: 4,
      isExternal: true,
      categoryId: CAT.vendor,
      categorySource: "attendees",
      categoryReason: "External attendee from acme-cloud.example",
    }),
    row("e0000000-0000-4000-d000-000000000003", {
      title: "Q3 board review",
      startsAt: at(clock, 1, 10, 0),
      endsAt: at(clock, 1, 12, 0),
      location: "Boardroom",
      organizerAddress: PEOPLE.priya.address,
      attendeeAddresses: [
        PEOPLE.priya.address,
        PEOPLE.maya.address,
        PEOPLE.self.address,
      ],
      attendeeCount: 9,
      isExternal: true,
      categoryId: CAT.stakeholder,
      categorySource: "manual",
      categoryReason: "You filed this as Stakeholder & Board",
    }),
    row("e0000000-0000-4000-d000-000000000004", {
      title: "1:1 — Dana",
      startsAt: at(clock, 0, 13, 30),
      endsAt: at(clock, 0, 14, 0),
      attendeeAddresses: [PEOPLE.dana.address],
      attendeeCount: 2,
      categoryId: CAT.people,
      categorySource: "rule",
      categoryReason: "Matched the 1:1 rule",
    }),
    row("e0000000-0000-4000-d000-000000000005", {
      title: "Focus block — budget envelope",
      startsAt: at(clock, 0, 15, 0),
      endsAt: at(clock, 0, 17, 0),
      categoryId: CAT.strategic,
      categorySource: "rule",
      categoryReason: "Matched the focus-block rule",
    }),
    // Explicitly excluded from hours by hand — the override the spec insists on.
    row("e0000000-0000-4000-d000-000000000006", {
      title: "Lunch",
      startsAt: at(clock, 0, 12, 0),
      endsAt: at(clock, 0, 12, 45),
      hoursInclude: false,
      categorySource: "manual",
      categoryReason: "You excluded this from hours",
    }),
    // Cancelled, so it should count for nothing anywhere.
    row("e0000000-0000-4000-d000-000000000007", {
      title: "Architecture review (cancelled)",
      startsAt: at(clock, 2, 11, 0),
      endsAt: at(clock, 2, 12, 0),
      isCancelled: true,
    }),
    row("e0000000-0000-4000-d000-000000000008", {
      title: "Security working group",
      startsAt: at(clock, 2, 15, 0),
      endsAt: at(clock, 2, 16, 0),
      attendeeAddresses: [PEOPLE.sam.address, PEOPLE.tom.address],
      attendeeCount: 6,
      isExternal: true,
      categoryId: CAT.security,
      categorySource: "rule",
      categoryReason: "Title contains “security”",
    }),
  ];
}

/* ── Hours ────────────────────────────────────────────────────────────── */

function hours(clock: ReturnType<typeof weekClock>): {
  sessions: PomodoroSession[];
  entries: TimeEntry[];
  rules: WorkCategoryRule[];
} {
  const sessions: PomodoroSession[] = [];
  const entries: TimeEntry[] = [];

  // Four focused days behind us, so the weekly total is not a single number
  // sitting on its own.
  const plan: { day: number; count: number; taskId: string | null }[] = [
    { day: -4, count: 3, taskId: "d0000000-0000-4000-b000-000000000017" },
    { day: -3, count: 4, taskId: "d0000000-0000-4000-b000-000000000016" },
    { day: -2, count: 2, taskId: "d0000000-0000-4000-b000-000000000001" },
    { day: -1, count: 3, taskId: "d0000000-0000-4000-b000-000000000003" },
    { day: 0, count: 2, taskId: "d0000000-0000-4000-b000-000000000003" },
  ];

  let n = 0;
  for (const { day, count, taskId } of plan) {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      const id = `f0000000-0000-4000-f000-${String(n).padStart(12, "0")}`;
      const startedAt = at(clock, day, 9 + i, 5);
      const endedAt = at(clock, day, 9 + i, 30);

      sessions.push({
        id,
        kind: "focus",
        taskId,
        plannedMinutes: 25,
        startedAt,
        endedAt,
        completed: true,
        seconds: 25 * 60,
        note: i === 0 ? "First block of the morning" : null,
        createdAt: startedAt,
        updatedAt: endedAt,
      });

      entries.push({
        id: `t0000000-0000-4000-f000-${String(n).padStart(12, "0")}`,
        source: "focused",
        taskId,
        categoryId: null,
        sessionId: id,
        startedAt,
        endedAt,
        minutes: 25,
        note: null,
        clientKey: null,
        createdAt: startedAt,
        updatedAt: endedAt,
      });
    }
  }

  // Manual adjustments, clearly labelled — the off-calendar work the spec
  // asks to be capturable and distinguishable.
  entries.push(
    {
      id: "t0000000-0000-4000-f000-000000000901",
      source: "manual",
      taskId: null,
      categoryId: CAT.stakeholder,
      sessionId: null,
      startedAt: at(clock, -2, 19, 0),
      endedAt: at(clock, -2, 20, 30),
      minutes: 90,
      note: "Board pack, at home after dinner",
      clientKey: null,
      createdAt: at(clock, -2, 20, 35),
      updatedAt: at(clock, -2, 20, 35),
    },
    {
      id: "t0000000-0000-4000-f000-000000000902",
      source: "manual",
      taskId: "d0000000-0000-4000-b000-000000000002",
      categoryId: CAT.security,
      sessionId: null,
      startedAt: at(clock, -1, 7, 30),
      endedAt: at(clock, -1, 8, 15),
      minutes: 45,
      note: "Access review, on the train",
      clientKey: "demo-offline-capture-0001",
      createdAt: at(clock, -1, 8, 20),
      updatedAt: at(clock, -1, 8, 20),
    },
  );

  const rules: WorkCategoryRule[] = [
    {
      id: "r0000000-0000-4000-a000-000000000001",
      pattern: "stand-up",
      field: "title",
      categoryId: CAT.operational,
      countsTowardHours: true,
      position: 1,
      isEnabled: true,
      createdAt: at(clock, -30, 9),
      updatedAt: at(clock, -30, 9),
    },
    {
      id: "r0000000-0000-4000-a000-000000000002",
      pattern: "1:1",
      field: "title",
      categoryId: CAT.people,
      countsTowardHours: true,
      position: 2,
      isEnabled: true,
      createdAt: at(clock, -30, 9),
      updatedAt: at(clock, -30, 9),
    },
    {
      id: "r0000000-0000-4000-a000-000000000003",
      pattern: "focus block",
      field: "title",
      categoryId: CAT.strategic,
      countsTowardHours: true,
      position: 3,
      isEnabled: true,
      createdAt: at(clock, -30, 9),
      updatedAt: at(clock, -30, 9),
    },
    {
      id: "r0000000-0000-4000-a000-000000000004",
      pattern: "lunch",
      field: "title",
      categoryId: null,
      countsTowardHours: false,
      position: 4,
      isEnabled: true,
      createdAt: at(clock, -30, 9),
      updatedAt: at(clock, -30, 9),
    },
    {
      // Disabled, so the editor has something to show in that state.
      id: "r0000000-0000-4000-a000-000000000005",
      pattern: "acme-cloud.example",
      field: "attendee",
      categoryId: CAT.vendor,
      countsTowardHours: true,
      position: 5,
      isEnabled: false,
      createdAt: at(clock, -20, 9),
      updatedAt: at(clock, -6, 9),
    },
  ];

  return { sessions, entries, rules };
}

/* ── The digest inbox ─────────────────────────────────────────────────── */

function inbox(clock: ReturnType<typeof weekClock>): InboxMessage[] {
  return [
    {
      id: "i0000000-0000-4000-a000-000000000001",
      kind: "daily",
      subject: "Morning brief — today",
      preview: "2 meetings · 4 due · 2 overdue · 11h 25m logged this week",
      body: "Overdue: Acme Cloud renewal, Okta access review.\nDue today: board pack slide, 1:1 prep.\nNext two days: Q3 board review, security working group.",
      html: null,
      readAt: null,
      generatedAt: minutesAgo(clock, 200),
    },
    {
      id: "i0000000-0000-4000-a000-000000000002",
      kind: "daily",
      subject: "Morning brief — yesterday",
      preview: "3 meetings · 2 due · 1 overdue",
      body: "Yesterday's brief, already read.",
      html: null,
      readAt: at(clock, -1, 8, 10),
      generatedAt: at(clock, -1, 7, 5),
    },
    {
      id: "i0000000-0000-4000-a000-000000000003",
      kind: "weekly",
      subject: "Week in review",
      preview: "5 completed · 11h 25m · heaviest category: Stakeholder & Board",
      body: "Completed five, closed the tooling spend, lost most of Wednesday to the outage.",
      html: null,
      readAt: null,
      generatedAt: at(clock, -2, 7, 5),
    },
    {
      id: "i0000000-0000-4000-a000-000000000004",
      kind: "monthly",
      subject: "Month in review",
      preview: "Hours by category, and what slipped",
      body: "Monthly rollup.",
      html: null,
      readAt: at(clock, -6, 9, 0),
      generatedAt: at(clock, -6, 7, 5),
    },
  ];
}

/* ── Mail and its calendar ────────────────────────────────────────────── */

/**
 * A week of mail across both Microsoft accounts.
 *
 * `doug@theonefor.ai` is the owner's own tenant and caches in full, so its
 * threads have bodies. `doug@encountive.com` is marked corporate and caches
 * headers only — its messages arrive with `body: null` on purpose, which is
 * what the reader's "stored metadata only" notice exists to explain. Seeing
 * the two side by side is the clearest way to check the policy is real
 * rather than described.
 *
 * Sender importance covers all four levels, because the attention card, the
 * inbox pinning and the email→task priority suggestion all read it and none
 * of them can be judged from a single value.
 */
function mail(clock: ReturnType<typeof weekClock>) {
  const PRIMARY = "acc-m365-primary";
  const SECONDARY = "acc-m365-secondary";

  const message = (
    id: string,
    over: {
      accountId?: string;
      mailboxId?: string;
      threadKey: string;
      subject: string;
      snippet?: string | null;
      from: { address: string; name: string | null };
      body?: string | null;
      importance?: "critical" | "high" | "normal" | "low";
      minutes: number;
      isRead?: boolean;
      isFlagged?: boolean;
      hasAttachments?: boolean;
    },
  ) => ({
    id,
    accountId: over.accountId ?? PRIMARY,
    threadId: over.threadKey,
    threadKey: over.threadKey,
    mailboxId: over.mailboxId ?? "mb-inbox",
    remoteId: id,
    messageIdHeader: `<${id}@demo.invalid>`,
    subject: over.subject,
    snippet: over.snippet ?? null,
    from: over.from,
    to: ["doug@theonefor.ai"],
    cc: [],
    sentAt: minutesAgo(clock, over.minutes),
    receivedAt: minutesAgo(clock, over.minutes),
    isRead: over.isRead ?? false,
    isFlagged: over.isFlagged ?? false,
    isDraft: false,
    hasAttachments: over.hasAttachments ?? false,
    body: over.body ?? null,
    bodyFormat: over.body ? ("text" as const) : null,
    senderImportance: over.importance ?? "normal",
  });

  const messages = [
    message("m0000000-0000-4000-c000-000000000004", {
      threadKey: "thr-demo-renewal",
      subject: "Renewal paperwork — signature needed",
      snippet:
        "I can hold the 2025 rate until month end, but I need it signed.",
      from: { address: PEOPLE.vendor.address, name: PEOPLE.vendor.name },
      body: "Doug — I can hold the 2025 rate until month end, but I need the signed order form by then.\n\nQuote AC-2026-118 attached.",
      importance: "high",
      minutes: 90,
      hasAttachments: true,
      isFlagged: true,
    }),
    message("m0000000-0000-4000-c000-000000000005", {
      threadKey: "thr-demo-seat",
      subject: "Audit committee seat",
      snippet: "Do you have ten minutes this week?",
      from: { address: PEOPLE.priya.address, name: PEOPLE.priya.name },
      body: "Do you have ten minutes this week? I would like to talk about the audit committee seat before the board meets.",
      importance: "critical",
      minutes: 45,
    }),
    message("m0000000-0000-4000-c000-000000000006", {
      threadKey: "thr-demo-outage",
      subject: "Auth outage — draft write-up",
      snippet: "Draft attached. The alert rule is the real finding.",
      from: { address: PEOPLE.dana.address, name: PEOPLE.dana.name },
      body: "Draft attached. The deploy was not the cause — the alert that should have fired at 02:10 did not.\n\nI would like your read before it goes wider.",
      importance: "high",
      minutes: 300,
      hasAttachments: true,
      isRead: true,
    }),
    message("m0000000-0000-4000-c000-000000000007", {
      threadKey: "thr-demo-residency",
      subject: "Data residency addendum, redlined",
      snippet: "Two changes in clause 7.",
      from: { address: PEOPLE.tom.address, name: PEOPLE.tom.name },
      body: "Two changes in clause 7. Neither is controversial; both need your sign-off by Wednesday.",
      importance: "normal",
      minutes: 1_500,
      isRead: true,
    }),
    message("m0000000-0000-4000-c000-000000000008", {
      threadKey: "thr-demo-newsletter",
      subject: "Daily digest: eight things you missed",
      snippet: "Sponsored content and three headlines.",
      from: {
        address: PEOPLE.newsletter.address,
        name: PEOPLE.newsletter.name,
      },
      body: "Newsletter body. Rated Low on purpose — this is the mail the attention card must never surface.",
      importance: "low",
      minutes: 200,
    }),

    // ── The governed mailbox: headers only, by policy ──────────────────
    message("m0000000-0000-4000-c000-000000000009", {
      accountId: SECONDARY,
      mailboxId: "mb-encountive-inbox",
      threadKey: "thr-demo-encountive-1",
      subject: "Encountive — quarterly platform review",
      from: { address: PEOPLE.maya.address, name: PEOPLE.maya.name },
      // No body: this account caches metadata only.
      importance: "high",
      minutes: 600,
    }),
    message("m0000000-0000-4000-c000-000000000010", {
      accountId: SECONDARY,
      mailboxId: "mb-encountive-inbox",
      threadKey: "thr-demo-encountive-2",
      subject: "Encountive — invoice approval needed",
      from: { address: "billing@encountive.com", name: "Billing" },
      importance: "normal",
      minutes: 2_800,
      isRead: true,
    }),
  ];

  const senders = [
    {
      id: "snd-demo-priya",
      address: PEOPLE.priya.address,
      displayName: PEOPLE.priya.name,
      importance: "critical" as const,
      notes: "Board chair. Always surfaces.",
      updatedAt: at(clock, -20, 9),
    },
    {
      id: "snd-demo-vendor",
      address: PEOPLE.vendor.address,
      displayName: PEOPLE.vendor.name,
      importance: "high" as const,
      notes: "Acme Cloud account exec",
      updatedAt: at(clock, -14, 9),
    },
    {
      id: "snd-demo-dana",
      address: PEOPLE.dana.address,
      displayName: PEOPLE.dana.name,
      importance: "high" as const,
      notes: null,
      updatedAt: at(clock, -14, 9),
    },
    {
      id: "snd-demo-tom",
      address: PEOPLE.tom.address,
      displayName: PEOPLE.tom.name,
      importance: "normal" as const,
      notes: "External counsel",
      updatedAt: at(clock, -9, 9),
    },
    {
      id: "snd-demo-news",
      address: PEOPLE.newsletter.address,
      displayName: PEOPLE.newsletter.name,
      importance: "low" as const,
      notes: "Newsletter — deliberately rated Low",
      updatedAt: at(clock, -9, 9),
    },
  ];

  const event = (
    id: string,
    over: {
      calendarId?: string;
      title: string;
      startsAt: string;
      endsAt: string;
      organizer?: { address: string; name: string | null } | null;
      attendeeCount?: number;
      isExternal?: boolean;
      response?:
        | "organizer"
        | "accepted"
        | "tentative"
        | "declined"
        | "needs_action"
        | "unknown";
      isCancelled?: boolean;
      location?: string | null;
      allDay?: boolean;
      meetingUrl?: string | null;
      description?: string | null;
    },
  ) => ({
    id,
    calendarId: over.calendarId ?? "cal-primary",
    remoteId: id,
    seriesId: null,
    title: over.title,
    location: over.location ?? null,
    description: over.description ?? null,
    startsAt: over.startsAt,
    endsAt: over.endsAt,
    allDay: over.allDay ?? false,
    timeZone: clock.timeZone,
    organizer: over.organizer ?? {
      address: PEOPLE.self.address,
      name: PEOPLE.self.name,
    },
    attendeeCount: over.attendeeCount ?? 1,
    isExternal: over.isExternal ?? false,
    response: over.response ?? ("accepted" as const),
    isCancelled: over.isCancelled ?? false,
    meetingUrl: over.meetingUrl ?? null,
  });

  const events = [
    event("e0000000-0000-4000-d000-000000000003", {
      title: "Q3 board review",
      startsAt: at(clock, 1, 10),
      endsAt: at(clock, 1, 12),
      organizer: { address: PEOPLE.priya.address, name: PEOPLE.priya.name },
      attendeeCount: 9,
      isExternal: true,
      location: "Boardroom",
      description: "Quarterly review. Spend slide needs the three-year view.",
      meetingUrl: "https://teams.example/q3-board",
    }),
    event("e0000000-0000-4000-d000-000000000004", {
      title: "1:1 — Dana",
      startsAt: at(clock, 0, 13, 30),
      endsAt: at(clock, 0, 14),
      attendeeCount: 2,
    }),
    event("e0000000-0000-4000-d000-000000000005", {
      title: "Focus block — budget envelope",
      startsAt: at(clock, 0, 15),
      endsAt: at(clock, 0, 17),
    }),
    event("e0000000-0000-4000-d000-000000000008", {
      title: "Security working group",
      startsAt: at(clock, 2, 15),
      endsAt: at(clock, 2, 16),
      attendeeCount: 6,
      isExternal: true,
      organizer: { address: PEOPLE.sam.address, name: PEOPLE.sam.name },
    }),
    // Declined, so it should be absent from the agenda and from hours.
    event("e0000000-0000-4000-d000-000000000009", {
      title: "All-hands (declined)",
      startsAt: at(clock, 1, 16),
      endsAt: at(clock, 1, 17),
      attendeeCount: 200,
      response: "declined",
    }),
    // All-day, on the secondary calendar.
    event("e0000000-0000-4000-d000-000000000010", {
      calendarId: "cal-encountive",
      title: "Encountive quarterly close",
      startsAt: at(clock, 3, 0),
      endsAt: at(clock, 4, 0),
      allDay: true,
      attendeeCount: 5,
      organizer: { address: PEOPLE.maya.address, name: PEOPLE.maya.name },
    }),
  ];

  const calendars = [
    {
      id: "cal-encountive",
      accountId: SECONDARY,
      remoteId: "encountive-primary",
      name: "Encountive",
      description: "Secondary tenant",
      color: "#7A5F35",
      timeZone: clock.timeZone,
      isPrimary: false,
      isVisible: true,
      access: "read_only" as const,
    },
  ];

  return { messages, senders, events, calendars };
}

/* ── Applying it ──────────────────────────────────────────────────────── */

/**
 * Loads the demo week into the in-memory stores.
 *
 * Guarded twice over by its callers: memory mode only, and only when asked
 * for explicitly. It writes nothing to a database and cannot reach one.
 */
export async function seedDemoWeek(now: Date = new Date()): Promise<void> {
  const clock = weekClock(now);

  const [
    tasksStore,
    notesStore,
    hoursStore,
    reportsStore,
    priorityStore,
    mailStore,
  ] = await Promise.all([
    import("@/lib/tasks/repository.memory"),
    import("@/lib/notes/repository.memory"),
    import("@/lib/hours/repository.memory"),
    import("@/lib/reports/repository.memory"),
    import("@/lib/priority/repository.memory"),
    import("@/lib/mail/repository.memory"),
  ]);

  const calendar = events(clock);

  tasksStore.seedMemoryTasks(tasks(clock));
  notesStore.seedMemoryNotes(notes(clock));

  const { sessions, entries, rules } = hours(clock);
  hoursStore.seedMemoryHours({ sessions, entries, rules });
  hoursStore.seedMemoryEvents(calendar);

  reportsStore.seedMemoryInbox(inbox(clock));

  const inbox_ = mail(clock);
  mailStore.seedMemoryMail({
    messages: inbox_.messages,
    senders: inbox_.senders,
    events: inbox_.events,
  });

  // The priority engine reads meetings to infer importance, so it gets the
  // same week the calendar shows rather than a parallel one.
  priorityStore.seedPriorityEvents(
    calendar
      .filter((event) => !event.isCancelled)
      .map((event) => ({
        id: event.id,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        attendeeCount: event.attendeeCount,
        isExternal: event.isExternal,
        organizerAddress: event.organizerAddress,
        isCancelled: event.isCancelled,
        isOwnerOrganiser: event.organizerAddress === PEOPLE.self.address,
      })),
  );
}
