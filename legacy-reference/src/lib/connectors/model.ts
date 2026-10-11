/**
 * The shared vocabulary for external context.
 *
 * Kept away from any one connector on purpose. These are the words the
 * interface, the digest and the database all use, and a GitHub concept
 * leaking into them would make the second connector a rewrite.
 */

export const EXTERNAL_PROVIDERS = ["github"] as const;
export type ExternalProvider = (typeof EXTERNAL_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<ExternalProvider, string> = {
  github: "GitHub",
};

/**
 * What a reference *is*.
 *
 * Coarse on purpose: the interface groups by this, and a taxonomy with thirty
 * entries groups into thirty piles of one.
 */
export const EXTERNAL_REF_KINDS = [
  "issue",
  "pull_request",
  "release",
  "repository",
  "commit",
  "discussion",
  "document",
  "message",
  "recording",
  "other",
] as const;
export type ExternalRefKind = (typeof EXTERNAL_REF_KINDS)[number];

export const REF_KIND_LABELS: Record<ExternalRefKind, string> = {
  issue: "Issue",
  pull_request: "Pull request",
  release: "Release",
  repository: "Repository",
  commit: "Commit",
  discussion: "Discussion",
  document: "Document",
  message: "Message",
  recording: "Recording",
  other: "Link",
};

/**
 * Normalised state.
 *
 * `none` is not "unknown" — it means the thing genuinely has no state, like a
 * document or a chat message. The interface hides the column for those rather
 * than printing a dash, which reads as missing data.
 */
export const EXTERNAL_REF_STATES = [
  "none",
  "open",
  "in_progress",
  "blocked",
  "merged",
  "closed",
  "archived",
] as const;
export type ExternalRefState = (typeof EXTERNAL_REF_STATES)[number];

export const REF_STATE_LABELS: Record<ExternalRefState, string> = {
  none: "",
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  merged: "Merged",
  closed: "Closed",
  archived: "Archived",
};

/** How the owner said the reference relates to their work. */
export const EXTERNAL_LINK_RELATIONS = [
  "about",
  "blocked_by",
  "produced",
  "related",
] as const;
export type ExternalLinkRelation = (typeof EXTERNAL_LINK_RELATIONS)[number];

export const LINK_RELATION_LABELS: Record<ExternalLinkRelation, string> = {
  about: "About",
  blocked_by: "Blocked by",
  produced: "Produced",
  related: "Related",
};

/* ── Rows ─────────────────────────────────────────────────────────────── */

export interface ExternalRef {
  id: string;
  provider: ExternalProvider;
  kind: ExternalRefKind;
  remoteId: string;
  url: string;
  title: string;
  subtitle: string | null;
  state: ExternalRefState;
  stateDetail: string | null;
  author: string | null;
  remoteUpdatedAt: string | null;
  /** `null` means never successfully fetched — pasted but not yet resolved. */
  fetchedAt: string | null;
  /** Why the last fetch failed, so staleness can be explained rather than hidden. */
  fetchError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalLink {
  id: string;
  refId: string;
  taskId: string | null;
  noteId: string | null;
  relation: ExternalLinkRelation;
  /** `null` means suggested-but-unconfirmed. Never set automatically. */
  confirmedAt: string | null;
  createdAt: string;
}

/** A link with the reference it points at, which is how the UI wants it. */
export interface LinkedRef extends ExternalLink {
  ref: ExternalRef;
}

export interface ExternalAccount {
  id: string;
  provider: ExternalProvider;
  accountLabel: string;
  baseUrl: string | null;
  isEnabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

/* ── Staleness ────────────────────────────────────────────────────────── */

/**
 * How old a reference's data is allowed to get before it is worth saying so.
 *
 * Six hours rather than minutes: a pull request's state does not usually
 * change between the morning brief and lunch, and a dashboard that constantly
 * announces its own staleness trains you to ignore the indicator — at which
 * point it is not there for the one time it matters.
 */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export type Freshness = "fresh" | "stale" | "never" | "failing";

/**
 * How much to trust what is on screen.
 *
 * `failing` outranks `stale` because a failure is actionable — the token has
 * expired, the repository was renamed — and mere age is not.
 */
export function freshness(ref: ExternalRef, now: Date = new Date()): Freshness {
  if (ref.fetchError) return "failing";
  if (!ref.fetchedAt) return "never";

  const fetched = Date.parse(ref.fetchedAt);
  if (!Number.isFinite(fetched)) return "never";

  return now.getTime() - fetched > STALE_AFTER_MS ? "stale" : "fresh";
}

/**
 * Whether a reference is worth re-fetching now.
 *
 * A failing reference is retried, but not as eagerly as a merely old one —
 * hammering a provider that just returned 403 does not make it return 200.
 */
export function dueForRefresh(
  ref: ExternalRef,
  now: Date = new Date(),
): boolean {
  const state = freshness(ref, now);
  if (state === "never") return true;
  if (state === "fresh") return false;

  if (state === "failing") {
    const fetched = ref.fetchedAt ? Date.parse(ref.fetchedAt) : 0;
    return now.getTime() - fetched > 24 * 60 * 60 * 1000;
  }

  return true;
}

/** Terminal states — nothing more will happen, so stop re-fetching. */
export const SETTLED_STATES: readonly ExternalRefState[] = [
  "merged",
  "closed",
  "archived",
];

export function isSettled(ref: ExternalRef): boolean {
  return SETTLED_STATES.includes(ref.state);
}
