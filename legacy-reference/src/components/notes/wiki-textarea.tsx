"use client";

import * as React from "react";

import { Textarea } from "@/components/ui/field";
import { useNoteTitles } from "@/lib/notes/client";
import { cn } from "@/lib/utils";

/**
 * A textarea that completes `[[wiki links]]`.
 *
 * The menu opens on `[[` and filters as you type. Arrow keys move, Enter or Tab
 * accepts, Escape dismisses — the same contract as every other completion menu,
 * because this is muscle memory and inventing a new one would be rude.
 *
 * **A title that doesn't exist yet is still a valid link.** The menu offers
 * what you have; it never refuses what you type. Linking a page before writing
 * it is how Obsidian works and how thinking works, and the unresolved link is
 * itself useful information — it is a note you have decided you owe yourself.
 */
export function WikiTextarea({
  value,
  onChange,
  id,
  rows,
  placeholder,
  className,
  "aria-describedby": describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  rows?: number;
  placeholder?: string;
  className?: string;
  "aria-describedby"?: string;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const titles = useNoteTitles();

  const [query, setQuery] = React.useState<string | null>(null);
  const [openAt, setOpenAt] = React.useState<number | null>(null);
  const [highlighted, setHighlighted] = React.useState(0);
  const listId = React.useId();

  const matches = React.useMemo(() => {
    if (query === null) return [];
    const needle = query.toLowerCase();
    return (titles.data ?? [])
      .filter((title) => title.title.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [query, titles.data]);

  /**
   * Finds an unclosed `[[` before the caret.
   *
   * Scanning backwards from the caret rather than tracking state as you type:
   * the caret can move by click, by arrow key, or by undo, and a state machine
   * that only watches keystrokes gets out of step with all three.
   */
  const syncMenu = React.useCallback((text: string, caret: number) => {
    const before = text.slice(0, caret);
    const open = before.lastIndexOf("[[");

    if (open === -1) {
      setQuery(null);
      setOpenAt(null);
      return;
    }

    const between = before.slice(open + 2);
    // A closed link, or a newline, means this `[[` isn't the one we're in.
    if (between.includes("]]") || between.includes("\n")) {
      setQuery(null);
      setOpenAt(null);
      return;
    }

    setQuery(between);
    setOpenAt(open);
    setHighlighted(0);
  }, []);

  const accept = (title: string) => {
    const element = ref.current;
    if (!element || openAt === null) return;

    const caret = element.selectionStart;
    const next = `${value.slice(0, openAt)}[[${title}]]${value.slice(caret)}`;
    onChange(next);

    setQuery(null);
    setOpenAt(null);

    // Put the caret after the closing brackets, so typing continues the
    // sentence rather than landing inside the link.
    const position = openAt + title.length + 4;
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(position, position);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (query === null || matches.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((index) => (index + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => (index - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      accept(matches[highlighted].title);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQuery(null);
      setOpenAt(null);
    }
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        id={id}
        rows={rows}
        placeholder={placeholder}
        className={className}
        value={value}
        aria-describedby={describedBy}
        // Deliberately *not* `aria-expanded` / `aria-controls` /
        // `aria-autocomplete`. Those belong to `role="combobox"`, and axe is
        // right to reject them on a bare textarea — but taking the combobox
        // role would make a screen reader announce this long-form field as a
        // combo box, which is a worse trade for a note body than for a
        // one-line input. The live region below carries the same information
        // in words instead.
        onKeyDown={onKeyDown}
        onChange={(event) => {
          onChange(event.target.value);
          syncMenu(event.target.value, event.target.selectionStart);
        }}
        onClick={(event) => syncMenu(value, event.currentTarget.selectionStart)}
        onKeyUp={(event) => syncMenu(value, event.currentTarget.selectionStart)}
        onBlur={() => {
          // A frame's delay so a click on an option lands before the menu goes.
          requestAnimationFrame(() => setQuery(null));
        }}
      />

      {query !== null && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Link to a note"
          data-testid="wiki-suggestions"
          className="absolute left-2 z-30 mt-1 max-h-56 w-72 overflow-y-auto rounded-md border border-line-strong bg-surface-raised p-1 shadow-[0_4px_12px_rgb(0_0_0/0.12)]"
        >
          {matches.map((match, index) => (
            // `role="none"`: a listbox's children must be options, and an
            // `<li>`'s implicit `listitem` role isn't one. The `<li>` stays
            // for the markup to be valid inside a `<ul>`; its role doesn't.
            <li key={match.id} role="none">
              <button
                type="button"
                role="option"
                aria-selected={index === highlighted}
                className={cn(
                  "w-full truncate rounded px-2 py-1.5 text-left text-sm",
                  index === highlighted
                    ? "bg-primary-soft text-primary-soft-fg"
                    : "text-fg hover:bg-surface-muted",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => accept(match.title)}
              >
                {match.title}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The menu's state, in words, because focus never leaves the textarea
          and there is no combobox role to carry it. Naming the highlighted
          option is the part that matters: "8 matches" tells you a menu exists,
          "Security review, 1 of 8" tells you what Enter will insert. */}
      <span className="sr-only" role="status">
        {query !== null && matches.length > 0
          ? `${matches[highlighted]?.title ?? ""}, ${highlighted + 1} of ${
              matches.length
            }. Use the arrow keys, Enter to link.`
          : ""}
      </span>
    </div>
  );
}
