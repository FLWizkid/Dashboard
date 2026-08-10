import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getNoteRepository } from "@/lib/notes/repository";

export const dynamic = "force-dynamic";

/** Titles for the wiki-link autocomplete. Small, and asked for on every `[[`. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const repository = await getNoteRepository();
    return NextResponse.json({ titles: await repository.titles() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
