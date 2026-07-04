import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { addTimeEntry, deleteTimeEntry } from "./actions";

export const dynamic = "force-dynamic";

type TimeEntry = Pick<
  Database["public"]["Tables"]["time_entries"]["Row"],
  "id" | "label" | "hours" | "logged_on" | "note"
>;

export default async function HoursPage() {
  const supabase = await createClient();
  const { data: entries, error } = await supabase
    .from("time_entries")
    .select("id, label, hours, logged_on, note")
    .order("logged_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<TimeEntry[]>();

  // 42P01 = undefined_table — the migration hasn't been applied yet.
  const tableMissing = error?.code === "42P01";
  const rows = entries ?? [];
  const total = rows.reduce((sum, entry) => sum + Number(entry.hours), 0);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Hours</h2>
          <p className="text-sm text-slate-500">
            A first-pass module — log time and see the total. The data model is
            provisional and will be refined against the detailed design.
          </p>
        </div>
        {!tableMissing && !error ? (
          <div className="shrink-0 rounded-2xl border border-slate-200 px-4 py-2 text-right dark:border-slate-800 dark:bg-panel">
            <div className="text-2xl font-semibold tabular-nums">
              {total.toFixed(1)}
            </div>
            <div className="text-xs text-slate-500">hours logged</div>
          </div>
        ) : null}
      </div>

      <form
        action={addTimeEntry}
        className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 p-4 dark:border-slate-800 dark:bg-panel"
      >
        <label className="flex-1 space-y-1">
          <span className="text-xs font-medium text-slate-500">What</span>
          <input
            name="label"
            required
            maxLength={120}
            placeholder="e.g. Deep work"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-500">Hours</span>
          <input
            name="hours"
            type="number"
            required
            min="0.25"
            max="24"
            step="0.25"
            placeholder="1.5"
            className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-500">
            Date (optional)
          </span>
          <input
            name="logged_on"
            type="date"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          Log
        </button>
      </form>

      {tableMissing ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          The <code>time_entries</code> table doesn&apos;t exist yet. Apply the
          migrations in <code>supabase/migrations</code> to your self-hosted
          instance (see <code>supabase/README.md</code>), then reload.
        </div>
      ) : error ? (
        <p className="text-sm text-red-600" role="alert">
          Couldn&apos;t load hours: {error.message}
        </p>
      ) : rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800"
            >
              <span className="w-24 shrink-0 text-xs tabular-nums text-slate-500">
                {entry.logged_on}
              </span>
              <div className="flex-1">
                <p className="text-sm">{entry.label}</p>
                {entry.note ? (
                  <p className="text-xs text-slate-500">{entry.note}</p>
                ) : null}
              </div>
              <span className="text-sm font-medium tabular-nums">
                {Number(entry.hours).toFixed(2)}h
              </span>
              <form action={deleteTimeEntry}>
                <input type="hidden" name="id" value={entry.id} />
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
          No hours logged yet. Add your first above.
        </p>
      )}
    </div>
  );
}
