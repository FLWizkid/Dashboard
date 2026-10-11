import { describe, expect, it } from "vitest";

import {
  fetchIdentity,
  mintState,
  OAuthStateError,
  verifyState,
} from "./connect";

/**
 * The OAuth state parameter.
 *
 * The rule being protected: **a state that does not verify is a refusal.**
 * Without it, anyone who can get the owner's browser to hit the callback with
 * a `code` of their choosing attaches *their* mailbox to the owner's
 * dashboard. Every test here is a way that must fail.
 */

const SECRET = "a-service-role-key";
const NOW = new Date("2026-08-10T12:00:00.000Z");

describe("minting and verifying", () => {
  it("accepts a state it just issued", () => {
    const state = mintState("gmail", { secret: SECRET, now: NOW });
    expect(() =>
      verifyState(state, "gmail", { secret: SECRET, now: NOW }),
    ).not.toThrow();
  });

  it("issues a different state every time", () => {
    // A fixed state is a replayable one.
    const a = mintState("gmail", { secret: SECRET, now: NOW });
    const b = mintState("gmail", { secret: SECRET, now: NOW });
    expect(a).not.toBe(b);
  });
});

describe("what must fail", () => {
  it("rejects a state signed with a different secret", () => {
    const state = mintState("gmail", { secret: "someone-elses", now: NOW });
    expect(() =>
      verifyState(state, "gmail", { secret: SECRET, now: NOW }),
    ).toThrow(OAuthStateError);
  });

  it("rejects a tampered payload", () => {
    const state = mintState("gmail", { secret: SECRET, now: NOW });
    const [provider, expiry, nonce, signature] = state.split(".");
    const forged = `${provider}.${Number(expiry) + 86_400_000}.${nonce}.${signature}`;

    expect(() =>
      verifyState(forged, "gmail", { secret: SECRET, now: NOW }),
    ).toThrow(OAuthStateError);
  });

  it("rejects a state issued for another provider", () => {
    // Otherwise a state minted at Google's start URL completes at Microsoft's
    // callback, which is the same hole with an extra step.
    const state = mintState("gmail", { secret: SECRET, now: NOW });
    expect(() =>
      verifyState(state, "microsoft", { secret: SECRET, now: NOW }),
    ).toThrow(/different provider/);
  });

  it("rejects one that has expired", () => {
    // A connect link left open in a tab for a week must not still work.
    const state = mintState("gmail", { secret: SECRET, now: NOW });
    const later = new Date(NOW.getTime() + 11 * 60 * 1000);

    expect(() =>
      verifyState(state, "gmail", { secret: SECRET, now: later }),
    ).toThrow(/expired/);
  });

  it("rejects a malformed state", () => {
    expect(() =>
      verifyState("nonsense", "gmail", { secret: SECRET, now: NOW }),
    ).toThrow(/malformed/);
  });

  it("refuses to sign with no secret at all", () => {
    expect(() => mintState("gmail", { secret: "" })).toThrow(OAuthStateError);
  });
});

describe("who the token belongs to", () => {
  it("takes the address from the provider, lowercased", async () => {
    const stub = (async () =>
      new Response(JSON.stringify({ email: "Doug@Example.Test", sub: "1" }), {
        status: 200,
      })) as unknown as typeof fetch;

    await expect(fetchIdentity("gmail", "token", stub)).resolves.toMatchObject({
      emailAddress: "doug@example.test",
      remoteId: "1",
    });
  });

  it("reads Microsoft's userPrincipalName when mail is absent", async () => {
    const stub = (async () =>
      new Response(
        JSON.stringify({ userPrincipalName: "doug@corp.test", id: "abc" }),
        { status: 200 },
      )) as unknown as typeof fetch;

    await expect(
      fetchIdentity("microsoft", "token", stub),
    ).resolves.toMatchObject({ emailAddress: "doug@corp.test" });
  });

  it("refuses to connect an account with no address", async () => {
    // Guessing here would make every later "is this from me" comparison wrong.
    const stub = (async () =>
      new Response(JSON.stringify({ name: "Doug" }), {
        status: 200,
      })) as unknown as typeof fetch;

    await expect(fetchIdentity("gmail", "token", stub)).rejects.toThrow(
      /no address/,
    );
  });

  it("surfaces a refusal from the provider", async () => {
    const stub = (async () =>
      new Response("nope", { status: 401 })) as unknown as typeof fetch;

    await expect(fetchIdentity("gmail", "token", stub)).rejects.toThrow(/401/);
  });
});
