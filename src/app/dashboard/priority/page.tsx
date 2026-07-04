import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { addPriority, deletePriority, togglePriority } from "./actions";

export const dynamic = "force-dynamic";

const LEVEL_LABELS: Record<number, string> = { 1: "High", 2: "Medium", 3: "Low" };

type PrioritySummary = Pick<
  Database["public"]["Tables"]["priorities"]["Row"],
  "id" | "title" | "note" | "level" | "is_done" | "created_at"
>;

export default async function PriorityPage() {
  const supabase = await createClient();
  const { data: priorities, error } = await supabase
    .from("priorities")
    .select("id, title, note, level, is_done, created_at")
    .order("is_done", { ascending: true })
    .order("level", { ascending: true })
    .order("created_at", { ascending: false })
    .returns<PrioritySummary[]>();

  // 42P01 = undefined_table — the migration hasn't been applied yet.
  const tableMissing = error?.code === "42P01";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Priority</h2>
        <p className="text-sm text-slate-500">
          A first-pass module — a per-user priority list. The data model is
          provisional and will be refined against the detailed design.
        </p>
      </div>

      <form
        action={addPriority}
        className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 p-4 dark:border-slate-800 dark:bg-panel"
      >
        <label className="flex-1 space-y-1">
          <span className="text-xs font-medium text-slate-500">New priority</span>
          <input
            name="title"
            required
            maxLength={200}
            placeholder="What needs attention?"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-500">Level</span>
          <select
            name="level"
            defaultValue="2"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="1">High</option>
            <option value="2">Medium</option>
            <option value="3">Low</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          Add
        </button>
      </form>

      {tableMissing ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          The <code>priorities</code> table doesn&apos;t exist yet. Apply the
          migrations in <code>supabase/migrations</code> to your self-hosted
          instance (see <code>supabase/README.md</code>), then reload.
        </div>
      ) : error ? (
        <p className="text-sm text-red-600" role="alert">
          Couldn&apos;t load priorities: {error.message}
        </p>
      ) : priorities && priorities.length > 0 ? (
        <ul className="space-y-2">
          {priorities.map((p) => (
            <li
              key={p.id}
              className={`flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800 ${
                p.is_done ? "opacity-60" : ""
              }`}
            >
              <form action={togglePriority}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="is_done" value={String(p.is_done)} />
                <button
                  type="submit"
                  aria-label={p.is_done ? "Mark as not done" : "Mark as done"}
                  className="flex h-5 w-5 items-center justify-center rounded border border-slate-400 text-xs dark:border-slate-600"
                >
                  {p.is_done ? "✓" : ""}
                </button>
              </form>

              <div className="flex-1">
                <p className={`text-sm ${p.is_done ? "line-through" : ""}`}>
                  {p.title}
                </p>
                {p.note ? (
                  <p className="text-xs text-slate-500">{p.note}</p>
                ) : null}
              </div>

              <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-500 dark:border-slate-700">
                {LEVEL_LABELS[p.level] ?? "—"}
              </span>

              <form action={deletePriority}>
                <input type="hidden" name="id" value={p.id} />
                <button
                  type="submit"
                  aria-label="Delete"
                  className="text-xs text-slate-400 transition hover:text-red-600"
                >
                  ✕
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">
          No priorities yet. Add your first above.
        </p>
      )}
    </div>
  );
}
