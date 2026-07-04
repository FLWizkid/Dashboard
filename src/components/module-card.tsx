export function ModuleCard({
  title,
  description,
  status,
}: {
  title: string;
  description: string;
  status: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800 dark:bg-panel">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-500 dark:border-slate-700">
          {status}
        </span>
      </div>
      <p className="text-sm text-slate-500">{description}</p>
    </section>
  );
}
