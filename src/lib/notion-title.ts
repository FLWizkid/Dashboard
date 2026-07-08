/**
 * Extract a page's title from a Notion property bag. Every Notion database has
 * exactly one "title" property, but its name is arbitrary — so scan for the
 * property whose type is "title" and join its rich-text. Runtime-safe (accepts
 * unknown shapes) so it's trivially testable and resilient to API drift.
 */
export function extractTitle(properties: Record<string, unknown>): string {
  for (const value of Object.values(properties)) {
    const prop = value as { type?: unknown; title?: unknown };
    if (prop.type === "title" && Array.isArray(prop.title)) {
      const text = prop.title
        .map((part) => (part as { plain_text?: unknown }).plain_text)
        .filter((part): part is string => typeof part === "string")
        .join("");
      return text || "Untitled";
    }
  }
  return "Untitled";
}
