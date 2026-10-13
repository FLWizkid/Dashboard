import { differenceInCalendarDays } from 'date-fns';
import type { SaasTool } from './types';
import { fromDateKey, toDateKey } from './utils';

export const UNUSED_AFTER_DAYS = 60;
export const REVIEW_EVERY_DAYS = 90;
export const RENEWAL_ALERT_DAYS = [30, 14, 7] as const;

export const daysUntil = (dateKey: string) => differenceInCalendarDays(fromDateKey(dateKey), fromDateKey(toDateKey(new Date())));
export const daysSince = (dateKey: string) => -daysUntil(dateKey);

export function monthlyCost(t: SaasTool) {
  if (t.status === 'cancelled') return 0;
  if (t.billing_cycle === 'monthly') return Number(t.cost_amount);
  if (t.billing_cycle === 'annual') return Number(t.cost_amount) / 12;
  return 0;
}

export const annualCost = (t: SaasTool) => monthlyCost(t) * 12;

export function renewalTier(t: SaasTool): 7 | 14 | 30 | 'overdue' | null {
  if (!t.renewal_date || t.status === 'cancelled') return null;
  const d = daysUntil(t.renewal_date);
  if (d < 0) return 'overdue';
  return RENEWAL_ALERT_DAYS.slice().reverse().find((tier) => d <= tier) ?? null;
}

export function isUnused(t: SaasTool) {
  if (t.status === 'cancelled') return false;
  return !t.last_used_on || daysSince(t.last_used_on) > UNUSED_AFTER_DAYS;
}

export const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 100 ? 0 : 2 });

export const prettyDate = (dateKey: string | null) => (dateKey ? fromDateKey(dateKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
