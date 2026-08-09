import type { Metadata } from "next";

import { BoardView } from "@/components/kanban/board-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kanban",
};

/**
 * The board.
 *
 * A view of `tasks.status`, not a separate record — which is why moving a card
 * here shows up on the Tasks page immediately, with no synchronisation step
 * between them.
 */
export default function KanbanPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-fg">Board</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Everything you capture lands in Inbox. Triage it, then promote it to
          Ready. Focus a card and use{" "}
          <kbd className="rounded border border-line px-1 text-xs">←</kbd> and{" "}
          <kbd className="rounded border border-line px-1 text-xs">→</kbd> to
          move it, or drag it.
        </p>
      </header>

      <BoardView />
    </div>
  );
}
