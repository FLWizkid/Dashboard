import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toDateKey(d: Date) {
  return format(d, 'yyyy-MM-dd');
}

export function fromDateKey(key: string) {
  return parseISO(key);
}

export function relativeTime(ts: number | string | null | undefined) {
  if (!ts) return 'never';
  const date = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (Date.now() - date.getTime() < 10_000) return 'just now';
  return `${formatDistanceToNowStrict(date)} ago`;
}

export function formatMinutes(total: number) {
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d+(\.\d+)?h$/.test(s)) return Math.round(parseFloat(s) * 60);
  if (/^\d+m(in)?$/.test(s)) return parseInt(s, 10);
  const hm = s.match(/^(\d+)h(\d+)m?$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const colon = s.match(/^(\d+):(\d{1,2})$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  return null;
}

export function errorMessage(err: unknown) {
  if (!err) return 'Something went wrong.';
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}
