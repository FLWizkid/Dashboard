/**
 * Work-category classification.
 *
 * Deciding, for a calendar event, which activity category it belongs to and
 * whether it counts toward hours at all.
 *
 * ── The precedence, from the specification ───────────────────────────────
 *
 *   1. **Manual override — always wins.** Once the owner has set a category,
 *      no automatic rule may change it. Not "usually"; the database enforces
 *      it too, because the classifier re-runs on every sync and would
 *      otherwise reassert itself the moment they looked away.
 *   2. **Event-level include/exclude toggle.** Also a manual act, and it
 *      overrides counting either way.
 *   3. **Keyword rules**, in the owner's own order. First match wins.
 *   4. **Attendee and meeting-type cues.** The weakest signal, and treated as
 *      such — see the note on cues below.
 *   5. **The source calendar's default.**
 *   6. Otherwise unclassified, and **it does not count**: the specification
 *      says only work-category events count by default, and a dashboard that
 *      silently counts your dentist appointment as work is worse than one
 *      that counts nothing.
 *
 * Every result carries a `reason`. A category appearing on a meeting with no
 * explanation is a number nobody trusts, and the reason is what makes the
 * classification editable rather than mysterious.
 */

export const CLASSIFICATION_SOURCES = [
  "manual",
  "rule",
  "attendees",
  "calendar",
  "unclassified",
] as const;
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

