import { createClient } from "@/lib/supabase/server";
import { fetchRecentNotionItems } from "@/lib/notion";
import { ModuleCard } from "@/components/module-card";
import { StatTile } from "@/components/stat-tile";

export const dynamic = "force-dynamic";

const MODULES: {
  title: string;
  description: string;
  status: string;
  href?: string;
}[] = [
  {
    title: "Priority",
    description:
      "Per-user priority list. First-pass module — open it to try it out.",
    status: "Live (draft)",
    href: "/dashboard/priority",
  },
  {
    title: "Hours",
    description: "Log time and see the total at a glance. First-pass module.",
    status: "Live (draft)",
    href: "/dashboard/hours",
  },
  {
    title: "Notion",
    description:
      "Recent items from a Notion database you connect. First-pass module.",
    status: "Live (draft)",
    href: "/dashboard/notion",
  },
];

function isMissingTable(error: { code?: string } | null): boolean {
  // 42P01 = undefined_table — migrations not applied yet.
  return error?.code === "42P01";
}

export default async function DashboardHome() {
  const supabase = await createClient();

  const [priorityRes, hoursRes, notion] = await Promise.all([
    supabase
      .from("priorities")
      .select("is_done")
      .returns<{ is_done: boolean }[]>(),
    supabase
      .from("time_entries")
      .select("hours")
      .returns<{ hours: number }[]>(),
    fetchRecentNotionItems(),
  ]);

  const priorities = priorityRes.data ?? [];
  const openPriorities = priorities.filter((p) => !p.is_done).length;
  const priorityHint = isMissingTable(priorityRes.error)
    ? "Run migrations"
    : `${priorities.length} total`;

  const hours = hoursRes.data ?? [];
  const totalHours = hours.reduce((sum, entry) => sum + Number(entry.hours), 0);
  const hoursHint = isMissingTable(hoursRes.error)
    ? "Run migrations"
    : `${hours.length} entries`;

  const notionValue = notion.status === "ok" ? String(notion.items.length) : "—";
  const notionHint =
    notion.status === "ok"
      ? "recent items"
      : notion.status === "not_configured"
        ? "Not connected"
        : "Error";

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold">Overview</h2>
        <p className="text-sm text-slate-500">
          A live snapshot across your modules.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Open priorities"
          value={String(openPriorities)}
          hint={priorityHint}
        />
        <StatTile
          label="Hours logged"
          value={totalHours.toFixed(1)}
          hint={hoursHint}
        />
        <StatTile label="Notion items" value={notionValue} hint={notionHint} />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
          Modules
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((module) => (
            <ModuleCard key={module.title} {...module} />
          ))}
        </div>
      </div>
    </div>
  );
}
