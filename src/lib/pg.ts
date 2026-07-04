/**
 * True when a Postgres error is "undefined_table" (42P01) — i.e. the migration
 * hasn't been applied yet. Lets a module show a "run migrations" hint instead
 * of surfacing a raw error.
 */
export function isUndefinedTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}
