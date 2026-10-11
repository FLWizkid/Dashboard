/*
 * Service worker — Phase 1 scope.
 *
 * Deliberately narrow, and the reasons matter:
 *
 *   • Static build output is cached (immutable, content-hashed, safe).
 *   • Navigations are network-first with an offline page as the fallback.
 *     They are NOT cached, because a dashboard page is authenticated,
 *     personal, and would otherwise sit in the browser's cache after sign-out.
 *   • API responses are never touched. Task data is the system of record;
 *     serving a stale copy is worse than saying "you're offline".
 *
 * Phase 4 adds real offline depth — a queue for time logging plus background
 * sync. That belongs with the module that needs it, not here.
 */

const VERSION = "v1";
const STATIC_CACHE = `dashboard-static-${VERSION}`;
const OFFLINE_URL = "/offline";

const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API traffic or auth callbacks.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    return;
  }

  // Build output is content-hashed: cache-first is safe and fast.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches
                .open(STATIC_CACHE)
                .then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Everything else: network, falling back to the offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then(
          (cached) =>
            cached ??
            new Response("Offline", {
              status: 503,
              headers: { "content-type": "text/plain" },
            }),
        ),
      ),
    );
  }
});
