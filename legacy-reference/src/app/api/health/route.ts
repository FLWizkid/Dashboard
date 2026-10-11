import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness probe for Docker and Caddy.
 *
 * Deliberately says nothing an unauthenticated caller shouldn't know: no
 * version, no environment, no dependency status. It answers one question —
 * "is this process serving requests?" — which is all a container healthcheck
 * needs. Anything richer becomes a reconnaissance endpoint the moment
 * something else reaches the tailnet.
 */
export function GET() {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "cache-control": "no-store" } },
  );
}
