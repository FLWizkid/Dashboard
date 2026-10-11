import { NextResponse, type NextRequest } from "next/server";

import { isMemoryMode } from "@/lib/data-mode";
import { connectorAvailability, getConnector } from "@/lib/connectors/registry";
import { createRefreshStore } from "@/lib/connectors/refresh-store.supabase";
import { getConnectorRepository } from "@/lib/connectors/repository";
import { refreshStaleRefs, type RefreshStore } from "@/lib/connectors/refresh";
import { schedulerFailure, scopeForRequest } from "@/lib/scheduler/request";

export const dynamic = "force-dynamic";

/**
 * Re-fetch the references that have gone stale.
 *
 * Called by the scheduler. Without it a reference is fetched once, when it is
 * pasted, and never again — so the interface would keep saying "open" about a
 * pull request that merged last week, and "what moved elsewhere" in the
 * morning brief would be permanently empty because nothing would ever observe
 * a change.
 *
 * ── No connector configured is not an error ──────────────────────────────
 * `GITHUB_TOKEN` unset is a supported way to run this product: no egress at
 * all. The response says so and returns 200, because a red mark in the
 * scheduler's log every quarter hour for a machine behaving exactly as
 * intended trains you to ignore the log.
 */
export async function POST(request: NextRequest) {
  const scope = await scopeForRequest(request);
  if (!scope.ok) return schedulerFailure(scope);

  try {
    // The scheduler runs elevated, so it gets the adapter whose three queries
    // each carry their own owner clause. A person pressing the button keeps
    // RLS doing that work.
    const repository: RefreshStore =
      scope.actor === "scheduler" && !isMemoryMode()
        ? createRefreshStore(scope.scope)
        : await getConnectorRepository();

    const result = await refreshStaleRefs({
      repository,
      connectorFor: (ref) =>
        connectorAvailability(ref.provider).configured
          ? getConnector(ref.provider)
          : null,
      now: new Date(),
    });

    return NextResponse.json({ actor: scope.actor, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
