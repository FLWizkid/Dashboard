import { NextResponse, type NextRequest } from "next/server";

import { getHoursRepository } from "@/lib/hours/repository";
import {
  readBody,
  requireUser,
  toErrorResponse,
  unauthorized,
} from "@/lib/hours/route-helpers";
import { createRuleSchema } from "@/lib/hours/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const repository = await getHoursRepository();
    return NextResponse.json({ rules: await repository.listRules() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await readBody(request, createRuleSchema);
  if ("response" in body) return body.response;

  try {
    const repository = await getHoursRepository();
    const rule = await repository.createRule(body.data);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
