"use client";

import { Link2, Plus } from "lucide-react";
import * as React from "react";

import { RefChip } from "@/components/connectors/ref-chip";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import {
  useAttachRef,
  useExternalLinks,
  useUnlinkRef,
} from "@/lib/connectors/client";

/**
 * External context on a task or a note.
 *
 * ── Paste, not search ────────────────────────────────────────────────────
 * The primary way to attach something is to paste its URL, because that is
 * what you already have: you were looking at the pull request, you copied the
 * address, you want it on the task. A search-first design makes you describe
 * something you are holding.
 *
 * ── Pasting is the confirmation ──────────────────────────────────────────
 * The product's rule is confirm-before-link, and this does not break it. The
 * rule exists because a *guessed* link is an assertion the owner never made —
 * a parser deciding two things are related. A pasted URL is the owner making
 * the assertion themselves, so asking again would be asking them to confirm
 * that they meant to do the thing they just did.
 *
 * Suggested links, when a detector eventually makes them, arrive unconfirmed
 * and render as an offer. The database refuses a backdated confirmation
 * either way.
 */
export function ContextPanel({
  taskId,
  noteId,
  title = "Linked context",
}: {
  taskId?: string;
  noteId?: string;
  title?: string;
}) {
  const links = useExternalLinks({ taskId, noteId });
  const attach = useAttachRef();
  const unlink = useUnlinkRef();
  const { toast } = useToast();

  const [url, setUrl] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const inputId = React.useId();

  const items = links.data ?? [];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    attach.mutate(
      { url: trimmed, taskId, noteId },
      {
        onSuccess: (link) => {
          setUrl("");
          setAdding(false);
          toast({
            title: "Attached",
            description: link.ref.title,
            tone: "success",
          });
        },
        onError: (error) =>
          toast({
            title: "Couldn't attach that",
            // The connector's own sentence. It already distinguishes "no such
            // thing" from "the token cannot see it", which are different
            // problems with different fixes.
            description: error.message,
            tone: "danger",
          }),
      },
    );
  }

  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">
          <span aria-hidden="true" className="[&_svg]:size-3.5">
            <Link2 />
          </span>
          {title}
          {items.length > 0 && (
            <span className="tabular-nums text-fg-subtle">{items.length}</span>
          )}
        </h3>

        {!adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus />
            Attach a link
          </Button>
        )}
      </div>

      {adding && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor={inputId}>Paste a link</Label>
            <Input
              id={inputId}
              value={url}
              autoFocus
              placeholder="https://github.com/owner/repo/pull/482"
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setUrl("");
                  setAdding(false);
                }
              }}
            />
          </div>

          <Button type="submit" size="sm" disabled={attach.isPending}>
            {attach.isPending ? "Attaching…" : "Attach"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setUrl("");
              setAdding(false);
            }}
          >
            Cancel
          </Button>
        </form>
      )}

      {links.isLoading ? (
        <p className="text-xs text-fg-muted">Loading…</p>
      ) : items.length === 0 ? (
        !adding && (
          <p className="text-xs text-fg-muted">
            Nothing attached. Paste a link to a pull request, issue or document
            and it will show its state here.
          </p>
        )
      ) : (
        <ul className="space-y-1.5" data-testid="context-list">
          {items.map((link) => (
            <RefChip
              key={link.id}
              link={link}
              removing={unlink.isPending}
              onRemove={() =>
                unlink.mutate(link.id, {
                  onError: (error) =>
                    toast({
                      title: "Couldn't detach that",
                      description: error.message,
                      tone: "danger",
                    }),
                })
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
