import { describe, expect, it, vi } from "vitest";

import { recordAudit } from "./record";
import type { DataScope } from "@/lib/db/scope";

vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));
const { reportError } = await import("@/lib/observability/report");

function scope(insert: ReturnType<typeof vi.fn>, userId: string | null = null) {
  return {
    userId,
    client: async () => ({ from: () => ({ insert }) }) as never,
  } satisfies DataScope;
}

describe("recordAudit", () => {
  it("writes the action, subject and actor", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });

    await recordAudit(scope(insert), {
      action: "message.read",
      subjectType: "message",
      subjectId: "message-1",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "message.read",
        subject_type: "message",
        subject_id: "message-1",
        actor: "session",
      }),
    );
  });

  it("truncates long detail values rather than storing prose", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });

    await recordAudit(scope(insert), {
      action: "message.searched",
      detail: { query: "x".repeat(400) },
    });

    const written = insert.mock.calls[0][0] as {
      detail: Record<string, string>;
    };

    // The cap exists so the audit log cannot quietly become a second copy of
    // the mail it is supposed to be protecting.
    expect(written.detail.query.length).toBeLessThanOrEqual(121);
    expect(written.detail.query.endsWith("…")).toBe(true);
  });

  it("stamps the owner when acting as a service", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });

    await recordAudit(scope(insert, "user-1"), { action: "mail.synced" });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1" }),
    );
  });

  it("never throws when the log cannot be written", async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ error: { message: "disk full" } });

    // Failing to log must not take the product down with it; the failure is
    // reported instead.
    await expect(
      recordAudit(scope(insert), { action: "message.read" }),
    ).resolves.toBeUndefined();

    expect(reportError).toHaveBeenCalled();
  });
});
