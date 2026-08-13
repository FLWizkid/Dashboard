/**
 * The GitHub connector.
 *
 * First of the secondary integrations, and chosen first because it is the one
 * whose objects a technical CIO's work actually references: the task is
 * "review the auth migration", and the thing it is about is a pull request.
 *
 * ── Server-side only ─────────────────────────────────────────────────────
 * Nothing here may run in a browser. `connect-src 'self'` would block it, and
 * that is the point — the token stays on the box. Every entry point is called
 * from a route handler or a scheduled job.
 *
 * ── What it deliberately does not do ─────────────────────────────────────
 * It does not store issue or PR *bodies*. The product's job is to tell you
 * that a thing exists, what state it is in and where to click; mirroring
 * GitHub's content into a second database would make this a worse GitHub and
 * a much larger thing to keep private. Titles and states only.
 */

import {
  ConnectorError,
  type Connector,
  type ConnectorCapabilities,
  type ConnectorConfig,
  type ResolvedRef,
  type SearchOptions,
} from "./types";
import type { ExternalRefKind, ExternalRefState } from "./model";

const PUBLIC_API = "https://api.github.com";

export const GITHUB_CAPABILITIES: ConnectorCapabilities = {
  resolveUrl: true,
  search: true,
  refresh: true,
  state: true,
  webhooks: false,
  limitations: [
    "Only issues, pull requests, releases, commits, discussions and repositories are recognised.",
    "Private repositories need a token whose scope includes them; without it the reference resolves to 'not found' rather than a partial result.",
    "Bodies are never stored — titles, state and author only.",
    "Search covers what the token can see, which on a personal token is what you can see.",
  ],
};

/* ── URL parsing ──────────────────────────────────────────────────────── */

/**
 * What a GitHub URL points at.
 *
 * Parsed rather than pattern-matched into an API call, so an unrecognised
 * shape fails immediately and locally instead of after a round trip. This is
 * also the only place that knows GitHub's URL layout.
 */
interface ParsedUrl {
  owner: string;
  repo: string;
  kind: ExternalRefKind;
  /** Issue/PR number, release tag, or commit sha. Null for a repository. */
  ref: string | null;
}

/** The path segment GitHub uses → what it means to us. */
const SEGMENT_KINDS: Record<string, ExternalRefKind> = {
  issues: "issue",
  pull: "pull_request",
  discussions: "discussion",
  commit: "commit",
  releases: "release",
};

export function parseGitHubUrl(
  raw: string,
  baseUrl?: string | null,
): ParsedUrl | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  // An enterprise install is on its own host. Comparing hosts rather than
  // accepting anything is what stops a link to a lookalike domain being
  // treated as yours.
  const expected = expectedHosts(baseUrl);
  if (!expected.includes(url.hostname.toLowerCase())) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const [owner, repo, segment, ...rest] = parts;

  if (!segment) return { owner, repo, kind: "repository", ref: null };

  // `/releases/tag/v1.2.3` — the tag is one deeper than everything else.
  if (segment === "releases") {
    const tag = rest[0] === "tag" ? rest[1] : rest[0];
    if (!tag) return null;
    return { owner, repo, kind: "release", ref: decodeURIComponent(tag) };
  }

  const kind = SEGMENT_KINDS[segment];
  if (!kind) return null;

  const ref = rest[0];
  if (!ref) return null;

  return { owner, repo, kind, ref: decodeURIComponent(ref) };
}

function expectedHosts(baseUrl?: string | null): string[] {
  if (!baseUrl) return ["github.com", "www.github.com"];

  try {
    // An enterprise API root is usually `https://ghe.example/api/v3`, and the
    // web UI is on the same host.
    return [new URL(baseUrl).hostname.toLowerCase()];
  } catch {
    return ["github.com", "www.github.com"];
  }
}

/* ── Mapping ──────────────────────────────────────────────────────────── */

interface IssueResponse {
  node_id?: string;
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
  state_reason?: string | null;
  draft?: boolean;
  merged_at?: string | null;
  updated_at?: string;
  user?: { login?: string } | null;
  pull_request?: unknown;
  labels?: { name?: string }[];
}

/**
 * GitHub's state, normalised.
 *
 * `state: "closed"` on a pull request means merged *or* rejected, and those
 * are very different things to see on a dashboard — so `merged_at` is
 * consulted rather than trusting the word.
 */
function issueState(payload: IssueResponse, isPr: boolean): ExternalRefState {
  if (isPr) {
    if (payload.merged_at) return "merged";
    if (payload.state === "closed") return "closed";
    return payload.draft ? "in_progress" : "open";
  }

  return payload.state === "closed" ? "closed" : "open";
}

