"use client";

import { Archive, Link2, Trash2, TriangleAlert } from "lucide-react";
import * as React from "react";

import { ContextPanel } from "@/components/connectors/context-panel";
import { FollowUpActions } from "@/components/notes/follow-up-actions";
import { BacklinksPane } from "@/components/notes/backlinks-pane";
import { WikiTextarea } from "@/components/notes/wiki-textarea";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useDeleteNote, useNote, useUpdateNote } from "@/lib/notes/client";
import { NOTE_KIND_LABELS, NOTE_KINDS } from "@/lib/notes/markdown";
import type { NoteKind } from "@/lib/notes/markdown";

/**
 * The note editor.
 *
 * ── Decision and rationale are siblings ──────────────────────────────────
 * Two fields of equal size, side by side, with equal labels. Not a title and
 * a body; not a field and an optional note. The database says the same thing
 * with a generated column and the Markdown says it with two `##` headings —
 * this is the third place, and the one the owner actually sees.
 *
 * A decision without its reasoning is an edict you cannot re-evaluate
 * eighteen months later, which is exactly when you need to.
 *
 * ── Incomplete is a state, not an error ──────────────────────────────────
 * A decision note saves without its rationale. You capture the decision in
 * the meeting and write down why afterwards; refusing the save would lose the
 * decision entirely. The banner says what is missing and the list marks it.
 */
