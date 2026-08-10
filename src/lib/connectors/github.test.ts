import { describe, expect, it } from "vitest";

import { createGitHubConnector, parseGitHubUrl } from "./github";
import { ConnectorError } from "./types";

/**
 * The GitHub connector.
 *
 * Driven against fixture responses through the injected `fetch`, so the real
 * parsing and mapping code runs. Mocking the module instead would test that
 * the mock returns what the mock was told to return.
 */

/** A fetch that answers from a table, and records what was asked for. */
function stubFetch(
  routes: Record<
    string,
    { status?: number; body?: unknown; headers?: Record<string, string> }
  >,
) {
  const calls: string[] = [];

  const fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);

    // `includes`, not `endsWith`: a search URL ends with its query string,
    // so an endsWith table can never match one.
    const match = Object.keys(routes).find((path) => url.includes(path));
    const route = match ? routes[match] : { status: 404 };

    return new Response(route.body ? JSON.stringify(route.body) : "{}", {
      status: route.status ?? 200,
      headers: route.headers,
    });
  }) as typeof globalThis.fetch;

  return { fetch, calls };
}

function connector(
  routes: Parameters<typeof stubFetch>[0] = {},
  over: { baseUrl?: string | null } = {},
) {
  const { fetch, calls } = stubFetch(routes);
  return {
    github: createGitHubConnector({ token: "t", fetch, ...over }),
    calls,
  };
}

/* ── URLs ─────────────────────────────────────────────────────────────── */

describe("recognising a URL", () => {
  it("reads an issue", () => {
    expect(parseGitHubUrl("https://github.com/acme/api/issues/12")).toEqual({
      owner: "acme",
      repo: "api",
      kind: "issue",
      ref: "12",
    });
  });

  it("reads a pull request", () => {
    expect(parseGitHubUrl("https://github.com/acme/api/pull/482")).toEqual({
      owner: "acme",
      repo: "api",
      kind: "pull_request",
      ref: "482",
    });
  });

  it("reads a release, with or without the /tag/ segment", () => {
    expect(
      parseGitHubUrl("https://github.com/acme/api/releases/tag/v1.2.3")?.ref,
    ).toBe("v1.2.3");
    expect(
      parseGitHubUrl("https://github.com/acme/api/releases/v1.2.3")?.ref,
    ).toBe("v1.2.3");
  });

  it("reads a commit and a bare repository", () => {
    expect(parseGitHubUrl("https://github.com/acme/api/commit/abc123")).toEqual(
      {
        owner: "acme",
        repo: "api",
        kind: "commit",
        ref: "abc123",
      },
    );

    expect(parseGitHubUrl("https://github.com/acme/api")).toEqual({
      owner: "acme",
      repo: "api",
      kind: "repository",
      ref: null,
    });
  });

  it("ignores query strings and fragments", () => {
    // A URL copied from a browser almost always has one.
    expect(
      parseGitHubUrl(
        "https://github.com/acme/api/pull/482?diff=split#discussion_r1",
      )?.ref,
    ).toBe("482");
  });

  it("tolerates surrounding whitespace, because paste does", () => {
    expect(parseGitHubUrl("  https://github.com/acme/api/pull/482  ")).not.toBe(
      null,
    );
  });

  it("refuses a lookalike host", () => {
    // The reason hosts are compared rather than pattern-matched. A link to
    // `github.com.evil.test` must not be treated as yours.
    expect(parseGitHubUrl("https://github.com.evil.test/acme/api/pull/1")).toBe(
      null,
    );
    expect(parseGitHubUrl("https://notgithub.com/acme/api/pull/1")).toBe(null);
  });

  it("refuses a GitHub page that is not a linkable object", () => {
    expect(parseGitHubUrl("https://github.com/acme/api/settings")).toBe(null);
    expect(parseGitHubUrl("https://github.com/acme")).toBe(null);
  });

  it("refuses something that is not a URL at all", () => {
    expect(parseGitHubUrl("acme/api#482")).toBe(null);
    expect(parseGitHubUrl("")).toBe(null);
  });

  it("accepts an enterprise host when one is configured, and only then", () => {
    const base = "https://ghe.example.test/api/v3";

    expect(
      parseGitHubUrl("https://ghe.example.test/acme/api/pull/7", base),
    ).not.toBe(null);

    // github.com is *not* implicitly trusted once an enterprise host is set:
    // an enterprise install is a different universe of repositories, and
    // resolving a public URL against an internal token would leak the token's
    // existence to nobody's benefit.
    expect(parseGitHubUrl("https://github.com/acme/api/pull/7", base)).toBe(
      null,
    );
  });
});

