import { NextResponse, type NextRequest } from "next/server";

import { isMemoryMode } from "@/lib/data-mode";
import { schedulerFailure, scopeForRequest } from "@/lib/scheduler/request";
import {
  createSupabaseVaultPorts,
  vaultRoot,
} from "@/lib/vault/ports.supabase";
import { syncVault } from "@/lib/vault/sync";

export const dynamic = "force-dynamic";

/**
 * Reconcile the vault with the app.
 *
 * Called by the scheduler, and by the owner from the notes page when they want
 * it to happen now rather than within the quarter hour. Same code path, which
 * is the only way "sync now" and "sync on a timer" can be trusted to agree.
 *
 * ── Not configured is not an error ───────────────────────────────────────
 * With `DASHBOARD_VAULT_PATH` unset there is no vault, which is a perfectly
 * valid way to run this product — notes live in Postgres and that is that.
 * Returning 200 with `configured: false` says so plainly; a 500 would put a
 * red mark in the scheduler's log every fifteen minutes for a machine that is
 * working exactly as intended.
 */
export async function POST(request: NextRequest) {
  const scope = await scopeForRequest(request);
  if (!scope.ok) return schedulerFailure(scope);

  const root = vaultRoot();
  if (!root) {
    return NextResponse.json({
      configured: false,
      reason: "DASHBOARD_VAULT_PATH is not set",
    });
  }

  // Memory mode has no Postgres and no vault; E2E exercises the route's
  // contract, not the filesystem.
  if (isMemoryMode()) {
    return NextResponse.json({
      configured: false,
      reason: "the vault does not run in memory mode",
    });
  }

  try {
    const ports = createSupabaseVaultPorts(scope.scope, root);
    const report = await syncVault(ports, new Date());

    return NextResponse.json({
      configured: true,
      actor: scope.actor,
      ...report,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
