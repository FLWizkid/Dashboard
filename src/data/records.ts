import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { check, recordAudit, unwrap } from './core';

export type RecordTable =
  | 'cc_saas_tools'
  | 'cc_hardware'
  | 'cc_access_grants'
  | 'cc_checklists'
  | 'cc_security_items'
  | 'cc_incidents'
  | 'cc_changes'
  | 'cc_requests'
  | 'cc_identity_migrations';

const ORDER: Record<RecordTable, { column: string; ascending: boolean }> = {
  cc_saas_tools: { column: 'name', ascending: true },
  cc_hardware: { column: 'name', ascending: true },
  cc_access_grants: { column: 'person', ascending: true },
  cc_checklists: { column: 'started_on', ascending: false },
  cc_security_items: { column: 'title', ascending: true },
  cc_incidents: { column: 'occurred_at', ascending: false },
  cc_changes: { column: 'changed_at', ascending: false },
  cc_requests: { column: 'created_at', ascending: false },
  cc_identity_migrations: { column: 'created_at', ascending: false },
};

const entityOf = (table: RecordTable) => table.replace(/^cc_/, '').replace(/s$/, '');

export function useRecords<T>(table: RecordTable) {
  const { column, ascending } = ORDER[table];
  return useQuery({
    queryKey: ['records', table],
    queryFn: async () => unwrap(await supabase.from(table).select('*').order(column, { ascending }).limit(1000)) as T[],
  });
}

export type RecordValues = Record<string, unknown> & { id?: string };

export function useSaveRecord(table: RecordTable) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: RecordValues) => {
      if (id) {
        check(await supabase.from(table).update(values).eq('id', id));
        await recordAudit(`${entityOf(table)}.update`, entityOf(table), id);
        return id;
      }
      const row = unwrap(await supabase.from(table).insert(values).select('id').single()) as { id: string };
      await recordAudit(`${entityOf(table)}.create`, entityOf(table), row.id);
      return row.id;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['records'] }),
  });
}

export function useInsertMany(table: RecordTable) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: Record<string, unknown>[]) => {
      check(await supabase.from(table).insert(rows));
      await recordAudit(`${entityOf(table)}.bulk_create`, entityOf(table));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['records', table] }),
  });
}

export function useDeleteRecord(table: RecordTable) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      check(await supabase.from(table).delete().eq('id', id));
      await recordAudit(`${entityOf(table)}.delete`, entityOf(table), id);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['records'] }),
  });
}