/* ── Resolving ────────────────────────────────────────────────────────── */

describe("resolving a pull request", () => {
  const merged = {
    node_id: "PR_kwDO",
    number: 482,
    title: "Rotate the signing keys",
    html_url: "https://github.com/acme/api/pull/482",
    state: "closed",
    merged_at: "2026-08-09T10:00:00Z",
    updated_at: "2026-08-09T10:00:00Z",
    user: { login: "someone" },
    pull_request: {},
    labels: [{ name: "security" }],
  };

  it("maps it to a reference", async () => {
    const { github } = connector({
      "/repos/acme/api/issues/482": { body: merged },
    });

    const ref = await github.resolve("https://github.com/acme/api/pull/482");

    expect(ref).toMatchObject({
      provider: "github",
      kind: "pull_request",
      remoteId: "PR_kwDO",
      title: "Rotate the signing keys",
      subtitle: "acme/api#482",
      author: "someone",
    });
  });

  it("calls it merged, not closed", async () => {
    // `state: "closed"` covers both merged and rejected, and those are very
    // different things to see on a dashboard.
    const { github } = connector({
      "/repos/acme/api/issues/482": { body: merged },
    });

    expect(
      (await github.resolve("https://github.com/acme/api/pull/482")).state,
    ).toBe("merged");
  });

  it("calls a closed-unmerged pull request closed", async () => {
    const { github } = connector({
      "/repos/acme/api/issues/9": {
        body: { ...merged, number: 9, merged_at: null, state: "closed" },
      },
    });

    expect(
      (await github.resolve("https://github.com/acme/api/pull/9")).state,
    ).toBe("closed");
  });

  it("marks a draft as in progress rather than open", async () => {
    const { github } = connector({
      "/repos/acme/api/issues/10": {
        body: {
          ...merged,
          number: 10,
          state: "open",
          merged_at: null,
          draft: true,
        },
      },
    });

    const ref = await github.resolve("https://github.com/acme/api/pull/10");
    expect(ref.state).toBe("in_progress");
    expect(ref.stateDetail).toBe("Draft");
  });

  it("keeps labels but never the body", async () => {
    // Mirroring GitHub's prose into a second database would make this a worse
    // GitHub and a much larger thing to keep private.
    const { github } = connector({
      "/repos/acme/api/issues/482": {
        body: {
          ...merged,
          body: "A very long description that must not be stored",
        },
      },
    });

    const ref = await github.resolve("https://github.com/acme/api/pull/482");

    expect(ref.snapshot).toEqual({ labels: ["security"] });
    expect(JSON.stringify(ref)).not.toContain("must not be stored");
  });
});

describe("resolving other kinds", () => {
  it("distinguishes 'not planned' from 'done' on a closed issue", async () => {
    const { github } = connector({
      "/repos/acme/api/issues/3": {
        body: {
          number: 3,
          title: "Support IE11",
          state: "closed",
          state_reason: "not_planned",
        },
      },
    });

    const ref = await github.resolve("https://github.com/acme/api/issues/3");
    expect(ref.state).toBe("closed");
    expect(ref.stateDetail).toBe("Not planned");
  });

  it("uses only a commit's subject line", async () => {
    const { github } = connector({
      "/repos/acme/api/commits/abc1234": {
        body: {
          sha: "abc1234def",
          commit: {
            message: "Fix the thing\n\nA long body that is not a title",
            author: { name: "Someone", date: "2026-08-01T00:00:00Z" },
          },
        },
      },
    });

    const ref = await github.resolve(
      "https://github.com/acme/api/commit/abc1234",
    );

    expect(ref.title).toBe("Fix the thing");
    expect(ref.subtitle).toBe("acme/api abc1234");
  });

  it("marks an archived repository as archived", async () => {
    const { github } = connector({
      "/repos/acme/legacy": {
        body: {
          full_name: "acme/legacy",
          archived: true,
          owner: { login: "acme" },
        },
      },
    });

    expect((await github.resolve("https://github.com/acme/legacy")).state).toBe(
      "archived",
    );
  });

  it("falls back to the tag when a release has no name", async () => {
    const { github } = connector({
      "/repos/acme/api/releases/tags/v2.0.0": {
        body: {
          name: null,
          tag_name: "v2.0.0",
          published_at: "2026-08-01T00:00:00Z",
        },
      },
    });

    const ref = await github.resolve(
      "https://github.com/acme/api/releases/tag/v2.0.0",
    );
    expect(ref.title).toBe("v2.0.0");
  });
});

/* ── Failure ──────────────────────────────────────────────────────────── */

