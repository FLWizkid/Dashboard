import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getNoteRepository } from "@/lib/notes/repository";
import { createNoteSchema, listNotesQuerySchema } from "@/lib/notes/schema";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const query = listNotesQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: query.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const repository = await getNoteRepository();
    return NextResponse.json({ notes: await repository.listNotes(query.data) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * Creates a note.
 *
 * Note what is *not* validated: a decision note with no rationale is accepted.
 * You capture the decision when it is made and write down why afterwards, and
 * refusing the save would mean losing the decision entirely. The database
 * marks it incomplete and the interface says so.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid note", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const repository = await getNoteRepository();
    const note = await repository.createNote(parsed.data);
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
