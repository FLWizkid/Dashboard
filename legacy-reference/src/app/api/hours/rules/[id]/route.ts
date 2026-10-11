import { NextResponse, type NextRequest } from "next/server";

import { getHoursRepository } from "@/lib/hours/repository";
import {
  readBody,
  requireUser,
  toErrorResponse,
  unauthorized,
  UUID,
} from "@/lib/hours/route-helpers";
import { updateRuleSchema } from "@/lib/hours/schema";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Invalid rule id" }, { status: 400 });
  }

  const body = await readBody(request, updateRuleSchema);
  if ("response" in body) return body.response;

  try {
    const repository = await getHoursRepository();
    const rule = await repository.updateRule(id, body.data);
    return NextResponse.json({ rule });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Invalid rule id" }, { status: 400 });
  }

  try {
    const repository = await getHoursRepository();
    await repository.deleteRule(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
