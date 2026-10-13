import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Identity } from '@/lib/types';
import { check, recordAudit } from './core';

export type IdentityTable = 'cc_companies' | 'cc_projects' | 'cc_tasks' | 'cc_saas_tools';

const QUERY_KEYS: Record<IdentityTable, unknown[]> = {
  cc_companies: ['companies'],
  cc_projects: ['projects'],
  cc_tasks: ['tasks'],
  cc_saas_tools: ['records', 'cc_saas_tools'],
};

export function useSetIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ table, id, identity }: { table: IdentityTable; id: string; identity: Identity }) => {
      check(await supabase.from(table).update({ identity }).eq('id', id));
      await recordAudit('identity.set', table.replace(/^cc_/, ''), id);
      return table;
    },
    onSettled: (table) => table && qc.invalidateQueries({ queryKey: QUERY_KEYS[table] }),
  });
}
