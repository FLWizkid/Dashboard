import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { parseIcs } from "./ics.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type Provider = "google" | "microsoft" | "outlook_ics";
type OAuthProvider = "google" | "microsoft";
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
const ICS_HOSTS = new Set(["outlook.office365.com", "outlook.office.com", "outlook.live.com"]);
const ICS_MAX_BYTES = 5_000_000;
const LINK_NEVER_EXPIRES = "9999-12-31T00:00:00Z";
const GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly";
const MICROSOFT_SCOPES = "openid email offline_access User.Read Mail.Read Calendars.Read";
const MS_TENANT = Deno.env.get("MICROSOFT_TENANT_ID")?.trim() ?? "";
const MS_AUTH = `https://login.microsoftonline.com/${encodeURIComponent(MS_TENANT)}/oauth2/v2.0`;
const GRAPH = "https://graph.microsoft.com/v1.0";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function creds(provider: OAuthProvider) {
  const prefix = provider === "google" ? "GOOGLE" : "MICROSOFT";
  const id = Deno.env.get(`${prefix}_CLIENT_ID`);
  const secret = Deno.env.get(`${prefix}_CLIENT_SECRET`);
  if (provider === "microsoft" && !/^[A-Za-z0-9.-]{1,100}$/.test(MS_TENANT)) return null;
  return id && secret ? { id, secret } : null;
}

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomToken(n = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

async function aesKey() {
  const material = SERVICE_KEY;
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

async function tokenRequest(provider: OAuthProvider, params: Record<string, string>): Promise<TokenSet> {
  const c = creds(provider);
  if (!c) throw new UserError(`${provider === "google" ? "Google" : "Microsoft"} is not set up yet.`);
  const endpoint = provider === "google" ? "https://oauth2.googleapis.com/token" : `${MS_AUTH}/token`;
  const extra: Record<string, string> = provider === "microsoft" ? { scope: MICROSOFT_SCOPES } : {};
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...extra, ...params }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || typeof body.access_token !== "string") {
    console.error("token request failed", r.status, body?.error, body?.error_description);
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

function checkIcsUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new UserError("That does not look like a web link. Copy the ICS link again from Outlook."); }
  if (u.protocol !== "https:" || !ICS_HOSTS.has(u.hostname) || u.username || u.password || u.port) {
    throw new UserError("Only Outlook calendar links (starting with https://outlook.office365.com) can be added.");
  }
  if (!u.pathname.toLowerCase().endsWith(".ics")) throw new UserError("Use the ICS link from Outlook (it ends in .ics), not the HTML link.");
  return u;
}

async function fetchIcs(link: string) {
  let u = checkIcsUrl(link);
  for (let hop = 0; hop < 3; hop++) {
    const r = await fetch(u, { redirect: "manual", headers: { Accept: "text/calendar" } });
    if (r.status >= 300 && r.status < 400 && r.headers.get("Location")) {
      await r.body?.cancel();
      u = checkIcsUrl(new URL(r.headers.get("Location")!, u).toString());
      continue;
    }
    if (!r.ok) {
      await r.body?.cancel();
      if (r.status === 404 || r.status === 401 || r.status === 403) throw new UserError("Outlook no longer shares this calendar. Publish it again and paste the new link.");
      throw new UserError("Outlook did not send the calendar. Try again shortly.");
    }
    if (Number(r.headers.get("Content-Length") ?? 0) > ICS_MAX_BYTES) throw new UserError("This calendar is too large to read.");
    const text = await r.text();
    if (text.length > ICS_MAX_BYTES) throw new UserError("This calendar is too large to read.");
    if (!text.includes("BEGIN:VCALENDAR")) throw new UserError("That link did not return a calendar. Use the ICS link from Outlook.");
    return text;
  }
  throw new UserError("Outlook redirected too many times. Publish the calendar again and paste the new link.");
}

function mailboxFromLink(u: URL) {
  const seg = u.pathname.split("/").map(decodeURIComponent).find((x) => /^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(x));
  return (seg ?? "Outlook calendar").toLowerCase().slice(0, 200);
}

async function addCalendarLink(admin: SupabaseClient, userId: string, link: unknown) {
  if (typeof link !== "string" || link.length > 2000) throw new UserError("Paste the ICS link from Outlook.");
  const u = checkIcsUrl(link);
  await fetchIcs(u.toString());
  const email = mailboxFromLink(u);
  const { data: account, error } = await admin.from("cc_mail_accounts")
    .upsert({ user_id: userId, provider: "outlook_ics", email, status: "connected", last_error: null, scopes: "calendar (published link)" },
      { onConflict: "user_id,provider,email" })
    .select("id, user_id, provider, email, identity").single();
  if (error) throw error;
  if (!account.identity && email.endsWith("@theonefor.ai")) {
    await admin.from("cc_mail_accounts").update({ identity: "doug_it" }).eq("id", account.id);
  }
  const { error: tErr } = await admin.from("cc_mail_tokens").upsert({
    account_id: account.id, access_token_enc: await encrypt(u.toString()), refresh_token_enc: null,
    expires_at: LINK_NEVER_EXPIRES, updated_at: new Date().toISOString(),
  });
  if (tErr) throw tErr;
  return syncAccount(admin, account as Account);
}

