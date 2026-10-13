import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const FROM = "CIO Console <doug@encountive.com>";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: auth } = await userClient.auth.getUser();
    const user = auth?.user;
    if (!user) return json({ error: "Please sign in again." }, 401);
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const key = Deno.env.get("RESEND_API_KEY");

    if (body?.action === "status") return json({ configured: !!key, from: FROM });

    if (body?.action !== "test") return json({ error: "Unknown action." }, 400);

    const { data: settings, error: sErr } = await admin
      .from("cc_settings").select("notification_address, approved_destinations").eq("user_id", user.id).maybeSingle();
    if (sErr) throw sErr;
    if (!settings) return json({ error: "Open Settings once so your preferences are created, then try again." }, 400);

    const to = String(settings.notification_address ?? "").trim().toLowerCase();
    const approved = ((settings.approved_destinations ?? []) as string[]).map((a) => a.toLowerCase());
    const subject = "Console test message";
    const log = (status: string, error: string | null) =>
      admin.from("cc_outbound_email_log").insert({ user_id: user.id, recipient: to || "(none)", subject, kind: "test", status, error });

    if (!EMAIL_RE.test(to) || !approved.includes(to)) {
      await log("blocked", "Address is not an approved destination");
      return json({ error: "The notification address is not on your approved destinations list." }, 400);
    }
    if (!key) return json({ error: "Email sending is not set up yet. See Setup > Your steps, step 2." }, 400);

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject,
        html: "<p>This is a test from your CIO Command Console. Alerts will arrive at this address.</p>",
      }),
    });
    if (!r.ok) {
      const detail = await r.json().catch(() => ({}));
      const msg = typeof detail?.message === "string" ? detail.message.slice(0, 200) : `HTTP ${r.status}`;
      await log("failed", msg);
      return json({ error: `Resend did not send it: ${msg}` }, 502);
    }
    await log("sent", null);
    return json({ ok: true, to });
  } catch (e) {
    console.error("console-email failed", e);
    return json({ error: "Email could not be sent. Try again shortly." }, 500);
  }
});
