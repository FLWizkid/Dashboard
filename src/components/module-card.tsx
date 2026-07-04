import Link from "next/link";

export function ModuleCard({
  title,
  description,
  status,
  href,
}: {
  title: string;
  description: string;
  status: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-500 dark:border-slate-700">
          {status}
        </span>
      </div>
      <p className="text-sm text-slate-500">{description}</p>
    </>
  );

  const base =
    "block rounded-2xl border border-slate-200 p-5 dark:border-slate-800 dark:bg-panel";

  if (href) {
    return (
      <Link
        href={href}
        className={`${base} transition hover:border-slate-400 dark:hover:border-slate-600`}
      >
        {inner}
      </Link>
    );
  }

  return <section className={base}>{inner}</section>;
}
