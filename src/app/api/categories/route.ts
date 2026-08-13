import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getTaskRepository } from "@/lib/tasks/repository";

export const dynamic = "force-dynamic";

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
