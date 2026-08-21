/**
 * A week in the life, as data.
 *
 * ── What this is for ─────────────────────────────────────────────────────
 * The memory fixtures were built to make individual end-to-end assertions
 * possible: a handful of rows, each proving one thing. That is the right
 * shape for a test and the wrong shape for judging the product, because the
 * interesting behaviour is *between* the modules — a meeting that lifts a
 * task's rank, a decision whose follow-up becomes a draft, an hour that is
 * scheduled rather than focused. None of that shows up in a fixture of three
 * tasks.
 *
 * So this builds a coherent week: the same people appear in mail, on the
 * calendar and as note owners; the same projects run through tasks, the
 * board and the vault; and every field that can hold a value holds one, so a
 * column that silently never renders is visible as a gap rather than as an
 * empty-looking demo.
 *
 * ── Relative, not fixed ──────────────────────────────────────────────────
 * Everything is anchored to the moment the seed runs. A demo full of dates
 * from last spring answers none of the questions the dashboard exists to
 * answer — "is this overdue", "what is tomorrow" — so the week is built
 * around *today*, with real overdue work behind it and real deadlines ahead.
 *
 * ── Deliberately not random ──────────────────────────────────────────────
 * No faker, no shuffling. Two runs produce the same week, so "the board looks
 * wrong" is a reproducible sentence. The variety comes from the content being
 * written out, not from a generator.
 */

/** Fixed ids, so links between modules can be written by hand and checked. */
export const DEMO_IDS = {
  categories: {
    strategic: "00000000-0000-4000-9000-000000000001",
    operational: "00000000-0000-4000-9000-000000000002",
    people: "00000000-0000-4000-9000-000000000003",
    stakeholder: "00000000-0000-4000-9000-000000000004",
    vendor: "00000000-0000-4000-9000-000000000005",
    security: "00000000-0000-4000-9000-000000000006",
    innovation: "00000000-0000-4000-9000-000000000007",
    admin: "00000000-0000-4000-9000-000000000008",
  },
} as const;

/**
 * The cast.
 *
 * One list, referenced by mail, calendar, notes and task owners alike. A demo
 * where the person who sent the mail is not the person who chaired the
 * meeting is a demo that cannot show a link being useful.
 */
export const PEOPLE = {
  maya: { name: "Maya Chen", address: "maya.chen@example.com", role: "CTO" },
  priya: {
    name: "Priya Raman",
    address: "priya.raman@example.com",
    role: "Board chair",
  },
  tom: {
    name: "Tom Okafor",
    address: "tom.okafor@northwind-legal.example",
    role: "External counsel",
  },
  dana: {
    name: "Dana Willis",
    address: "dana.willis@example.com",
    role: "VP Eng",
  },
  sam: {
    name: "Sam Ortega",
    address: "sam.ortega@example.com",
    role: "Sec lead",
  },
  vendor: {
    name: "Ravi Patel",
    address: "ravi@acme-cloud.example",
    role: "Account exec",
  },
  newsletter: {
    name: "The Register Daily",
    address: "digest@theregister.example",
    role: "Newsletter",
  },
  self: { name: "Doug", address: "doug@theonefor.ai", role: "CIO" },
} as const;

export interface WeekClock {
  now: Date;
  /** Midnight local, today. */
  startOfToday: Date;
  timeZone: string;
}

export function weekClock(now: Date = new Date()): WeekClock {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  return {
    now,
    startOfToday,
    timeZone:
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      process.env.TZ ??
      "UTC",
  };
}

/** `at(-1, 9, 30)` is half past nine yesterday morning. */
export function at(
  clock: WeekClock,
  dayOffset: number,
  hour: number,
  minute = 0,
): string {
  const date = new Date(clock.startOfToday);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

/** Minutes before now, for "arrived recently" without a fixed clock. */
export function minutesAgo(clock: WeekClock, minutes: number): string {
  return new Date(clock.now.getTime() - minutes * 60_000).toISOString();
}
