import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DuplicateClientKeyError,
  HoursRecordNotFoundError,
  SessionAlreadyRunningError,
} from "./repository";
import { readBody, toErrorResponse } from "./route-helpers";
import type { PomodoroSession, TimeEntry } from "./types";

/**
 * The error mapping is a behavioural contract, not boilerplate.
 *
 * Two of these translations are load-bearing:
 *
 *   A duplicate client key must come back **200**, because the outbox reads
 *   anything else as "not stored yet" and keeps retrying an hour that is
 *   already in the database — forever, with the owner watching an entry that
 *   never clears.
 *
 *   A session already running must come back **409 with the session**, so the
 *   second tab adopts the timer rather than showing an error about a session
 *   the owner can see ticking.
 */

const entry: TimeEntry = {
  id: "entry-1",
  source: "manual",
  taskId: null,
  categoryId: null,
  sessionId: null,
  startedAt: "2026-08-10T09:00:00.000Z",
  endedAt: "2026-08-10T09:30:00.000Z",
  minutes: 30,
  note: null,
  clientKey: "ob-abcdefgh",
  createdAt: "2026-08-10T09:30:00.000Z",
  updatedAt: "2026-08-10T09:30:00.000Z",
};

const session: PomodoroSession = {
  id: "session-1",
  kind: "focus",
  taskId: null,
  plannedMinutes: 25,
  startedAt: "2026-08-10T09:00:00.000Z",
  endedAt: null,
  completed: false,
  seconds: null,
  note: null,
  createdAt: "2026-08-10T09:00:00.000Z",
  updatedAt: "2026-08-10T09:00:00.000Z",
};

describe("toErrorResponse", () => {
  it("answers a duplicate client key with 200 and the existing entry", async () => {
    const response = toErrorResponse(new DuplicateClientKeyError(entry));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      entry,
      duplicate: true,
    });
  });

  it("answers a running session with 409 and the session itself", async () => {
    const response = toErrorResponse(new SessionAlreadyRunningError(session));

    expect(response.status).toBe(409);
    const body = (await response.json()) as { session: PomodoroSession };
    expect(body.session.id).toBe("session-1");
  });

  it("answers a missing record with 404", () => {
    expect(
      toErrorResponse(new HoursRecordNotFoundError("Rule", "rule-1")).status,
    ).toBe(404);
  });

  it("answers anything else with 500 and the message", async () => {
    const response = toErrorResponse(new Error("the database went away"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "the database went away",
    });
  });

  it("does not leak a non-Error thrown value into the response", async () => {
    const response = toErrorResponse({ secret: "service-role-key" });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Unknown error" });
  });
});

describe("readBody", () => {
  const schema = z.object({ minutes: z.number().int().min(1) });

  it("returns the parsed value when the body is valid", async () => {
    const request = new Request("http://localhost/api/hours", {
      method: "POST",
      body: JSON.stringify({ minutes: 30 }),
    });

    const result = await readBody(request, schema);
    expect(result).toEqual({ data: { minutes: 30 } });
  });

  it("returns a 400 for a body that isn't JSON", async () => {
    const request = new Request("http://localhost/api/hours", {
      method: "POST",
      body: "not json at all",
    });

    const result = await readBody(request, schema);
    expect("response" in result && result.response.status).toBe(400);
  });

  it("returns a 400 with the issues when validation fails", async () => {
    const request = new Request("http://localhost/api/hours", {
      method: "POST",
      body: JSON.stringify({ minutes: 0 }),
    });

    const result = await readBody(request, schema);
    if (!("response" in result)) throw new Error("expected a response");

    expect(result.response.status).toBe(400);
    const body = (await result.response.json()) as { issues: unknown };
    expect(body.issues).toBeDefined();
  });
});
