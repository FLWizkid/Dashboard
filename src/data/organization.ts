import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Company, Project } from '@/lib/types';
import { check, recordAudit, unwrap } from './core';
import { useShowDemo } from './settings';

export function useCompanies() {
  const showDemo = useShowDemo();
  return useQuery({
    queryKey: ['companies'],
    queryFn: async () => unwrap(await supabase.from('cc_companies').select('*').order('name')) as Company[],
    select: (rows) => (showDemo ? rows : rows.filter((r) => !r.is_demo)),
  });
}

export function useSaveCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: Partial<Company> & { name: string }) => {
      const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const payload = { name: c.name.trim(), slug, identity: c.identity ?? null };
      if (c.id) {
        check(await supabase.from('cc_companies').update(payload).eq('id', c.id));
        await recordAudit('company.update', 'company', c.id);
      } else {
        const row = unwrap(await supabase.from('cc_companies').insert(payload).select('id').single());
        await recordAudit('company.create', 'company', row.id);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  });
}

export function useDeleteCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      check(await supabase.from('cc_companies').delete().eq('id', id));
      await recordAudit('company.delete', 'company', id);
    },
    onSettled: () => qc.invalidateQueries(),
  });
}

export function useProjects() {
  const showDemo = useShowDemo();
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => unwrap(await supabase.from('cc_projects').select('*').order('name')) as Project[],
    select: (rows) => (showDemo ? rows : rows.filter((r) => !r.is_demo)),
  });
}

export type ProjectInput = Omit<Project, 'id' | 'is_demo' | 'updated_at'> & { id?: string };

export function useSaveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...p }: ProjectInput) => {
      if (id) {
        check(await supabase.from('cc_projects').update(p).eq('id', id));
        await recordAudit('project.update', 'project', id);
      } else {
        const row = unwrap(await supabase.from('cc_projects').insert(p).select('id').single());
        await recordAudit('project.create', 'project', row.id);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['projects'] }),
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
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
