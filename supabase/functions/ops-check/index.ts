import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type Status = "healthy" | "attention" | "action" | "unknown";
interface SubCheck { name: string; status: Status; message: string }
interface Outcome { status: Status; summary: string; checks: SubCheck[]; meta?: Record<string, string> }
interface Monitor {
  id: string; kind: string; label: string; target: string | null;
  warn_days: number; critical_days: number; slow_ms: number; dkim_selectors: string[];
}

const RANK: Record<Status, number> = { healthy: 0, unknown: 1, attention: 2, action: 3 };
const DEFAULT_DKIM = ["google", "selector1", "selector2", "resend", "default", "k1", "s1", "s2"];
const UA = "CIO-Command-Console-Monitor/1.0";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function overall(checks: SubCheck[]): Status {
  const known = checks.filter((c) => c.status !== "unknown");
  if (known.length === 0) return "unknown";
  return known.reduce<Status>((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), "healthy");
}

function summarize(checks: SubCheck[], okText: string): string {
  const bad = checks.filter((c) => c.status === "action" || c.status === "attention");
  if (bad.length) return bad.map((c) => c.message).join(" · ");
  if (checks.every((c) => c.status === "unknown")) return checks[0]?.message ?? "Could not check";
  return okText;
}

async function fetchWithTimeout(url: string, ms: number, init: RequestInit = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function errText(e: unknown) {
  if (e instanceof DOMException && e.name === "AbortError") return "timed out";
  return e instanceof Error ? e.message.slice(0, 160) : "unknown error";
}

async function dns(name: string, type: string): Promise<{ type: number; data: string }[]> {
  const r = await fetchWithTimeout(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, 6000, {
    headers: { accept: "application/dns-json" },
  });
  if (!r.ok) throw new Error(`DNS lookup failed (HTTP ${r.status})`);
  const j = await r.json();
  if (j.Status !== 0 && j.Status !== 3) throw new Error(`DNS lookup failed (code ${j.Status})`);
  return Array.isArray(j.Answer) ? j.Answer : [];
}

const txt = (data: string) => data.replace(/^"|"$/g, "").replace(/"\s*"/g, "");

function daysUntil(iso: string) {
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function expiryStatus(days: number, warn: number, critical: number): Status {
  if (days <= critical) return "action";
  if (days <= warn) return "attention";
  return "healthy";
}

async function rdapLookup(domain: string): Promise<Response> {
  const init = { headers: { accept: "application/rdap+json, application/json", "user-agent": UA } };
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchWithTimeout(`https://rdap.org/domain/${domain}`, 12000, init);
      if (r.status < 500 && r.status !== 429) return r;
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
  }
  throw lastErr;
}

async function checkDomain(m: Monitor): Promise<Outcome> {
  const domain = m.target!;
  let r: Response;
  try {
    r = await rdapLookup(domain);
  } catch {
    const c = { name: "Registry lookup", status: "unknown" as Status, message: "The domain registry did not answer after 3 tries. This is usually temporary; it will retry on the next check." };
    return { status: "unknown", summary: c.message, checks: [c] };
  }
  if (r.status === 404) {
    const c = { name: "Registration", status: "action" as Status, message: "Domain not found in the registry" };
    return { status: "action", summary: c.message, checks: [c] };
  }
  if (!r.ok) {
    const c = { name: "Registry lookup", status: "unknown" as Status, message: `Registry did not answer (HTTP ${r.status}). Check expiry at your registrar.` };
    return { status: "unknown", summary: c.message, checks: [c] };
  }
  const j = await r.json();
  const checks: SubCheck[] = [];
  const meta: Record<string, string> = {};

  const exp = (j.events ?? []).find((e: { eventAction: string }) => e.eventAction === "expiration")?.eventDate as string | undefined;
  if (exp) {
    const days = daysUntil(exp);
    meta.expires = exp.slice(0, 10);
    checks.push({
      name: "Expiry",
      status: expiryStatus(days, m.warn_days, m.critical_days),
      message: days < 0 ? `Expired ${-days} days ago` : `Expires in ${days} days (${exp.slice(0, 10)})`,
    });
  } else {
    checks.push({ name: "Expiry", status: "unknown", message: "Registry does not publish an expiry date. Check at your registrar." });
  }

  const registrar = (j.entities ?? []).find((e: { roles?: string[] }) => e.roles?.includes("registrar"));
  const fn = registrar?.vcardArray?.[1]?.find((v: unknown[]) => v[0] === "fn")?.[3];
  if (typeof fn === "string") meta.registrar = fn;

  const statuses: string[] = (j.status ?? []).map((s: string) => s.toLowerCase());
  if (statuses.length) {
    const locked = statuses.some((s) => s.includes("transfer prohibited"));
    checks.push({
      name: "Transfer lock",
      status: locked ? "healthy" : "attention",
      message: locked ? "Transfer lock on" : "Transfer lock is off. Turn it on at your registrar.",
    });
  }

  const ns: string[] = (j.nameservers ?? []).map((n: { ldhName?: string }) => (n.ldhName ?? "").toLowerCase()).filter(Boolean);
  if (ns.length) {
    meta.nameservers = ns.join(", ");
    checks.push({ name: "Name servers", status: ns.length >= 2 ? "healthy" : "attention", message: `${ns.length} name server${ns.length === 1 ? "" : "s"}` });
  }

  const expiry = checks[0];
  return { status: overall(checks), summary: summarize(checks, expiry.message), checks, meta };
}

async function checkEmailAuth(m: Monitor): Promise<Outcome> {
  const d = m.target!;
  const checks: SubCheck[] = [];
  const meta: Record<string, string> = {};

  const safe = async (name: string, fn: () => Promise<SubCheck>) => {
    try {
      checks.push(await fn());
    } catch (e) {
      checks.push({ name, status: "unknown", message: `${name} lookup ${errText(e)}` });
    }
  };

  await safe("MX", async () => {
    const mx = (await dns(d, "MX")).filter((a) => a.type === 15);
    if (!mx.length) return { name: "MX", status: "action", message: "No mail servers (MX) found" };
    meta.mx = mx.map((a) => a.data.split(" ").pop()).join(", ");
    return { name: "MX", status: "healthy", message: `${mx.length} mail server${mx.length === 1 ? "" : "s"}` };
  });

  await safe("SPF", async () => {
    const spf = (await dns(d, "TXT")).filter((a) => a.type === 16).map((a) => txt(a.data)).filter((t) => /^v=spf1\b/i.test(t));
    if (!spf.length) return { name: "SPF", status: "action", message: "No SPF record" };
    if (spf.length > 1) return { name: "SPF", status: "action", message: "More than one SPF record (invalid, merge them)" };
    meta.spf = spf[0];
    const all = spf[0].match(/(?:^|\s)([-~?+]?)all(?:\s|$)/i);
    if (!all) return { name: "SPF", status: "attention", message: "SPF has no closing 'all' rule" };
    if (all[1] === "-") return { name: "SPF", status: "healthy", message: "SPF strict (-all)" };
    if (all[1] === "~") return { name: "SPF", status: "healthy", message: "SPF soft fail (~all)" };
    return { name: "SPF", status: "action", message: `SPF allows anyone (${all[1] || "+"}all)` };
  });

  await safe("DMARC", async () => {
    const rec = (await dns(`_dmarc.${d}`, "TXT")).filter((a) => a.type === 16).map((a) => txt(a.data)).find((t) => /^v=DMARC1/i.test(t));
    if (!rec) return { name: "DMARC", status: "action", message: "No DMARC record" };
    meta.dmarc = rec;
    const p = rec.match(/;\s*p=(\w+)/i)?.[1]?.toLowerCase();
    if (p === "reject" || p === "quarantine") return { name: "DMARC", status: "healthy", message: `DMARC enforcing (p=${p})` };
    return { name: "DMARC", status: "attention", message: `DMARC monitoring only (p=${p ?? "missing"})` };
  });

  await safe("DKIM", async () => {
    const custom = m.dkim_selectors.length > 0;
    const selectors = custom ? m.dkim_selectors : DEFAULT_DKIM;
    const found: string[] = [];
    await Promise.all(
      selectors.map(async (s) => {
        const ans = await dns(`${s}._domainkey.${d}`, "TXT");
        if (ans.some((a) => a.type === 5 || (a.type === 16 && /p=/i.test(txt(a.data))))) found.push(s);
      }),
    );
    if (found.length) {
      meta.dkim = found.join(", ");
      const missing = custom ? selectors.filter((s) => !found.includes(s)) : [];
      if (missing.length) return { name: "DKIM", status: "attention", message: `DKIM missing for: ${missing.join(", ")}` };
      return { name: "DKIM", status: "healthy", message: `DKIM found (${found.join(", ")})` };
    }
    return custom
      ? { name: "DKIM", status: "action", message: `No DKIM key at selector${selectors.length > 1 ? "s" : ""} ${selectors.join(", ")}` }
      : { name: "DKIM", status: "attention", message: "No DKIM found at common selectors. Add your selector in this check's settings." };
  });

  return { status: overall(checks), summary: summarize(checks, "SPF, DKIM and DMARC look good"), checks, meta };
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff")) return true;
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0);
}

