import { addDays, addMonths, addWeeks, addYears, nextMonday, isValid, parse } from 'date-fns';
import type { Company, Identity, Priority, Recurrence } from './types';
import { toDateKey, fromDateKey } from './utils';

export interface ParsedTask {
  title: string;
  due_date: string | null;
  priority: Priority | null;
  category: string | null;
  company_id: string | null;
  identity: Identity | null;
  recurrence: Recurrence;
  unknownCompany: string | null;
}

const PRIORITY_ALIASES: Record<string, Priority> = {
  low: 'low', l: 'low', p4: 'low',
  med: 'medium', medium: 'medium', m: 'medium', p3: 'medium',
  high: 'high', h: 'high', p2: 'high',
  urgent: 'urgent', u: 'urgent', p1: 'urgent', critical: 'urgent',
};

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FULL_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const RECURRENCE_WORDS: Record<string, Recurrence> = {
  day: 'daily', daily: 'daily', week: 'weekly', weekly: 'weekly',
  month: 'monthly', monthly: 'monthly', year: 'annually', yearly: 'annually', annually: 'annually',
};

function parseDateWord(word: string, today: Date): Date | null {
  const w = word.toLowerCase();
  if (w === 'today' || w === 'tod') return today;
  if (w === 'tomorrow' || w === 'tmr' || w === 'tom') return addDays(today, 1);
  const dayIdx = DAYS.findIndex((d, i) => w === d || w === FULL_DAYS[i] || (i === 2 && w === 'tues') || (i === 4 && (w === 'thur' || w === 'thurs')));
  if (dayIdx >= 0) {
    const diff = (dayIdx - today.getDay() + 7) % 7;
    return addDays(today, diff);
  }
  const rel = w.match(/^\+?(\d+)(d|w|m)$/);
  if (rel) {
    const n = Number(rel[1]);
    return rel[2] === 'd' ? addDays(today, n) : rel[2] === 'w' ? addWeeks(today, n) : addMonths(today, n);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) {
    const d = fromDateKey(w);
    return isValid(d) ? d : null;
  }
  if (/^\d{1,2}\/\d{1,2}$/.test(w)) {
    let d = parse(w, 'M/d', today);
    if (!isValid(d)) return null;
    if (d < today && toDateKey(d) !== toDateKey(today)) d = addYears(d, 1);
    return d;
  }
  return null;
}

export function parseQuickAdd(input: string, companies: Company[], today = new Date()): ParsedTask {
  const result: ParsedTask = {
    title: '', due_date: null, priority: null, category: null,
    company_id: null, identity: null, recurrence: 'none', unknownCompany: null,
  };
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const titleWords: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const lower = tok.toLowerCase();
    const next = tokens[i + 1]?.toLowerCase();

    if (tok.startsWith('!') && PRIORITY_ALIASES[lower.slice(1)]) {
      result.priority = PRIORITY_ALIASES[lower.slice(1)];
      continue;
    }
    if (tok.startsWith('#') && tok.length > 1) {
      result.category = tok.slice(1);
      continue;
    }
    if (tok.startsWith('@') && tok.length > 1) {
      const key = lower.slice(1).replace(/[^a-z0-9]/g, '');
      const match = companies.find((c) => {
        const slug = c.slug.replace(/[^a-z0-9]/g, '');
        const name = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return slug === key || name === key || name.startsWith(key) || slug.startsWith(key);
      });
      if (match) {
        result.company_id = match.id;
        result.identity = match.identity;
      } else {
        result.unknownCompany = tok.slice(1);
      }
      continue;
    }
    if (lower.startsWith('*') && RECURRENCE_WORDS[lower.slice(1)]) {
      result.recurrence = RECURRENCE_WORDS[lower.slice(1)];
      continue;
    }
    if (lower === 'every' && next && RECURRENCE_WORDS[next]) {
      result.recurrence = RECURRENCE_WORDS[next];
      i++;
      continue;
    }
    if (lower === 'next' && next === 'week') {
      result.due_date = toDateKey(nextMonday(today));
      i++;
      continue;
    }
    if (lower === 'in' && next && /^\d+(d|w|m)$/.test(next)) {
      const d = parseDateWord(next, today);
      if (d) {
        result.due_date = toDateKey(d);
        i++;
        continue;
      }
    }
    const date = parseDateWord(tok, today);
    if (date && !result.due_date) {
      result.due_date = toDateKey(date);
      continue;
    }
    titleWords.push(tok);
  }

  result.title = titleWords.join(' ');
  return result;
}

export function nextOccurrence(from: string, recurrence: Recurrence): string | null {
  const d = fromDateKey(from);
  switch (recurrence) {
    case 'daily': return toDateKey(addDays(d, 1));
    case 'weekly': return toDateKey(addWeeks(d, 1));
    case 'monthly': return toDateKey(addMonths(d, 1));
    case 'annually': return toDateKey(addYears(d, 1));
    default: return null;
  }
}
