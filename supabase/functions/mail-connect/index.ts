import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type Provider = "microsoft" | "google";
interface TokenSet { access_token: string; refresh_token?: string; expires_in: number; scope?: string }
interface Account { id: string; user_id: string; provider: Provider; email: string }
interface MessageRow {
  provider_id: string; thread_id: string | null; from_name: string | null; from_email: string | null;
  subject: string | null; snippet: string | null; received_at: string; is_unread: boolean; is_important: boolean; web_link: string | null;
}
interface EventRow {
  provider_id: string; title: string | null; starts_at: string; ends_at: string; all_day: boolean;
  location: string | null; organizer: string | null; web_link: string | null; is_cancelled: boolean;
}

class UserError extends Error {}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/mail-connect/callback`;
const MS_TENANT = Deno.env.get("MICROSOFT_TENANT") || "common";
const MS_SCOPES = "offline_access openid email User.Read Mail.Read Calendars.Read";
const GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function creds(p: Provider) {
  const prefix = p === "microsoft" ? "MICROSOFT" : "GOOGLE";
  const id = Deno.env.get(`${prefix}_CLIENT_ID`);
  const secret = Deno.env.get(`${prefix}_CLIENT_SECRET`);
  return id && secret ? { id, secret } : null;
}

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomToken(n = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

async function aesKey() {
  const material = Deno.env.get("MAIL_TOKEN_KEY") || SERVICE_KEY;
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(material), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("cc-mail-tokens-v1"), info: new Uint8Array() },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}
async function encrypt(text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(text)));
  return `${b64url(iv)}.${b64url(ct)}`;
}
function fromB64url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function decrypt(blob: string) {
  const [iv, ct] = blob.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await aesKey(), fromB64url(ct));
  return new TextDecoder().decode(pt);
}

function safeReturnOrigin(origin: string | null) {
  if (!origin) return null;
  try {
    const u = new URL(origin);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol === "https:" || (u.protocol === "http:" && local)) return u.origin;
  } catch { /* invalid origin */ }
  return null;
}

async function tokenRequest(p: Provider, params: Record<string, string>): Promise<TokenSet> {
  const c = creds(p);
  if (!c) throw new UserError("This provider is not set up yet.");
  const url = p === "microsoft"
    ? `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`
    : "https://oauth2.googleapis.com/token";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...params }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || typeof body.access_token !== "string") {
    console.error("token request failed", p, r.status, body?.error, body?.error_description);
    throw new UserError("The sign-in could not be completed. Please try connecting again.");
  }
  return body as TokenSet;
}

async function apiGet(url: string, token: string, extra: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...extra } });
  if (!r.ok) {
    console.error("api request failed", url.split("?")[0], r.status, (await r.text()).slice(0, 300));
    if (r.status === 401 || r.status === 403) throw new UserError("Access was refused. Reconnect this account.");
    throw new UserError("The mail service did not respond properly. Try again shortly.");
  }
  return r.json();
}

async function accountEmail(p: Provider, token: string): Promise<string> {
  if (p === "microsoft") {
    const me = await apiGet("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", token);
    return String(me.mail || me.userPrincipalName || "").toLowerCase();
  }
  const me = await apiGet("https://openidconnect.googleapis.com/v1/userinfo", token);
  return String(me.email || "").toLowerCase();
}

async function startConnect(admin: SupabaseClient, userId: string, provider: Provider, origin: string | null) {
  const c = creds(provider);
  if (!c) throw new UserError("This provider is not set up yet. Follow the setup steps first.");
  const returnTo = safeReturnOrigin(origin);
  if (!returnTo) throw new UserError("Open the console from its normal web address and try again.");
  await admin.from("cc_oauth_states").delete().lt("created_at", new Date(Date.now() - 3600_000).toISOString());
  const state = randomToken();
  const verifier = randomToken(48);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const { error } = await admin.from("cc_oauth_states").insert({ state, user_id: userId, provider, code_verifier: verifier, return_to: returnTo });
  if (error) throw error;
  const common = { client_id: c.id, redirect_uri: REDIRECT_URI, response_type: "code", state, code_challenge: challenge, code_challenge_method: "S256" };
  const url = provider === "microsoft"
    ? `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize?` +
      new URLSearchParams({ ...common, scope: MS_SCOPES, response_mode: "query", prompt: "select_account" })
    : "https://accounts.google.com/o/oauth2/v2/auth?" +
      new URLSearchParams({ ...common, scope: GOOGLE_SCOPES, access_type: "offline", prompt: "consent select_account", include_granted_scopes: "true" });
  return { url };
}

async function handleCallback(admin: SupabaseClient, url: URL) {
  const state = url.searchParams.get("state") ?? "";
  const { data: row } = state
    ? await admin.from("cc_oauth_states").select("*").eq("state", state).maybeSingle()
    : { data: null };
  if (!row) return new Response("This sign-in link has expired. Close this tab and try connecting again from the console.", { status: 400 });
  await admin.from("cc_oauth_states").delete().eq("state", state);
  const back = (result: string) =>
    new Response(null, { status: 302, headers: { Location: `${row.return_to}/settings/connections?mail=${result}` } });
  if (Date.now() - new Date(row.created_at).getTime() > 10 * 60_000) return back("expired");
  const code = url.searchParams.get("code");
  if (!code) return back(url.searchParams.get("error") === "access_denied" ? "denied" : "error");
  try {
    const provider = row.provider as Provider;
    const tokens = await tokenRequest(provider, {
      grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, code_verifier: row.code_verifier,
    });
    const email = await accountEmail(provider, tokens.access_token);
    if (!email) return back("error");
    const { data: account, error } = await admin.from("cc_mail_accounts")
      .upsert({ user_id: row.user_id, provider, email, status: "connected", last_error: null, scopes: tokens.scope ?? null },
        { onConflict: "user_id,provider,email" })
      .select("id, user_id, provider, email").single();
    if (error) throw error;
    const { data: existing } = await admin.from("cc_mail_tokens").select("refresh_token_enc").eq("account_id", account.id).maybeSingle();
    const { error: tErr } = await admin.from("cc_mail_tokens").upsert({
      account_id: account.id,
      access_token_enc: await encrypt(tokens.access_token),
      refresh_token_enc: tokens.refresh_token ? await encrypt(tokens.refresh_token) : existing?.refresh_token_enc ?? null,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (tErr) throw tErr;
    await syncAccount(admin, account as Account).catch((e) => console.error("initial sync failed", e));
    return back("connected");
  } catch (e) {
    console.error("callback failed", e);
    return back("error");
  }
}

async function accessToken(admin: SupabaseClient, account: Account) {
  const { data: t } = await admin.from("cc_mail_tokens").select("*").eq("account_id", account.id).maybeSingle();
  if (!t) throw new UserError("Sign-in for this account is missing. Reconnect it.");
  if (new Date(t.expires_at).getTime() - Date.now() > 120_000) return decrypt(t.access_token_enc);
  if (!t.refresh_token_enc) throw new UserError("Sign-in for this account expired. Reconnect it.");
  const refresh = await decrypt(t.refresh_token_enc);
  const params: Record<string, string> = { grant_type: "refresh_token", refresh_token: refresh };
  if (account.provider === "microsoft") params.scope = MS_SCOPES;
  const tokens = await tokenRequest(account.provider, params).catch(() => {
    throw new UserError("Sign-in for this account expired. Reconnect it.");
  });
  await admin.from("cc_mail_tokens").update({
    access_token_enc: await encrypt(tokens.access_token),
    refresh_token_enc: tokens.refresh_token ? await encrypt(tokens.refresh_token) : t.refresh_token_enc,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("account_id", account.id);
  return tokens.access_token;
}

const clip = (s: unknown, n: number) => (typeof s === "string" && s ? s.slice(0, n) : null);
const utc = (s: string) => (/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);

async function microsoftData(token: string, from: Date, to: Date) {
  const m = await apiGet(
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=50&$orderby=receivedDateTime desc" +
      "&$select=id,conversationId,subject,bodyPreview,from,receivedDateTime,isRead,importance,webLink",
    token,
  );
  const messages: MessageRow[] = (m.value ?? []).map((x: any) => ({
    provider_id: x.id, thread_id: x.conversationId ?? null,
    from_name: clip(x.from?.emailAddress?.name, 200), from_email: clip(x.from?.emailAddress?.address, 200),
    subject: clip(x.subject, 500), snippet: clip(x.bodyPreview, 300), received_at: x.receivedDateTime,
    is_unread: !x.isRead, is_important: x.importance === "high", web_link: clip(x.webLink, 2000),
  }));
  const events: EventRow[] = [];
  let next: string | null = "https://graph.microsoft.com/v1.0/me/calendarView?" + new URLSearchParams({
    startDateTime: from.toISOString(), endDateTime: to.toISOString(), $top: "100", $orderby: "start/dateTime",
    $select: "id,subject,start,end,isAllDay,location,organizer,webLink,isCancelled",
  });
  for (let page = 0; next && page < 3; page++) {
    const e = await apiGet(next, token, { Prefer: 'outlook.timezone="UTC"' });
    for (const x of e.value ?? []) {
      events.push({
        provider_id: x.id, title: clip(x.subject, 500), starts_at: utc(x.start.dateTime), ends_at: utc(x.end.dateTime),
        all_day: !!x.isAllDay, location: clip(x.location?.displayName, 300), organizer: clip(x.organizer?.emailAddress?.name, 200),
        web_link: clip(x.webLink, 2000), is_cancelled: !!x.isCancelled,
      });
    }
    next = e["@odata.nextLink"] ?? null;
  }
  return { messages, events };
}

function parseFrom(v: string | undefined) {
  if (!v) return { name: null, email: null };
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || null, email: m[2] } : { name: null, email: v.trim() };
}

async function googleData(token: string, email: string, from: Date, to: Date) {
  const list = await apiGet("https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=30", token);
  const ids: string[] = (list.messages ?? []).map((x: any) => x.id);
  const details = await Promise.all(ids.map((id) =>
    apiGet(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, token)
  ));
  const messages: MessageRow[] = details.map((x: any) => {
    const h = (n: string) => x.payload?.headers?.find((y: any) => y.name?.toLowerCase() === n.toLowerCase())?.value;
    const f = parseFrom(h("From"));
    const labels: string[] = x.labelIds ?? [];
    return {
      provider_id: x.id, thread_id: x.threadId ?? null, from_name: clip(f.name, 200), from_email: clip(f.email, 200),
      subject: clip(h("Subject"), 500), snippet: clip(x.snippet, 300), received_at: new Date(Number(x.internalDate)).toISOString(),
      is_unread: labels.includes("UNREAD"), is_important: labels.includes("IMPORTANT"),
      web_link: `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${x.threadId}`,
    };
  });
  const e = await apiGet("https://www.googleapis.com/calendar/v3/calendars/primary/events?" + new URLSearchParams({
    timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250",
  }), token);
  const events: EventRow[] = (e.items ?? []).filter((x: any) => x.start).map((x: any) => ({
    provider_id: x.id, title: clip(x.summary, 500),
    starts_at: x.start.dateTime ?? `${x.start.date}T00:00:00Z`, ends_at: x.end?.dateTime ?? `${x.end?.date ?? x.start.date}T00:00:00Z`,
    all_day: !x.start.dateTime, location: clip(x.location, 300), organizer: clip(x.organizer?.displayName ?? x.organizer?.email, 200),
    web_link: clip(x.htmlLink, 2000), is_cancelled: x.status === "cancelled",
  }));
  return { messages, events };
}

async function replaceRows(admin: SupabaseClient, table: string, account: Account, rows: object[], ids: string[]) {
  if (rows.length) {
    const { error } = await admin.from(table).upsert(
      rows.map((r) => ({ ...r, user_id: account.user_id, account_id: account.id })),
      { onConflict: "account_id,provider_id" },
    );
    if (error) throw error;
  }
  const { data: existing, error: selErr } = await admin.from(table).select("id, provider_id").eq("account_id", account.id);
  if (selErr) throw selErr;
  const keep = new Set(ids);
  const stale = (existing ?? []).filter((r) => !keep.has(r.provider_id)).map((r) => r.id);
  for (let i = 0; i < stale.length; i += 100) {
    const { error } = await admin.from(table).delete().in("id", stale.slice(i, i + 100));
    if (error) throw error;
  }
}

async function syncAccount(admin: SupabaseClient, account: Account) {
  try {
    const token = await accessToken(admin, account);
    const from = new Date(Date.now() - 86400_000);
    const to = new Date(Date.now() + 14 * 86400_000);
    const { messages, events } = account.provider === "microsoft"
      ? await microsoftData(token, from, to)
      : await googleData(token, account.email, from, to);
    await replaceRows(admin, "cc_mail_messages", account, messages, messages.map((m) => m.provider_id));
    await replaceRows(admin, "cc_calendar_events", account, events, events.map((e) => e.provider_id));
    await admin.from("cc_mail_accounts").update({ status: "connected", last_error: null, last_synced_at: new Date().toISOString() }).eq("id", account.id);
    return { id: account.id, ok: true };
  } catch (e) {
    console.error("sync failed", account.provider, e);
    const msg = e instanceof UserError ? e.message : "Could not refresh this account. Try again shortly.";
    await admin.from("cc_mail_accounts").update({ status: "error", last_error: msg }).eq("id", account.id);
    return { id: account.id, ok: false, error: msg };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname.endsWith("/callback")) return await handleCallback(admin, url);

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
    const user = auth?.user;
    if (!user) return json({ error: "Please sign in again." }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    if (action === "status") {
      return json({
        redirectUri: REDIRECT_URI,
        providers: { microsoft: { configured: !!creds("microsoft") }, google: { configured: !!creds("google") } },
      });
    }
    if (action === "start") {
      if (body.provider !== "microsoft" && body.provider !== "google") return json({ error: "Unknown provider." }, 400);
      return json(await startConnect(admin, user.id, body.provider, req.headers.get("Origin")));
    }
    if (action === "sync") {
      let q = admin.from("cc_mail_accounts").select("id, user_id, provider, email").eq("user_id", user.id);
      if (typeof body.accountId === "string") q = q.eq("id", body.accountId);
      const { data: accounts, error } = await q;
      if (error) throw error;
      const results = await Promise.all((accounts ?? []).map((a) => syncAccount(admin, a as Account)));
      return json({ results });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error("mail-connect error", e);
    return json({ error: e instanceof UserError ? e.message : "Something went wrong. Please try again." }, e instanceof UserError ? 400 : 500);
  }
});
