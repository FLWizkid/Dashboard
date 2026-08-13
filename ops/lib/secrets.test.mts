import { describe, expect, it } from "vitest";

import { renderEnvFile } from "./env-file.mjs";
import {
  base64url,
  generateSecrets,
  password,
  signJwt,
  verifyJwt,
} from "./secrets.mjs";

describe("base64url", () => {
  it("drops padding and uses the URL-safe alphabet", () => {
    // 0xfb 0xff encodes to "+/8=" in standard base64.
    const encoded = base64url(Buffer.from([0xfb, 0xff, 0xfe]));
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });
});

describe("password", () => {
  it("returns the requested length", () => {
    for (const length of [1, 16, 40, 64, 128]) {
      expect(password(length)).toHaveLength(length);
    }
  });

  it("avoids characters that are ambiguous or need escaping", () => {
    const sample = password(4000);
    // No 0/O, 1/l/I, and nothing a URL, shell or connection string would
    // want quoted.
    expect(sample).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
  });

  it("rejects biased bytes rather than folding them", () => {
    // 228 is the largest multiple of the 57-character alphabet below 256, so
    // 228..255 must be discarded. Feed it nothing but rejects followed by a
    // single acceptable byte: a modulo implementation would consume the
    // rejects and return the wrong characters.
    const bytes = [255, 254, 253, 252, 251, 250, 249, 248, 0];
    const source = () => Uint8Array.from(bytes);
    expect(password(1, source)).toBe("A");
  });

  it("keeps drawing until it has enough characters", () => {
    // A source that yields mostly rejects still has to produce a full-length
    // password rather than a short one.
    let call = 0;
    const source = (n) => {
      call += 1;
      return Uint8Array.from({ length: n }, (_, i) =>
        call === 1 && i > 0 ? 255 : 0,
      );
    };
    expect(password(5, source)).toHaveLength(5);
  });
});

describe("signJwt / verifyJwt", () => {
  const secret = "a-test-secret-that-is-long-enough-to-be-realistic";

  it("round-trips a payload", () => {
    const token = signJwt({ role: "anon", iss: "supabase" }, secret);
    expect(verifyJwt(token, secret)).toEqual({
      role: "anon",
      iss: "supabase",
    });
  });

  it("produces the three-part compact form", () => {
    expect(signJwt({ role: "anon" }, secret).split(".")).toHaveLength(3);
  });

  it("declares HS256 in the header, which is what GoTrue expects", () => {
    const [header] = signJwt({ role: "anon" }, secret).split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
  });

  it("rejects a token signed with a different secret", () => {
    const token = signJwt({ role: "service_role" }, secret);
    expect(verifyJwt(token, "some-other-secret")).toBeNull();
  });

  it("rejects a tampered payload", () => {
    // The attack this guards against: take the anon key, swap the role to
    // service_role, keep the signature. It must not verify.
    const token = signJwt({ role: "anon" }, secret);
    const [header, , signature] = token.split(".");
    const forged = base64url(JSON.stringify({ role: "service_role" }));
    expect(verifyJwt(`${header}.${forged}.${signature}`, secret)).toBeNull();
  });

  it("rejects anything that isn't three parts", () => {
    expect(verifyJwt("not-a-token", secret)).toBeNull();
    expect(verifyJwt("only.two", secret)).toBeNull();
  });
});

describe("generateSecrets", () => {
  const now = Date.UTC(2026, 0, 1);

  it("signs both API keys with the JWT secret", () => {
    const secrets = generateSecrets({ now });

    expect(verifyJwt(secrets.anonKey, secrets.jwtSecret)).toMatchObject({
      role: "anon",
      iss: "supabase",
    });
    expect(verifyJwt(secrets.serviceRoleKey, secrets.jwtSecret)).toMatchObject({
      role: "service_role",
      iss: "supabase",
    });
  });

  it("gives Realtime exactly the 16-character key it demands", () => {
    expect(generateSecrets({ now }).realtimeEncKey).toHaveLength(16);
  });

  it("dates the keys from `now` and expires them after the requested span", () => {
    const claims = verifyJwt(
      ...(() => {
        const s = generateSecrets({ now, years: 10 });
        return [s.anonKey, s.jwtSecret];
      })(),
    );

    expect(claims.iat).toBe(Math.floor(now / 1000));
    const spanYears = (claims.exp - claims.iat) / (365.25 * 24 * 60 * 60);
    expect(spanYears).toBeCloseTo(10, 5);
  });

  it("never repeats a secret between runs", () => {
    const a = generateSecrets({ now });
    const b = generateSecrets({ now });
    expect(a.jwtSecret).not.toBe(b.jwtSecret);
    expect(a.postgresPassword).not.toBe(b.postgresPassword);
    expect(a.anonKey).not.toBe(b.anonKey);
  });
});

describe("renderEnvFile", () => {
  const secrets = generateSecrets({ now: Date.UTC(2026, 0, 1) });
  const env = renderEnvFile({
    hostname: "dashboard.tail1234.ts.net",
    bindAddress: "100.64.0.7",
    secrets,
  });

  const value = (key) =>
    env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1] ?? null;

  it("writes every variable docker-compose.yml requires", () => {
    for (const key of [
      "TAILNET_HOSTNAME",
      "BIND_ADDRESS",
      "POSTGRES_DB",
      "POSTGRES_PASSWORD",
      "JWT_SECRET",
      "ANON_KEY",
      "SERVICE_ROLE_KEY",
      "REALTIME_ENC_KEY",
      "REALTIME_SECRET_KEY_BASE",
    ]) {
      expect(value(key), `${key} missing from .env`).toBeTruthy();
    }
  });

  it("carries the hostname and bind address through", () => {
    expect(value("TAILNET_HOSTNAME")).toBe("dashboard.tail1234.ts.net");
    expect(value("BIND_ADDRESS")).toBe("100.64.0.7");
  });

  it("keeps signup disabled by default", () => {
    expect(value("DISABLE_SIGNUP")).toBe("true");
  });

  it("leaves the Sentry DSN empty so nothing leaves the box by default", () => {
    expect(value("SENTRY_DSN")).toBe("");
  });

  it("never assigns a bind address of 0.0.0.0", () => {
    // The prose warns against it; no assignment may actually be it.
    expect(env).not.toMatch(/^[A-Z_]+=0\.0\.0\.0\s*$/m);
    expect(value("BIND_ADDRESS")).not.toBe("0.0.0.0");
  });

  it("defaults the bind address to loopback when none is given", () => {
    // Fail closed: a forgotten --bind must leave the stack unreachable from
    // the network, not reachable from all of it.
    const fallback = renderEnvFile({ hostname: "x.ts.net", secrets });
    expect(fallback.match(/^BIND_ADDRESS=(.*)$/m)?.[1]).toBe("127.0.0.1");
  });
});
