import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  aad as aadFor,
  decryptField,
  encryptField,
  EncryptionError,
  EncryptionNotConfiguredError,
  ENVELOPE_PREFIX,
  envelopeKeyId,
  getKeyring,
  isEncryptionConfigured,
  isEnvelope,
  parseKeyring,
  resetKeyringCache,
  rotateField,
  safeEqual,
  type Keyring,
} from "./envelope";

const key = (seed: number) => Buffer.alloc(32, seed).toString("base64");

function keyring(activeKeyId = "v1", spec = `v1:${key(1)}`): Keyring {
  return parseKeyring(spec, activeKeyId);
}

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetKeyringCache();
});

describe("parseKeyring", () => {
  it("reads a single key", () => {
    const ring = parseKeyring(`v1:${key(1)}`, "v1");
    expect(ring.activeKeyId).toBe("v1");
    expect(ring.keys.get("v1")).toHaveLength(32);
  });

  it("reads several, so rotation is additive", () => {
    const ring = parseKeyring(`v1:${key(1)}, v2:${key(2)}`, "v2");
    expect([...ring.keys.keys()]).toEqual(["v1", "v2"]);
    expect(ring.activeKeyId).toBe("v2");
  });

  it("rejects a key that is not 32 bytes", () => {
    const short = randomBytes(16).toString("base64");
    expect(() => parseKeyring(`v1:${short}`, "v1")).toThrow(/needs exactly 32/);
  });

  it("rejects an active key that is not in the ring", () => {
    // Otherwise every write would fail at run time, in production, silently
    // until the first message arrived.
    expect(() => parseKeyring(`v1:${key(1)}`, "v9")).toThrow(
      /not in the keyring/,
    );
  });

  it("rejects a duplicated id", () => {
    expect(() => parseKeyring(`v1:${key(1)},v1:${key(2)}`, "v1")).toThrow(
      /appears twice/,
    );
  });

  it("rejects a malformed entry", () => {
    expect(() => parseKeyring(`justbase64`, "v1")).toThrow(
      /expected "id:base64"/,
    );
  });

  it("rejects an id with characters that would break the envelope format", () => {
    expect(() => parseKeyring(`v.1:${key(1)}`, "v.1")).toThrow(/Key id/);
  });

  it("treats an empty spec as unconfigured", () => {
    expect(() => parseKeyring("", "v1")).toThrow(EncryptionNotConfiguredError);
  });
});

describe("encrypt / decrypt", () => {
  const ring = keyring();

  it("round-trips", () => {
    const secret = "The board pack is attached. Do not forward.";
    const envelope = encryptField(secret, "message-body:1", ring);

    expect(decryptField(envelope, "message-body:1", ring)).toBe(secret);
  });

  it("round-trips unicode and long bodies", () => {
    const body = `Grüße — ${"筆".repeat(5000)} 🎉`;
    const envelope = encryptField(body, "message-body:1", ring);
    expect(decryptField(envelope, "message-body:1", ring)).toBe(body);
  });

  it("round-trips the empty string", () => {
    // A mail with an empty body is not an error, and must not become one.
    const envelope = encryptField("", "message-body:1", ring);
    expect(decryptField(envelope, "message-body:1", ring)).toBe("");
  });

  it("produces a self-describing envelope", () => {
    const envelope = encryptField("x", "message-body:1", ring);
    const [version, keyId] = envelope.split(".");

    expect(version).toBe(ENVELOPE_PREFIX);
    expect(keyId).toBe("v1");
    expect(isEnvelope(envelope)).toBe(true);
    expect(envelopeKeyId(envelope)).toBe("v1");
  });

  it("never emits the plaintext", () => {
    const envelope = encryptField("hunter2-the-board-pack", "a:1", ring);
    expect(envelope).not.toContain("hunter2");
  });

  it("is non-deterministic — the same input twice looks different", () => {
    // A deterministic scheme would let anyone with the ciphertexts see which
    // messages share a body.
    const a = encryptField("same", "message-body:1", ring);
    const b = encryptField("same", "message-body:1", ring);

    expect(a).not.toBe(b);
    expect(decryptField(a, "message-body:1", ring)).toBe("same");
    expect(decryptField(b, "message-body:1", ring)).toBe("same");
  });
});

