import type { Metadata } from "next";

import { CategoryManager } from "@/components/tasks/category-manager";
import { TasksView } from "@/components/tasks/tasks-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tasks",
};

export default function TasksPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-fg">Tasks</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Capture in one line. Triage when you have a moment. Press{" "}
          <kbd className="rounded-sm border border-line-strong bg-surface-muted px-1 text-xs">
            ?
          </kbd>{" "}
          for shortcuts.
        </p>
      </header>

      <TasksView />

      {/* The taxonomy lives where it is used, folded away — a settings screen
          consulted about once a quarter has no business at the top of a page
          visited every day. */}
      <CategoryManager />
    </div>
  );
}
