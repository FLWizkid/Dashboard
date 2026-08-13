import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { renderEnvFile } from "./env-file.mjs";
import { generateSecrets } from "./secrets.mjs";

/**
 * Keeps `docker-compose.yml` and the generated `.env` in step.
 *
 * The failure this prevents is quiet and annoying: a service gains a new
 * variable, the generator is not updated, and the box only finds out at
 * `docker compose up` — or worse, starts with a default nobody chose.
 */

const compose = readFileSync("docker-compose.yml", "utf8");
const env = renderEnvFile({
  hostname: "dashboard.tail1234.ts.net",
  bindAddress: "100.64.0.7",
  secrets: generateSecrets({ now: Date.UTC(2026, 0, 1) }),
});

const envKeys = new Set(
  env
    .split("\n")
    .map((line) => line.match(/^([A-Z_][A-Z0-9_]*)=/)?.[1])
    .filter((key): key is string => Boolean(key)),
);

type Reference = { name: string; required: boolean };

/** Every `${VAR}`, `${VAR:-default}` and `${VAR:?message}` in the file. */
function referencedVariables(source: string): Reference[] {
  const found = new Map<string, boolean>();

  for (const match of source.matchAll(
    /\$\{([A-Z_][A-Z0-9_]*)(:-[^}]*|:\?[^}]*)?\}/g,
  )) {
    const [, name, modifier] = match;
    // `:-` supplies a default, so the variable is optional. Anything else —
    // including `:?`, which fails the run — makes it required.
    const required = !modifier?.startsWith(":-");
    found.set(name, (found.get(name) ?? false) || required);
  }

  return [...found].map(([name, required]) => ({ name, required }));
}

describe("docker-compose.yml and the generated .env", () => {
  const references = referencedVariables(compose);

  it("finds the variables it is supposed to check", () => {
    // Guard against the regex silently matching nothing and the rest of this
    // suite passing vacuously.
    expect(references.length).toBeGreaterThan(10);
    expect(references.map((r) => r.name)).toContain("TAILNET_HOSTNAME");
  });

  it("generates every variable the stack cannot start without", () => {
    const missing = references
      .filter((reference) => reference.required)
      .filter((reference) => !envKeys.has(reference.name))
      .map((reference) => reference.name);

    expect(
      missing,
      `not written by ops/generate-secrets.mjs: ${missing}`,
    ).toEqual([]);
  });

  it("gives every optional variable either a compose default or an entry", () => {
    // An optional variable with neither is a value nobody ever chose.
    const undocumented = references
      .filter((reference) => !reference.required)
      .filter((reference) => !envKeys.has(reference.name))
      .filter(
        (reference) => !new RegExp(`\\$\\{${reference.name}:-`).test(compose),
      )
      .map((reference) => reference.name);

    expect(undocumented).toEqual([]);
  });
});

describe("network exposure", () => {
  // The product's hardest constraint: reachable only over Tailscale, never
  // public. These assertions are cheap and the failure mode is severe.

  it("publishes every host port through BIND_ADDRESS or loopback", () => {
    // Matches the "ip:host:container" form in a ports list.
    const published = [...compose.matchAll(/^\s*-\s*"([^"]*:\d+:\d+)"/gm)].map(
      (match) => match[1],
    );

    expect(published.length).toBeGreaterThan(0);

    for (const mapping of published) {
      const bindsToVariable = mapping.startsWith("${BIND_ADDRESS");
      const bindsToLoopback = mapping.startsWith("127.0.0.1:");

      expect(
        bindsToVariable || bindsToLoopback,
        `port mapping "${mapping}" is not bound to BIND_ADDRESS or loopback`,
      ).toBe(true);
    }
  });

  it("never binds a port to every interface", () => {
    expect(compose).not.toMatch(/^\s*-\s*"?0\.0\.0\.0:/m);
  });

  it("defaults BIND_ADDRESS to loopback so a missing value fails closed", () => {
    expect(compose).toContain("${BIND_ADDRESS:-127.0.0.1}");
  });

  it("keeps the service role key out of the browser bundle", () => {
    // NEXT_PUBLIC_* is inlined at build time. The service role key bypasses
    // RLS; it must never be a build argument, and never NEXT_PUBLIC_.
    expect(compose).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE/);

    const buildArgs = compose.slice(
      compose.indexOf("args:"),
      compose.indexOf("<<: [*restart, *logging]", compose.indexOf("args:")),
    );

    // Prove we are looking at the app's build arguments before asserting on
    // what is absent from them.
    expect(buildArgs).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(buildArgs).not.toContain("SERVICE_ROLE_KEY");
  });
});
