import { randomUUID } from "node:crypto";

import type { DigestKind } from "./digest";
import type { InboxWrite } from "./delivery";
import {
  DEFAULT_DIGEST_SETTINGS,
  InboxMessageNotFoundError,
  type DigestSettings,
  type InboxMessage,
  type ReportRepository,
} from "./repository";

/**
 * In-process report store, for end-to-end tests.
 *
 * It enforces the one invariant the schedule depends on: **a period can only
 * be claimed once.** A fake that let the same morning brief be generated twice
 * would make the E2E suite agree with itself and disagree with the deployment,
 * where a unique index says otherwise.
 */

interface MemoryReportStore {
  inbox: InboxMessage[];
  runs: { kind: DigestKind; periodDate: string }[];
  settings: DigestSettings;
}

const STORE_KEY = Symbol.for("dashboard.memoryReportStore");

function getStore(): MemoryReportStore {
  const globalStore = globalThis as typeof globalThis & {
    [STORE_KEY]?: MemoryReportStore;
  };

  globalStore[STORE_KEY] ??= {
    inbox: [],
    runs: [],
    settings: { ...DEFAULT_DIGEST_SETTINGS },
  };

  return globalStore[STORE_KEY];
}

/** Test-only reset hook, exposed through the E2E route handler. */
export function resetMemoryReportStore(): void {
  const store = getStore();
  store.inbox = [];
  store.runs = [];
  store.settings = { ...DEFAULT_DIGEST_SETTINGS };
}

export const memoryReportRepository: ReportRepository = {
  async writeInbox(message: InboxWrite) {
    const store = getStore();
    const id = randomUUID();

    store.inbox.push({
      id,
      kind: message.kind,
      subject: message.subject,
      preview: message.preview,
      body: message.body,
      html: message.html,
      readAt: null,
      generatedAt: message.generatedAt,
    });

    return id;
  },

  async recordRun() {
    // The period claim is what matters for idempotency, and `claimPeriod`
    // already made it. Nothing further to record in memory.
  },

  async listInbox(options = {}) {
    return getStore()
      .inbox.slice()
      .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
      .slice(0, options.limit ?? 50);
  },

  async markRead(id: string, read: boolean) {
    const store = getStore();
    const index = store.inbox.findIndex((message) => message.id === id);
    if (index === -1) throw new InboxMessageNotFoundError(id);

    const updated: InboxMessage = {
      ...store.inbox[index],
      readAt: read ? new Date().toISOString() : null,
    };
    store.inbox[index] = updated;

    return updated;
  },

  async unreadCount() {
    return getStore().inbox.filter((message) => message.readAt === null).length;
  },

  async getSettings() {
    return { ...getStore().settings };
  },

  async saveSettings(patch) {
    const store = getStore();
    store.settings = { ...store.settings, ...patch };
    return { ...store.settings };
  },

  async alreadySent(kind: DigestKind, periodDate: string) {
    return getStore().runs.some(
      (run) => run.kind === kind && run.periodDate === periodDate,
    );
  },

  async claimPeriod(kind: DigestKind, periodDate: string) {
    const store = getStore();

    // Check-then-insert, atomic here because this is single-threaded. The
    // database does the same job with a unique index, where it genuinely
    // needs to be atomic.
    if (
      store.runs.some(
        (run) => run.kind === kind && run.periodDate === periodDate,
      )
    ) {
      return false;
    }

    store.runs.push({ kind, periodDate });
    return true;
  },
};
