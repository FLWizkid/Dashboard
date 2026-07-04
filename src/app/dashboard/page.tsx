import { ModuleCard } from "@/components/module-card";

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
    description: "Time allocation and capacity at a glance. Design pending.",
    status: "Planned",
  },
  {
    title: "Notion",
    description: "Synced notes, docs, and tasks from Notion. Design pending.",
    status: "Planned",
  },
];

export default function DashboardHome() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Overview</h2>
        <p className="text-sm text-slate-500">
          Phase 1 in progress — Priority is a working first-pass; Hours and
          Notion await their detailed design.
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
