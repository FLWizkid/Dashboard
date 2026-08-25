import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit/record";
import { sessionScope } from "@/lib/db/scope";
import { sealCredentials } from "@/lib/mail/credentials";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Connecting Proton, which is not an OAuth flow and cannot be made into one.
 *
 * ── Why this route exists at all ─────────────────────────────────────────
 * Every other provider here goes through `/api/mail/oauth/[provider]`. Proton
 * has no sync API and no consent screen: Bridge runs on the owner's own
 * machine, decrypts the mailbox locally, and exposes it as plain IMAP and
 * SMTP on `127.0.0.1` behind a generated per-application password. There is
 * nothing to redirect to. The connect screen used to send Proton to the OAuth
 * start route anyway, which answered "unknown provider" — the button existed
 * and could not work.
 *
 * ── The password is a real password ──────────────────────────────────────
 * Bridge's password only works against loopback, which limits the blast
 * radius but does not change what it is: access to a decrypted mailbox. So it
 * is sealed with the same envelope encryption as an OAuth refresh token, it
 * is never returned by any read path, and it is never logged — the audit
 * entry below records that a connection happened and to which host, not what
 * was used to make it.
 *
 * ── Loopback only, and enforced rather than documented ───────────────────
 * A Bridge host that is not loopback means either a misconfiguration or
 * someone being talked into pointing this at a server they do not control.
 * Either way the password would cross a network in the clear, because Bridge
 * speaks unencrypted IMAP on the assumption it never leaves the machine.
 * Refusing here is the difference between a safe default and a warning in a
 * document nobody reads.
 */

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

const connectSchema = z.object({
  emailAddress: z.string().email().max(320),
  host: z.string().min(1).max(255),
  imapPort: z.number().int().min(1).max(65_535),
  smtpPort: z.number().int().min(1).max(65_535),
  username: z.string().min(1).max(320),
  password: z.string().min(1).max(1_024),
  displayName: z.string().max(120).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const details = parsed.data;

  if (!LOOPBACK.has(details.host.toLowerCase())) {
    return NextResponse.json(
      {
        error:
          "Proton Bridge is only reachable on this machine. Use 127.0.0.1 — " +
          "Bridge speaks unencrypted IMAP and a remote host would send your " +
          "password in the clear.",
      },
      { status: 400 },
    );
  }

  try {
    const supabase = await createClient();

    // Same upsert key as the OAuth path. Re-entering the password for an
    // account that is already here has to refresh it rather than create a
    // second row that syncs the same mailbox twice.
    const { data, error } = await supabase
      .from("mail_accounts")
      .upsert(
        {
          provider: "proton_bridge",
          remote_id: details.emailAddress,
          email_address: details.emailAddress,
          display_name: details.displayName ?? null,
          status: "connected",
          status_detail: null,
          last_error: null,
          // Metadata, for the same reason the OAuth path starts there: no
          // bodies at rest until the owner has said what kind of mailbox
          // this is. Proton has a second reason — the bodies are the thing
          // Proton is *for*, and mirroring them locally deserves an explicit
          // decision rather than a default.
          caching_policy: "metadata",
        },
        { onConflict: "user_id,provider,remote_id" },
      )
      .select("id")
      .single<{ id: string }>();

    if (error) throw new Error(error.message);

    const { error: sealError } = await supabase
      .from("mail_accounts")
      .update({
        credentials_cipher: sealCredentials(data.id, {
          kind: "bridge",
          provider: "proton_bridge",
          host: details.host,
          imapPort: details.imapPort,
          smtpPort: details.smtpPort,
          username: details.username,
          password: details.password,
        }),
      })
      .eq("id", data.id);

    if (sealError) throw new Error(sealError.message);

    // Host and port, never the username or the password. An audit log that
    // records secrets is a second copy of the secret.
    await recordAudit(sessionScope(), {
      action: "account.connected",
      subjectType: "mail_account",
      subjectId: data.id,
      detail: {
        provider: "proton_bridge",
        host: details.host,
        imapPort: details.imapPort,
      },
    });

    return NextResponse.json({ accountId: data.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
