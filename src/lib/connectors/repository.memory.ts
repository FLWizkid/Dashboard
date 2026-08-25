import { randomUUID } from "node:crypto";

import {
  dueForRefresh,
  type ExternalAccount,
  type ExternalLink,
  type ExternalLinkRelation,
  type ExternalRef,
  type LinkedRef,
} from "./model";
import {
  AlreadyLinkedError,
  LinkNotFoundError,
  RefNotFoundError,
  type ConnectorRepository,
} from "./repository";
import type { ResolvedRef } from "./types";

/**
 * In-process repository, for end-to-end tests.
 *
 * Not a mock. It enforces the same invariants the migration does — one
 * reference per `(provider, remoteId)`, exactly one subject per link, no
 * duplicate attachment, no confirming on the owner's behalf — because **an
 * end-to-end suite that passes against a permissive fake is a statement about
 * nothing.** If this accepted a second copy of a pull request, the tests would
 * be green while the database was the only thing holding the line.
 */
interface MemoryStore {
  accounts: ExternalAccount[];
  refs: ExternalRef[];
  links: ExternalLink[];
}

const STORE_KEY = Symbol.for("dashboard.memoryConnectorStore");

function getStore(): MemoryStore {
  const globalStore = globalThis as typeof globalThis & {
    [STORE_KEY]?: MemoryStore;
  };

  globalStore[STORE_KEY] ??= { accounts: [], refs: [], links: [] };
  return globalStore[STORE_KEY];
}

/** Test-only reset hook, exposed through the E2E route handler. */
/** Seeds external context — references and what they are attached to. */
export function seedMemoryConnectors(input: {
  accounts?: ExternalAccount[];
  refs?: ExternalRef[];
  links?: ExternalLink[];
}): void {
  const store = getStore();
  if (input.accounts) store.accounts = [...input.accounts];
  if (input.refs) store.refs = [...input.refs];
  if (input.links) store.links = [...input.links];
}

export function resetMemoryConnectorStore(): void {
  const store = getStore();
  store.accounts = [];
  store.refs = [];
  store.links = [];
}

function withRef(link: ExternalLink): LinkedRef {
  const ref = getStore().refs.find((candidate) => candidate.id === link.refId);
  if (!ref) throw new RefNotFoundError(link.refId);
  return { ...link, ref };
}