function stateDetail(payload: IssueResponse, isPr: boolean): string | null {
  if (isPr && payload.draft) return "Draft";
  // `not_planned` vs `completed` is the difference between "we did it" and
  // "we decided not to", and only one of those is good news.
  if (!isPr && payload.state_reason === "not_planned") return "Not planned";
  return null;
}

/* ── The connector ────────────────────────────────────────────────────── */

export function createGitHubConnector(config: ConnectorConfig): Connector {
  const doFetch = config.fetch ?? globalThis.fetch;
  const api = (config.baseUrl ?? PUBLIC_API).replace(/\/+$/, "");

  async function request<T>(path: string): Promise<T> {
    let response: Response;

    try {
      response = await doFetch(`${api}${path}`, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${config.token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "cio-dashboard",
        },
      });
    } catch (cause) {
      // A network failure is not a missing resource. Cached data stays.
      throw new ConnectorError(
        "unavailable",
        "github",
        "GitHub is unreachable",
        { cause },
      );
    }

    if (response.ok) return (await response.json()) as T;

    throw toConnectorError(response);
  }

  async function resolveParsed(parsed: ParsedUrl): Promise<ResolvedRef> {
    const { owner, repo, kind, ref } = parsed;
    const slug = `${owner}/${repo}`;

    if (kind === "repository") {
      const payload = await request<{
        node_id?: string;
        full_name?: string;
        description?: string | null;
        html_url?: string;
        archived?: boolean;
        pushed_at?: string;
        owner?: { login?: string };
      }>(`/repos/${owner}/${repo}`);

      return {
        provider: "github",
        kind: "repository",
        remoteId: payload.node_id ?? slug,
        url: payload.html_url ?? `https://github.com/${slug}`,
        title: payload.full_name ?? slug,
        subtitle: payload.description ?? null,
        state: payload.archived ? "archived" : "none",
        stateDetail: null,
        author: payload.owner?.login ?? owner,
        remoteUpdatedAt: payload.pushed_at ?? null,
        snapshot: {},
      };
    }

    if (kind === "release") {
      const payload = await request<{
        node_id?: string;
        name?: string | null;
        tag_name?: string;
        html_url?: string;
        published_at?: string | null;
        draft?: boolean;
        prerelease?: boolean;
        author?: { login?: string };
      }>(`/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(ref!)}`);

      return {
        provider: "github",
        kind: "release",
        remoteId: payload.node_id ?? `${slug}@${ref}`,
        url:
          payload.html_url ?? `https://github.com/${slug}/releases/tag/${ref}`,
        title: payload.name || payload.tag_name || String(ref),
        subtitle: `${slug} ${payload.tag_name ?? ref}`,
        state: payload.draft ? "in_progress" : "none",
        stateDetail: payload.prerelease ? "Pre-release" : null,
        author: payload.author?.login ?? null,
        remoteUpdatedAt: payload.published_at ?? null,
        snapshot: {},
      };
    }

    if (kind === "commit") {
      const payload = await request<{
        node_id?: string;
        sha?: string;
        html_url?: string;
        commit?: {
          message?: string;
          author?: { name?: string; date?: string };
        };
      }>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref!)}`);

      const message = payload.commit?.message ?? "";
      const short = (payload.sha ?? ref ?? "").slice(0, 7);

      return {
        provider: "github",
        kind: "commit",
        remoteId: payload.node_id ?? `${slug}@${payload.sha ?? ref}`,
        url: payload.html_url ?? `https://github.com/${slug}/commit/${ref}`,
        // The subject line only. A commit message body is prose we have no
        // business storing, and it makes the chip unreadable.
        title: message.split("\n")[0] || short,
        subtitle: `${slug} ${short}`,
        state: "none",
        stateDetail: null,
        author: payload.commit?.author?.name ?? null,
        remoteUpdatedAt: payload.commit?.author?.date ?? null,
        snapshot: {},
      };
    }

    // Issues, pull requests and discussions all live behind the issues API —
    // GitHub numbers them in one sequence per repository, which is why a PR
    // URL and an issue URL with the same number are the same object.
    const payload = await request<IssueResponse>(
      `/repos/${owner}/${repo}/issues/${encodeURIComponent(ref!)}`,
    );

    const isPr = Boolean(payload.pull_request) || kind === "pull_request";

    return {
      provider: "github",
      kind: isPr ? "pull_request" : kind,
      remoteId: payload.node_id ?? `${slug}#${payload.number ?? ref}`,
      url:
        payload.html_url ??
        `https://github.com/${slug}/${isPr ? "pull" : "issues"}/${ref}`,
      title: payload.title ?? `#${ref}`,
      subtitle: `${slug}#${payload.number ?? ref}`,
      state: issueState(payload, isPr),
      stateDetail: stateDetail(payload, isPr),
      author: payload.user?.login ?? null,
      remoteUpdatedAt: payload.updated_at ?? null,
      snapshot: {
        labels: (payload.labels ?? [])
          .map((label) => label.name)
          .filter((name): name is string => Boolean(name))
          .slice(0, 10),
      },
    };
  }

  return {
    provider: "github",
    capabilities: GITHUB_CAPABILITIES,

    recognises(url: string) {
      return parseGitHubUrl(url, config.baseUrl) !== null;
    },

    async resolve(url: string) {
      const parsed = parseGitHubUrl(url, config.baseUrl);
      if (!parsed) {
        throw new ConnectorError(
          "unrecognised",
          "github",
          "That does not look like a GitHub issue, pull request, release, commit or repository",
        );
      }

      return resolveParsed(parsed);
    },

    async refresh(remoteId: string) {
      // `owner/repo#number` is the only remote id shape we can turn back into
      // a request. A node id cannot be re-fetched from the REST API, so a
      // reference stored under one is refreshed via its URL instead — which
      // the repository does by passing the URL as the id.
      const parsed = parseGitHubUrl(remoteId, config.baseUrl);
      if (parsed) return resolveParsed(parsed);

      const match = /^([^/]+)\/([^#]+)#(\d+)$/.exec(remoteId);
      if (!match) {
        throw new ConnectorError(
          "unsupported",
          "github",
          `Cannot refresh a reference stored as "${remoteId}" — re-add it to pick up changes`,
        );
      }

      return resolveParsed({
        owner: match[1],
        repo: match[2],
        kind: "issue",
        ref: match[3],
      });
    },

    async search({ query, limit = 10 }: SearchOptions) {
      const trimmed = query.trim();
      if (!trimmed) return [];

      const payload = await request<{ items?: IssueResponse[] }>(
        `/search/issues?q=${encodeURIComponent(trimmed)}&per_page=${Math.min(limit, 50)}`,
      );

      return (payload.items ?? []).map((item) => {
        const isPr = Boolean(item.pull_request);
        // Search results carry the API URL, so the repository slug is derived
        // from the html_url rather than assumed.
        const slug = slugFromHtmlUrl(item.html_url) ?? "";

        return {
          provider: "github" as const,
          kind: (isPr ? "pull_request" : "issue") as ExternalRefKind,
          remoteId: item.node_id ?? `${slug}#${item.number}`,
          url: item.html_url ?? "",
          title: item.title ?? `#${item.number}`,
          subtitle: slug ? `${slug}#${item.number}` : null,
          state: issueState(item, isPr),
          stateDetail: stateDetail(item, isPr),
          author: item.user?.login ?? null,
          remoteUpdatedAt: item.updated_at ?? null,
          snapshot: {},
        };
      });
    },
  };
}

function slugFromHtmlUrl(htmlUrl: string | undefined): string | null {
  if (!htmlUrl) return null;
  try {
    const parts = new URL(htmlUrl).pathname.split("/").filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  } catch {
    return null;
  }
}

/**
 * A GitHub response that is not ok, as something the product can act on.
 *
 * The distinction that earns its place: **404 and 403 are not the same.** A
 * token without access to a private repository gets 404, which looks like
 * "deleted" and is actually "not yours to see" — and treating it as deleted
 * would make the interface tell the owner their pull request is gone.
 */
function toConnectorError(response: Response): ConnectorError {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");

  if (response.status === 401) {
    return new ConnectorError(
      "auth",
      "github",
      "GitHub rejected the token. Reconnect the integration.",
    );
  }

  if (response.status === 403 || response.status === 429) {
    // GitHub answers 403 for both "forbidden" and "rate limited", and the
    // remaining-quota header is the only thing that tells them apart.
    if (remaining === "0") {
      const resetMs = reset ? Number(reset) * 1000 - Date.now() : undefined;
      return new ConnectorError(
        "rate_limited",
        "github",
        "GitHub rate limit reached. It will refresh itself shortly.",
        { retryAfterMs: resetMs && resetMs > 0 ? resetMs : undefined },
      );
    }

    return new ConnectorError(
      "forbidden",
      "github",
      "This token may not read that. Check the scopes on the connection.",
    );
  }

  if (response.status === 404) {
    return new ConnectorError(
      "not_found",
      "github",
      "GitHub has no such item, or the token cannot see it.",
    );
  }

  if (response.status >= 500) {
    return new ConnectorError(
      "unavailable",
      "github",
      `GitHub returned ${response.status}. Showing what was last fetched.`,
    );
  }

  return new ConnectorError(
    "unknown",
    "github",
    `GitHub returned ${response.status}`,
  );
}
