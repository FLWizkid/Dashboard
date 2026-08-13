import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildEvent, isRemoteReportingEnabled, reportError } from "./report";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("isRemoteReportingEnabled", () => {
  it("is off when no DSN is set — nothing leaves the box by default", () => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    expect(isRemoteReportingEnabled()).toBe(false);
  });

  it("treats an empty or whitespace DSN as off", () => {
    process.env.SENTRY_DSN = "   ";
    expect(isRemoteReportingEnabled()).toBe(false);
  });

  it("is on once a DSN is configured", () => {
    process.env.SENTRY_DSN = "https://key@sentry.example.com/1";
    expect(isRemoteReportingEnabled()).toBe(true);
  });
});

describe("buildEvent", () => {
  it("records severity, source and environment", () => {
    process.env.DASHBOARD_ENVIRONMENT = "production";

    const event = buildEvent(new Error("boom"), {
      source: "api/tasks",
      severity: "fatal",
    });

    expect(event).toMatchObject({
      severity: "fatal",
      source: "api/tasks",
      environment: "production",
      runtime: "server",
    });
    expect(event.error.message).toBe("boom");
    expect(Date.parse(event.timestamp)).not.toBeNaN();
  });

  it("defaults to error severity and an unknown source", () => {
    const event = buildEvent(new Error("boom"));
    expect(event.severity).toBe("error");
    expect(event.source).toBe("unknown");
  });

  it("normalises a thrown string", () => {
    expect(buildEvent("just a string").error.message).toBe("just a string");
  });

  it("normalises a thrown object", () => {
    expect(buildEvent({ code: 42 }).error.message).toBe('{"code":42}');
  });

  it("scrubs the error message", () => {
    const event = buildEvent(
      new Error("PostgREST said no to apikey=abc123 for doug@theonefor.ai"),
    );

    expect(event.error.message).toContain("apikey=[redacted]");
    expect(event.error.message).toContain("[email]@theonefor.ai");
  });

  it("scrubs attached context", () => {
    const event = buildEvent(new Error("boom"), {
      source: "quick-add",
      extra: {
        userId: "11111111-1111-1111-1111-111111111111",
        authorization: "Bearer abc.def",
        url: "https://box.ts.net/rest/v1/tasks?apikey=secret",
      },
    });

    // The id is kept: it is how you find the row without naming the person.
    expect(event.extra?.userId).toBe("11111111-1111-1111-1111-111111111111");
    expect(event.extra?.authorization).toBe("[redacted]");
    expect(String(event.extra?.url)).toContain("apikey=[redacted]");
  });

  it("omits `extra` entirely when there is nothing to attach", () => {
    expect(buildEvent(new Error("boom"), { extra: {} }).extra).toBeUndefined();
  });
});

describe("reportError", () => {
  beforeEach(() => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  it("writes one structured line to the local log", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportError(new Error("boom"), { source: "api/tasks" });

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      type: "error-report",
      source: "api/tasks",
      severity: "error",
    });
  });

  it("logs warnings and info through console.warn", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    reportError(new Error("slow"), { severity: "warning" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("never lets a secret reach the log", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportError(
      new Error(
        "connect postgres://authenticator:hunter2@db:5432/postgres failed",
      ),
      {
        extra: { serviceRoleKey: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoieCJ9.sig" },
      },
    );

    const line = spy.mock.calls[0][0] as string;
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("still records the error when the context cannot be serialised", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    // A getter that throws is the realistic version of this: a proxy or an
    // ORM entity attached to `extra` in a hurry.
    const hostile = {
      get boom(): string {
        throw new Error("nope");
      },
    };

    expect(() =>
      reportError(new Error("original failure"), { extra: { hostile } }),
    ).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });

  it("returns the event it recorded", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const event = reportError(new Error("boom"), { source: "instrumentation" });
    expect(event.source).toBe("instrumentation");
    expect(event.error.name).toBe("Error");
  });

  it("does not throw when a remote reporter is configured but absent", () => {
    // @sentry/nextjs is deliberately not a dependency. A DSN with no package
    // installed must degrade to local logging, not crash the request.
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.SENTRY_DSN = "https://key@sentry.example.com/1";

    expect(() => reportError(new Error("boom"))).not.toThrow();
  });
});
