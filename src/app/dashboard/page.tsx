import { ModuleCard } from "@/components/module-card";

export const dynamic = "force-dynamic";

const MODULES = [
  {
    title: "Priority",
    description:
      "Ranked view of what matters most right now. Wiring arrives in Phase 1.",
    status: "Planned",
  },
  {
    title: "Hours",
    description:
      "Time allocation and capacity at a glance. Wiring arrives in Phase 1.",
    status: "Planned",
  },
  {
    title: "Notion",
    description:
      "Synced notes, docs, and tasks from Notion. Wiring arrives in Phase 1.",
    status: "Planned",
  },
];

export default function DashboardHome() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Overview</h2>
        <p className="text-sm text-slate-500">
          Phase 0 skeleton — the modules below are placeholders pending the
          detailed design.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((module) => (
          <ModuleCard key={module.title} {...module} />
        ))}
      </div>
    </div>
  );
}
