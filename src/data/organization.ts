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
      const profile = Object.fromEntries(
        (['website', 'my_role', 'key_contact'] as const).filter((k) => k in c).map((k) => [k, c[k]?.trim() || null]),
      );
      const payload = { name: c.name.trim(), slug, identity: c.identity ?? null, ...profile };
      if (c.id) {
        check(await supabase.from('cc_companies').update(payload).eq('id', c.id));
        return c.id;
      }
      const row = unwrap(await supabase.from('cc_companies').insert(payload).select('id').single()) as { id: string };
      await recordAudit('company.create', 'company', row.id);
      return row.id;
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
      } else {
        const row = unwrap(await supabase.from('cc_projects').insert(p).select('id').single()) as { id: string };
        await recordAudit('project.create', 'project', row.id);
        return row.id;
      }
      return id;
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

export type UsageKind = 'project' | 'company' | 'time_category';

export function useUsage() {
  return useQuery({
    queryKey: ['usage'],
    queryFn: async () => {
      const rows = unwrap(await supabase.rpc('cc_usage_counts')) as { kind: UsageKind; key: string; uses: number; last_used: string | null }[];
      return new Map(rows.map((r) => [`${r.kind}:${r.key}`, { uses: r.uses, last: r.last_used ? Date.parse(r.last_used) : 0 }]));
    },
    staleTime: 60_000,
  });
}

export function useUsageRank() {
  const { data: usage } = useUsage();
  return <T,>(items: T[], kind: UsageKind, keyOf: (item: T) => string) => {
    if (!usage) return items;
    const stat = (item: T) => usage.get(`${kind}:${keyOf(item)}`) ?? { uses: 0, last: 0 };
    return [...items].sort((a, b) => {
      const x = stat(a);
      const y = stat(b);
      return y.uses - x.uses || y.last - x.last;
    });
  };
}