describe("tamper resistance", () => {
  const ring = keyring();

  it("rejects a modified ciphertext", () => {
    const envelope = encryptField("original", "message-body:1", ring);
    const [version, keyId, payload] = envelope.split(".");

    const raw = Buffer.from(payload, "base64url");
    raw[raw.length - 1] ^= 0xff; // flip the last byte of the ciphertext
    const tampered = `${version}.${keyId}.${raw.toString("base64url")}`;

    expect(() => decryptField(tampered, "message-body:1", ring)).toThrow(
      EncryptionError,
    );
  });

  it("rejects a modified authentication tag", () => {
    const envelope = encryptField("original", "message-body:1", ring);
    const [version, keyId, payload] = envelope.split(".");

    const raw = Buffer.from(payload, "base64url");
    raw[12] ^= 0xff; // first byte of the tag
    expect(() =>
      decryptField(
        `${version}.${keyId}.${raw.toString("base64url")}`,
        "message-body:1",
        ring,
      ),
    ).toThrow(EncryptionError);
  });

  it("rejects the right ciphertext under the wrong AAD", () => {
    // This is the attack the AAD exists for: moving one message's body onto
    // another row. Write access to the database must not be enough.
    const envelope = encryptField(
      "Alice's body",
      aadFor.messageBody("m1"),
      ring,
    );

    expect(() =>
      decryptField(envelope, aadFor.messageBody("m2"), ring),
    ).toThrow(/could not authenticate/i);
  });

  it("rejects credentials relocated to another account", () => {
    const token = encryptField(
      "refresh-token",
      aadFor.credentials("acc1"),
      ring,
    );

    expect(() => decryptField(token, aadFor.credentials("acc2"), ring)).toThrow(
      EncryptionError,
    );
  });

  it("rejects a value encrypted under a different key", () => {
    const other = parseKeyring(`v1:${key(9)}`, "v1");
    const envelope = encryptField("secret", "a:1", other);

    expect(() => decryptField(envelope, "a:1", ring)).toThrow(EncryptionError);
  });

  it("rejects anything that is not an envelope", () => {
    for (const bad of ["", "plain text", "cio1.v1", "a.b.c.d"]) {
      expect(() => decryptField(bad, "a:1", ring)).toThrow(EncryptionError);
    }
  });

  it("rejects a truncated payload", () => {
    const short = Buffer.alloc(4).toString("base64url");
    expect(() =>
      decryptField(`${ENVELOPE_PREFIX}.v1.${short}`, "a:1", ring),
    ).toThrow(/truncated/);
  });

  it("names the missing key rather than failing opaquely", () => {
    const envelope = `${ENVELOPE_PREFIX}.v7.${Buffer.alloc(40).toString("base64url")}`;
    expect(() => decryptField(envelope, "a:1", ring)).toThrow(
      /not in the keyring/,
    );
  });

  it("refuses to encrypt without an AAD", () => {
    expect(() => encryptField("x", "", ring)).toThrow(/AAD is required/);
  });
});

describe("rotation", () => {
  it("re-encrypts an old value under the active key", () => {
    const old = parseKeyring(`v1:${key(1)}`, "v1");
    const both = parseKeyring(`v1:${key(1)},v2:${key(2)}`, "v2");

    const written = encryptField("board pack", aadFor.messageBody("m1"), old);
    const rotated = rotateField(written, aadFor.messageBody("m1"), both);

    expect(rotated).not.toBeNull();
    expect(envelopeKeyId(rotated!)).toBe("v2");
    expect(decryptField(rotated!, aadFor.messageBody("m1"), both)).toBe(
      "board pack",
    );
  });

  it("still reads old values while both keys are present", () => {
    const both = parseKeyring(`v1:${key(1)},v2:${key(2)}`, "v2");
    const written = encryptField(
      "old",
      "a:1",
      parseKeyring(`v1:${key(1)}`, "v1"),
    );

    expect(decryptField(written, "a:1", both)).toBe("old");
  });

  it("returns null for a value already on the active key", () => {
    const ring = parseKeyring(`v1:${key(1)},v2:${key(2)}`, "v2");
    const current = encryptField("x", "a:1", ring);

    expect(rotateField(current, "a:1", ring)).toBeNull();
  });
});

describe("configuration", () => {
  it("reports unconfigured rather than throwing at import time", () => {
    delete process.env.DASHBOARD_ENCRYPTION_KEYS;
    delete process.env.DASHBOARD_ENCRYPTION_ACTIVE_KEY;

    expect(isEncryptionConfigured()).toBe(false);
    expect(() => getKeyring()).toThrow(EncryptionNotConfiguredError);
  });

  it("reads the keyring from the environment", () => {
    process.env.DASHBOARD_ENCRYPTION_KEYS = `v1:${key(3)}`;
    process.env.DASHBOARD_ENCRYPTION_ACTIVE_KEY = "v1";

    expect(isEncryptionConfigured()).toBe(true);
    expect(getKeyring().activeKeyId).toBe("v1");
  });

  it("notices when the environment changes", () => {
    process.env.DASHBOARD_ENCRYPTION_KEYS = `v1:${key(3)}`;
    process.env.DASHBOARD_ENCRYPTION_ACTIVE_KEY = "v1";
    expect(getKeyring().activeKeyId).toBe("v1");

    process.env.DASHBOARD_ENCRYPTION_KEYS = `v1:${key(3)},v2:${key(4)}`;
    process.env.DASHBOARD_ENCRYPTION_ACTIVE_KEY = "v2";
    expect(getKeyring().activeKeyId).toBe("v2");
  });
});

describe("aad builders", () => {
  it("distinguish the three encrypted things", () => {
    const all = [
      aadFor.messageBody("1"),
      aadFor.eventDescription("1"),
      aadFor.credentials("1"),
    ];
    expect(new Set(all).size).toBe(3);
  });
});

describe("safeEqual", () => {
  it("matches equal strings and rejects others", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
