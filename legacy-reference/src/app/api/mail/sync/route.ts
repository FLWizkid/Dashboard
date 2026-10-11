import { NextResponse, type NextRequest } from "next/server";

import { isMemoryMode } from "@/lib/data-mode";
import { runMailSync } from "@/lib/mail/run-sync";
import { createSyncStore } from "@/lib/mail/sync-store.supabase";
import { schedulerFailure, scopeForRequest } from "@/lib/scheduler/request";

export const dynamic = "force-dynamic";

/**
 * Pull mail from every connected account.
 *
 * Called by the scheduler, and by the person pressing Sync now. Until this
 * route existed the sync engine had no caller at all: accounts could be
 * connected, adapters were written and tested, and the mailbox stayed empty
 * because nothing ever ran a pass.
 *
 * ── No accounts is not an error ─────────────────────────────────────────
 * A box with nothing connected yet returns 200 and says so, for the same
 * reason the connector refresh job does: a scheduled red mark for a machine
 * behaving exactly as intended trains you to ignore the log.
 */
export async function POST(request: NextRequest) {
  const scope = await scopeForRequest(request);
  if (!scope.ok) return schedulerFailure(scope);

  if (isMemoryMode()) {
    // The memory backend has no credentials to sync with, and pretending
    // otherwise would make the e2e suite look like it exercised a live pull.
    return NextResponse.json({
      actor: scope.actor,
      attempted: 0,
      stored: 0,
      outcomes: [],
      detail: "Memory mode: no live sync.",
    });
  }

  try {
    const result = await runMailSync({
      store: createSyncStore(scope.scope),
      internalDomains: (process.env.DASHBOARD_INTERNAL_DOMAINS ?? "")
        .split(",")
        .map((domain) => domain.trim())
        .filter(Boolean),
    });

    return NextResponse.json({ actor: scope.actor, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
