import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getTaskRepository } from "@/lib/tasks/repository";
import { updateCategorySchema } from "@/lib/tasks/schema";

export const dynamic = "force-dynamic";

/**
 * Rename, recolour, reorder, archive.
 *
 * There is deliberately no DELETE. Tasks, hours entries and classification
 * rules all point at a category, and the reports read months of them —
 * removing one would either orphan that history or quietly rewrite it.
 * Archiving takes a category out of every picker and leaves what already
 * happened intact and explainable, which is the behaviour a ledger owes you.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateCategorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid change" },
      { status: 400 },
    );
  }

  try {
    const repository = await getTaskRepository();
    const category = await repository.updateCategory(id, parsed.data);
    return NextResponse.json({ category });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
