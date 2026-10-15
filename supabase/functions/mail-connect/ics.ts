export interface IcsEvent {
  provider_id: string; title: string | null; starts_at: string; ends_at: string; all_day: boolean;
  location: string | null; organizer: string | null; web_link: string | null; is_cancelled: boolean;
}

interface Prop { value: string; params: Record<string, string> }
interface Local { y: number; mo: number; d: number; h: number; mi: number; s: number }
interface When { local: Local; tz: string | null; utc: boolean; date: boolean }

const WINDOWS_ZONES: Record<string, string> = {
  "Eastern Standard Time": "America/New_York", "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver", "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles", "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu", "Atlantic Standard Time": "America/Halifax",
  "US Eastern Standard Time": "America/Indiana/Indianapolis", "Canada Central Standard Time": "America/Regina",
  "Central America Standard Time": "America/Guatemala", "Central Standard Time (Mexico)": "America/Mexico_City",
  "GMT Standard Time": "Europe/London", "Greenwich Standard Time": "Atlantic/Reykjavik", "UTC": "UTC",
  "W. Europe Standard Time": "Europe/Berlin", "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest", "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Chisinau", "GTB Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev", "India Standard Time": "Asia/Kolkata", "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo", "Singapore Standard Time": "Asia/Singapore",
  "AUS Eastern Standard Time": "Australia/Sydney", "New Zealand Standard Time": "Pacific/Auckland",
  "SA Pacific Standard Time": "America/Bogota", "E. South America Standard Time": "America/Sao_Paulo",
};
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_MS = 86400_000;
const MAX_STEPS = 5000;

function unfold(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line: string): [string, Prop] | null {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return [name.toUpperCase(), { value: line.slice(colon + 1), params }];
}

const unescape = (s: string) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
const clip = (s: string | undefined, n: number) => (s ? unescape(s).slice(0, n) || null : null);

function zoneName(tzid: string | undefined) {
  if (!tzid) return null;
  if (WINDOWS_ZONES[tzid]) return WINDOWS_ZONES[tzid];
  try { new Intl.DateTimeFormat("en-US", { timeZone: tzid }); return tzid; } catch { return null; }
}

function parseWhen(p: Prop | undefined): When | null {
  const m = p?.value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const local = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) };
  return { local, tz: zoneName(p!.params.TZID), utc: !!m[7], date: !m[4] };
}

function zoneOffset(ts: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ts));
  const v = (t: string) => Number(parts.find((x) => x.type === t)?.value);
  return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - ts;
}

function toUtc(l: Local, w: When) {
  const wall = Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi, l.s);
  if (w.utc || w.date || !w.tz) return wall;
  const first = wall - zoneOffset(wall, w.tz);
  return wall - zoneOffset(first, w.tz);
}

