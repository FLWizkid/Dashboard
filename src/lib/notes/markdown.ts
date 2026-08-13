/**
 * Notes ↔ Markdown.
 *
 * The vault is a real Obsidian vault: plain Markdown files a person can open,
 * edit and search with no knowledge that this app exists. That constrains the
 * format far more than a private serialization would, and the constraint is
 * the point — the specification says local-first, and local-first is only true
 * if the files remain useful when the app is gone.
 *
 * ── The shape of a decision note ─────────────────────────────────────────
 *
 *     ---
 *     type: decision
 *     title: Consolidate on one identity provider
 *     owner: Doug
 *     decided: 2026-08-11
 *     ---
 *
 *     # Consolidate on one identity provider
 *
 *     ## Decision
 *     Move everything to Entra ID by Q1.
 *
 *     ## Rationale
 *     Two providers means two audit trails and twice the offboarding risk.
 *
 *     ## Context
 *     Raised by the SOC2 gap analysis.
 *
 *     ## Follow-up actions
 *     - [ ] Inventory the Okta apps 👤 Maya 📅 2026-09-01 ⏫
 *
 * Decision and Rationale are sibling headings of equal weight, because the
 * specification makes them equal anchors. Neither is the title and neither is
 * a footnote to the other.
 */

import type { TaskPriority } from "@/lib/tasks/types";

import {
  parseDocument,
  serializeDocument,
  type Frontmatter,
  type FrontmatterValue,
} from "./frontmatter";

export const NOTE_KINDS = [
  "decision",
  "meeting",
  "follow_up",
  "action",
  "freeform",
] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const NOTE_KIND_LABELS: Record<NoteKind, string> = {
  decision: "Decision",
  meeting: "Meeting notes",
  follow_up: "Follow-up",
  action: "Action item",
  freeform: "Note",
};

export interface NoteDocument {
  kind: NoteKind;
  title: string;
  decision: string | null;
  rationale: string | null;
  context: string | null;
  owner: string | null;
  decidedOn: string | null;
  /** Everything that was not one of the structured sections. */
  body: string;
  /** Follow-up actions, in Obsidian Tasks form. */
  followUps: MarkdownTask[];
  /** Frontmatter keys we did not recognise, preserved for the round trip. */
  extraFrontmatter: Frontmatter;
}

/* ── Obsidian Tasks ───────────────────────────────────────────────────── */

/**
 * A task line in the format the Obsidian Tasks plugin reads.
 *
 * Using the plugin's own vocabulary rather than inventing one means the
 * mirrored subset is queryable in Obsidian on day one — `not done due before
 * tomorrow` works on our files without configuration.
 */
export interface MarkdownTask {
  id: string | null;
  title: string;
  done: boolean;
  priority: TaskPriority | null;
  dueAt: string | null;
  doneAt: string | null;
  owner: string | null;
  /** A draft has not been activated and must not be treated as live work. */
  isDraft: boolean;
}

/** Obsidian Tasks priority emoji. `normal` is explicit so it round-trips. */
const PRIORITY_EMOJI: Record<TaskPriority, string> = {
  critical: "🔺",
  high: "⏫",
  normal: "🔼",
  low: "🔽",
};

const EMOJI_PRIORITY = new Map<string, TaskPriority>(
  Object.entries(PRIORITY_EMOJI).map(([priority, emoji]) => [
    emoji,
    priority as TaskPriority,
  ]),
);

// Obsidian Tasks also defines ⏬ for "lowest"; we have four levels, so it maps
// onto low rather than being dropped.
EMOJI_PRIORITY.set("⏬", "low");

const DUE = "📅";
const DONE = "✅";
const ID = "🆔";
/** Not an Obsidian Tasks field; a convention of ours, documented in the vault README. */
const OWNER = "👤";
const DRAFT_TAG = "#draft";

const CHECKBOX = /^(\s*)-\s+\[( |x|X)\]\s+(.*)$/;

/** Renders one task as an Obsidian Tasks checkbox line. */
export function taskToMarkdown(task: MarkdownTask): string {
  const parts: string[] = [task.title.trim()];

  if (task.isDraft) parts.push(DRAFT_TAG);
  if (task.owner) parts.push(`${OWNER} ${task.owner}`);
  if (task.priority) parts.push(PRIORITY_EMOJI[task.priority]);
  if (task.dueAt) parts.push(`${DUE} ${toDateOnly(task.dueAt)}`);
  if (task.doneAt) parts.push(`${DONE} ${toDateOnly(task.doneAt)}`);
  if (task.id) parts.push(`${ID} ${task.id}`);

  return `- [${task.done ? "x" : " "}] ${parts.join(" ")}`;
}

