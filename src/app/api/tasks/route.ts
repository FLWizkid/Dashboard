import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { DuplicateTaskError, getTaskRepository } from "@/lib/tasks/repository";
import { createTaskSchema, listTasksQuerySchema } from "@/lib/tasks/schema";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const query = listTasksQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: query.error.flatten() },
      { status: 400 },
    );
  }

  const repository = await getTaskRepository();

  try {
    const tasks = await repository.listTasks(query.data);
    return NextResponse.json({ tasks });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

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

  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid task", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const repository = await getTaskRepository();

  try {
    const task = await repository.createTask(parsed.data);
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    // A capture whose key is already used is not an error — it is the queue
    // replaying a request whose response was lost. Answering 200 with the row
    // that exists is what lets the device settle its outbox; a 409 or a 500
    // would be retried forever, and a 201 would be a lie about having created
    // something.
    if (error instanceof DuplicateTaskError) {
      return NextResponse.json({ task: error.existing }, { status: 200 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
