/**
 * YAML frontmatter — the deliberately small subset a note needs.
 *
 * Not a YAML parser. YAML is a large, surprising language (`no` is a boolean,
 * `1.0` is a float, indentation is significant three different ways) and
 * pulling in a full implementation to read six keys would be a poor trade for
 * something that sits between a public repository and a folder of the owner's
 * decisions.
 *
 * What is supported is what Obsidian frontmatter actually contains:
 * scalars (string, number, boolean, null), ISO dates, and flow or block
 * sequences of scalars. Anything else is preserved **verbatim** as an unparsed
 * line so a round trip never destroys a key we did not understand — the single
 * most important property here, because the file is the owner's, not ours.
 */

export type FrontmatterValue = string | number | boolean | null | string[];

export interface Frontmatter {
  /** Keys we understood. */
  data: Record<string, FrontmatterValue>;
  /**
   * Lines we did not. Re-emitted unchanged, in their original order relative
   * to each other, so a plugin's own keys survive us.
   */
  unknown: string[];
}

export interface ParsedDocument {
  frontmatter: Frontmatter;
  /** Everything after the closing `---`, with no leading blank line. */
  body: string;
  /** True when the source actually had a frontmatter block. */
  hadFrontmatter: boolean;
}

const FENCE = "---";

/** Splits a document into frontmatter and body. Never throws. */
export function parseDocument(source: string): ParsedDocument {
  const normalized = source.replace(/\r\n/g, "\n");

  if (!normalized.startsWith(`${FENCE}\n`)) {
    return {
      frontmatter: { data: {}, unknown: [] },
      body: normalized.replace(/^\n+/, ""),
      hadFrontmatter: false,
    };
  }

  const closing = normalized.indexOf(`\n${FENCE}`, FENCE.length);
  if (closing === -1) {
    // An unterminated fence is not frontmatter; treating it as such would
    // swallow the whole note.
    return {
      frontmatter: { data: {}, unknown: [] },
      body: normalized,
      hadFrontmatter: false,
    };
  }

  const block = normalized.slice(FENCE.length + 1, closing);
  const rest = normalized.slice(closing + FENCE.length + 1);

  return {
    frontmatter: parseBlock(block),
    body: rest.replace(/^\n+/, ""),
    hadFrontmatter: true,
  };
}

function parseBlock(block: string): Frontmatter {
  const data: Record<string, FrontmatterValue> = {};
  const unknown: string[] = [];

  const lines = block.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      unknown.push(line);
      continue;
    }

    const [, key, rawValue] = match;

    // A block sequence: the value is empty and the following lines are "- x".
    if (rawValue.trim() === "") {
      const items: string[] = [];
      let cursor = index + 1;

      while (cursor < lines.length && /^\s*-\s+/.test(lines[cursor])) {
        items.push(
          parseScalar(lines[cursor].replace(/^\s*-\s+/, "")) as string,
        );
        cursor += 1;
      }

      if (items.length > 0) {
        data[key] = items;
        index = cursor - 1;
      } else {
        // `key:` with nothing after it is an empty value, not a mistake.
        data[key] = null;
      }
      continue;
    }

    data[key] = parseValue(rawValue.trim());
  }

  return { data, unknown };
}

function parseValue(raw: string): FrontmatterValue {
  // Flow sequence: [a, b, c]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (inner === "") return [];
    return splitFlow(inner).map((item) => String(parseScalar(item)));
  }
  return parseScalar(raw);
}

/** Splits `a, "b, c", d` without breaking inside quotes. */
function splitFlow(inner: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (const char of inner) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ",") {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim() !== "") out.push(current.trim());
  return out;
}

function parseScalar(raw: string): FrontmatterValue {
  const value = raw.trim();

  if (value === "") return null;

  // Quoted strings stay strings, whatever they look like inside. This is how
  // a title of "true" or "2026-08-11" survives.
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }

  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;

  // Numbers, but not things that merely start with digits — "2026-08-11" is a
  // date and must stay a string, and "1.2.3" is a version.
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);

  return value;
}

/* ── Serializing ──────────────────────────────────────────────────────── */

/**
 * Emits a frontmatter block.
 *
 * Deterministic: keys are written in the order given, never sorted, so a file
 * that has not changed produces byte-identical output and the sync does not
 * see a phantom edit.
 */
export function serializeFrontmatter(frontmatter: Frontmatter): string {
  const lines: string[] = [FENCE];

  for (const [key, value] of Object.entries(frontmatter.data)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) lines.push(`  - ${quoteIfNeeded(item)}`);
      }
      continue;
    }

    lines.push(`${key}: ${formatScalar(value)}`);
  }

  // Keys we did not understand go back exactly as they arrived.
  lines.push(...frontmatter.unknown);
  lines.push(FENCE);

  return lines.join("\n");
}

function formatScalar(value: string | number | boolean | null): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return quoteIfNeeded(value);
}

/**
 * Quotes only when leaving it bare would change the meaning.
 *
 * Over-quoting is not harmful but it is noisy, and the vault is a folder a
 * person reads and edits in a text editor.
 */
function quoteIfNeeded(value: string): string {
  const needsQuotes =
    value === "" ||
    /^[\s>|*&!%@`{}[\]]/.test(value) ||
    /:\s/.test(value) ||
    value.endsWith(":") ||
    /^(true|false|null|~)$/.test(value) ||
    /^-?\d+(\.\d+)?$/.test(value) ||
    value.includes("#") ||
    value.includes("\n");

  if (!needsQuotes) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Builds a whole document. A note with no frontmatter keys emits no fence. */
export function serializeDocument(
  frontmatter: Frontmatter,
  body: string,
): string {
  const hasFrontmatter =
    Object.keys(frontmatter.data).length > 0 || frontmatter.unknown.length > 0;

  if (!hasFrontmatter) return `${body.trimEnd()}\n`;

  return `${serializeFrontmatter(frontmatter)}\n\n${body.trimEnd()}\n`;
}
