/**
 * Turning an HTML mail body into something a person can read.
 *
 * ── Why not render the HTML ──────────────────────────────────────────────
 * Because rendering attacker-supplied HTML is how mail clients get owned,
 * and the safe way to do it — a real sanitiser, a strict allow-list, styles
 * scoped so a sender cannot restyle the application around their message —
 * is a serious piece of work with a serious failure mode. Until that exists,
 * the honest position is that this product shows the *text* of a message.
 *
 * ── Why not leave it as it was ───────────────────────────────────────────
 * The previous behaviour put the raw markup on screen: a wall of `<div>` and
 * `<span style=…>` with the sentence buried in it. That is not safer than
 * plain text — it is the same content, made unreadable. Anything sent by a
 * marketing system was effectively unopenable.
 *
 * So: extract the words, keep the paragraph breaks, keep link targets
 * visible, and drop everything else. No HTML reaches the DOM — the result is
 * rendered as ordinary text.
 */

/** Elements whose *content* is markup or styling, never prose. */
const NON_CONTENT = /<(script|style|head|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Tags that end a line when they close, so paragraphs survive. */
const BREAKS = /<\/?(p|div|br|tr|li|h[1-6]|blockquote|table)\b[^>]*>/gi;

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => {
      const known = ENTITIES[entity.toLowerCase()];
      if (known !== undefined) return known;

      const numeric = /^&#(\d+);$/.exec(entity);
      if (numeric) {
        const code = Number(numeric[1]);
        // Control characters are never content, and a stray one would show
        // as a replacement glyph in the middle of a sentence.
        if (code >= 32 && code <= 0x10ffff) return String.fromCodePoint(code);
      }

      return entity;
    })
    .replace(/&amp;/g, "&");
}

/**
 * A link, rendered so the destination is visible.
 *
 * `<a href="https://x">click here</a>` becomes `click here (https://x)`.
 * Hiding where a link goes is the oldest trick in phishing, and this is a
 * mailbox: the destination is part of the message, not decoration.
 */
function unwrapLinks(html: string): string {
  return html.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, "").trim();
      const target = href.trim();

      if (!label) return target;
      // A link whose text already is its destination reads badly doubled.
      if (label === target) return target;
      return `${label} (${target})`;
    },
  );
}

/**
 * The readable text of a message body.
 *
 * Plain-text bodies are returned untouched — they are already the thing this
 * function is trying to recover.
 */
export function readableBody(
  body: string | null,
  format: "text" | "html" | null,
): string | null {
  if (!body) return null;
  if (format !== "html") return body;

  const text = decodeEntities(
    unwrapLinks(body.replace(NON_CONTENT, " "))
      .replace(BREAKS, "\n")
      // Everything else is presentation.
      .replace(/<[^>]+>/g, ""),
  );

  return (
    text
      // Runs of blank lines collapse to one: HTML mail is full of empty
      // layout rows, and they arrive here as vertical emptiness.
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .trim() || null
  );
}