/** Reads a checkbox line back. Returns null for anything that is not one. */
export function markdownToTask(line: string): MarkdownTask | null {
  const match = CHECKBOX.exec(line);
  if (!match) return null;

  const [, , checked, rest] = match;

  let remaining = rest;
  const take = (marker: string): string | null => {
    const index = remaining.indexOf(marker);
    if (index === -1) return null;

    const after = remaining.slice(index + marker.length);
    // A field runs until the next field marker or the end of the line.
    const nextMarker = [DUE, DONE, ID, OWNER, ...EMOJI_PRIORITY.keys()]
      .map((candidate) => after.indexOf(candidate))
      .filter((position) => position > -1)
      .sort((a, b) => a - b)[0];

    const value = (
      nextMarker === undefined ? after : after.slice(0, nextMarker)
    ).trim();
    remaining =
      remaining.slice(0, index) +
      remaining.slice(
        index +
          marker.length +
          (nextMarker === undefined ? after.length : nextMarker),
      );
    return value === "" ? null : value;
  };

  const due = take(DUE);
  const doneAt = take(DONE);
  const id = take(ID);
  const owner = take(OWNER);

  let priority: TaskPriority | null = null;
  for (const [emoji, value] of EMOJI_PRIORITY) {
    if (remaining.includes(emoji)) {
      priority = value;
      remaining = remaining.replace(emoji, "");
      break;
    }
  }

  const isDraft = remaining.includes(DRAFT_TAG);
  if (isDraft) remaining = remaining.replace(DRAFT_TAG, "");

  return {
    id,
    title: remaining.replace(/\s+/g, " ").trim(),
    done: checked.toLowerCase() === "x",
    priority,
    dueAt: due ? fromDateOnly(due) : null,
    doneAt: doneAt ? fromDateOnly(doneAt) : null,
    owner,
    isDraft,
  };
}

function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function fromDateOnly(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match) return null;
  // Obsidian Tasks dates carry no time. Noon UTC rather than midnight, so the
  // date reads the same either side of the international date line.
  return `${match[1]}T12:00:00.000Z`;
}

/* ── Wiki-links ───────────────────────────────────────────────────────── */

export interface WikiLink {
  /** The page name, exactly as written. */
  target: string;
  /** The `|alias` half, when present. */
  alias: string | null;
  /** The whole `[[...]]`, for replacing in place. */
  raw: string;
}

/**
 * Finds `[[Page]]`, `[[Page|alias]]` and `[[Page#Heading]]`.
 *
 * Links inside fenced code blocks and inline code are skipped: a note
 * documenting the syntax should not acquire links to imaginary pages.
 */
