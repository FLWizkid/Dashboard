/**
 * The backlink index.
 *
 * `[[Vendor renewal]]` in one note means "Vendor renewal" should show that
 * note under Linked mentions. That is the whole feature, and the two things
 * that make it worth building carefully are:
 *
 * • **Unresolved links are a real state, not an error.** Obsidian lets you
 *   link to a page before you write it, and that is how people think — you
 *   mention the thing, then create it later. An unresolved link is recorded
 *   with its label so it can resolve itself the moment the note appears.
 *
 * • **Titles are matched the way a person means them.** Case and surrounding
 *   whitespace do not distinguish two notes, and neither does the folder or
 *   the date prefix in the filename.
 */

import { extractWikiLinks } from "./markdown";

export interface IndexedNote {
  id: string;
  title: string;
  /** Everything a wiki-link could be written in. */
  searchableText: string;
  /** Optional alternative titles, e.g. from frontmatter aliases. */
  aliases?: string[];
}

export interface ResolvedLink {
  fromNoteId: string;
  /** Exactly as written between the brackets. */
  label: string;
  alias: string | null;
  /** `null` when the target does not exist yet. */
  toNoteId: string | null;
}

export interface BacklinkIndex {
  /** Every link, resolved or not. */
  links: ResolvedLink[];
  /** note id → the notes it links to. */
  outgoing: Map<string, ResolvedLink[]>;
  /** note id → the links pointing at it. */
  incoming: Map<string, ResolvedLink[]>;
  /** Labels nothing resolves to yet, with who mentions them. */
  unresolved: Map<string, string[]>;
}

/** The key two titles are considered the same under. */
export function titleKey(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      // A filename may carry a date prefix; the title it refers to does not.
      .replace(/^\d{4}-\d{2}-\d{2}\s+/, "")
      .replace(/\.md$/, "")
      .replace(/\s+/g, " ")
  );
}

/**
 * Builds the whole index in one pass.
 *
 * Rebuilt wholesale rather than maintained incrementally: the note count here
 * is in the thousands at most, a full rebuild is milliseconds, and an
 * incremental index that drifts is worse than no index — it shows links that
 * are not there.
 */
export function buildBacklinkIndex(notes: IndexedNote[]): BacklinkIndex {
  const byTitle = new Map<string, string>();

  for (const note of notes) {
    // First writer wins, so a later duplicate title cannot silently steal
    // every existing link.
    const key = titleKey(note.title);
    if (!byTitle.has(key)) byTitle.set(key, note.id);

    for (const alias of note.aliases ?? []) {
      const aliasKey = titleKey(alias);
      if (!byTitle.has(aliasKey)) byTitle.set(aliasKey, note.id);
    }
  }

  const links: ResolvedLink[] = [];
  const outgoing = new Map<string, ResolvedLink[]>();
  const incoming = new Map<string, ResolvedLink[]>();
  const unresolved = new Map<string, string[]>();

  for (const note of notes) {
    for (const wikiLink of extractWikiLinks(note.searchableText)) {
      const targetId = byTitle.get(titleKey(wikiLink.target)) ?? null;

      // A note linking to itself is noise, not a backlink.
      if (targetId === note.id) continue;

      const link: ResolvedLink = {
        fromNoteId: note.id,
        label: wikiLink.target,
        alias: wikiLink.alias,
        toNoteId: targetId,
      };

      links.push(link);
      push(outgoing, note.id, link);

      if (targetId) {
        push(incoming, targetId, link);
      } else {
        const key = titleKey(wikiLink.target);
        const mentions = unresolved.get(key) ?? [];
        if (!mentions.includes(note.id)) mentions.push(note.id);
        unresolved.set(key, mentions);
      }
    }
  }

  return { links, outgoing, incoming, unresolved };
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

/** The notes linking to `noteId`, de-duplicated. */
export function backlinksFor(index: BacklinkIndex, noteId: string): string[] {
  const seen = new Set<string>();
  for (const link of index.incoming.get(noteId) ?? [])
    seen.add(link.fromNoteId);
  return [...seen];
}

/** The notes `noteId` links to, de-duplicated and resolved only. */
export function forwardLinksFor(
  index: BacklinkIndex,
  noteId: string,
): string[] {
  const seen = new Set<string>();
  for (const link of index.outgoing.get(noteId) ?? []) {
    if (link.toNoteId) seen.add(link.toNoteId);
  }
  return [...seen];
}

/**
 * Links that point at nothing, with the notes that mention them.
 *
 * Surfaced in the UI as "mentioned but not written" — the list of pages the
 * owner has promised themselves.
 */
export function unresolvedLinks(
  index: BacklinkIndex,
): { label: string; mentionedBy: string[] }[] {
  return [...index.unresolved].map(([label, mentionedBy]) => ({
    label,
    mentionedBy,
  }));
}
