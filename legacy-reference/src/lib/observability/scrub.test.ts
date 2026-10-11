import { describe, expect, it } from "vitest";

import { REDACTED, scrub, scrubError, scrubString } from "./scrub";

describe("scrubString", () => {
  it("redacts a JWT", () => {
    // Shaped exactly like the anon and service-role keys.
    const key =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.9dQe1Hc0fak3Sig";
    const scrubbed = scrubString(`PostgREST rejected ${key} for role`);

    expect(scrubbed).toBe("PostgREST rejected [jwt] for role");
    expect(scrubbed).not.toContain("eyJ");
  });

  it("redacts a bearer token but keeps the scheme", () => {
    expect(scrubString("authorization: Bearer sk-abc123.def_456")).toBe(
      "authorization: Bearer [redacted]",
    );
  });

  it("redacts the password in a connection string, keeping the shape", () => {
    // The host and user are the diagnostic; the password never is.
    expect(
      scrubString("connect postgres://authenticator:hunter2@db:5432/postgres"),
    ).toBe("connect postgres://authenticator:[redacted]@db:5432/postgres");
  });

  it("redacts secrets carried in a query string", () => {
    expect(scrubString("GET /rest/v1/tasks?apikey=abc123&select=id")).toBe(
      "GET /rest/v1/tasks?apikey=[redacted]&select=id",
    );
    expect(scrubString("refresh_token=v1.MRq-9x&grant_type=refresh")).toBe(
      "refresh_token=[redacted]&grant_type=refresh",
    );
  });

  it("redacts the local part of an address but keeps the domain", () => {
    // Which mailbox is failing is the useful part; whose it is isn't.
    expect(scrubString("sync failed for doug@theonefor.ai")).toBe(
      "sync failed for [email]@theonefor.ai",
    );
  });

  it("redacts an age private key", () => {
    expect(
      scrubString("key=AGE-SECRET-KEY-1QQQPZRFQ7Z2XKCM3NYD4VZFKJ5"),
    ).toContain("[age-key]");
  });

  it("leaves ordinary text alone", () => {
    const message = "Task 'Brief the board' could not be saved: due_at is null";
    expect(scrubString(message)).toBe(message);
  });
});

describe("scrub", () => {
  it("redacts values by key name, whatever they hold", () => {
    const result = scrub({
      password: "hunter2",
      apiKey: "plainlooking",
      SUPABASE_SERVICE_ROLE_KEY: "x",
      refresh_token: "y",
      authorization: "z",
      title: "Brief the board",
    }) as Record<string, unknown>;

    expect(result.password).toBe(REDACTED);
    expect(result.apiKey).toBe(REDACTED);
    expect(result.SUPABASE_SERVICE_ROLE_KEY).toBe(REDACTED);
    expect(result.refresh_token).toBe(REDACTED);
    expect(result.authorization).toBe(REDACTED);
    // Not everything is a secret — a redactor that eats the diagnostic is
    // just a slower way of having no diagnostic.
    expect(result.title).toBe("Brief the board");
  });

  it("redacts mail body fields, which arrive in P2", () => {
    const result = scrub({
      subject: "Q3 plan",
      body: "confidential",
    }) as Record<string, unknown>;

    expect(result.body).toBe(REDACTED);
    expect(result.subject).toBe("Q3 plan");
  });

  it("scrubs nested values", () => {
    const result = scrub({
      request: { url: "https://box.ts.net/rest/v1/tasks?apikey=secret" },
    }) as { request: { url: string } };

    expect(result.request.url).toContain("apikey=[redacted]");
  });

  it("survives a circular structure", () => {
    const node: Record<string, unknown> = { name: "root" };
    node.self = node;

    expect(() => scrub(node)).not.toThrow();
    expect((scrub(node) as Record<string, unknown>).self).toBe("[circular]");
  });

  it("stops at the depth limit", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: "bottom" } } } } } } };
    expect(JSON.stringify(scrub(deep, { maxDepth: 3 }))).toContain(
      "[depth limit]",
    );
  });

  it("truncates a very long string and still scrubs it", () => {
    const long = `${"x".repeat(3000)} doug@theonefor.ai`;
    const result = scrub(long, { maxStringLength: 100 }) as string;

    expect(result).toContain("[truncated");
    expect(result).not.toContain("doug@");
  });

  it("caps long arrays", () => {
    const result = scrub(
      Array.from({ length: 200 }, (_, i) => i),
      {
        maxArrayLength: 5,
      },
    ) as unknown[];

    expect(result).toHaveLength(6);
    expect(result[5]).toBe("…195 more");
  });

  it("handles the awkward primitives without throwing", () => {
    expect(scrub(undefined)).toBeUndefined();
    expect(scrub(null)).toBeNull();
    expect(scrub(10n)).toBe("10n");
    expect(scrub(() => {})).toBe("[function]");
    expect(scrub(new Date("2026-08-09T12:00:00Z"))).toBe(
      "2026-08-09T12:00:00.000Z",
    );
  });
});

describe("scrubError", () => {
  it("scrubs the message and the stack", () => {
    const error = new Error(
      "insert failed: postgres://authenticator:hunter2@db:5432/postgres",
    );
    const result = scrubError(error);

    expect(result.name).toBe("Error");
    expect(result.message).toContain("[redacted]");
    expect(result.message).not.toContain("hunter2");
    expect(result.stack).toBeTypeOf("string");
  });

  it("follows the cause chain, which is where drivers hide credentials", () => {
    const cause = new Error("apikey=supersecret rejected");
    const error = new Error("could not load tasks", { cause });

    const result = scrubError(error);
    const scrubbedCause = result.cause as { message: string };

    expect(scrubbedCause.message).toBe("apikey=[redacted] rejected");
  });

  it("does not run away down a circular cause chain", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as Error & { cause?: unknown }).cause = b;

    expect(() => scrubError(a)).not.toThrow();
  });
});
