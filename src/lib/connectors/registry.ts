import "server-only";

import { isMemoryMode } from "@/lib/data-mode";

import { createGitHubConnector, parseGitHubUrl } from "./github";
import type { ExternalProvider } from "./model";
import { ConnectorError, type Connector, type ResolvedRef } from "./types";

/**
 * Building a connector for a provider, on the server.
 *
 * `server-only` at the top is not decoration: this module reads access tokens
 * out of the environment, and importing it from a client component would put
 * one in a browser bundle. The import fails the build instead.
 *
 * ── Where the token comes from ───────────────────────────────────────────
 * An environment variable on the box, not the database.
 *
 * That is a smaller choice than it looks, and it is deliberate for a
 * single-user product: a GitHub personal access token is one long-lived
 * secret with no refresh cycle, so the encrypted credential store — which
 * exists to hold *rotating* OAuth tokens and to survive a `pg_dump` — buys
 * nothing here that `.env` on a BitLocker volume does not. It also means
 * connecting GitHub needs no OAuth app registration, which is the difference
 * between an integration you can turn on this afternoon and one that waits
 * for a form.
 *
 * When a connector arrives that genuinely needs OAuth — Slack and Zoom both
 * will — it uses the credential store, and this function grows a branch
 * rather than the store being retrofitted.
 */

const TOKEN_ENV: Record<ExternalProvider, string> = {
  github: "GITHUB_TOKEN",
};

const BASE_URL_ENV: Record<ExternalProvider, string> = {
  github: "GITHUB_API_URL",
};

export interface ConnectorAvailability {
  provider: ExternalProvider;
  /** Whether a token is configured at all. */
  configured: boolean;
  /** Set when it is not, so the interface can say what to do. */
  reason?: string;
}

export function connectorAvailability(
  provider: ExternalProvider,
): ConnectorAvailability {
  if (isMemoryMode()) return { provider, configured: true };

  const token = process.env[TOKEN_ENV[provider]];

  if (!token) {
    return {
      provider,
      configured: false,
      reason: `Set ${TOKEN_ENV[provider]} on the box to connect ${provider}.`,
    };
  }

  return { provider, configured: true };
}

/**
 * The connector for a provider, or a `ConnectorError` explaining why not.
 *
 * Throws rather than returning null so every caller has to deal with the
 * unconfigured case — a silently-null connector becomes a silently-missing
 * feature, which is how "I linked that PR and nothing happened" happens.
 */
export function getConnector(
  provider: ExternalProvider,
  overrides: { baseUrl?: string | null } = {},
): Connector {
  // End-to-end tests drive the real interface against a connector that
  // answers from a fixture instead of the network. Hermetic on purpose: a
  // suite that reaches github.com fails when GitHub is slow, when a token
  // expires, and on any machine without an outbound route — none of which is
  // a fact about this product. Memory mode cannot activate in a production
  // build (src/lib/data-mode.ts), so this cannot leak onto the box.
  if (isMemoryMode()) {
    return createFixtureConnector(provider);
  }

  const token = process.env[TOKEN_ENV[provider]];

  if (!token) {
    throw new ConnectorError(
      "auth",
      provider,
      `${provider} is not connected. Set ${TOKEN_ENV[provider]} on the box.`,
    );
  }

  const baseUrl =
    overrides.baseUrl ?? process.env[BASE_URL_ENV[provider]] ?? null;

  switch (provider) {
    case "github":
      return createGitHubConnector({ token, baseUrl });
  }
}

/**
 * The connector that recognises a URL, if any.
 *
 * Asked before anything is fetched, so a paste of something nobody handles
 * fails instantly and locally rather than after a timeout. Unconfigured
 * providers are skipped rather than throwing: "GitHub is not connected" is a
 * better answer than nothing, but only once we know the URL *was* GitHub's.
 */
export function connectorForUrl(url: string): Connector | null {
  for (const provider of Object.keys(TOKEN_ENV) as ExternalProvider[]) {
    if (!connectorAvailability(provider).configured) continue;

    const connector = getConnector(provider);
    if (connector.recognises(url)) return connector;
  }

  return null;
}

/* ── The fixture connector ────────────────────────────────────────────── */

/**
 * A connector that answers from a fixture instead of the network.
 *
 * It delegates `recognises` to the real parser, so a malformed link still
 * fails exactly as it would in production — only the HTTP call is replaced.
 *
 * ── Why it overrides `resolve` rather than injecting a fetch ─────────────
 * An injected fetch only sees the *API* path, `/repos/acme/api/issues/1`,
 * which GitHub uses for issues and pull requests alike. A fixture at that
 * level cannot tell them apart, so it has to guess — and the first version of
 * this did, producing a pull request whose link pointed at `/issues/1`. The
 * URL the owner pasted is the only thing that knows, and it is available
 * here.
 *
 * State comes from the number so a spec can be explicit about what it is
 * exercising: 1 open · 2 merged · 3 closed.
 */
function createFixtureConnector(provider: ExternalProvider): Connector {
  const real = createGitHubConnector({ token: "fixture", baseUrl: null });

  function fixtureFor(url: string): ResolvedRef {
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
      throw new ConnectorError(
        "unrecognised",
        provider,
        "That does not look like a GitHub link",
      );
    }

    const number = Number(parsed.ref ?? 1);
    const isPr = parsed.kind === "pull_request";
    const state = number === 2 ? "merged" : number === 3 ? "closed" : "open";

    return {
      provider,
      kind: parsed.kind,
      remoteId: `${parsed.owner}/${parsed.repo}#${parsed.ref}`,
      url,
      title: `Fixture item ${parsed.ref}`,
      subtitle: `${parsed.owner}/${parsed.repo}#${parsed.ref}`,
      state: isPr || parsed.kind === "issue" ? state : "none",
      stateDetail: null,
      author: "fixture-user",
      remoteUpdatedAt: "2026-08-09T10:00:00.000Z",
      snapshot: {},
    };
  }

  return {
    provider,
    capabilities: real.capabilities,
    recognises: real.recognises,
    async resolve(url: string) {
      return fixtureFor(url);
    },
    async refresh(remoteId: string) {
      return fixtureFor(
        remoteId.startsWith("http")
          ? remoteId
          : `https://github.com/${remoteId.replace("#", "/pull/")}`,
      );
    },
    async search({ query, limit = 10 }) {
      return Array.from({ length: Math.min(limit, 2) }, (_, index) =>
        fixtureFor(`https://github.com/acme/api/pull/${index + 1}`),
      ).map((ref) => ({ ...ref, title: `${ref.title} matching ${query}` }));
    },
  };
}
