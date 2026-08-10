import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth";
import {
  getPriorityRepository,
  SuggestionNotFoundError,
} from "@/lib/priority/repository";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const decisionSchema = z.object({
  decision: z.enum(["accept", "dismiss"]),
  /**
   * Whether to create the offered note alongside the link.
   *
   * A separate answer from the link itself: agreeing that a task relates to a
   * meeting and wanting a note about it are two different decisions, and
   * bundling them leaves the vault full of notes nobody asked for.
   */
  withNote: z.boolean().default(false),
});

/**
 * The owner's answer to a suggestion.
 *
 * This route is the *only* way an event link becomes confirmed — the database
 * trigger rejects any other attempt to create one already-confirmed. That is
 * what makes "never auto-link silently" a property of the system rather than
 * a promise about this codebase.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json(
      { error: "Invalid suggestion id" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid decision", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const repository = await getPriorityRepository();

    if (parsed.data.decision === "dismiss") {
      const suggestion = await repository.dismissSuggestion(id);
      return NextResponse.json({ suggestion });
    }

    const result = await repository.acceptSuggestion(id, {
      withNote: parsed.data.withNote,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SuggestionNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