export const memoryConnectorRepository: ConnectorRepository = {
  /* ── Accounts ─────────────────────────────────────────────────────── */

  async listAccounts() {
    return [...getStore().accounts];
  },

  async getAccount(provider) {
    return (
      getStore().accounts.find((account) => account.provider === provider) ??
      null
    );
  },

  async saveAccount(input) {
    const store = getStore();
    const existing = store.accounts.find(
      (account) => account.provider === input.provider,
    );

    const account: ExternalAccount = {
      id: existing?.id ?? randomUUID(),
      provider: input.provider,
      accountLabel: input.accountLabel,
      baseUrl: input.baseUrl ?? null,
      isEnabled: input.isEnabled ?? true,
      lastSyncedAt: existing?.lastSyncedAt ?? null,
      lastError: existing?.lastError ?? null,
    };

    store.accounts = [
      ...store.accounts.filter((item) => item.provider !== input.provider),
      account,
    ];

    return account;
  },

  async recordAccountResult(provider, result) {
    const store = getStore();
    store.accounts = store.accounts.map((account) =>
      account.provider === provider
        ? {
            ...account,
            lastSyncedAt: new Date().toISOString(),
            lastError: result.error,
          }
        : account,
    );
  },

  async removeAccount(provider) {
    const store = getStore();
    store.accounts = store.accounts.filter(
      (account) => account.provider !== provider,
    );
  },

  /* ── References ───────────────────────────────────────────────────── */

  async upsertRef(resolved: ResolvedRef) {
    const store = getStore();
    const now = new Date().toISOString();

    const existing = store.refs.find(
      (ref) =>
        ref.provider === resolved.provider &&
        ref.remoteId === resolved.remoteId,
    );

    const ref: ExternalRef = {
      id: existing?.id ?? randomUUID(),
      provider: resolved.provider,
      kind: resolved.kind,
      remoteId: resolved.remoteId,
      url: resolved.url,
      title: resolved.title,
      subtitle: resolved.subtitle,
      state: resolved.state,
      stateDetail: resolved.stateDetail,
      author: resolved.author,
      remoteUpdatedAt: resolved.remoteUpdatedAt,
      fetchedAt: now,
      // A successful fetch clears the last failure. Leaving it would make the
      // interface keep explaining a problem that has gone away.
      fetchError: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    store.refs = [
      ...store.refs.filter((candidate) => candidate.id !== ref.id),
      ref,
    ];

    return ref;
  },

  async recordRefFailure(id, error) {
    const store = getStore();
    const index = store.refs.findIndex((ref) => ref.id === id);
    if (index === -1) throw new RefNotFoundError(id);

    store.refs[index] = {
      ...store.refs[index],
      // Deliberately keeps title and state: the point of recording a failure
      // rather than clearing the row is that yesterday's answer is better
      // than none, as long as it is labelled.
      fetchedAt: new Date().toISOString(),
      fetchError: error,
      updatedAt: new Date().toISOString(),
    };
  },

  async getRef(id) {
    return getStore().refs.find((ref) => ref.id === id) ?? null;
  },

  async staleRefs(limit) {
    const now = new Date();
    return getStore()
      .refs.filter((ref) => dueForRefresh(ref, now))
      .sort((a, b) => (a.fetchedAt ?? "").localeCompare(b.fetchedAt ?? ""))
      .slice(0, limit);
  },

  async searchRefs(query, limit) {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    return getStore()
      .refs.filter((ref) =>
        [ref.title, ref.subtitle, ref.author]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(needle)),
      )
      .slice(0, limit);
  },

  /* ── Links ────────────────────────────────────────────────────────── */

  async linksForTask(taskId) {
    return getStore()
      .links.filter((link) => link.taskId === taskId)
      .map(withRef);
  },

  async linksForNote(noteId) {
    return getStore()
      .links.filter((link) => link.noteId === noteId)
      .map(withRef);
  },

  async allLinks(limit) {
    return getStore()
      .links.slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(withRef);
  },

  async linkRef(input) {
    const store = getStore();

    // The check constraint, enforced here too.
    const hasTask = Boolean(input.taskId);
    const hasNote = Boolean(input.noteId);
    if (hasTask === hasNote) {
      throw new Error("A link must have exactly one subject");
    }

    if (!store.refs.some((ref) => ref.id === input.refId)) {
      throw new RefNotFoundError(input.refId);
    }

    // The partial unique indexes. A double-click is a normal thing for a
    // person to do, and it must not leave two identical chips on a row.
    const duplicate = store.links.find(
      (link) =>
        link.refId === input.refId &&
        link.taskId === (input.taskId ?? null) &&
        link.noteId === (input.noteId ?? null),
    );
    if (duplicate) throw new AlreadyLinkedError(withRef(duplicate));

    const link: ExternalLink = {
      id: randomUUID(),
      refId: input.refId,
      taskId: input.taskId ?? null,
      noteId: input.noteId ?? null,
      relation: (input.relation ?? "about") as ExternalLinkRelation,
      confirmedAt: input.confirmed ? new Date().toISOString() : null,
      createdAt: new Date().toISOString(),
    };

    store.links.push(link);
    return withRef(link);
  },

  async confirmLink(id) {
    const store = getStore();
    const index = store.links.findIndex((link) => link.id === id);
    if (index === -1) throw new LinkNotFoundError(id);

    store.links[index] = {
      ...store.links[index],
      confirmedAt: store.links[index].confirmedAt ?? new Date().toISOString(),
    };

    return withRef(store.links[index]);
  },

  async unlink(id) {
    const store = getStore();
    store.links = store.links.filter((link) => link.id !== id);
  },

  async changedSince(since, limit) {
    const cutoff = since.getTime();

    return getStore()
      .links.map(withRef)
      .filter((link) => {
        if (!link.ref.remoteUpdatedAt) return false;
        const changed = Date.parse(link.ref.remoteUpdatedAt);
        return Number.isFinite(changed) && changed > cutoff;
      })
      .sort((a, b) =>
        (b.ref.remoteUpdatedAt ?? "").localeCompare(
          a.ref.remoteUpdatedAt ?? "",
        ),
      )
      .slice(0, limit);
  },
};
