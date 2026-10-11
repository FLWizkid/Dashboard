/**
 * Data-mode switch.
 *
 * The app normally talks to the self-hosted Supabase instance. End-to-end
 * tests need a backend that CI can actually run, so there is a second,
 * in-memory implementation of the same repository contract behind this flag.
 *
 * Two guards, both required, keep it out of the running system:
 *   1. `DASHBOARD_DATA_MODE=memory` must be set explicitly.
 *   2. `NODE_ENV` must not be `production` — the box runs a production build,
 *      so no combination of environment variables can put the real deployment
 *      into memory mode.
 *
 * Memory mode also bypasses authentication, which is precisely why guard (2)
 * is not negotiable.
 */
export function isMemoryMode(): boolean {
  return (
    process.env.DASHBOARD_DATA_MODE === "memory" &&
    process.env.NODE_ENV !== "production"
  );
}

/** The identity memory mode pretends to be signed in as. */
export const MEMORY_MODE_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "test@example.invalid",
} as const;
