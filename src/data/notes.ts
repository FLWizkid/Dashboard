import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Note } from '@/lib/types';
import { check, recordAudit, unwrap } from './core';

export type NoteInput = Pick<Note, 'title' | 'body' | 'kind' | 'company_id' | 'pinned'> & { id?: string };

export function useNotes() {
  return useQuery({
    queryKey: ['notes'],
    queryFn: async () =>
      unwrap(await supabase.from('cc_notes').select('*').order('pinned', { ascending: false }).order('updated_at', { ascending: false })) as Note[],
  });
}

export function useSaveNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...fields }: NoteInput) => {
      if (id) {
        check(await supabase.from('cc_notes').update(fields).eq('id', id));
        await recordAudit('note.update', 'note', id);
        return id;
      }
      const res = await supabase.from('cc_notes').insert(fields).select('id').single();
      const row = unwrap(res) as { id: string };
      await recordAudit('note.create', 'note', row.id);
      return row.id;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      check(await supabase.from('cc_notes').delete().eq('id', id));
      await recordAudit('note.delete', 'note', id);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
}

export const RUNBOOK_TEMPLATES: { name: string; title: string; body: string }[] = [
  {
    name: 'Agent runbook',
    title: 'Runbook: AGENT NAME',
    body: `## What it does\n\n## When it runs\n\n## Where the report goes\nReport Library in this console.\n\n## If it fails\n1. Open the failed report and read the summary.\n2. Check the account or tool it depends on.\n3. Re-run the agent in Claude.\n\n## Owner and contacts\n`,
  },
  {
    name: 'Offboarding',
    title: 'Runbook: Offboard a person',
    body: `## Before the last day\n- [ ] List every tool they can sign in to (Assets & Access)\n- [ ] Transfer shared files and ownership\n\n## On the last day\n- [ ] Turn off sign-in for each tool\n- [ ] Rotate any shared passwords they knew\n- [ ] Remove from email groups\n\n## After\n- [ ] Cancel unused paid seats (Renewals & Spend)\n`,
  },
  {
    name: 'Incident',
    title: 'Runbook: Security incident',
    body: `## 1. Contain\n- [ ] Change the affected password and sign out other sessions\n- [ ] Turn on two-step sign-in if it was off\n\n## 2. Understand\n- What happened:\n- When:\n- What was affected:\n\n## 3. Fix and record\n- [ ] Log it in Security, Incidents\n- [ ] Tell anyone affected\n`,
  },
  {
    name: 'Domain or DNS change',
    title: 'Runbook: Change a DNS record',
    body: `## Before\n- [ ] Write down the current value (for rollback)\n- [ ] Note the domain and registrar\n\n## Change\n- [ ] Make the change\n- [ ] Log it in Security, Change log with the rollback step\n\n## Check\n- [ ] Website still loads\n- [ ] Email still sends and arrives\n`,
  },
];
