/**
 * Who a task belongs to.
 *
 * Almost every task in this dashboard is the owner's own, so the field starts
 * filled in with their name and the common case costs nothing. The few that
 * are delegated are typed by hand — and typed *again* next week, at which
 * point the app should already know the name.
 *
 * ── Free text, with memory — not a picker ────────────────────────────────
 * There is no directory behind this, and inventing one would mean a task
 * cannot be assigned to someone until they have been "added" somewhere. So
 * the control stays a plain text box and the remembered names are offered as
 * suggestions beside it. Anything can be typed; what has been typed before is
 * one keystroke away.
 *
 * ── The default is fixed, not most-recent ────────────────────────────────
 * A most-recently-used default would mean that delegating one task to someone
 * silently makes them the owner of the next thing captured — and capture is
 * exactly where nobody re-reads the fields. The default stays the owner's own
 * name; the memory only ever populates the suggestion list.
 */

const KEY = "dashboard.owners.v1";

/** Enough to cover the people delegated to, without becoming a directory. */
const LIMIT = 12;

/**
 * The name a new task starts with.
 *
 * This is the owner of the dashboard, not a placeholder: it is a single-user
 * product running on one person's machine.
 */
export const DEFAULT_OWNER = "Doug";

/** The subset of `Storage` this needs. Injectable so it can be tested. */
export interface OwnerStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): OwnerStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Names seen before, most recently used first, always including the default.
 *
 * Never throws and never returns an empty list: a browser that refuses
 * storage still gets a usable suggestion list of one.
 */
export function readOwners(
  store: OwnerStore | null = defaultStore(),
): string[] {
  let stored: unknown = null;
  try {
    const raw = store?.getItem(KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }

  const names = Array.isArray(stored)
    ? stored.filter((name): name is string => typeof name === "string")
    : [];

  return dedupe([...names, DEFAULT_OWNER]).slice(0, LIMIT);
}

/**
 * Records a name and returns the new list.
 *
 * Moves an existing name to the front rather than adding a second copy, and
 * matches case-insensitively so "maya" and "Maya" are one person — keeping
 * the spelling most recently typed, because that is the one the owner just
 * chose.
 */
export function rememberOwner(
  name: string,
  store: OwnerStore | null = defaultStore(),
): string[] {
  const trimmed = name.trim();
  if (!trimmed) return readOwners(store);

  const next = dedupe([trimmed, ...readOwners(store)]).slice(0, LIMIT);

  try {
    store?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing, or storage refused outright. The suggestion list is a
    // convenience; failing to record a name must never fail the capture.
  }

  return next;
}

/** Case-insensitive, first occurrence wins — so the newest spelling survives. */
function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }

  return out;
}
