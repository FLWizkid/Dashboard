/**
 * Secret generation primitives for the self-hosted stack.
 *
 * Deliberately dependency-free: this runs before `npm ci` does, on a box that
 * has just been set up, and a secret generator is the last place to want a
 * supply chain. Kept apart from the CLI so it can be tested.
 */

import { createHmac, randomBytes } from "node:crypto";

/** URL-safe base64 with the padding stripped — what JWT calls base64url. */
export function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * A password from an unambiguous alphabet.
 *
 * These get typed into terminals and pasted into connection strings, so `l`
 * and `1`, `O` and `0` are out, and so is anything a URL or a shell would
 * want to escape.
 *
 * At 57 characters the alphabet gives ~5.83 bits each: the 40-character
 * database password is ~233 bits, the 64-character JWT secret ~373.
 */
export function password(length, randomSource = randomBytes) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  // The largest multiple of the alphabet length that fits in a byte. Values
  // at or above it are rejected rather than folded, so every character is
  // equally likely — taking bytes modulo 57 would quietly favour the first
  // few letters.
  const ceiling = 256 - (256 % alphabet.length);

  let out = "";
  while (out.length < length) {
    for (const value of randomSource(length * 2)) {
      if (value >= ceiling) continue;
      out += alphabet[value % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** HS256 JWT. Supabase's anon and service_role keys are exactly this. */
export function signJwt(payload, secret) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${body}.${signature}`;
}

/** Verifies a token this module produced. Used by the tests and the CLI. */
export function verifyJwt(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expected = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  if (signature !== expected) return null;
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

/**
 * The full set of secrets one box needs.
 *
 * `anonKey` and `serviceRoleKey` are JWTs signed with `jwtSecret`, which is
 * why rotating the secret invalidates both.
 */
export function generateSecrets({ years = 10, now = Date.now() } = {}) {
  const jwtSecret = password(64);
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + Math.round(years * 365.25 * 24 * 60 * 60);

  return {
    jwtSecret,
    postgresPassword: password(40),
    anonKey: signJwt(
      { role: "anon", iss: "supabase", iat: issuedAt, exp: expiresAt },
      jwtSecret,
    ),
    serviceRoleKey: signJwt(
      { role: "service_role", iss: "supabase", iat: issuedAt, exp: expiresAt },
      jwtSecret,
    ),
    // Realtime insists on exactly 16 characters for its at-rest encryption
    // key, and a long one for the Phoenix signing base.
    realtimeEncKey: password(16),
    realtimeSecretKeyBase: password(64),
  };
}
