import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getTaskRepository } from "@/lib/tasks/repository";
import { createCategorySchema } from "@/lib/tasks/schema";

export const dynamic = "force-dynamic";

/**
 * The taxonomy is the owner's, not the product's.
 *
 * Eight categories are seeded because a blank taxonomy is useless on day one,
 * but they were read-only until now — which made "editable defaults" a claim
 * the specification made and the product did not keep. The eight drive the
 * dashboard splits, the hours rollups and the report groupings, so being
 * stuck with someone else's words for your own work is a real cost.
 */

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const repository = await getTaskRepository();

  try {
    const categories = await repository.listCategories();
    return NextResponse.json({ categories });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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

  const parsed = createCategorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid category" },
      { status: 400 },
    );
  }

  try {
    const repository = await getTaskRepository();
    const category = await repository.createCategory(parsed.data);
    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
