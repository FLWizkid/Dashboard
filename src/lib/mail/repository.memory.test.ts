import { beforeEach, describe, expect, it } from "vitest";

import { memoryMailRepository, resetMemoryMail } from "./repository.memory";
import { markReadSchema } from "./schema";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The fake must satisfy the contract the real store satisfies.
 *
 * The API layer validates ids as UUIDs before they ever reach a repository —
 * `markReadSchema` rejects anything else with a 400. When the fixtures used
 * slug ids ("msg-board"), every mark-as-read call in memory mode failed
 * validation, invisibly, while the E2E suite stayed green. These tests pin
 * the parity so a readable-looking slug id cannot reintroduce that gap.
 */
describe("memory fixtures obey the id contract the schemas enforce", () => {
  beforeEach(() => {
    resetMemoryMail();
  });

  it("every account, thread and event id is a UUID", async () => {
    const accounts = await memoryMailRepository.listAccounts();
    expect(accounts.length).toBeGreaterThan(0);
    for (const account of accounts) {
      expect(account.id, `account ${account.emailAddress}`).toMatch(UUID);
    }

    const threads = await memoryMailRepository.listThreads({});
    expect(threads.length).toBeGreaterThan(0);
    for (const thread of threads) {
      expect(thread.id, thread.subject ?? thread.id).toMatch(UUID);
      expect(thread.accountId, thread.subject ?? thread.id).toMatch(UUID);
    }

    const week = 7 * 24 * 3600_000;
    const events = await memoryMailRepository.listEvents({
      from: new Date(Date.now() - week).toISOString(),
      to: new Date(Date.now() + week).toISOString(),
    });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.id, event.title ?? event.id).toMatch(UUID);
      expect(event.calendarId, event.title ?? event.id).toMatch(UUID);
    }
  });

  it("every seeded message id passes markReadSchema", async () => {
    const threads = await memoryMailRepository.listThreads({});
    for (const summary of threads) {
      const detail = await memoryMailRepository.getThread(summary.id);
      expect(detail, summary.subject ?? summary.id).not.toBeNull();
      const messageIds = detail!.messages.map((message) => message.id);
      const parsed = markReadSchema.safeParse({ messageIds, read: true });
      expect(parsed.success, `${summary.subject}: ${messageIds}`).toBe(true);
    }
  });

  it("marking a seeded thread read actually clears its unread count", async () => {
    const threads = await memoryMailRepository.listThreads({});
    const unread = threads.find((thread) => thread.unreadCount > 0);
    expect(unread).toBeDefined();

    const detail = await memoryMailRepository.getThread(unread!.id);
    await memoryMailRepository.markRead(
      detail!.messages.map((message) => message.id),
      true,
    );

    const after = await memoryMailRepository.listThreads({});
    expect(after.find((t) => t.id === unread!.id)?.unreadCount).toBe(0);
  });
});
