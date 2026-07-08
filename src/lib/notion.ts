import { Client, isFullPage } from "@notionhq/client";
import { extractTitle } from "./notion-title";

export type NotionItem = {
  id: string;
  title: string;
  url: string;
  lastEdited: string;
};

export type NotionResult =
  | { status: "ok"; items: NotionItem[] }
  | { status: "not_configured" }
  | { status: "error"; message: string };

/**
 * Read-only feed of the most recently edited pages in a single Notion database.
 *
 * Configured entirely by env (NOTION_TOKEN + NOTION_DATABASE_ID) — nothing is
 * hardcoded and nothing is written back to Notion. Schema-agnostic: it reads
 * each page's title property (present on every database) and ignores the rest.
 * First-pass; refine against the detailed design.
 */
export async function fetchRecentNotionItems(limit = 15): Promise<NotionResult> {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!token || !databaseId) {
    return { status: "not_configured" };
  }

  try {
    const notion = new Client({ auth: token });
    const response = await notion.databases.query({
      database_id: databaseId,
      page_size: limit,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    });

    const items: NotionItem[] = response.results
      .filter(isFullPage)
      .map((page) => ({
        id: page.id,
        title: extractTitle(page.properties as Record<string, unknown>),
        url: page.url,
        lastEdited: page.last_edited_time,
      }));

    return { status: "ok", items };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
