import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The scheduler sidecar.
 *
 * A scheduler's characteristic failure is silence: it runs, achieves nothing,
 * and reports success. Everything asserted here is about making that
 * impossible — or at least loud.
 */

const entrypoint = readFileSync("ops/scheduler/entrypoint.sh", "utf8");
const runJob = readFileSync("ops/scheduler/run-job.sh", "utf8");
const compose = readFileSync("docker-compose.yml", "utf8");

describe("run-job.sh", () => {
  it("treats a non-2xx response as a failure", () => {
    // curl exits 0 on a 500 unless told otherwise, which would fill the log
    // with successful-looking runs that did nothing.
    expect(runJob).toContain("%{http_code}");
    expect(runJob).toMatch(/FAILED/);
  });

  it("prints the response body when a job fails", () => {
    // The endpoints answer 503 with the reason — "more than one account
    // exists", "SUPABASE_SERVICE_ROLE_KEY is not set". That sentence is the
    // entire value of reading the log.
    expect(runJob).toMatch(/head -c \d+ "\$body"/);
  });

  it("passes the token in a file rather than on the command line", () => {
    // Arguments are visible in the container's process list.
    expect(runJob).toContain("--header @");
    expect(runJob).not.toMatch(/-H ['"]?authorization: Bearer \$/i);
  });

  it("refuses to call anything when no token is configured", () => {
    // Rather than sending an unauthenticated request every quarter hour and
    // logging a 401 nobody reads.
    expect(runJob).toMatch(/no token configured/);
  });

  it("bounds how long a job may take", () => {
    expect(runJob).toContain("--max-time");
  });
});

describe("entrypoint.sh", () => {
  it("schedules all three jobs", () => {
    expect(entrypoint).toContain("/api/digests/run");
    expect(entrypoint).toContain("/api/vault/sync");
    expect(entrypoint).toContain("/api/connectors/refresh");
  });

  it("refuses to start without a token", () => {
    // A scheduler that starts and 401s forever looks healthy in `docker ps`.
    expect(entrypoint).toMatch(/DASHBOARD_CRON_TOKEN[\s\S]*exit 1/);
  });

  it("refuses to start without somewhere to call", () => {
    expect(entrypoint).toMatch(/DASHBOARD_URL:\?/);
  });

  it("does not leave the crontab world-readable", () => {
    // It contains the token, because cron runs with no environment.
    expect(entrypoint).toContain("chmod 600 /etc/crontabs/root");
  });

  it("runs the digest hourly, not daily", () => {
    // Hourly is what lets one schedule serve any timezone, and what makes a
    // missed hour recoverable rather than lost until tomorrow.
    expect(entrypoint).toContain("DIGEST_CRON_SCHEDULE:-5 * * * *");
  });
});

describe("the compose service", () => {
  it("exists", () => {
    expect(compose).toMatch(/^ {2}scheduler:$/m);
  });

  it("talks to the app over the internal network", () => {
    // Not through Caddy: a scheduled job should not depend on tailnet DNS and
    // a TLS handshake to reach a container on the same bridge.
    expect(compose).toContain("DASHBOARD_URL: http://app:3000");
  });

  it("publishes no ports", () => {
    const service = compose.slice(compose.indexOf("\n  scheduler:"));
    const nextService = service.slice(1).search(/^ {2}\w[\w-]*:$/m);
    const block = nextService === -1 ? service : service.slice(0, nextService);
    expect(block).not.toMatch(/^\s*ports:/m);
  });
});

describe("the app service", () => {
  it("can reach Supabase without leaving the Docker network", () => {
    expect(compose).toContain("SUPABASE_INTERNAL_URL: http://kong:8000");
  });

  it("gets the service-role key, which the scheduled jobs need", () => {
    expect(compose).toMatch(/SUPABASE_SERVICE_ROLE_KEY: \$\{SERVICE_ROLE_KEY/);
  });
});
