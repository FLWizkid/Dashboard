"use client";

import { FileText, Plus, Search, TriangleAlert } from "lucide-react";
import * as React from "react";

import { NoteEditor } from "@/components/notes/note-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import { useCreateNote, useNotes } from "@/lib/notes/client";
import { NOTE_KIND_LABELS, NOTE_KINDS } from "@/lib/notes/markdown";
import type { NoteKind } from "@/lib/notes/markdown";
import type { NoteSummary } from "@/lib/notes/types";
import { cn } from "@/lib/utils";

/**
 * The notes module: a list beside an editor.
 *
 * Capture is one field and one button. Everything else about a note — the
 * reasoning, the owner, the links — is added afterwards, which is the same
 * capture-first shape the task inbox uses and for the same reason: the moment
 * you need to write something down is never the moment you have time to
 * classify it.
 */
export function NotesView() {
  const [kind, setKind] = React.useState<NoteKind | "">("");
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);

  const notes = useNotes({ kind, q: query });
  const create = useCreateNote();
  const [title, setTitle] = React.useState("");

  // Debounced, because full-text search on every keystroke is a query per
  // character and the answers arrive out of order.
  React.useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const list = notes.data ?? [];

  // The open note deliberately stays open when the filter or the search no
  // longer includes it. Closing it would mean typing a search term while
  // editing throws away what you were doing — the filter narrows the *list*,
  // and the editor is not part of the list. Deletion closes it, via
  // `onDeleted`; that is the only case where there is nothing left to show.

  const capture = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;

    const note = await create.mutateAsync({
      kind: kind || "freeform",
      title: title.trim(),
      decision: null,
      rationale: null,
      context: null,
      owner: null,
      decidedOn: null,
      body: "",
      links: [],
    });

    setTitle("");
    setSelected(note.id);
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-fg">Notes</h1>
        <p className="mt-1 text-sm text-fg-muted">
          A decision log in plain Markdown, in your vault. Decision and
          reasoning carry equal weight — a decision without its reasoning
          can&rsquo;t be re-evaluated later.
        </p>
      </header>

      <form onSubmit={capture} className="flex gap-2">
        <Label htmlFor="note-capture" className="sr-only">
          New note title
        </Label>
        <Input
          id="note-capture"
          data-testid="note-capture"
          value={title}
          maxLength={300}
          placeholder="Capture a note…"
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button type="submit" disabled={create.isPending || !title.trim()}>
          <Plus />
          Add
        </Button>
      </form>

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle [&_svg]:size-4"
                aria-hidden="true"
              >
                <Search />
              </span>
              <Label htmlFor="note-search" className="sr-only">
                Search notes
              </Label>
              <Input
                id="note-search"
                className="pl-8"
                value={search}
                placeholder="Search"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <Label htmlFor="note-kind-filter" className="sr-only">
              Filter by kind
            </Label>
            <Select
              id="note-kind-filter"
              className="w-32"
              value={kind}
              onChange={(event) => setKind(event.target.value as NoteKind | "")}
            >
              <option value="">All kinds</option>
              {NOTE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {NOTE_KIND_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>

          <NoteList
            notes={list}
            loading={notes.isLoading}
            selected={selected}
            onSelect={setSelected}
          />
        </div>

        {selected ? (
          <NoteEditor noteId={selected} onDeleted={() => setSelected(null)} />
        ) : (
          <Card>
            <CardContent className="flex min-h-48 flex-col items-center justify-center gap-2 p-8 text-center">
              <span className="text-fg-subtle [&_svg]:size-6" aria-hidden>
                <FileText />
              </span>
              <p className="text-sm text-fg-muted">
                Pick a note, or capture a new one above.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function NoteList({
  notes,
  loading,
  selected,
  onSelect,
}: {
  notes: NoteSummary[];
  loading: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return <p className="text-sm text-fg-muted">Loading…</p>;
  }

  if (notes.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        No notes yet. The first thing you capture shows up here.
      </p>
    );
  }

  return (
    <ul
      className="divide-y divide-line rounded-lg border border-line bg-surface-raised"
      data-testid="note-list"
    >
      {notes.map((note) => (
        <li key={note.id}>
          <button
            type="button"
            data-testid="note-list-item"
            aria-current={note.id === selected ? "true" : undefined}
            onClick={() => onSelect(note.id)}
            className={cn(
              "w-full px-3 py-2.5 text-left transition-colors duration-fast",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              note.id === selected
                ? "bg-primary-soft"
                : "hover:bg-surface-muted",
            )}
          >
            <span className="flex items-start justify-between gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  note.id === selected
                    ? "font-medium text-primary-soft-fg"
                    : "text-fg",
                )}
              >
                {note.title}
              </span>

              {/* An incomplete decision is marked in the list, not only in the
                  editor — otherwise you have to open each one to find the
                  gaps, which means you never do. */}
              {!note.isCompleteDecision && (
                <span
                  className="shrink-0 text-priority-high [&_svg]:size-3.5"
                  title="Missing its decision or reasoning"
                >
                  <TriangleAlert />
                  <span className="sr-only">
                    Incomplete — missing its decision or reasoning
                  </span>
                </span>
              )}
            </span>

            {/* `fg-muted`, not `fg-subtle`: the subtle token clears AA on the
                page background but not on `primary-soft`, which is what the
                selected row is painted with. One token that works on both
                beats two that each work on one. */}
            <span
              className={cn(
                "mt-0.5 flex items-center gap-2 text-xs",
                note.id === selected ? "text-primary-soft-fg" : "text-fg-muted",
              )}
            >
              <span>{NOTE_KIND_LABELS[note.kind]}</span>
              {note.owner && <span>· {note.owner}</span>}
              {note.backlinkCount > 0 && (
                <span>
                  · {note.backlinkCount} inbound
                  <span className="sr-only"> links</span>
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
