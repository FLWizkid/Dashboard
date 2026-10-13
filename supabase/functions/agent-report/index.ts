import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Agent-Key",
};

const MAX_AGENTS = 200;

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

    if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) return json({ error: "Missing or malformed check-in key." }, 401);
    if (!name || name.length > 120) return json({ error: "Provide the agent name (1-120 characters) as 'agent'." }, 400);
    if (!status) return json({ error: "Status must be started, succeeded or failed." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const { data: keyRow, error: keyErr } = await admin.from("cc_agent_keys").select("user_id").eq("key_hash", await sha256Hex(key)).maybeSingle();
    if (keyErr) throw keyErr;
    if (!keyRow) return json({ error: "That check-in key is not valid. Copy a fresh one from Agent Operations." }, 401);
    const userId = keyRow.user_id as string;

    const { data: existing, error: findErr } = await admin.from("cc_agents").select("id, last_status, last_started_at").eq("user_id", userId).eq("name", name).maybeSingle();
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

    if (existing) {
      const { error } = await admin.from("cc_agents").update(patch).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { count, error: countErr } = await admin.from("cc_agents").select("id", { count: "exact", head: true }).eq("user_id", userId);
      if (countErr) throw countErr;
      if ((count ?? 0) >= MAX_AGENTS) return json({ error: `You already have ${MAX_AGENTS} agents. Remove some in Agent Operations first.` }, 409);
      const { error } = await admin.from("cc_agents").insert({ user_id: userId, name, ...patch });
      if (error) throw error;
    }

    return json({ ok: true, agent: name, status, recorded_at: now });
  } catch (e) {
    console.error("agent-report failed", e);
    return json({ error: "Could not record the check-in. Try again shortly." }, 500);
  }
});
