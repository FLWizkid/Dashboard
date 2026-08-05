import { NextResponse } from "next/server";

import { isMemoryMode } from "@/lib/data-mode";

export const dynamic = "force-dynamic";

/**
 * Clears the in-memory store between end-to-end specs.
 *
 * Returns 404 unless memory mode is active, so the route simply does not
 * exist in any real deployment.
 */
export async function POST() {
  if (!isMemoryMode()) {
    return new NextResponse(null, { status: 404 });
  }

  const { resetMemoryStore } = await import("@/lib/tasks/repository.memory");
  resetMemoryStore();

  return NextResponse.json({ ok: true });
}
