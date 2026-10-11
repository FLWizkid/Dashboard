import { isMemoryMode } from "@/lib/data-mode";

import type {
  ExternalAccount,
  ExternalLinkRelation,
  ExternalProvider,
  ExternalRef,
  LinkedRef,
} from "./model";
import type { ResolvedRef } from "./types";

/**
 * The seam every external-context read and write goes through.
 *
 * Same shape as tasks, notes and hours. Two operations are worth explaining
 * because they exist for reasons the names do not carry:
 *
 * **`upsertRef`** rather than `createRef`. One reference per external thing
 * per owner is a database invariant, and the common case — pasting a PR onto
 * a second task — must reuse the row rather than fail. Two copies of the same
 * pull request would drift, and the interface would show one task an open PR
 * and another the same PR merged.
 *
 * **`staleRefs`** exists so refreshing is pull-based. A job asks "what is
 * worth re-fetching", rather than every render asking the provider — which is
 * the design that turns a dashboard into a rate-limit problem.
 */
export interface ConnectorRepository {
  /* ── Accounts ─────────────────────────────────────────────────────── */

  listAccounts(): Promise<ExternalAccount[]>;
  getAccount(provider: ExternalProvider): Promise<ExternalAccount | null>;
  saveAccount(input: {
    provider: ExternalProvider;
    accountLabel: string;
    baseUrl?: string | null;
    isEnabled?: boolean;
  }): Promise<ExternalAccount>;
  recordAccountResult(
    provider: ExternalProvider,
    result: { error: string | null },
  ): Promise<void>;
  removeAccount(provider: ExternalProvider): Promise<void>;

  /* ── References ───────────────────────────────────────────────────── */

  /** Insert or update by `(provider, remoteId)`. Never creates a duplicate. */
  upsertRef(resolved: ResolvedRef): Promise<ExternalRef>;

  /** Record that a fetch failed, without discarding what we already had. */
  recordRefFailure(id: string, error: string): Promise<void>;

  getRef(id: string): Promise<ExternalRef | null>;

  /** References worth re-fetching, oldest first. */
  staleRefs(limit: number): Promise<ExternalRef[]>;

  /** Full-text over stored titles. Only ever what the owner has linked. */
  searchRefs(query: string, limit: number): Promise<ExternalRef[]>;

  /* ── Links ────────────────────────────────────────────────────────── */

  linksForTask(taskId: string): Promise<LinkedRef[]>;
  linksForNote(noteId: string): Promise<LinkedRef[]>;

  /** Every link across every subject, newest first. For the workspace. */
  allLinks(limit: number): Promise<LinkedRef[]>;

  linkRef(input: {
    refId: string;
    taskId?: string | null;
    noteId?: string | null;
    relation?: ExternalLinkRelation;
    /**
     * Only ever from an explicit act by the owner. A detector must leave this
     * false and let the interface ask — the database refuses a backdated
     * confirmation, but nothing stops a caller confirming *now* on the
     * owner's behalf except this contract and the person reading it.
     */
    confirmed: boolean;
  }): Promise<LinkedRef>;

  confirmLink(id: string): Promise<LinkedRef>;
  unlink(id: string): Promise<void>;

  /**
   * Links whose reference changed after `since`.
   *
   * What the daily brief is built from — and the reason to connect anything
   * in the first place.
   */
  changedSince(since: Date, limit: number): Promise<LinkedRef[]>;
}

export class RefNotFoundError extends Error {
  constructor(id: string) {
    super(`Reference ${id} was not found`);
    this.name = "RefNotFoundError";
  }
}

export class LinkNotFoundError extends Error {
  constructor(id: string) {
    super(`Link ${id} was not found`);
    this.name = "LinkNotFoundError";
  }
}

/**
 * Thrown when the same reference is attached to the same subject twice.
 *
 * A success from the caller's point of view — it is already attached — so the
 * route answers 200 with the existing link rather than an error. Double-click
 * is a normal thing for a person to do.
 */
export class AlreadyLinkedError extends Error {
  constructor(public readonly existing: LinkedRef) {
    super("That is already attached");
    this.name = "AlreadyLinkedError";
  }
}

export async function getConnectorRepository(): Promise<ConnectorRepository> {
  if (isMemoryMode()) {
    const { memoryConnectorRepository } = await import("./repository.memory");
    return memoryConnectorRepository;
  }

  const { createSupabaseConnectorRepository } =
    await import("./repository.supabase");
  return createSupabaseConnectorRepository();
}