async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http and https addresses can be checked");
  if (u.username || u.password) throw new Error("Addresses with embedded credentials are not allowed");
  if (u.port && !["80", "443", "8080", "8443"].includes(u.port)) throw new Error("Only standard web ports can be checked");
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) throw new Error("Use a domain name, not an IP address");
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) throw new Error("That address is not on the public internet");
  const ips = [...(await dns(host, "A")), ...(await dns(host, "AAAA"))].filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
  if (!ips.length) throw new Error("The domain does not resolve to an address");
  if (ips.some(isPrivateIp)) throw new Error("The domain points to a private network address");
  return u;
}

async function checkCertificate(host: string): Promise<SubCheck> {
  try {
    const r = await fetchWithTimeout(`https://crt.sh/?q=${encodeURIComponent(host)}&output=json&exclude=expired&deduplicate=Y`, 9000, { headers: { "user-agent": UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows: { name_value: string; not_after: string }[] = await r.json();
    const parent = host.split(".").slice(1).join(".");
    const matching = rows.filter((row) => row.name_value.toLowerCase().split("\n").some((n) => n === host || n === `*.${parent}`));
    if (!matching.length) return { name: "Certificate", status: "unknown", message: "Certificate expiry not found in public logs" };
    const latest = matching.map((row) => row.not_after).sort().pop()!;
    const iso = latest.endsWith("Z") ? latest : `${latest}Z`;
    const days = daysUntil(iso);
    return { name: "Certificate", status: expiryStatus(days, 14, 7), message: `Certificate valid for ${days} more days` };
  } catch (e) {
    return { name: "Certificate", status: "unknown", message: `Could not look up certificate expiry (${errText(e)})` };
  }
}

async function checkWebsite(m: Monitor): Promise<Outcome> {
  const checks: SubCheck[] = [];
  const meta: Record<string, string> = {};
  let url: URL;
  try {
    url = await assertPublicUrl(m.target!);
  } catch (e) {
    const c = { name: "Address", status: "unknown" as Status, message: errText(e) };
    return { status: "unknown", summary: c.message, checks: [c] };
  }

  const started = Date.now();
  let res: Response | null = null;
  try {
    for (let hop = 0; hop < 5; hop++) {
      res = await fetchWithTimeout(url.toString(), 10000, { redirect: "manual", headers: { "user-agent": UA } });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel();
        url = await assertPublicUrl(new URL(loc, url).toString());
        continue;
      }
      break;
    }
    await res?.body?.cancel();
  } catch (e) {
    checks.push({ name: "Reachable", status: "action", message: `Not reachable (${errText(e)})` });
    return { status: "action", summary: checks[0].message, checks };
  }
  const ms = Date.now() - started;
  meta.final_url = url.toString();
  meta.response_ms = String(ms);

  if (!res || (res.status >= 300 && res.status < 400)) {
    checks.push({ name: "Reachable", status: "attention", message: "Too many redirects" });
  } else if (res.status >= 400) {
    checks.push({ name: "Reachable", status: "action", message: `Site returned an error (HTTP ${res.status})` });
  } else {
    checks.push({ name: "Reachable", status: "healthy", message: `Up (HTTP ${res.status})` });
  }
  checks.push({ name: "Speed", status: ms > m.slow_ms ? "attention" : "healthy", message: ms > m.slow_ms ? `Slow: ${ms} ms` : `${ms} ms` });

  if (url.protocol === "https:") checks.push(await checkCertificate(url.hostname));
  else checks.push({ name: "Certificate", status: "attention", message: "Site does not use HTTPS" });

  return { status: overall(checks), summary: summarize(checks, `Up in ${ms} ms`), checks, meta };
}

async function checkDatabase(admin: SupabaseClient): Promise<Outcome> {
  const t0 = Date.now();
  const { error } = await admin.from("cc_monitors").select("id", { head: true, count: "exact" }).limit(1);
  const ms = Date.now() - t0;
  const c: SubCheck = error
    ? { name: "Database", status: "action", message: "Console database did not answer" }
    : { name: "Database", status: ms > 1500 ? "attention" : "healthy", message: `Answered in ${ms} ms` };
  return { status: c.status, summary: c.message, checks: [c] };
}

function runCheck(m: Monitor, admin: SupabaseClient): Promise<Outcome> {
  switch (m.kind) {
    case "domain": return checkDomain(m);
    case "email_auth": return checkEmailAuth(m);
    case "website": return checkWebsite(m);
    case "database": return checkDatabase(admin);
    default: return Promise.resolve({ status: "unknown", summary: "Not an automatic check", checks: [] });
  }
}

const MANUAL_STATUSES = new Set(["healthy", "attention", "action"]);
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const FROM = "CIO Console <doug@encountive.com>";

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function sendAlert(admin: SupabaseClient, userId: string, turnedRed: { label: string; summary: string }[]) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key || !turnedRed.length) return;
  const { data: settings } = await admin.from("cc_settings").select("notification_address, approved_destinations, alert_emails").eq("user_id", userId).maybeSingle();
  if (!settings?.alert_emails) return;
  const to = String(settings.notification_address ?? "").trim().toLowerCase();
  const approved = ((settings.approved_destinations ?? []) as string[]).map((a) => a.toLowerCase());
  const subject = `Console alert: ${turnedRed.length} check${turnedRed.length === 1 ? "" : "s"} need action`;
  if (!EMAIL_RE.test(to) || !approved.includes(to)) {
    await admin.from("cc_outbound_email_log").insert({ user_id: userId, recipient: to || "(none)", subject, kind: "alert", status: "blocked", error: "Address is not an approved destination" });
    return;
  }
  const items = turnedRed.map((r) => `<li><strong>${esc(r.label)}</strong>: ${esc(r.summary)}</li>`).join("");
  let status = "sent";
  let error: string | null = null;
  try {
    const r = await fetchWithTimeout("https://api.resend.com/emails", 10000, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html: `<p>These checks just turned red in IT Operations:</p><ul>${items}</ul>` }),
    });
    if (!r.ok) {
      status = "failed";
      error = `Resend answered HTTP ${r.status}`;
    }
  } catch (e) {
    status = "failed";
    error = errText(e);
  }
  await admin.from("cc_outbound_email_log").insert({ user_id: userId, recipient: to, subject, kind: "alert", status, error });
}

