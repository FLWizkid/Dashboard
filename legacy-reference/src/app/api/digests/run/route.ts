import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { emailChannelFromEnv } from "@/lib/reports/delivery";
import { DIGEST_KINDS } from "@/lib/reports/digest";
import { getReportRepository } from "@/lib/reports/repository";
import { runDigests } from "@/lib/reports/run";
import { scopeForRequest, schedulerFailure } from "@/lib/scheduler/request";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    preview: z.enum(DIGEST_KINDS).optional(),
    force: z.enum(DIGEST_KINDS).optional(),
  })
  .default({});

/**
 * The endpoint the scheduler calls, hourly.
 *
 * Hourly rather than daily so one schedule can serve any timezone, and so a
 * missed hour is recoverable — the period claim is what decides whether
 * anything actually happens, not the firing.
 *
 * ── Authentication and identity are two questions ────────────────────────
 * A signed-in person answers both at once. The scheduler's token answers only
 * the first: it proves the caller is the scheduler and says nothing about
 * whose brief to build.
 *
 * That distinction is not academic. This endpoint previously took the token
 * and then built a repository from the request's cookies — of which a
 * scheduler has none — so `auth.uid()` was null, every read matched nothing
 * and every write violated NOT NULL. The job reported success and delivered
 * silence. `scopeForRequest` is what closes that: see
 * `src/lib/scheduler/request.ts`.
 */
export async function POST(request: NextRequest) {
  const scope = await scopeForRequest(request);
  if (!scope.ok) return schedulerFailure(scope);

  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    // A bodyless POST is exactly what the scheduler sends.
  }

  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const repository = await getReportRepository(scope.scope);

    const result = await runDigests({
      repository,
      email: emailChannelFromEnv(),
      now: new Date(),
      baseUrl: process.env.NEXT_PUBLIC_APP_URL,
      preview: parsed.data.preview,
      force: parsed.data.force,
    });

    return NextResponse.json({
      ran: result.ran,
      skipped: result.skipped,
      // The digests themselves come back only for a preview; a scheduled run
      // has already delivered them and the response goes nowhere useful.
      digests: parsed.data.preview ? result.digests : undefined,
      // Which identity the run used. The single most useful thing in a
      // scheduler log when a brief does not arrive.
      actor: scope.actor,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
