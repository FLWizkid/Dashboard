import { NextResponse, type NextRequest } from "next/server";

import { getHoursRepository } from "@/lib/hours/repository";
import {
  readBody,
  requireUser,
  toErrorResponse,
  unauthorized,
} from "@/lib/hours/route-helpers";
import { startSessionSchema } from "@/lib/hours/schema";

export const dynamic = "force-dynamic";

/**
 * `GET` returns the running session, if there is one, plus recent history.
 *
 * The running session is the important half: it is what lets the timer be
 * picked up on a second device, or after a reload, without the owner losing
 * the interval they are in.
 */
export async function GET(request: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const days = Number(request.nextUrl.searchParams.get("days") ?? 7);
  const to = new Date();
  const from = new Date(
    to.getTime() - Math.min(90, Math.max(1, days)) * 24 * 60 * 60_000,
  );

  try {
    const repository = await getHoursRepository();
    const [running, sessions] = await Promise.all([
      repository.getRunningSession(),
      repository.listSessions({ from, to }),
    ]);

    return NextResponse.json({ running, sessions });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await readBody(request, startSessionSchema);
  if ("response" in body) return body.response;

  try {
    const repository = await getHoursRepository();
    const session = await repository.startSession(body.data);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
