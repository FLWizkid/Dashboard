#!/usr/bin/env node
/**
 * Generates every secret the stack needs and writes a ready-to-use `.env`.
 *
 *   node ops/generate-secrets.mjs --hostname dashboard.your-tailnet.ts.net
 *
 * Run it once, on the box. The output is git-ignored and must stay that way:
 * this repository is public.
 */

import { existsSync, writeFileSync } from "node:fs";
import { argv, exit, stdout } from "node:process";

import { renderEnvFile } from "./lib/env-file.mjs";
import { generateSecrets, verifyJwt } from "./lib/secrets.mjs";

/* ── arguments ──────────────────────────────────────────────────────────── */

const args = new Map();
for (let i = 2; i < argv.length; i += 1) {
  const token = argv[i];
  if (!token.startsWith("--")) continue;
  const next = argv[i + 1];
  if (next && !next.startsWith("--")) {
    args.set(token.slice(2), next);
    i += 1;
  } else {
    args.set(token.slice(2), "true");
  }
}

if (args.has("help")) {
  stdout.write(
    [
      "Usage: node ops/generate-secrets.mjs --hostname <tailnet-hostname> [options]",
      "",
      "  --hostname <host>   Required, e.g. dashboard.tail1234.ts.net",
      "  --bind <address>    Tailscale IP Caddy binds to (default 127.0.0.1)",
      "  --out <path>        Output file (default .env)",
      "  --years <n>         API key lifetime in years (default 10)",
      "  --print             Write to stdout instead of a file",
      "  --force             Overwrite an existing output file",
      "",
    ].join("\n"),
  );
  exit(0);
}

const hostname = args.get("hostname");
if (!hostname || hostname === "true") {
  stdout.write(
    "error: --hostname is required (e.g. --hostname dashboard.tail1234.ts.net)\n" +
      "       Run `tailscale status` on the box to find it.\n",
  );
  exit(1);
}

const outPath = args.get("out") ?? ".env";
const toStdout = args.get("print") === "true";

if (!toStdout && existsSync(outPath) && args.get("force") !== "true") {
  stdout.write(
    `refusing to overwrite ${outPath}.\n` +
      "Rotating secrets signs you out and invalidates both API keys; the steps\n" +
      'are in docs/runbook-windows.md → "Rotating secrets". Pass --force when\n' +
      "you mean it.\n",
  );
  exit(1);
}

/* ── generate ───────────────────────────────────────────────────────────── */

const secrets = generateSecrets({ years: Number(args.get("years") ?? 10) });

// Cheap self-check: a key that doesn't verify against its own secret would
// fail much later, as an opaque 401 from PostgREST.
for (const [name, key] of [
  ["ANON_KEY", secrets.anonKey],
  ["SERVICE_ROLE_KEY", secrets.serviceRoleKey],
]) {
  if (!verifyJwt(key, secrets.jwtSecret)) {
    stdout.write(`error: generated ${name} failed to verify — aborting.\n`);
    exit(1);
  }
}

const env = renderEnvFile({
  hostname,
  bindAddress: args.get("bind") ?? "127.0.0.1",
  secrets,
});

if (toStdout) {
  stdout.write(env);
  exit(0);
}

// 0600: readable by the account that owns the stack, nobody else.
writeFileSync(outPath, env, { mode: 0o600 });

stdout.write(
  [
    `Wrote ${outPath} (mode 0600).`,
    "",
    "Next:",
    `  1. Confirm it is ignored:  git check-ignore -v ${outPath}`,
    "  2. Set BIND_ADDRESS to this box's Tailscale IP (`tailscale ip -4`).",
    "  3. Issue the certificate:  pwsh ops/windows/Update-TailscaleCert.ps1",
    "  4. docker compose up -d",
    "",
    "Keep a copy of JWT_SECRET somewhere off this box. Losing it means every",
    "session and both API keys have to be reissued.",
    "",
  ].join("\n"),
);