export function NoteEditor({
  noteId,
  onDeleted,
}: {
  noteId: string;
  onDeleted: () => void;
}) {
  const note = useNote(noteId);
  const update = useUpdateNote();
  const remove = useDeleteNote();
  const { toast } = useToast();

  const [draft, setDraft] = React.useState<{
    kind: NoteKind;
    title: string;
    decision: string;
    rationale: string;
    context: string;
    owner: string;
    decidedOn: string;
    body: string;
  } | null>(null);

  // Reset the draft when a different note is opened, but not on every refetch
  // — that would discard what is being typed the moment a query revalidates.
  const loadedId = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!note.data || loadedId.current === note.data.id) return;
    loadedId.current = note.data.id;
    setDraft({
      kind: note.data.kind,
      title: note.data.title,
      decision: note.data.decision ?? "",
      rationale: note.data.rationale ?? "",
      context: note.data.context ?? "",
      owner: note.data.owner ?? "",
      decidedOn: note.data.decidedOn ?? "",
      body: note.data.body,
    });
  }, [note.data]);

  if (note.isLoading || !draft) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-fg-muted">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (note.isError || !note.data) {
    return (
      <Card>
        <CardContent className="p-6">
          <p role="alert" className="text-sm text-priority-critical">
            Couldn&rsquo;t open that note.
          </p>
        </CardContent>
      </Card>
    );
  }

  const set = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) => setDraft({ ...draft, [key]: value });

  const missing =
    draft.kind === "decision"
      ? [
          draft.decision.trim() ? null : "the decision",
          draft.rationale.trim() ? null : "the reasoning",
        ].filter((part): part is string => part !== null)
      : [];

  const save = async () => {
    await update.mutateAsync({
      id: noteId,
      patch: {
        kind: draft.kind,
        title: draft.title.trim() || "Untitled",
        decision: draft.decision.trim() || null,
        rationale: draft.rationale.trim() || null,
        context: draft.context.trim() || null,
        owner: draft.owner.trim() || null,
        decidedOn: draft.decidedOn || null,
        body: draft.body,
      },
    });

    toast({
      title: "Saved",
      description: missing.length
        ? `Still missing ${missing.join(" and ")}.`
        : undefined,
      tone: "success",
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="min-w-0 flex-1">
            <Label htmlFor="note-title" className="sr-only">
              Title
            </Label>
            <Input
              id="note-title"
              value={draft.title}
              maxLength={300}
              className="border-0 bg-transparent px-0 text-lg font-semibold tracking-tight"
              placeholder="Untitled"
              onChange={(event) => set("title", event.target.value)}
            />
            {note.data.vaultPath && (
              <p className="mt-0.5 truncate font-mono text-xs text-fg-subtle">
                {note.data.vaultPath}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void update.mutateAsync({
                  id: noteId,
                  patch: { isArchived: !note.data.isArchived },
                })
              }
            >
              <Archive />
              {note.data.isArchived ? "Unarchive" : "Archive"}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Delete “${note.data.title}”`}
              onClick={async () => {
                await remove.mutateAsync(noteId);
                toast({ title: "Note deleted", tone: "neutral" });
                onDeleted();
              }}
            >
              <Trash2 />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="note-kind">Kind</Label>
              <Select
                id="note-kind"
                value={draft.kind}
                onChange={(event) =>
                  set("kind", event.target.value as NoteKind)
                }
              >
                {NOTE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {NOTE_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="note-owner">Owner</Label>
              <Input
                id="note-owner"
                value={draft.owner}
                maxLength={120}
                placeholder="Who owns this?"
                onChange={(event) => set("owner", event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="note-decided">Decided on</Label>
              <Input
                id="note-decided"
                type="date"
                value={draft.decidedOn}
                onChange={(event) => set("decidedOn", event.target.value)}
              />
            </div>
          </div>

          {missing.length > 0 && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-md bg-priority-high-soft px-3 py-2 text-xs text-priority-high"
            >
              <span className="mt-0.5 shrink-0 [&_svg]:size-3.5" aria-hidden>
                <TriangleAlert />
              </span>
              <span>
                This decision is incomplete — it still needs{" "}
                {missing.join(" and ")}. It saves anyway; a decision recorded
                without its reasoning is better than one not recorded at all.
              </span>
            </p>
          )}

          {/* The two anchors. Same size, same weight, side by side. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="note-decision">Decision</Label>
              <WikiTextarea
                id="note-decision"
                rows={6}
                placeholder="What was decided?"
                value={draft.decision}
                onChange={(value) => set("decision", value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="note-rationale">Why</Label>
              <WikiTextarea
                id="note-rationale"
                rows={6}
                placeholder="What made this the right call? What were the alternatives?"
                value={draft.rationale}
                onChange={(value) => set("rationale", value)}
                aria-describedby="note-rationale-hint"
              />
              <p id="note-rationale-hint" className="text-xs text-fg-subtle">
                Read eighteen months from now by someone deciding whether this
                still holds — possibly you.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note-context">Context</Label>
            <WikiTextarea
              id="note-context"
              rows={3}
              placeholder="What was going on at the time?"
              value={draft.context}
              onChange={(value) => set("context", value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note-body">Notes</Label>
            <WikiTextarea
              id="note-body"
              rows={10}
              placeholder="Markdown. Type [[ to link another note."
              value={draft.body}
              onChange={(value) => set("body", value)}
              aria-describedby="note-body-hint"
            />
            <p id="note-body-hint" className="text-xs text-fg-subtle">
              Type <code className="font-mono">[[</code> to link another note. A
              page that doesn&rsquo;t exist yet is still a valid link.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={() => void save()} disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
            <span className="text-xs text-fg-subtle">
              Version {note.data.version}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <FollowUpActions
            noteId={noteId}
            noteTitle={note.data.title}
            body={draft.body}
          />
        </CardContent>
      </Card>

      <OutboundLinks note={note.data} />

      <Card>
        <CardContent className="p-4">
          <ContextPanel noteId={noteId} />
        </CardContent>
      </Card>

      <BacklinksPane noteId={noteId} />
    </div>
  );
}

/* ── What this note points at ─────────────────────────────────────────── */

function OutboundLinks({
  note,
}: {
  note: {
    links: {
      id: string;
      kind: string;
      targetNoteId: string | null;
      targetLabel: string;
    }[];
  };
}) {
  if (note.links.length === 0) return null;

  const unresolved = note.links.filter(
    (link) => link.kind === "note" && !link.targetNoteId,
  );

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <span className="text-fg-subtle [&_svg]:size-4">
              <Link2 />
            </span>
            Links from this note
          </CardTitle>
          {unresolved.length > 0 && (
            <CardDescription className="mt-1">
              {unresolved.length} point at{" "}
              {unresolved.length === 1 ? "a note" : "notes"} that
              {unresolved.length === 1 ? " doesn't" : " don't"} exist yet.
              That&rsquo;s allowed — it&rsquo;s a note you owe yourself.
            </CardDescription>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-wrap gap-1.5" data-testid="outbound-links">
          {note.links.map((link) => (
            <li key={link.id}>
              <span
                className={
                  link.kind === "note" && !link.targetNoteId
                    ? "inline-flex items-center rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-fg-subtle"
                    : "inline-flex items-center rounded-full bg-primary-soft px-2.5 py-1 text-xs text-primary-soft-fg"
                }
              >
                {link.targetLabel}
                {link.kind === "note" && !link.targetNoteId && (
                  <span className="sr-only"> — not written yet</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
