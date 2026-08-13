/**
 * The connector contract.
 *
 * A connector turns something outside this product into a reference the
 * dashboard can show next to a task or a note. GitHub is the first one; Slack,
 * Zoom, Drive and SharePoint are the reason this is an interface rather than a
 * GitHub client with a nice name.
 *
 * Modelled on the mail adapter contract (`src/lib/mail/adapters/types.ts`) and
 * for the same reason: **providers are not equally capable, and the honest way
 * to handle that is to declare it rather than to fail at the moment the owner
 * clicks something.** Slack cannot give you a "state"; Drive has no notion of
 * open or merged; a Zoom recording has an author and no assignee. The
 * interface asks what a connector can do and shows only that.
 *
 * ── One rule that is not negotiable ──────────────────────────────────────
 * **Connectors run on the server. Always.** The Content Security Policy sets
 * `connect-src 'self'`, so the browser cannot reach a provider even if
 * something tried — and that is the point rather than an obstacle: it is what
 * keeps access tokens on the box. Every function here is called from a route
 * handler or a scheduled job, never from a component.
 */

import type {
  ExternalProvider,
  ExternalRefKind,
  ExternalRefState,
} from "./model";

/* ── Capabilities ─────────────────────────────────────────────────────── */

export interface ConnectorCapabilities {
  /** A URL from this provider can be turned into a reference. */
  resolveUrl: boolean;
  /** The provider can be searched, rather than only linked to directly. */
  search: boolean;
  /** A stored reference can be re-fetched to pick up a state change. */
  refresh: boolean;
  /**
   * The provider reports a meaningful state — open, merged, closed.
   *
   * False for things that simply exist, like a document or a message. The
   * interface hides the state column entirely rather than showing a row of
   * "—", which reads as missing data instead of not-applicable.
   */
  state: boolean;
  /** Changes can be received rather than polled for. Nothing uses this yet. */
  webhooks: boolean;
  /**
   * Human-readable constraints, shown in the connector settings.
   * Anything a reasonable owner would be surprised by belongs here.
   */
  limitations: string[];
}

/* ── Errors ───────────────────────────────────────────────────────────── */

export type ConnectorErrorKind =
  /** The token is invalid, revoked, or lacks the scope. Needs the owner. */
  | "auth"
  /** The reference exists but this token may not see it. */
  | "forbidden"
  /** It is gone, or never existed. */
  | "not_found"
  /** Rate limited. `retryAfterMs` is set when the provider said so. */
  | "rate_limited"
  /** The provider is unreachable. Cached data stays valid. */
  | "unavailable"
  /** This connector cannot do that at all — see capabilities. */
  | "unsupported"
  /** The URL is not one this connector recognises. */
  | "unrecognised"
  /** Anything else. */
  | "unknown";

export class ConnectorError extends Error {
  readonly kind: ConnectorErrorKind;
  readonly provider: ExternalProvider;
  readonly retryAfterMs?: number;

  /**
   * Whether previously cached data should still be shown.
   *
   * The distinction that matters: `unavailable` means "we could not look, keep
   * showing what we had"; `not_found` means "it is gone, stop pretending".
   * Rendering a deleted pull request as open indefinitely is worse than
   * showing nothing.
   */
  readonly keepCache: boolean;

  constructor(
    kind: ConnectorErrorKind,
    provider: ExternalProvider,
    message: string,
    options: { retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ConnectorError";
    this.kind = kind;
    this.provider = provider;
    this.retryAfterMs = options.retryAfterMs;
    this.keepCache = kind !== "not_found" && kind !== "forbidden";
  }
}

/* ── What a connector returns ─────────────────────────────────────────── */

/**
 * A reference as the provider describes it, before it is stored.
 *
 * Deliberately not the database row: no id, no owner, no timestamps of ours.
 * A connector's job ends at "here is what this thing is".
 */
export interface ResolvedRef {
  provider: ExternalProvider;
  kind: ExternalRefKind;
  /** Stable across renames. Never the title, never the URL. */
  remoteId: string;
  url: string;
  title: string;
  subtitle: string | null;
  state: ExternalRefState;
  stateDetail: string | null;
  author: string | null;
  /** When the provider last saw a change, not when we looked. */
  remoteUpdatedAt: string | null;
  /** Anything this model does not carry. Never rendered blindly. */
  snapshot: Record<string, unknown>;
}

export interface SearchOptions {
  query: string;
  limit?: number;
}

/* ── The connector ────────────────────────────────────────────────────── */

export interface Connector {
  readonly provider: ExternalProvider;
  readonly capabilities: ConnectorCapabilities;

  /**
   * Does this connector recognise the URL?
   *
   * Pure and synchronous, so the interface can decide which connector to hand
   * a pasted URL to without a network call — and so a paste of something
   * nobody handles fails instantly rather than after a timeout.
   */
  recognises(url: string): boolean;

  /** Turn a recognised URL into a reference. Throws `ConnectorError`. */
  resolve(url: string): Promise<ResolvedRef>;

  /** Re-fetch a stored reference by its remote id. */
  refresh(remoteId: string): Promise<ResolvedRef>;

  /** Search the provider. Only when `capabilities.search`. */
  search?(options: SearchOptions): Promise<ResolvedRef[]>;
}

/** Everything a connector needs from its surroundings. */
export interface ConnectorConfig {
  /** The credential. Never logged, never sent to the browser. */
  token: string;
  /**
   * The API root, for self-hosted or enterprise installs.
   *
   * Null means the provider's public service. A configured value is used
   * verbatim — a connector must not "helpfully" append paths a user did not
   * write, because that is how an internal host becomes a request to
   * somewhere else.
   */
  baseUrl?: string | null;
  /**
   * The fetch to use. Injected so tests drive real code against fixtures
   * rather than mocking the module.
   */
  fetch?: typeof globalThis.fetch;
}