function addDays(l: Local, n: number): Local {
  const t = new Date(Date.UTC(l.y, l.mo - 1, l.d + n));
  return { ...l, y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
const weekday = (l: Local) => new Date(Date.UTC(l.y, l.mo - 1, l.d)).getUTCDay();
const daysIn = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

function nthWeekday(y: number, mo: number, rule: string): number | null {
  const m = rule.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : 1;
  const dow = DAYS.indexOf(m[2]);
  const last = daysIn(y, mo);
  if (n > 0) {
    const first = (dow - new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 7) % 7 + 1;
    const d = first + (n - 1) * 7;
    return d <= last ? d : null;
  }
  const lastDow = new Date(Date.UTC(y, mo - 1, last)).getUTCDay();
  const d = last - ((lastDow - dow + 7) % 7) + (n + 1) * 7;
  return d >= 1 ? d : null;
}

function occurrences(start: Local, rrule: string, windowEnd: number, w: When): Local[] {
  const r: Record<string, string> = {};
  for (const part of rrule.split(";")) { const [k, v] = part.split("="); if (k && v) r[k.toUpperCase()] = v; }
  const freq = r.FREQ;
  const interval = Math.max(1, Number(r.INTERVAL) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? parseWhen({ value: r.UNTIL, params: {} }) : null;
  const untilMs = until ? toUtc(until.local, { ...until, tz: until.utc ? null : w.tz }) : Infinity;
  const byDay = r.BYDAY ? r.BYDAY.split(",") : [];
  const byMonthDay = r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : [];
  const out: Local[] = [];
  const startMs = toUtc(start, w);
  const push = (l: Local) => {
    const ms = toUtc(l, w);
    if (ms < startMs) return true;
    if (ms > untilMs || ms > windowEnd || out.length >= count) return false;
    out.push(l);
    return true;
  };
  for (let i = 0; i < MAX_STEPS; i++) {
    let batch: Local[] = [];
    if (freq === "DAILY") batch = [addDays(start, i * interval)];
    else if (freq === "WEEKLY") {
      const weekStart = addDays(start, i * interval * 7 - ((weekday(start) + 6) % 7));
      const days = byDay.length ? byDay.map((d) => (DAYS.indexOf(d.slice(-2)) + 6) % 7) : [(weekday(start) + 6) % 7];
      batch = [...new Set(days)].sort((a, b) => a - b).map((n) => addDays(weekStart, n));
    } else if (freq === "MONTHLY" || freq === "YEARLY") {
      const total = start.mo - 1 + i * interval * (freq === "YEARLY" ? 12 : 1);
      const y = start.y + Math.floor(total / 12);
      const mo = r.BYMONTH && freq === "YEARLY" ? Number(r.BYMONTH) : (total % 12) + 1;
      const days = byDay.length
        ? byDay.map((d) => nthWeekday(y, mo, d))
        : (byMonthDay.length ? byMonthDay : [start.d]).map((d) => (d < 0 ? daysIn(y, mo) + d + 1 : d));
      batch = days.filter((d): d is number => d !== null && d >= 1 && d <= daysIn(y, mo)).sort((a, b) => a - b)
        .map((d) => ({ ...start, y, mo, d }));
    } else return [start];
    for (const l of batch) if (!push(l)) return out;
  }
  return out;
}

const URL_RE = /https:\/\/[^\s<>"'\\]+/gi;
const MEETING_HOST = /(^|\.)(teams\.microsoft\.com|teams\.live\.com|zoom\.us|zoomgov\.com|meet\.google\.com|webex\.com|gotomeeting\.com|meet\.goto\.com|whereby\.com|chime\.aws)$/i;

function httpsUrl(raw: string | undefined) {
  if (!raw) return null;
  try {
    const u = new URL(raw.replace(/[).,;]+$/, ""));
    return u.protocol === "https:" ? u.toString().slice(0, 2000) : null;
  } catch { return null; }
}

function urlsIn(text: string | undefined) {
  return (text?.replace(/\\n/gi, " ").match(URL_RE) ?? []).map(httpsUrl).filter((u): u is string => !!u);
}

function meetingLink(one: (k: string) => Prop | undefined) {
  for (const k of ["X-MICROSOFT-SKYPETEAMSMEETINGURL", "X-MICROSOFT-ONLINEMEETINGCONFLINK", "X-GOOGLE-CONFERENCE", "URL"]) {
    const u = httpsUrl(one(k)?.value.trim());
    if (u) return u;
  }
  const found = [...urlsIn(one("LOCATION")?.value), ...urlsIn(one("DESCRIPTION")?.value), ...urlsIn(one("X-ALT-DESC")?.value)];
  return found.find((u) => MEETING_HOST.test(new URL(u).hostname)) ?? urlsIn(one("LOCATION")?.value)[0] ?? null;
}

function iso(ms: number) { return new Date(ms).toISOString(); }

export function parseIcs(text: string, from: Date, to: Date): IcsEvent[] {
  const blocks: Map<string, Prop[]>[] = [];
  let cur: Map<string, Prop[]> | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") { cur = new Map(); continue; }
    if (line === "END:VEVENT") { if (cur) blocks.push(cur); cur = null; continue; }
    if (!cur) continue;
    const parsed = parseLine(line);
    if (parsed) cur.set(parsed[0], [...(cur.get(parsed[0]) ?? []), parsed[1]]);
  }
  const windowStart = from.getTime();
  const windowEnd = to.getTime();
  const overrides = new Set<string>();
  for (const b of blocks) {
    const rid = parseWhen(b.get("RECURRENCE-ID")?.[0]);
    const uid = b.get("UID")?.[0]?.value;
    if (rid && uid) overrides.add(`${uid}|${toUtc(rid.local, rid)}`);
  }
  const events: IcsEvent[] = [];
  for (const b of blocks) {
    const one = (k: string) => b.get(k)?.[0];
    const start = parseWhen(one("DTSTART"));
    if (!start) continue;
    const uid = one("UID")?.value ?? `${one("SUMMARY")?.value}-${one("DTSTART")?.value}`;
    const end = parseWhen(one("DTEND"));
    const startMs = toUtc(start.local, start);
    const duration = end ? toUtc(end.local, end) - startMs : (start.date ? DAY_MS : 0);
    const isOverride = !!one("RECURRENCE-ID");
    const rrule = one("RRULE")?.value;
    const exdates = new Set<number>();
    for (const ex of b.get("EXDATE") ?? []) {
      for (const v of ex.value.split(",")) {
        const w = parseWhen({ value: v, params: ex.params });
        if (w) exdates.add(toUtc(w.local, w));
      }
    }
    const starts = rrule && !isOverride
      ? occurrences(start.local, rrule, windowEnd, start).map((l) => toUtc(l, start))
      : [startMs];
    const organizer = one("ORGANIZER");
    const link = meetingLink(one);
    for (const s of starts) {
      if (exdates.has(s)) continue;
      if (!isOverride && rrule && overrides.has(`${uid}|${s}`)) continue;
      const e = s + Math.max(duration, 0);
      if (e <= windowStart || s >= windowEnd) continue;
      events.push({
        provider_id: `${uid}|${iso(s)}`.slice(0, 900),
        title: clip(one("SUMMARY")?.value, 500),
        starts_at: iso(s), ends_at: iso(e), all_day: start.date,
        location: clip(one("LOCATION")?.value, 300),
        organizer: clip(organizer?.params.CN ?? organizer?.value.replace(/^mailto:/i, ""), 200),
        web_link: link,
        is_cancelled: one("STATUS")?.value.toUpperCase() === "CANCELLED",
      });
    }
  }
  return events;
}
