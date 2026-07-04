import { fetchRecentNotionItems } from "@/lib/notion";

export const dynamic = "force-dynamic";

export default async function NotionPage() {
  const result = await fetchRecentNotionItems();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Notion</h2>
        <p className="text-sm text-slate-500">
          A first-pass module — recent items from a Notion database you connect.
          Read-only; refine against the detailed design.
        </p>
      </div>

      {result.status === "not_configured" ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          Notion isn&apos;t connected yet. Create a Notion internal integration,
          share a database with it, then set <code>NOTION_TOKEN</code> and{" "}
          <code>NOTION_DATABASE_ID</code> in <code>.env.local</code> (see{" "}
          <code>.env.example</code>) and reload.
        </div>
      ) : result.status === "error" ? (
        <p className="text-sm text-red-600" role="alert">
          Couldn&apos;t reach Notion: {result.message}
        </p>
      ) : result.items.length > 0 ? (
        <ul className="space-y-2">
          {result.items.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800"
            >
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 p-3 hover:underline"
              >
                <span className="text-sm">{item.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">
                  {new Date(item.lastEdited).toLocaleDateString()}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">
          Connected, but that database has no items.
        </p>
      )}
    </div>
  );
}
