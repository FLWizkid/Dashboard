import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getMailRepository } from "@/lib/mail/repository";
import { threadQuerySchema } from "@/lib/mail/schema";

export const dynamic = "force-dynamic";

/**
 * The unified inbox.
 *
 * No `accountId` means every connected account at once, which is the whole
 * point of the module: one list, sorted by when things arrived, rather than
 * three tabs you have to remember to check.
 *
 * **Bodies are never in this response.** A list view needs subjects.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const query = threadQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: query.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const repository = await getMailRepository();
    return NextResponse.json({
      threads: await repository.listThreads(query.data),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