export function extractWikiLinks(markdown: string): WikiLink[] {
  const withoutCode = stripCode(markdown);
  const links: WikiLink[] = [];
  const seen = new Set<string>();

  for (const match of withoutCode.matchAll(
    /\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g,
  )) {
    const raw = match[0];
    // `Page#Heading` links to Page; the heading is a scroll position.
    const target = match[1].split("#")[0].trim();
    if (target === "") continue;

    const key = `${target}|${match[2] ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    links.push({ target, alias: match[2]?.trim() || null, raw });
  }

  return links;
}

function stripCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/* ── Note ↔ document ──────────────────────────────────────────────────── */

const SECTIONS: { heading: string; field: keyof NoteDocument }[] = [
  { heading: "Decision", field: "decision" },
  { heading: "Rationale", field: "rationale" },
  { heading: "Context", field: "context" },
];

const FOLLOW_UP_HEADING = "Follow-up actions";

/**
 * Freeform prose gets its own heading.
 *
 * Without one it is ambiguous on the way back in: prose written after
 * `## Context` reads as more Context, because nothing says where Context
 * ended. A heading makes the round trip lossless and, as a bonus, gives the
 * note a sensible outline in Obsidian.
 */
const BODY_HEADING = "Notes";

/** Renders a note as the Markdown file that lives in the vault. */
export function noteToMarkdown(note: NoteDocument): string {
  const data: Record<string, FrontmatterValue> = {
    type: note.kind,
    title: note.title,
  };

  if (note.owner) data.owner = note.owner;
  if (note.decidedOn) data.decided = note.decidedOn.slice(0, 10);

  const frontmatter: Frontmatter = {
    data: { ...data, ...note.extraFrontmatter.data },
    unknown: note.extraFrontmatter.unknown,
  };

  const sections: string[] = [`# ${note.title}`];

  for (const { heading, field } of SECTIONS) {
    const value = note[field] as string | null;
    if (value && value.trim() !== "") {
      sections.push(`## ${heading}\n\n${value.trim()}`);
    }
  }

  if (note.body.trim() !== "") {
    sections.push(`## ${BODY_HEADING}\n\n${note.body.trim()}`);
  }

  if (note.followUps.length > 0) {
    sections.push(
      `## ${FOLLOW_UP_HEADING}\n\n${note.followUps.map(taskToMarkdown).join("\n")}`,
    );
  }

  return serializeDocument(frontmatter, sections.join("\n\n"));
}

/**
 * Reads a vault file back into a note.
 *
 * Tolerant on purpose. The owner edits these files by hand, in Obsidian, on a
 * phone; a note missing its frontmatter, or with the sections in a different
 * order, or with prose where a heading was expected, must still come back as
 * a note rather than as an error.
 */
export function markdownToNote(source: string): NoteDocument {
  const { frontmatter, body } = parseDocument(source);

  const kind = readKind(frontmatter.data.type);
  const known = new Set(["type", "title", "owner", "decided"]);

  const extraData: Record<string, FrontmatterValue> = {};
  for (const [key, value] of Object.entries(frontmatter.data)) {
    if (!known.has(key)) extraData[key] = value;
  }

  const parsed = splitSections(body);

  const title =
    asString(frontmatter.data.title) ??
    parsed.heading ??
    firstNonEmptyLine(body) ??
    "Untitled";

  return {
    kind,
    title,
    decision: parsed.sections.Decision ?? null,
    rationale: parsed.sections.Rationale ?? null,
    context: parsed.sections.Context ?? null,
    owner: asString(frontmatter.data.owner),
    decidedOn: asString(frontmatter.data.decided),
    body: parsed.rest,
    followUps: parsed.followUps,
    extraFrontmatter: { data: extraData, unknown: frontmatter.unknown },
  };
}

interface SplitResult {
  heading: string | null;
  sections: Record<string, string>;
  followUps: MarkdownTask[];
  rest: string;
}

function splitSections(body: string): SplitResult {
  const lines = body.split("\n");

  let heading: string | null = null;
  const sections: Record<string, string> = {};
  const followUps: MarkdownTask[] = [];
  const rest: string[] = [];

  let current: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current === null) {
      rest.push(...buffer);
    } else if (current === BODY_HEADING) {
      rest.push(...buffer);
    } else if (current === FOLLOW_UP_HEADING) {
      for (const line of buffer) {
        const task = markdownToTask(line);
        if (task) followUps.push(task);
        else if (line.trim() !== "") rest.push(line);
      }
    } else {
      sections[current] = buffer.join("\n").trim();
    }
    buffer = [];
  };

  for (const line of lines) {
    const h1 = /^#\s+(.*)$/.exec(line);
    if (
      h1 &&
      heading === null &&
      current === null &&
      rest.every((l) => l.trim() === "")
    ) {
      heading = h1[1].trim();
      continue;
    }

    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      flush();
      const name = h2[1].trim();
      const known = [
        ...SECTIONS.map((s) => s.heading),
        BODY_HEADING,
        FOLLOW_UP_HEADING,
      ];
      if (known.includes(name)) {
        current = name;
      } else {
        // An unrecognised heading is part of the freeform body, heading and
        // all — dropping it would lose the owner's structure.
        current = null;
        buffer.push(line);
      }
      continue;
    }

    buffer.push(line);
  }

  flush();

  return {
    heading,
    sections,
    followUps,
    rest: rest.join("\n").trim(),
  };
}

function readKind(value: FrontmatterValue | undefined): NoteKind {
  return typeof value === "string" &&
    (NOTE_KINDS as readonly string[]).includes(value)
    ? (value as NoteKind)
    : "freeform";
}

function asString(value: FrontmatterValue | undefined): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return null;
}

function firstNonEmptyLine(body: string): string | null {
  const line = body.split("\n").find((candidate) => candidate.trim() !== "");
  return line
    ? line
        .replace(/^#+\s*/, "")
        .trim()
        .slice(0, 300)
    : null;
}

/* ── Paths ────────────────────────────────────────────────────────────── */

/** Folder each kind lives in, so the vault is navigable without the app. */
export const KIND_FOLDER: Record<NoteKind, string> = {
  decision: "Decisions",
  meeting: "Meetings",
  follow_up: "Follow-ups",
  action: "Actions",
  freeform: "Notes",
};

/**
 * A filename that is safe on Windows, macOS and Linux, and on iOS/Android
 * where the vault is synced for Obsidian mobile.
 *
 * Windows is the strictest: `<>:"/\|?*`, trailing dots and spaces, and the
 * reserved device names. Getting this wrong produces a file that cannot be
 * created on the very machine this runs on.
 */
export function safeFileName(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?* -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");

  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  const safe = reserved.test(cleaned) ? `${cleaned}_` : cleaned;

  return (safe === "" ? "Untitled" : safe).slice(0, 120);
}

/** The vault path a note should live at. */
export function vaultPathFor(note: {
  kind: NoteKind;
  title: string;
  decidedOn?: string | null;
  createdAt?: string | null;
}): string {
  const date = (note.decidedOn ?? note.createdAt ?? "").slice(0, 10);
  const prefix = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date} ` : "";

  return `${KIND_FOLDER[note.kind]}/${prefix}${safeFileName(note.title)}.md`;
}