async function accountEmail(provider: OAuthProvider, token: string): Promise<string> {
  if (provider === "microsoft") {
    const me = await apiGet(`${GRAPH}/me?$select=mail,userPrincipalName`, token);
    return String(me.mail || me.userPrincipalName || "").toLowerCase().slice(0, 200);
  }
  const me = await apiGet("https://openidconnect.googleapis.com/v1/userinfo", token);
  return String(me.email || "").toLowerCase();
}

async function startConnect(admin: SupabaseClient, userId: string, provider: OAuthProvider, origin: string | null) {
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
  if (provider === "microsoft") {
    return { url: `${MS_AUTH}/authorize?` + new URLSearchParams({
      ...common, scope: MICROSOFT_SCOPES, response_mode: "query", prompt: "select_account", login_hint: "doug@theonefor.ai", domain_hint: "theonefor.ai",
    }) };
  }
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" +
      new URLSearchParams({ ...common, scope: GOOGLE_SCOPES, access_type: "offline", prompt: "consent select_account", login_hint: "doug@encountive.com", hd: "encountive.com", include_granted_scopes: "true" });
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
    new Response(null, { status: 302, headers: { Location: `${row.return_to}/setup?section=connectors&mail=${result}` } });
  if (Date.now() - new Date(row.created_at).getTime() > 10 * 60_000) return back("expired");
  const code = url.searchParams.get("code");
  if (!code) return back(url.searchParams.get("error") === "access_denied" ? "denied" : "error");
  try {
    const provider = row.provider as OAuthProvider;
    const tokens = await tokenRequest(provider, {
      grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, code_verifier: row.code_verifier,
    });
    const email = await accountEmail(provider, tokens.access_token);
    if (!email) return back("error");
    const { data: account, error } = await admin.from("cc_mail_accounts")
      .upsert({ user_id: row.user_id, provider, email, status: "connected", last_error: null, scopes: tokens.scope ?? null },
        { onConflict: "user_id,provider,email" })
      .select("id, user_id, provider, email, identity").single();
    if (error) throw error;
    if (!account.identity && email.endsWith("@theonefor.ai")) {
      await admin.from("cc_mail_accounts").update({ identity: "doug_it" }).eq("id", account.id);
    }
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
  if (account.provider === "outlook_ics") return decrypt(t.access_token_enc);
  if (new Date(t.expires_at).getTime() - Date.now() > 120_000) return decrypt(t.access_token_enc);
  if (!t.refresh_token_enc) throw new UserError("Sign-in for this account expired. Reconnect it.");
  const refresh = await decrypt(t.refresh_token_enc);
  const tokens = await tokenRequest(account.provider, { grant_type: "refresh_token", refresh_token: refresh }).catch(() => {
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

async function microsoftData(token: string, from: Date, to: Date) {
  const list = await apiGet(`${GRAPH}/me/mailFolders/inbox/messages?` + new URLSearchParams({
    $top: "30", $orderby: "receivedDateTime desc",
    $select: "id,conversationId,from,subject,bodyPreview,receivedDateTime,isRead,importance,webLink",
  }), token);
  const messages: MessageRow[] = (list.value ?? []).map((x: any) => ({
    provider_id: x.id, thread_id: x.conversationId ?? null,
    from_name: clip(x.from?.emailAddress?.name, 200), from_email: clip(x.from?.emailAddress?.address, 200),
    subject: clip(x.subject, 500), snippet: clip(x.bodyPreview, 300), received_at: new Date(x.receivedDateTime).toISOString(),
    is_unread: x.isRead === false, is_important: x.importance === "high",
    web_link: typeof x.webLink === "string" && x.webLink.startsWith("https://") ? x.webLink.slice(0, 2000) : null,
  }));
  const e = await apiGet(`${GRAPH}/me/calendarView?` + new URLSearchParams({
    startDateTime: from.toISOString(), endDateTime: to.toISOString(), $top: "250", $orderby: "start/dateTime",
    $select: "id,subject,start,end,isAllDay,location,organizer,webLink,isCancelled",
  }), token, { Prefer: 'outlook.timezone="UTC"' });
  const events: EventRow[] = (e.value ?? []).filter((x: any) => x.start?.dateTime).map((x: any) => ({
    provider_id: x.id, title: clip(x.subject, 500),
    starts_at: new Date(utc(x.start.dateTime)).toISOString(), ends_at: new Date(utc(x.end?.dateTime ?? x.start.dateTime)).toISOString(),
    all_day: !!x.isAllDay, location: clip(x.location?.displayName, 300), organizer: clip(x.organizer?.emailAddress?.name ?? x.organizer?.emailAddress?.address, 200),
    web_link: typeof x.webLink === "string" && x.webLink.startsWith("https://") ? x.webLink.slice(0, 2000) : null, is_cancelled: !!x.isCancelled,
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
    const { messages, events } = account.provider === "outlook_ics"
      ? { messages: [] as MessageRow[], events: parseIcs(await fetchIcs(token), from, to) }
      : account.provider === "microsoft"
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
        providers: { google: { configured: !!creds("google") }, microsoft: { configured: !!creds("microsoft") }, outlook_ics: { configured: true } },
      });
    }
    if (action === "start") {
      if (body.provider !== "google" && body.provider !== "microsoft") return json({ error: "Unknown provider." }, 400);
      return json(await startConnect(admin, user.id, body.provider, req.headers.get("Origin")));
    }
    if (action === "add_calendar_link") {
      const result = await addCalendarLink(admin, user.id, body.link);
      return result.ok ? json(result) : json({ error: result.error }, 400);
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
