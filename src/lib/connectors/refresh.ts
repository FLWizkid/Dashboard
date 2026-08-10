/**
 * Keeping cached references honest.
 *
 * Without this, a reference is fetched once when it is pasted and never again.
 * The interface would go on showing "open" for a pull request that merged
 * three weeks ago, and — worse — the morning brief's "what moved elsewhere"
 * would be permanently empty, because nothing would ever observe a change.
 *
 * ── What it refreshes, and what it leaves alone ──────────────────────────
 *
 *   **Settled references are skipped.** Merged, closed and archived are
 *   terminal. Re-fetching them spends the provider's rate limit to learn
 *   nothing, forever, and the number of them only grows.
 *
 *   **Unlinked references are skipped.** A reference nothing points at is on
 *   its way to being purged; refreshing it would keep resetting the clock that
 *   decides when.
 *
 *   **Failing references are retried slowly**, which `dueForRefresh` already
 *   encodes: hammering a provider that just answered 403 does not make it
 *   answer 200.
 *
 * ── Errors are recorded, not thrown ──────────────────────────────────────
 * One reference to a repository whose token lost access must not stop the
 * other forty from refreshing. Each failure is written against its own row,
 * where the interface shows it as "out of date" with the reason — which is
 * the behaviour the freshness design already promises.
 */

import { dueForRefresh, isSettled, type ExternalRef } from "./model";
import type { ConnectorRepository } from "./repository";
import { ConnectorError, type Connector } from "./types";

/** How many references one pass will look at. */
export const REFRESH_BATCH = 25;

/**
 * The three operations a refresh pass needs.
 *
 * Narrower than `ConnectorRepository` on purpose. The scheduled path runs with
 * the service role, where RLS is not filtering and every query must carry its
 * own owner clause; declaring three operations rather than twenty means the
 * adapter that has to get that right is three functions long and can be read
 * in one sitting.
 */
export type RefreshStore = Pick<
  ConnectorRepository,
  "staleRefs" | "upsertRef" | "recordRefFailure"
>;

export interface RefreshOptions {
  repository: RefreshStore;
  /** Resolves a provider to a connector, or null when it is not configured. */
  connectorFor(ref: ExternalRef): Connector | null;
  now?: Date;
  limit?: number;
}

export interface RefreshResult {
  considered: number;
  refreshed: number;
  skipped: { settled: number; fresh: number; noConnector: number };
  failed: { remoteId: string; error: string }[];
}

export async function refreshStaleRefs(
  options: RefreshOptions,
): Promise<RefreshResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? REFRESH_BATCH;

  const candidates = await options.repository.staleRefs(limit);

  const result: RefreshResult = {
    considered: candidates.length,
    refreshed: 0,
    skipped: { settled: 0, fresh: 0, noConnector: 0 },
    failed: [],
  };

  for (const ref of candidates) {
    if (isSettled(ref)) {
      result.skipped.settled += 1;
      continue;
    }

    // `staleRefs` orders by age; whether a row is genuinely due is this
    // module's question, and asking it here means the rule lives in one place
    // rather than being half in SQL.
    if (!dueForRefresh(ref, now)) {
      result.skipped.fresh += 1;
      continue;
    }

    const connector = options.connectorFor(ref);
    if (!connector) {
      // The provider's token was removed. Not a failure of this reference —
      // recording an error against it would make the interface blame the
      // wrong thing.
      result.skipped.noConnector += 1;
      continue;
    }

    try {
      const resolved = await connector.refresh(ref.remoteId);
      await options.repository.upsertRef(resolved);
      result.refreshed += 1;
    } catch (error) {
      const message =
        error instanceof ConnectorError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Unknown error";

      result.failed.push({ remoteId: ref.remoteId, error: message });

      // Recorded against the row rather than discarded: the freshness design
      // already promises that a failure is shown with its reason and does not
      // hide the title. Yesterday's answer beats none, as long as it is
      // labelled.
      await options.repository
        .recordRefFailure(ref.id, message)
        .catch(() => undefined);
    }
  }

  return result;
}
