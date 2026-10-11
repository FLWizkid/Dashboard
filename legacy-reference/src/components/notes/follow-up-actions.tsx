"use client";

import { CheckSquare, ListPlus } from "lucide-react";
import { useMemo, useState } from "react";

import { findFollowUps } from "@/lib/notes/follow-ups";
import { useCreateTask } from "@/lib/tasks/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Turning a note's follow-ups into work.
 *
 * The database has carried the draft machinery since P3 — `is_draft`, a
 * `can_activate` generated column, a trigger refusing the transition — and
 * nothing could create one, so the path from a decision to its follow-through
 * existed only on paper.
 *
 * ── Drafts, deliberately ─────────────────────────────────────────────────
 * These arrive needing an owner, a due date and a priority. Until they have
 * all three they stay off the board, out of the counts and out of the
 * ranking. That is the specification, and the reason holds up: writing "we
 * should tell legal" in a meeting note is not the same as committing to do
 * it by Thursday.
 */

export function FollowUpActions({
  noteId,
  noteTitle,
  body,
}: {
  noteId: string;
  noteTitle: string;
  body: string;
}) {
  const createTask = useCreateTask();
  const [created, setCreated] = useState<Record<number, boolean>>({});

  const actions = useMemo(() => findFollowUps(body), [body]);
  const open = actions.filter((action) => !action.checked);

  if (actions.length === 0) return null;

  return (
    <section className="space-y-2" data-testid="follow-up-actions">
      <header className="flex items-center gap-2">
        <CheckSquare aria-hidden className="size-4 text-fg-muted" />
        <h3 className="text-sm font-semibold text-fg">Follow-up actions</h3>
        <Badge tone="neutral">{open.length} open</Badge>
      </header>

      <p className="text-xs text-fg-subtle">
        These become <strong>drafts</strong>. A draft stays off the board until
        it has an owner, a due date and a priority.
      </p>

      <ul role="list" className="space-y-1">
        {actions.map((action) => (
          <li
            key={action.line}
            className="flex items-center gap-3 text-sm"
            data-testid="follow-up-action"
          >
            <span
              className={
                action.checked
                  ? "flex-1 text-fg-muted line-through"
                  : "flex-1 text-fg"
              }
            >
              {action.title}
            </span>

            {action.checked ? (
              <span className="text-xs text-fg-subtle">Done</span>
            ) : created[action.line] ? (
              <span className="text-xs text-fg-muted">Draft created</span>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={createTask.isPending}
                onClick={() => {
                  createTask.mutate(
                    {
                      title: action.title,
                      isDraft: true,
                      status: "inbox",
                      // Left unset on purpose: owner, due date and priority
                      // are exactly the three the owner has to supply before
                      // this draft becomes work.
                      notes: null,
                      priority: null,
                      dueAt: null,
                      categoryId: null,
                      pinned: false,
                      sourceLink: null,
                      owner: null,
                      clientKey: null,
                      links: [
                        {
                          kind: "note",
                          relation: "source",
                          targetId: noteId,
                          targetLabel: noteTitle,
                          targetUrl: null,
                          // The owner wrote the follow-up in this note and
                          // pressed this button; the link back is the request,
                          // not a guess.
                          confirmed: true,
                        },
                      ],
                    },
                    {
                      onSuccess: () =>
                        setCreated((prev) => ({
                          ...prev,
                          [action.line]: true,
                        })),
                    },
                  );
                }}
              >
                <ListPlus className="size-4" aria-hidden />
                Create draft
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
