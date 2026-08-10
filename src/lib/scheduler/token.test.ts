import { describe, expect, it } from "vitest";

import { bearerFrom, isSchedulerRequest, schedulerToken } from "./token";

/**
 * Proving a request is the scheduler.
 *
 * The rule being protected: **an unset token closes the path.** "No token
 * configured means no auth required" is the failure mode that reads as
 * convenience and behaves as an open endpoint.
 */

const SECRET = "s3cr3t-token-value";

function headers(authorization?: string): Headers {
  return new Headers(authorization ? { authorization } : {});
}

describe("the token itself", () => {
  it("prefers the current name", () => {
    expect(
      schedulerToken({
        DASHBOARD_CRON_TOKEN: "new",
        DIGEST_CRON_TOKEN: "old",
      }),
    ).toBe("new");
  });

  it("still accepts the name boxes were deployed with", () => {
    // Renaming a variable is not worth silently breaking someone's digests.
    expect(schedulerToken({ DIGEST_CRON_TOKEN: "old" })).toBe("old");
  });

  it("treats an empty string as unset", () => {
    expect(schedulerToken({ DASHBOARD_CRON_TOKEN: "" })).toBeUndefined();
  });
});

describe("recognising the scheduler", () => {
  const env = { DASHBOARD_CRON_TOKEN: SECRET };

  it("accepts the right token", () => {
    expect(isSchedulerRequest(headers(`Bearer ${SECRET}`), env)).toBe(true);
  });

  it("rejects the wrong one", () => {
    expect(isSchedulerRequest(headers("Bearer nope"), env)).toBe(false);
  });

  it("rejects one of the right length but wrong content", () => {
    const sameLength = "x".repeat(SECRET.length);
    expect(isSchedulerRequest(headers(`Bearer ${sameLength}`), env)).toBe(
      false,
    );
  });

  it("rejects a missing header", () => {
    expect(isSchedulerRequest(headers(), env)).toBe(false);
  });

  it("rejects the token without the scheme", () => {
    expect(isSchedulerRequest(headers(SECRET), env)).toBe(false);
  });

  it("rejects everything when no token is configured", () => {
    // Including a request presenting the empty string, which is what a
    // `Bearer ` header with nothing after it produces.
    expect(isSchedulerRequest(headers("Bearer "), {})).toBe(false);
    expect(isSchedulerRequest(headers(`Bearer ${SECRET}`), {})).toBe(false);
  });
});

describe("bearerFrom", () => {
  it("returns the token", () => {
    expect(bearerFrom(headers("Bearer abc"))).toBe("abc");
  });

  it("returns empty for another scheme", () => {
    expect(bearerFrom(headers("Basic abc"))).toBe("");
  });
});
