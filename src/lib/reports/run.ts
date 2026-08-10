/**
 * Running a digest.
 *
 * The job pg_cron calls, and the one a person calls from the settings page
 * when they want to see what today's brief would say. Same code path — a
 * "preview" that renders differently from the real thing is not a preview.
 *
 * ── The order of operations ──────────────────────────────────────────────
 *
 *   1. Decide whether this kind is *due* right now, in the owner's zone.
 *   2. **Claim the period.** If the claim fails, someone already did this —
 *      stop, quietly and successfully.
 *   3. Build the report, compose, deliver.
 *
 * Claiming before composing is deliberate. A crash during composition leaves
 * the period claimed and no digest sent, which is the right failure: a missing
 * brief is visible and recoverable by hand, two contradictory briefs are just
 * confusing.
 */

import { startOfZonedWeek } from "@/lib/time/zone";

import { buildReport } from "./build";
import type { GroupedTasks } from "./group";
import { composeDigest, type Digest, type DigestKind } from "./digest";
import { deliverDigest, type EmailChannel } from "./delivery";
import type { DigestSettings, ReportRepository } from "./repository";

export interface RunOptions {
  repository: ReportRepository;
  email?: EmailChannel;
  now: Date;
  baseUrl?: string;
  /**
   * Ignore the schedule and the claim, and don't deliver.
   *
   * What the settings page uses to show "here is what your brief looks like".
   */
  preview?: DigestKind;
  /** Ignore the schedule but still claim and deliver — the "send now" button. */
  force?: DigestKind;
}

export interface RunResult {
  ran: DigestKind[];
  skipped: { kind: DigestKind; reason: string }[];
  digests: Digest[];
}

/**
 * Which digests are due at this instant.
 *
 * The cron fires hourly and asks this. That is what lets one schedule serve
 * any timezone, and what makes a missed hour recoverable — the next firing
 * still finds the period unclaimed.
 */
export function dueKinds(settings: DigestSettings, now: Date): DigestKind[] {
  const local = zonedParts(now, settings.timeZone);
  const due: DigestKind[] = [];

  if (settings.dailyEnabled && local.hour === settings.dailyHour) {
    due.push("daily");
  }

  // The weekly rollup goes out at the same hour, on the chosen weekday.
  if (
    settings.weeklyEnabled &&
    local.hour === settings.dailyHour &&
    local.weekday === settings.weeklyDow
  ) {
    due.push("weekly");
  }

  // Monthly on the first of the month, same hour.
  if (
    settings.monthlyEnabled &&
    local.hour === settings.dailyHour &&
    local.day === 1
  ) {
    due.push("monthly");
  }

  return due;
}

/** The local date a digest is *for* — the idempotency key. */
export function periodDate(
  kind: DigestKind,
  now: Date,
  timeZone: string,
): string {
  if (kind === "weekly") {
    // The whole week collapses to its Monday, so a rollup is once per week
    // whatever hour it fires at.
    return isoDate(startOfZonedWeek(now, timeZone), timeZone);
  }

  if (kind === "monthly") {
    const parts = zonedParts(now, timeZone);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-01`;
  }

  return isoDate(now, timeZone);
}

export async function runDigests(options: RunOptions): Promise<RunResult> {
  const { repository, now } = options;
  const settings = await repository.getSettings();

  const result: RunResult = { ran: [], skipped: [], digests: [] };

  const kinds = options.preview
    ? [options.preview]
    : options.force
      ? [options.force]
      : dueKinds(settings, now);

  if (kinds.length === 0) {
    return result;
  }

  for (const kind of kinds) {
    const period = periodDate(kind, now, settings.timeZone);

    if (!options.preview) {
      const claimed = await repository.claimPeriod(kind, period);
      if (!claimed) {
        // Already done. Not an error — this is the cron firing twice, or a
        // restart mid-schedule, and both should be uneventful.
        result.skipped.push({ kind, reason: "already sent for this period" });
        continue;
      }
    }

    const digest = await composeFor(kind, settings, now, options.baseUrl);
    result.digests.push(digest);

    if (options.preview) continue;

    await deliverDigest({
      digest,
      store: repository,
      email: options.email,
      to: settings.emailTo,
    });

    result.ran.push(kind);
  }

  return result;
}

async function composeFor(
  kind: DigestKind,
  settings: DigestSettings,
  now: Date,
  baseUrl: string | undefined,
): Promise<Digest> {
  const report = await buildReport({ timeZone: settings.timeZone, now });

  return composeDigest({
    kind,
    generatedAt: now,
    timeZone: settings.timeZone,
    summary: report.summary,
    // The daily brief is about *today*; the rollups are about where the time
    // went. Sending both sections in both would make each one longer and
    // neither one clearer.
    twoDay: kind === "daily" ? report.twoDay : undefined,
    groups: kind === "daily" ? trimGroups(report.groups) : undefined,
    splits: kind === "daily" ? undefined : report.splits,
    baseUrl,
  });
}

/**
 * Keeps the brief a brief.
 *
 * Overdue and due-soon in full, because those are what the brief is for.
 * Everything else is a count you can act on by opening the dashboard — a
 * morning email listing ninety upcoming tasks is one nobody finishes reading.
 */
function trimGroups(groups: GroupedTasks[]): GroupedTasks[] {
  return groups.filter(
    (group) => group.group === "overdue" || group.group === "dueSoon",
  );
}

/* ── Zone helpers ─────────────────────────────────────────────────────── */

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(instant);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // "24" appears at midnight in some locales; both mean hour zero.
    hour: Number(get("hour")) % 24,
    weekday: weekdays[get("weekday")] ?? 0,
  };
}

function isoDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}
