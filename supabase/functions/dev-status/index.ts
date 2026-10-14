import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type Status = "healthy" | "attention" | "action" | "unknown";
interface Item { label: string; status: Status; detail: string; url?: string }
interface Service { key: "github" | "vercel" | "resend"; configured: boolean; status: Status; summary: string; items: Item[]; error?: string }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const worst = (items: Item[]): Status =>
  items.some((i) => i.status === "action") ? "action" : items.some((i) => i.status === "attention") ? "attention" : items.length ? "healthy" : "unknown";

async function getJson(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (res.status === 401 || res.status === 403) throw new Error("The saved token was refused. It may have expired or lack read access.");
  if (!res.ok) throw new Error(`The service replied with an error (${res.status}).`);
  return await res.json();
}

async function github(): Promise<Service> {
  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) return { key: "github", configured: false, status: "unknown", summary: "Not connected", items: [] };
  const h = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "cio-command-console" };
  const repos = (await getJson("https://api.github.com/user/repos?sort=pushed&per_page=8&affiliation=owner,organization_member", h)) as
    { full_name: string; html_url: string; archived: boolean }[];
  const items: Item[] = [];
  await Promise.all(
    repos.filter((r) => !r.archived).map(async (r) => {
      const [runs, pulls] = await Promise.all([
        getJson(`https://api.github.com/repos/${r.full_name}/actions/runs?per_page=1`, h).catch(() => null),
        getJson(`https://api.github.com/repos/${r.full_name}/pulls?state=open&per_page=30`, h).catch(() => []),
      ]);
      const run = runs?.workflow_runs?.[0];
      const prs = Array.isArray(pulls) ? pulls.length : 0;
      const failed = run && run.status === "completed" && ["failure", "timed_out", "startup_failure"].includes(run.conclusion);
      const parts = [run ? (failed ? `Last build failed (${run.name})` : run.status !== "completed" ? "Build running" : "Last build passed") : "No builds", `${prs} open pull request${prs === 1 ? "" : "s"}`];
      items.push({ label: r.full_name, status: failed ? "action" : prs > 5 ? "attention" : "healthy", detail: parts.join(" · "), url: failed ? run.html_url : r.html_url });
    }),
  );
  items.sort((a, b) => a.label.localeCompare(b.label));
  const failing = items.filter((i) => i.status === "action").length;
  return { key: "github", configured: true, status: worst(items), summary: failing ? `${failing} failing build${failing === 1 ? "" : "s"}` : `${items.length} repos, all builds passing`, items };
}

async function vercel(): Promise<Service> {
  const token = Deno.env.get("VERCEL_TOKEN");
  if (!token) return { key: "vercel", configured: false, status: "unknown", summary: "Not connected", items: [] };
  const team = Deno.env.get("VERCEL_TEAM_ID");
  const q = new URLSearchParams({ limit: "40" });
  if (team) q.set("teamId", team);
  const data = await getJson(`https://api.vercel.com/v6/deployments?${q}`, { Authorization: `Bearer ${token}` });
  const latest = new Map<string, { name: string; state: string; url: string; created: number; target: string | null }>();
  for (const d of data.deployments ?? []) {
    if (!latest.has(d.name)) latest.set(d.name, { name: d.name, state: d.state ?? d.readyState, url: d.url, created: d.created, target: d.target ?? null });
  }
  const items: Item[] = [...latest.values()].map((d) => ({
    label: d.name,
    status: d.state === "ERROR" ? "action" : d.state === "READY" ? "healthy" : d.state === "CANCELED" ? "attention" : "attention",
    detail: `${d.state === "READY" ? "Live" : d.state === "ERROR" ? "Last deploy failed" : d.state === "BUILDING" || d.state === "QUEUED" ? "Deploying" : d.state.toLowerCase()}${d.target === "production" ? " (production)" : ""} · ${new Date(d.created).toISOString().slice(0, 16).replace("T", " ")} UTC`,
    url: d.url ? `https://${d.url}` : undefined,
  }));
  const failing = items.filter((i) => i.status === "action").length;
  return { key: "vercel", configured: true, status: worst(items), summary: failing ? `${failing} failed deploy${failing === 1 ? "" : "s"}` : `${items.length} projects live`, items };
}

async function resend(): Promise<Service> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { key: "resend", configured: false, status: "unknown", summary: "Not connected", items: [] };
  const data = await getJson("https://api.resend.com/domains", { Authorization: `Bearer ${key}` });
  const items: Item[] = (data.data ?? []).map((d: { name: string; status: string }) => ({
    label: d.name,
    status: d.status === "verified" ? "healthy" : d.status === "failed" ? "action" : "attention",
    detail: d.status === "verified" ? "Verified, can send" : d.status === "failed" ? "Verification failed, emails will not send" : `Not verified yet (${d.status})`,
  }));
  if (!items.length) items.push({ label: "Sending domain", status: "attention", detail: "No domain added in Resend yet, so only test sending works." });
  return { key: "resend", configured: true, status: worst(items), summary: items.every((i) => i.status === "healthy") ? "Email sending ready" : "Needs attention", items };
}

async function safe(key: Service["key"], fn: () => Promise<Service>): Promise<Service> {
  try {
    return await fn();
  } catch (e) {
    return { key, configured: true, status: "unknown", summary: "Could not check", items: [], error: e instanceof Error ? e.message : "Could not reach the service." };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
    if (!auth?.user) return json({ error: "Please sign in again." }, 401);
    const services = await Promise.all([safe("github", github), safe("vercel", vercel), safe("resend", resend)]);
    return json({ services, checked_at: new Date().toISOString() });
  } catch (e) {
    console.error("dev-status error", e);
    return json({ error: "The status check failed. Try again shortly." }, 500);
  }
});
