/**
 * The values the quick-log carries from one entry to the next.
 *
 * Logging time is repetitive by nature. Three blocks of work on the same thing
 * in an afternoon is the ordinary case, not the exception, and re-typing the
 * same description each time is the friction that makes people stop logging at
 * all — which costs far more than a stale description ever could.
 *
 * ── Why storage and not just React state ─────────────────────────────────
 * The card lives on the dashboard *and* on the hours page, and it is normal to
 * log, navigate away, and come back an hour later. State that only survives
 * until the next render is not "remembered" in any sense the owner would
 * recognise. Storage is per-device and per-browser, which is the right scope:
 * this is a convenience about how one person works at one desk, not data.
 *
 * ── Why failure here is silent ───────────────────────────────────────────
 * A browser can refuse storage outright — private windows do, and so does a
 * profile with site data blocked. Every read and write is therefore wrapped:
 * carrying a value over is a nicety, and it must never be able to stop an
 * entry being logged. The worst case is that you type the description again.
 */

const PREFIX = "dashboard.quick-log.";

/** The subset of `Storage` this needs. Injectable so it can be tested. */
export interface RememberedStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): RememberedStore | null {
  try {
    // Accessing the property itself throws in some blocked configurations, so
    // this has to be inside the try, not guarded by a typeof check outside it.
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readRemembered(
  key: string,
  store: RememberedStore | null = defaultStore(),
): string {
  try {
    return store?.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

/**
 * Writes a value, or forgets it when the value is empty.
 *
 * Clearing the field is a decision — "this next block is something else" — so
 * an empty value removes the key rather than storing a blank. Otherwise
 * clearing it would only last until the next reload, and the owner would find
 * yesterday's description back in the box.
 */
export function writeRemembered(
  key: string,
  value: string,
  store: RememberedStore | null = defaultStore(),
): void {
  try {
    if (value) store?.setItem(PREFIX + key, value);
    else store?.removeItem(PREFIX + key);
  } catch {
    // See the note above: a refusal to store is not a reason to fail.
  }
}
