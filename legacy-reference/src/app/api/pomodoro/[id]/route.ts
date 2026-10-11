import { NextResponse, type NextRequest } from "next/server";

import { getHoursRepository } from "@/lib/hours/repository";
import {
  readBody,
  requireUser,
  toErrorResponse,
  unauthorized,
  UUID,
} from "@/lib/hours/route-helpers";
import { endSessionSchema } from "@/lib/hours/schema";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Ends a session, and — when the client says so — writes the focused hours
 * that go with it.
 *
 * Both in one request on purpose: a session that ended without its time entry
 * is an hour of work that vanished, and two round trips is two chances for
 * the second one to be the one that fails.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  const body = await readBody(request, endSessionSchema);
  if ("response" in body) return body.response;

  try {
    const repository = await getHoursRepository();
    const result = await repository.endSession(id, body.data);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