describe("when GitHub says no", () => {
  it("refuses an unrecognised URL without a request", async () => {
    const { github, calls } = connector();

    await expect(github.resolve("https://example.test/thing")).rejects.toThrow(
      ConnectorError,
    );
    expect(calls).toEqual([]);
  });

  it("reports an expired token as auth, not as missing", async () => {
    const { github } = connector({
      "/repos/acme/api/issues/1": { status: 401 },
    });

    await expect(
      github.resolve("https://github.com/acme/api/issues/1"),
    ).rejects.toMatchObject({ kind: "auth" });
  });

  it("tells rate limiting apart from forbidden, which share a status", async () => {
    const limited = connector({
      "/repos/acme/api/issues/1": {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      },
    });

    await expect(
      limited.github.resolve("https://github.com/acme/api/issues/1"),
    ).rejects.toMatchObject({ kind: "rate_limited" });

    const forbidden = connector({
      "/repos/acme/api/issues/1": {
        status: 403,
        headers: { "x-ratelimit-remaining": "4999" },
      },
    });

    await expect(
      forbidden.github.resolve("https://github.com/acme/api/issues/1"),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("keeps the cache on an outage and drops it on a deletion", async () => {
    // The distinction the whole error type exists for: "we could not look" is
    // not "it is gone", and rendering a deleted PR as open forever is worse
    // than showing nothing.
    const down = connector({ "/repos/acme/api/issues/1": { status: 503 } });
    await expect(
      down.github.resolve("https://github.com/acme/api/issues/1"),
    ).rejects.toMatchObject({ kind: "unavailable", keepCache: true });

    const gone = connector({ "/repos/acme/api/issues/1": { status: 404 } });
    await expect(
      gone.github.resolve("https://github.com/acme/api/issues/1"),
    ).rejects.toMatchObject({ kind: "not_found", keepCache: false });
  });

  it("treats a network failure as unavailable, not unknown", async () => {
    const github = createGitHubConnector({
      token: "t",
      fetch: (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof fetch,
    });

    await expect(
      github.resolve("https://github.com/acme/api/issues/1"),
    ).rejects.toMatchObject({ kind: "unavailable", keepCache: true });
  });
});

/* ── Search ───────────────────────────────────────────────────────────── */

describe("search", () => {
  it("returns references, with the repository derived from the URL", async () => {
    const { github } = connector({
      "/search/issues?q=signing%20keys&per_page=10": {
        body: {
          items: [
            {
              number: 482,
              title: "Rotate the signing keys",
              html_url: "https://github.com/acme/api/pull/482",
              state: "open",
              pull_request: {},
              user: { login: "someone" },
            },
          ],
        },
      },
    });

    const results = await github.search!({ query: "signing keys" });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: "pull_request",
      subtitle: "acme/api#482",
      state: "open",
    });
  });

  it("does not call out for an empty query", async () => {
    const { github, calls } = connector();
    expect(await github.search!({ query: "   " })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("caps the page size GitHub is asked for", async () => {
    const { github, calls } = connector({
      "/search/issues": { body: { items: [] } },
    });
    await github.search!({ query: "x", limit: 500 });

    expect(calls[0]).toContain("per_page=50");
  });
});

/* ── Refresh ──────────────────────────────────────────────────────────── */

describe("refresh", () => {
  it("re-fetches from a stored URL", async () => {
    const { github } = connector({
      "/repos/acme/api/issues/482": {
        body: {
          number: 482,
          title: "Now merged",
          state: "closed",
          merged_at: "x",
          pull_request: {},
        },
      },
    });

    const ref = await github.refresh("https://github.com/acme/api/pull/482");
    expect(ref.state).toBe("merged");
  });

  it("re-fetches from an owner/repo#number id", async () => {
    const { github } = connector({
      "/repos/acme/api/issues/12": {
        body: { number: 12, title: "Issue", state: "open" },
      },
    });

    expect((await github.refresh("acme/api#12")).title).toBe("Issue");
  });

  it("says so plainly when an id cannot be refreshed", async () => {
    // A GitHub node id cannot be turned back into a REST request. Better an
    // explicit "re-add it" than a silent failure to ever update.
    const { github } = connector();

    await expect(github.refresh("PR_kwDOabc123")).rejects.toMatchObject({
      kind: "unsupported",
    });
  });
});

describe("capabilities", () => {
  it("declares what it can do rather than failing when asked", () => {
    const { github } = connector();

    expect(github.capabilities.resolveUrl).toBe(true);
    expect(github.capabilities.search).toBe(true);
    expect(github.capabilities.state).toBe(true);
    expect(github.capabilities.webhooks).toBe(false);
    expect(github.capabilities.limitations.length).toBeGreaterThan(0);
  });
});
