import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Company, Project, Task } from '@/lib/types';
import { check, recordAudit, unwrap } from './core';

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Please sign in again.');
  return data.user.id;
}
import { reseedDemo, seedIfFirstRun } from './demo';

async function deleteAll(table: string) {
  check(await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000'));
}

export function useSaveCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; identity: string | null }) => {
      const name = input.name.trim();
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'company';
      const row = unwrap(
        await supabase.from('cc_companies').insert({ name, slug, identity: input.identity }).select('*').single(),
      ) as Company;
      await recordAudit('company.create', 'company', row.id);
      return row;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  });
}

export function useSaveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; company_id: string | null; identity: string | null }) => {
      const row = unwrap(
        await supabase.from('cc_projects').insert({ ...input, name: input.name.trim() }).select('*').single(),
      ) as Project;
      await recordAudit('project.create', 'project', row.id);
      return row;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['usage'] });
    },
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Task> & { title: string }) => {
      const row = unwrap(await supabase.from('cc_tasks').insert(input).select('*').single()) as Task;
      await recordAudit('task.create', 'task', row.id);
      return row;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['priorities'] });
      qc.invalidateQueries({ queryKey: ['usage'] });
    },
  });
}

export function useDeleteCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      check(await supabase.from('cc_companies').delete().eq('id', id));
      await recordAudit('company.delete', 'company', id);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      check(await supabase.from('cc_projects').delete().eq('id', id));
      await recordAudit('project.delete', 'project', id);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['usage'] });
    },
  });
}

export function useResetAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await deleteAll('cc_tasks');
      await deleteAll('cc_time_entries');
      await deleteAll('cc_projects');
      await deleteAll('cc_companies');
      await recordAudit('setup.reset_all', 'settings');
      await seedIfFirstRun(await currentUserId());
    },
    onSettled: () => qc.invalidateQueries(),
  });
}

export function useClearRealData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await deleteAll('cc_tasks');
      await deleteAll('cc_time_entries');
      await recordAudit('setup.clear_tasks_hours', 'settings');
      await reseedDemo();
    },
    onSettled: () => qc.invalidateQueries(),
  });
}