export const RULE_FIELDS = [
  "title",
  "location",
  "organizer",
  "attendee",
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export interface ClassifiableEvent {
  id: string;
  title: string;
  location: string | null;
  organizerAddress: string | null;
  attendeeAddresses: string[];
  attendeeCount: number;
  isExternal: boolean;
  isCancelled: boolean;
  /** What is stored now — the classifier's own previous output, or a manual choice. */
  categoryId: string | null;
  categorySource: ClassificationSource;
  /** null = inherit, true = always count, false = never count. */
  hoursInclude: boolean | null;
}

export interface ClassifiableCalendar {
  id: string;
  name: string;
  countsTowardHours: boolean;
  defaultCategoryId: string | null;
}

export interface CategoryRule {
  id: string;
  pattern: string;
  field: RuleField;
  categoryId: string | null;
  countsTowardHours: boolean;
  position: number;
  isEnabled: boolean;
}

export interface Classification {
  categoryId: string | null;
  source: ClassificationSource;
  countsTowardHours: boolean;
  /** One sentence, shown against the event. */
  reason: string;
  /** The rule that decided it, when one did. */
  matchedRuleId?: string;
}

export interface ClassifyOptions {
  event: ClassifiableEvent;
  calendar: ClassifiableCalendar;
  rules?: CategoryRule[];
  /**
   * Category ids the attendee cues map onto, keyed by the seeded slug.
   * Absent slugs simply disable that cue rather than inventing a category.
   */
  categoryIdBySlug?: Partial<
    Record<"people-team" | "stakeholder-board", string>
  >;
}

/**
 * Classifies one event.
 *
 * Pure, and the single home for this decision — the sync path, the hours view
 * and the settings preview all call it, so the number on the dashboard and the
 * explanation on the event cannot disagree.
 */
export function classifyEvent(options: ClassifyOptions): Classification {
  const { event, calendar } = options;

  /* ── 1. Manual override wins, always ───────────────────────────────── */
  if (event.categorySource === "manual") {
    return applyToggle(
      {
        categoryId: event.categoryId,
        source: "manual",
        // A manually categorised event is work unless explicitly excluded.
        countsTowardHours: true,
        reason: "You set this category yourself.",
      },
      event,
    );
  }

  /* ── A cancelled meeting is not time you spent ─────────────────────── */
  if (event.isCancelled) {
    return applyToggle(
      {
        categoryId: event.categoryId,
        source: "unclassified",
        countsTowardHours: false,
        reason: "Cancelled, so it doesn't count toward hours.",
      },
      event,
    );
  }

  /* ── The whole calendar can be excluded ────────────────────────────── */
  if (!calendar.countsTowardHours) {
    return applyToggle(
      {
        categoryId: null,
        source: "calendar",
        countsTowardHours: false,
        reason: `“${calendar.name}” is excluded from hours.`,
      },
      event,
    );
  }

  /* ── 3. Keyword rules, in the owner's order ────────────────────────── */
  const rules = [...(options.rules ?? [])]
    .filter((rule) => rule.isEnabled)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  for (const rule of rules) {
    if (!matchesRule(event, rule)) continue;

    return applyToggle(
      {
        categoryId: rule.categoryId ?? calendar.defaultCategoryId,
        source: "rule",
        countsTowardHours: rule.countsTowardHours,
        reason: rule.countsTowardHours
          ? `Matched your rule “${rule.pattern}” in the ${rule.field}.`
          : `Excluded by your rule “${rule.pattern}” in the ${rule.field}.`,
        matchedRuleId: rule.id,
      },
      event,
    );
  }

  /* ── 4. Attendee and meeting-type cues ─────────────────────────────── */
  //
  // Deliberately only two, and only where the signal is strong enough to be
  // worth a guess: a two-person meeting is a one-to-one, and a meeting with
  // someone outside your domains is external. Anything cleverer — "eight
  // people means it's strategic" — is a guess dressed as a rule, and the
  // owner would spend their time correcting it.
  const cues = options.categoryIdBySlug ?? {};

  if (event.isExternal && cues["stakeholder-board"]) {
    return applyToggle(
      {
        categoryId: cues["stakeholder-board"],
        source: "attendees",
        countsTowardHours: true,
        reason: "Someone outside your organisation is invited.",
      },
      event,
    );
  }

  if (event.attendeeCount === 2 && cues["people-team"]) {
    return applyToggle(
      {
        categoryId: cues["people-team"],
        source: "attendees",
        countsTowardHours: true,
        reason: "A two-person meeting, so it looks like a one-to-one.",
      },
      event,
    );
  }

  /* ── 5. The calendar's default ─────────────────────────────────────── */
  if (calendar.defaultCategoryId) {
    return applyToggle(
      {
        categoryId: calendar.defaultCategoryId,
        source: "calendar",
        countsTowardHours: true,
        reason: `The default category for “${calendar.name}”.`,
      },
      event,
    );
  }

  /* ── 6. Nothing matched ────────────────────────────────────────────── */
  return applyToggle(
    {
      categoryId: null,
      source: "unclassified",
      countsTowardHours: false,
      reason:
        "No category yet, so it isn't counted. Set one, or add a rule, to include it.",
    },
    event,
  );
}

/**
 * The event-level include/exclude toggle, applied last.
 *
 * It is a manual act, so it beats everything automatic — in both directions.
 * It changes only whether the event counts, never its category: "don't count
 * this one" and "this isn't strategy work" are different statements.
 */
function applyToggle(
  classification: Classification,
  event: ClassifiableEvent,
): Classification {
  if (event.hoursInclude === null || event.hoursInclude === undefined) {
    return classification;
  }

  return {
    ...classification,
    countsTowardHours: event.hoursInclude,
    reason: event.hoursInclude
      ? `${classification.reason} You included it in hours.`
      : `${classification.reason} You excluded it from hours.`,
  };
}

function matchesRule(event: ClassifiableEvent, rule: CategoryRule): boolean {
  // Plain, case-insensitive substring matching. Deliberately not a regular
  // expression: these are edited in a text box by someone who wants "board"
  // to match "Board review", and a regex is a footgun with no upside.
  const needle = rule.pattern.trim().toLowerCase();
  if (needle === "") return false;

  switch (rule.field) {
    case "title":
      return event.title.toLowerCase().includes(needle);
    case "location":
      return (event.location ?? "").toLowerCase().includes(needle);
    case "organizer":
      return (event.organizerAddress ?? "").toLowerCase().includes(needle);
    case "attendee":
      return event.attendeeAddresses.some((address) =>
        address.toLowerCase().includes(needle),
      );
  }
}

/** Whether re-running the classifier would change what is stored. */
export function classificationChanged(
  event: ClassifiableEvent,
  next: Classification,
): boolean {
  return (
    event.categoryId !== next.categoryId || event.categorySource !== next.source
  );
}

export const CLASSIFICATION_SOURCE_LABELS: Record<
  ClassificationSource,
  string
> = {
  manual: "Set by you",
  rule: "Matched a rule",
  attendees: "From the attendees",
  calendar: "From the calendar",
  unclassified: "Not classified",
};
