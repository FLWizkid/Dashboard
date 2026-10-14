import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Agent-Key",
};

const MAX_AGENTS = 200;
const MAX_BODY = 200_000;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const FROM = "CIO Console <doug@encountive.com>";

const STATUS_ALIASES: Record<string, "running" | "succeeded" | "failed"> = {
  start: "running", started: "running", running: "running", begin: "running",
  success: "succeeded", succeeded: "succeeded", done: "succeeded", ok: "succeeded", complete: "succeeded", completed: "succeeded", finished: "succeeded",
  fail: "failed", failed: "failed", error: "failed",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

type Admin = ReturnType<typeof createClient>;

async function notify(admin: Admin, userId: string, agent: string, status: string, title: string, summary: string | null, reportId: string | null) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return;
  const { data: settings } = await admin.from("cc_settings").select("notification_address, approved_destinations, console_url").eq("user_id", userId).maybeSingle();
  if (!settings) return;
  const to = String(settings.notification_address ?? "").trim().toLowerCase();
  const approved = ((settings.approved_destinations ?? []) as string[]).map((a) => a.toLowerCase());
  const failed = status === "failed";
  const subject = `${failed ? "Agent failed" : "Report ready"}: ${agent}`.slice(0, 200);
  const log = (s: string, error: string | null) =>
    admin.from("cc_outbound_email_log").insert({ user_id: userId, recipient: to || "(none)", subject, kind: "report", status: s, error });
  if (!EMAIL_RE.test(to) || !approved.includes(to)) {
    await log("blocked", "Address is not an approved destination");
    return;
  }
  const base = String(settings.console_url ?? "").replace(/\/+$/, "");
  const link = base ? (reportId ? `${base}/library/${reportId}` : `${base}/agents`) : null;
  const html = [
    `<p><strong>${esc(agent)}</strong> ${failed ? "reported a failure" : "finished a run"}.</p>`,
    `<p style="font-size:16px"><strong>${esc(title)}</strong></p>`,
    summary ? `<p>${esc(summary)}</p>` : "",
    link ? `<p><a href="${esc(link)}">${reportId ? "Open the full report" : "Open Agent Operations"}</a></p>` : "<p>Open the Report Library in your console to read it.</p>",
  ].join("");
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
      signal: AbortSignal.timeout(10000),
    });
    await log(r.ok ? "sent" : "failed", r.ok ? null : `Resend answered HTTP ${r.status}`);
  } catch (e) {
    await log("failed", e instanceof Error ? e.message.slice(0, 200) : "Send failed");
  }
}

async function readParams(req: Request): Promise<Record<string, string>> {
  const url = new URL(req.url);
  const params: Record<string, string> = Object.fromEntries(url.searchParams.entries());
  if (req.method === "POST") {
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = await req.json().catch(() => null);
      if (body && typeof body === "object") {
        for (const [k, v] of Object.entries(body)) if (typeof v === "string") params[k] = v;
      }
    } else if (type.includes("form")) {
      const form = await req.formData().catch(() => null);
      form?.forEach((v, k) => { if (typeof v === "string") params[k] = v; });
    }
  }
  const headerKey = req.headers.get("x-agent-key");
  if (headerKey) params.key = headerKey;
  return params;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Use GET or POST." }, 405);

  try {
    const p = await readParams(req);
    const key = (p.key ?? "").trim();
    const name = (p.agent ?? p.name ?? "").trim().replace(/\s+/g, " ");
    const rawStatus = (p.status ?? "succeeded").trim().toLowerCase();
    const status = STATUS_ALIASES[rawStatus];
    const message = (p.message ?? "").trim().slice(0, 500) || null;
    const body = (p.report ?? p.body ?? "").replace(/\r\n/g, "\n").trim();
    const summary = (p.summary ?? "").trim().slice(0, 500) || message;
    const title = (p.title ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
    const sourceUrl = (p.source_url ?? p.link ?? "").trim();

    if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) return json({ error: "Missing or malformed check-in key." }, 401);
    if (!name || name.length > 120) return json({ error: "Provide the agent name (1-120 characters) as 'agent'." }, 400);
    if (!status) return json({ error: "Status must be started, succeeded or failed." }, 400);
    if (body.length > MAX_BODY) return json({ error: `The report is too long (limit ${MAX_BODY} characters). Send a shorter version or a link in source_url.` }, 413);
    if (sourceUrl && (!/^https?:\/\//i.test(sourceUrl) || sourceUrl.length > 2000)) return json({ error: "source_url must be a web address starting with https://" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const { data: keyRow, error: keyErr } = await admin.from("cc_agent_keys").select("user_id").eq("key_hash", await sha256Hex(key)).maybeSingle();
    if (keyErr) throw keyErr;
    if (!keyRow) return json({ error: "That check-in key is not valid. Copy a fresh one from Agent Operations." }, 401);
    const userId = keyRow.user_id as string;

    const { data: existing, error: findErr } = await admin.from("cc_agents").select("id, last_status, last_started_at, email_on").eq("user_id", userId).eq("name", name).maybeSingle();
    if (findErr) throw findErr;

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { last_status: status, last_message: message };
    if (status === "running") {
      patch.last_started_at = now;
      patch.last_finished_at = null;
    } else {
      patch.last_finished_at = now;
      const openRun = existing?.last_status === "running" && existing.last_started_at &&
        Date.now() - new Date(existing.last_started_at).getTime() < 24 * 3_600_000;
      if (!openRun) patch.last_started_at = now;
    }

    let agentId: string;
    let emailOn = "failure";
    if (existing) {
      const { error } = await admin.from("cc_agents").update(patch).eq("id", existing.id);
      if (error) throw error;
      agentId = existing.id as string;
      emailOn = (existing.email_on as string) ?? "failure";
    } else {
      const { count, error: countErr } = await admin.from("cc_agents").select("id", { count: "exact", head: true }).eq("user_id", userId);
      if (countErr) throw countErr;
      if ((count ?? 0) >= MAX_AGENTS) return json({ error: `You already have ${MAX_AGENTS} agents. Remove some in Agent Operations first.` }, 409);
      const { data: created, error } = await admin.from("cc_agents").insert({ user_id: userId, name, ...patch }).select("id").single();
      if (error) throw error;
      agentId = created.id as string;
    }

    if (status === "running") return json({ ok: true, agent: name, status, recorded_at: now });

    let reportId: string | null = null;
    const reportTitle = title || `${name} report, ${new Date().toISOString().slice(0, 10)}`;
    if (body || title || sourceUrl) {
      const { data: report, error } = await admin.from("cc_reports").insert({
        user_id: userId, agent_id: agentId, agent_name: name, title: reportTitle, status,
        summary, body, source_url: sourceUrl || null, received_at: now,
      }).select("id").single();
      if (error) throw error;
      reportId = report.id as string;
      const { error: linkErr } = await admin.from("cc_agents").update({ last_report_id: reportId }).eq("id", agentId);
      if (linkErr) throw linkErr;
    }

    if (emailOn === "always" || (emailOn === "failure" && status === "failed")) {
      await notify(admin, userId, name, status, reportId ? reportTitle : (status === "failed" ? "The run failed" : "Run finished"), summary, reportId);
    }

    return json({ ok: true, agent: name, status, recorded_at: now, report_id: reportId });
  } catch (e) {
    console.error("agent-report failed", e);
    return json({ error: "Could not record the check-in. Try again shortly." }, 500);
  }
});