async function runForUser(admin: SupabaseClient, userId: string, ids: string[] | null) {
  let q = admin.from("cc_monitors").select("*").eq("user_id", userId).eq("enabled", true).neq("kind", "manual");
  if (ids) q = q.in("id", ids);
  const { data: monitors, error: mErr } = await q;
  if (mErr) throw mErr;

  const { data: recent } = await admin
    .from("cc_check_results")
    .select("monitor_id")
    .eq("user_id", userId)
    .eq("source", "auto")
    .gte("checked_at", new Date(Date.now() - 60_000).toISOString());
  const skip = new Set((recent ?? []).map((r: { monitor_id: string }) => r.monitor_id));
  const todo = (monitors as Monitor[]).filter((m) => !skip.has(m.id)).slice(0, 25);

  const previous = new Map<string, string>();
  if (todo.length) {
    const { data: prev } = await admin.from("cc_check_results").select("monitor_id, status")
      .in("monitor_id", todo.map((m) => m.id)).order("checked_at", { ascending: false }).limit(500);
    for (const p of (prev ?? []) as { monitor_id: string; status: string }[]) {
      if (!previous.has(p.monitor_id)) previous.set(p.monitor_id, p.status);
    }
  }

  const rows = await Promise.all(
    todo.map(async (m) => {
      const t0 = Date.now();
      let out: Outcome;
      try {
        out = await runCheck(m, admin);
      } catch (e) {
        out = { status: "unknown", summary: "The check could not run", checks: [{ name: "Checker", status: "unknown", message: errText(e) }] };
      }
      return {
        monitor_id: m.id,
        user_id: userId,
        status: out.status,
        summary: out.summary.slice(0, 400),
        details: { checks: out.checks, meta: out.meta ?? {} },
        duration_ms: Date.now() - t0,
        source: "auto",
      };
    }),
  );
  if (rows.length) {
    const { error } = await admin.from("cc_check_results").insert(rows);
    if (error) throw error;
  }
  await admin.from("cc_check_results").delete().eq("user_id", userId).lt("checked_at", new Date(Date.now() - 180 * 86_400_000).toISOString());

  const labels = new Map(todo.map((m) => [m.id, m.label]));
  const turnedRed = rows
    .filter((r) => r.status === "action" && previous.get(r.monitor_id) !== "action")
    .map((r) => ({ label: labels.get(r.monitor_id) ?? "Check", summary: r.summary }));
  await sendAlert(admin, userId, turnedRed);
  return { checked: rows.length, skipped: (monitors?.length ?? 0) - rows.length };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const cronHeader = req.headers.get("x-cron-secret");
    if (cronHeader) {
      const { data: row } = await admin.from("cc_cron_secrets").select("secret").eq("name", "ops-check").maybeSingle();
      if (!row?.secret || !safeEqual(cronHeader, row.secret)) return json({ error: "Not allowed" }, 401);
      const { data: owners, error } = await admin.from("cc_monitors").select("user_id").eq("enabled", true).neq("kind", "manual");
      if (error) throw error;
      const users = [...new Set((owners ?? []).map((o: { user_id: string }) => o.user_id))];
      let checked = 0;
      for (const u of users) checked += (await runForUser(admin, u, null)).checked;
      return json({ checked, users: users.length });
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: auth } = await userClient.auth.getUser();
    const user = auth?.user;
    if (!user) return json({ error: "Please sign in again." }, 401);
    const body = await req.json().catch(() => ({}));

    if (body?.action === "manual") {
      const status = String(body.status ?? "");
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
      if (typeof body.monitor_id !== "string" || !MANUAL_STATUSES.has(status)) return json({ error: "Invalid manual check." }, 400);
      const { data: monitor } = await admin.from("cc_monitors").select("id, kind, label").eq("id", body.monitor_id).eq("user_id", user.id).maybeSingle();
      if (!monitor) return json({ error: "Check not found." }, 404);
      if (monitor.kind !== "manual") return json({ error: "Only manual systems can be confirmed by hand." }, 400);
      const label = status === "healthy" ? "Confirmed OK" : status === "attention" ? "Needs attention" : "Action needed";
      const { error } = await admin.from("cc_check_results").insert({
        monitor_id: monitor.id,
        user_id: user.id,
        status,
        summary: note || `${label} (checked by you)`,
        details: { checks: [{ name: "Manual check", status, message: note || label }], meta: {} },
        source: "manual",
      });
      if (error) throw error;
      return json({ ok: true });
    }

    const ids: string[] | null = Array.isArray(body?.monitor_ids) ? body.monitor_ids.filter((x: unknown) => typeof x === "string").slice(0, 50) : null;
    return json(await runForUser(admin, user.id, ids));
  } catch (e) {
    console.error("ops-check failed", e);
    return json({ error: "The health check could not run. Try again shortly." }, 500);
  }
});
