/**
 * The eight CIO activity categories seeded for every new account.
 *
 * This list MIRRORS `public.seed_default_activity_categories()` in
 * `supabase/migrations/20260805000001_tasks_core.sql`. The database is the
 * thing that actually seeds; this copy exists so the quick-add parser can
 * resolve `#strategic` before any network round-trip, and so a unit test can
 * assert the two never drift. Change both together.
 */
export interface DefaultCategory {
  slug: string;
  name: string;
  description: string;
  color: string;
  position: number;
  /** Extra words the quick-add parser will accept for this category. */
  aliases: string[];
}

export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  {
    slug: "strategic",
    name: "Strategic",
    description: "Roadmap, architecture direction, multi-quarter bets.",
    color: "primary",
    position: 1,
    aliases: ["strategy", "roadmap"],
  },
  {
    slug: "operational",
    name: "Operational",
    description: "Run-the-business: incidents, service health, delivery.",
    color: "primary",
    position: 2,
    aliases: ["ops", "operations", "run"],
  },
  {
    slug: "people-team",
    name: "People & Team",
    description: "1:1s, hiring, performance, org design.",
    color: "accent",
    position: 3,
    aliases: ["people", "team", "hiring", "1on1", "1:1"],
  },
  {
    slug: "stakeholder-board",
    name: "Stakeholder & Board",
    description: "Exec peers, board prep, investor and customer exposure.",
    color: "accent",
    position: 4,
    aliases: ["board", "stakeholder", "stakeholders", "exec"],
  },
  {
    slug: "vendor-budget",
    name: "Vendor & Budget",
    description: "Contracts, renewals, spend, procurement.",
    color: "accent",
    position: 5,
    aliases: ["vendor", "vendors", "budget", "finance", "procurement"],
  },
  {
    slug: "security-risk-compliance",
    name: "Security, Risk & Compliance",
    description: "Security posture, audits, regulatory obligations.",
    color: "danger",
    position: 6,
    aliases: ["security", "risk", "compliance", "audit", "sec"],
  },
  {
    slug: "innovation-rd",
    name: "Innovation & R&D",
    description: "Experiments, evaluations, emerging technology.",
    color: "primary",
    position: 7,
    aliases: ["innovation", "rd", "r&d", "research"],
  },
  {
    slug: "admin-inbox",
    name: "Admin & Inbox",
    description: "Approvals, expenses, correspondence, everything else.",
    color: "muted",
    position: 8,
    aliases: ["admin", "inbox", "misc"],
  },
] as const;

export const DEFAULT_CATEGORY_SLUGS = DEFAULT_CATEGORIES.map((c) => c.slug);
