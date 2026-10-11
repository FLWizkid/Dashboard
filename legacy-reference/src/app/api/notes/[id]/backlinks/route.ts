import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getNoteRepository } from "@/lib/notes/repository";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What links here — the half of a wiki that makes it worth keeping. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  try {
    const repository = await getNoteRepository();
    return NextResponse.json({ backlinks: await repository.backlinksFor(id) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
