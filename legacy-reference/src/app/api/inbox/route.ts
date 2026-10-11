import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getReportRepository } from "@/lib/reports/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const repository = await getReportRepository();
    const [messages, unread] = await Promise.all([
      repository.listInbox({ limit: 50 }),
      repository.unreadCount(),
    ]);

    return NextResponse.json({ messages, unread });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
