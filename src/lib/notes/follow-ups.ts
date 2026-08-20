/**
 * Follow-up actions inside a note.
 *
 * A decision log's follow-ups live in the body as Markdown checkboxes — the
 * same shape the vault writes and Obsidian's Tasks plugin reads, so a
 * follow-up written in Obsidian and one written here are the same text.
 *
 * They become **draft** tasks, never live ones. The specification is explicit
 * that a follow-up needs an owner, a due date and a priority before it counts
 * as work, and the reason is worth stating: a decision log that silently
 * emitted live tasks would fill the board with items nobody agreed to own,
 * and a board full of those stops being read.
 */

/** `- [ ] Do the thing` / `* [x] Done thing`, with optional indentation. */
const CHECKBOX = /^\s*[-*]\s+\[( |x|X)\]\s+(.+?)\s*$/;

/** Trailing Obsidian Tasks metadata, stripped from the title. */
const TASK_METADATA =
  /\s*(#\w[\w/-]*|👤\s*\S+|[⏫🔼🔽]|📅\s*\d{4}-\d{2}-\d{2})/gu;

export interface FollowUpAction {
  /** Line index in the body, so the caller can mark just this one. */
  line: number;
  title: string;
  checked: boolean;
}

/**
 * Every checkbox in a note body, in document order.
 *
 * Checked ones are included rather than filtered: the caller decides what to
 * offer, and hiding a completed follow-up here would make "why is that one
 * missing" a question about this function rather than about the note.
 */
export function findFollowUps(body: string): FollowUpAction[] {
  const actions: FollowUpAction[] = [];

  body.split("\n").forEach((text, line) => {
    const match = CHECKBOX.exec(text);
    if (!match) return;

    const title = match[2].replace(TASK_METADATA, "").trim();
    if (title === "") return;

    actions.push({ line, title, checked: match[1].toLowerCase() === "x" });
  });

  return actions;
}
