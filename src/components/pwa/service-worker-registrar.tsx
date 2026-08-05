"use client";

import * as React from "react";

/**
 * Registers the service worker.
 *
 * Only in production builds: in development the worker would serve stale
 * chunks and make every change look like it didn't apply.
 *
 * The worker itself is deliberately narrow — see `public/sw.js`. Offline
 * depth (queued time logging, background sync) arrives in Phase 4; this is
 * the installable shell and an honest offline page, nothing more.
 */
export function ServiceWorkerRegistrar() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration costs offline support, not the app.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
