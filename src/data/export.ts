import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AuditEntry } from '@/lib/types';
import { recordAudit, unwrap } from './core';

export const EXPORT_TABLES = [
  { table: 'cc_tasks', label: 'Tasks' },
  { table: 'cc_projects', label: 'Projects' },
  { table: 'cc_companies', label: 'Companies' },
  { table: 'cc_time_entries', label: 'Time entries' },
  { table: 'cc_focus_sessions', label: 'Focus sessions' },
  { table: 'cc_priorities', label: 'Daily priorities' },
  { table: 'cc_settings', label: 'Settings' },
  { table: 'cc_audit_log', label: 'Audit log' },
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number]['table'];

async function fetchTable(table: ExportTable) {
  return unwrap(await supabase.from(table).select('*')) as Record<string, unknown>[];
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v: unknown) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[]) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n');
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function exportJson() {
  const entries = await Promise.all(EXPORT_TABLES.map(async (t) => [t.table.replace('cc_', ''), await fetchTable(t.table)] as const));
  download(`cio-console-export-${stamp()}.json`, JSON.stringify({ exported_at: new Date().toISOString(), ...Object.fromEntries(entries) }, null, 2), 'application/json');
  await recordAudit('export.json', 'export');
}

export async function exportCsv(table: ExportTable) {
  const rows = await fetchTable(table);
  download(`cio-console-${table.replace('cc_', '')}-${stamp()}.csv`, toCsv(rows), 'text/csv');
  await recordAudit('export.csv', table);
}

export function useAuditLog() {
  return useQuery({
    queryKey: ['audit'],
    queryFn: async () => unwrap(await supabase.from('cc_audit_log').select('*').order('created_at', { ascending: false }).limit(50)) as AuditEntry[],
  });
}
