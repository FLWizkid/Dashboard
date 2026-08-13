/**
 * The one IndexedDB database, and the one place its version lives.
 *
 * Two queues use it: the hours outbox (`time-entries`) and the capture queue
 * (`captures`). They are independent features written months apart, and that
 * is exactly why this file exists.
 *
 * ── What went wrong without it ───────────────────────────────────────────
 * The capture queue was added with its own `openDatabase`, its own store, and
 * `DB_VERSION = 2` — while the hours outbox still opened the same database
 * name at version 1. `indexedDB.open(name, 1)` against a database already at
 * version 2 does not upgrade or fall back; it fails with a `VersionError`.
 *
 * So adding offline capture silently broke offline **time logging**, in a
 * module nobody had touched. Five hours specs went red at once, which was
 * lucky — the failure is invisible until a queue is actually needed, which is
 * the moment there is no network to fall back on.
 *
 * One version constant, one upgrade path, both stores created together. A new
 * store means bumping `DB_VERSION` here and adding a name to `STORES`, and
 * both queues get it at the same moment because they cannot do otherwise.
 */

export const DB_NAME = "cio-dashboard-outbox";

/**
 * Bump when a store is added. Never bump in one caller only — that is the
 * bug this module exists to prevent.
 */
export const DB_VERSION = 2;

export const STORES = {
  /** Phase 4: queued time entries. */
  hours: "time-entries",
  /** Phase 7: queued task captures. */
  captures: "captures",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/**
 * Opens the database, creating every store it should have.
 *
 * The upgrade handler creates **all** stores rather than only the new one, so
 * a device that has never opened one of the modules still ends up with a
 * complete database. Creating only the new store would leave the older one
 * missing on a fresh install that happened to reach the newer feature first.
 */
export function openOfflineDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "clientKey" });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Runs one request against one store, and closes the connection after. */
export function transact<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  body: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openOfflineDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = body(transaction.objectStore(store));

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      }),
  );
}

/** True when this environment can store a queue at all. */
export function offlineStorageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}
