"use client";

import { CornerDownLeft } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useBacklinks } from "@/lib/notes/client";
import { NOTE_KIND_LABELS, type NoteKind } from "@/lib/notes/markdown";

/**
 * What links here.
 *
 * The half of a wiki that makes it worth keeping. A decision log where you can
 * only follow links forwards is a pile of documents; being able to ask "what
 * referred back to this?" is what turns it into a record.
 *
 * Each row carries the line the link appears on, because "three notes link
 * here" is trivia and "the vendor renewal note says *superseded by [[this]]*"
 * is the answer you came for.
 */
export function BacklinksPane({ noteId }: { noteId: string }) {
  const backlinks = useBacklinks(noteId);
  const list = backlinks.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <span className="text-fg-subtle [&_svg]:size-4">
              <CornerDownLeft />
            </span>
            Linked from
          </CardTitle>
          <CardDescription className="mt-1">
            Notes that point at this one.
          </CardDescription>
        </div>
        {list.length > 0 && (
          <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-fg-muted">
            {list.length}
          </span>
        )}
      </CardHeader>

      <CardContent>
        {backlinks.isLoading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-fg-muted">Nothing links here yet.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="backlinks">
            {list.map((backlink) => (
              <li key={backlink.noteId} className="py-2.5">
                <p className="text-sm font-medium text-fg">
                  {backlink.title}
                  <span className="ml-2 text-xs font-normal text-fg-subtle">
                    {NOTE_KIND_LABELS[backlink.kind as NoteKind]}
                  </span>
                </p>
                {backlink.excerpt && (
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {backlink.excerpt}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
