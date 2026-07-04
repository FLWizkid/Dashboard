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
