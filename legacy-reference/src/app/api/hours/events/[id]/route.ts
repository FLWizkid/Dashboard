import { NextResponse, type NextRequest } from "next/server";

import { getHoursRepository } from "@/lib/hours/repository";
import {
  readBody,
  requireUser,
  toErrorResponse,
  unauthorized,
  UUID,
} from "@/lib/hours/route-helpers";
import { overrideEventSchema } from "@/lib/hours/schema";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * The per-event override: set a category by hand, or force the event in or
 * out of hours.
 *
 * Setting a category marks the event `manual`, and from that point the
 * database trigger refuses to let an automatic rule change it back. That is
 * why this is a route of its own and not a field on a generic event update:
 * it is the one write that ends the classifier's authority over a meeting.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Invalid event id" }, { status: 400 });
  }

  const body = await readBody(request, overrideEventSchema);
  if ("response" in body) return body.response;

  try {
    const repository = await getHoursRepository();
    const block = await repository.overrideEvent(id, body.data);
    return NextResponse.json({ block });
  } catch (error) {
    return toErrorResponse(error);
  }
}
