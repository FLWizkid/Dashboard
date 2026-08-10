import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth";
import { emailChannelFromEnv } from "@/lib/reports/delivery";
import { DIGEST_KINDS } from "@/lib/reports/digest";
import { getReportRepository } from "@/lib/reports/repository";
import { runDigests } from "@/lib/reports/run";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    preview: z.enum(DIGEST_KINDS).optional(),
    force: z.enum(DIGEST_KINDS).optional(),
  })
  .default({});

/**
 * The endpoint pg_cron calls, hourly.
 *
 * Hourly rather than daily so one schedule can serve any timezone, and so a
 * missed hour is recoverable — the period claim is what decides whether
 * anything actually happens, not the firing.
 *
 * ── Authentication ───────────────────────────────────────────────────────
 * Two ways in, and they are not equivalent:
 *
 *   **A signed-in session** — a person pressing "preview" or "send now".
 *   **A bearer token** matching `DIGEST_CRON_TOKEN` — the scheduler.
 *
 * The token path exists because pg_cron has no session. It is compared with a
 * length-safe comparison, and an unset token means the token path is closed
 * entirely rather than open to everyone — the failure mode of "no token
 * configured means no auth required" is not one to leave lying around, even
 * on a private tailnet.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  const authorised = user !== null || hasValidCronToken(request);

  if (!authorised) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

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

  // A preview is a read; anything that delivers needs a person or the token.
  if (parsed.data.force && !user && !hasValidCronToken(request)) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  try {
    const repository = await getReportRepository();

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
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * Constant-time-ish bearer check.
 *
 * `timingSafeEqual` needs equal lengths, so the length is compared first and
 * a mismatch short-circuits — which leaks the token's length and nothing else.
 */
function hasValidCronToken(request: NextRequest): boolean {
  const expected = process.env.DIGEST_CRON_TOKEN;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (presented.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
