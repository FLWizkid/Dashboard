import { describe, expect, it } from "vitest";

import { readableBody } from "./readable";

/**
 * The readable body.
 *
 * These assert the two things that matter: no markup survives to the screen,
 * and the sentence a person was sent is still there afterwards.
 */
describe("readableBody", () => {
  it("leaves plain text exactly as it arrived", () => {
    const body = "Two lines.\n\nAnd a paragraph break.";
    expect(readableBody(body, "text")).toBe(body);
  });

  it("returns null for a body that was never stored", () => {
    expect(readableBody(null, "html")).toBeNull();
  });

  it("recovers the sentence from layout markup", () => {
    const html =
      '<div style="font-family:Arial"><table><tr><td><p>Can you review the deck?</p></td></tr></table></div>';

    expect(readableBody(html, "html")).toBe("Can you review the deck?");
  });

  it("keeps paragraph breaks and drops the empty layout rows", () => {
    const html = "<p>First</p><div></div><div></div><p>Second</p>";
    expect(readableBody(html, "html")).toBe("First\n\nSecond");
  });

  it("never lets script or style content reach the reader", () => {
    const html =
      "<style>.x{color:red}</style><script>alert(1)</script><p>Real words</p>";

    const text = readableBody(html, "html");

    expect(text).toBe("Real words");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
  });

  it("shows where a link actually goes", () => {
    // Hiding the destination is the oldest trick in phishing, and this is a
    // mailbox — the target is part of the message.
    const html = '<a href="https://evil.example/login">your bank</a>';

    expect(readableBody(html, "html")).toBe(
      "your bank (https://evil.example/login)",
    );
  });

  it("does not double a link whose text is already its destination", () => {
    const html = '<a href="https://example.com">https://example.com</a>';
    expect(readableBody(html, "html")).toBe("https://example.com");
  });

  it("decodes the entities that appear in real mail", () => {
    const html = "<p>Ben &amp; Jerry&#39;s &mdash; 5 &lt; 6</p>";
    expect(readableBody(html, "html")).toBe("Ben & Jerry's — 5 < 6");
  });

  it("returns null when a body is markup and nothing else", () => {
    expect(readableBody("<div><span></span></div>", "html")).toBeNull();
  });
});
