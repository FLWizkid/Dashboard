import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Report } from '@/lib/types';
import { check, recordAudit, unwrap } from './core';

export type ReportSummary = Omit<Report, 'body'>;

const LIST_COLUMNS = 'id, agent_id, agent_name, title, status, summary, source_url, received_at, read_at, created_at';

export function useReports(search: string) {
  const q = search.trim().replace(/[,()%*\\]/g, ' ').trim().slice(0, 100);
  return useQuery({
    queryKey: ['reports', q],
    queryFn: async () => {
      let query = supabase.from('cc_reports').select(LIST_COLUMNS).order('received_at', { ascending: false }).limit(500);
      if (q) query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%,body.ilike.%${q}%,agent_name.ilike.%${q}%`);
      return unwrap(await query) as ReportSummary[];
    },
    refetchInterval: 60_000,
  });
}

export function useReport(id: string | undefined) {
  return useQuery({
    queryKey: ['report', id],
    enabled: !!id,
    queryFn: async () => {
      const res = await supabase.from('cc_reports').select('*').eq('id', id as string).maybeSingle();
      check(res);
      return res.data as Report | null;
    },
  });
}

export function usePreviousReport(report: Report | null | undefined) {
  return useQuery({
    queryKey: ['report-previous', report?.id],
    enabled: !!report,
    queryFn: async () => {
      const r = report as Report;
      const res = await supabase
        .from('cc_reports')
        .select('*')
        .eq('agent_name', r.agent_name)
        .lt('received_at', r.received_at)
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      check(res);
      return res.data as Report | null;
    },
  });
}

export function useMarkReportRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, read }: { id: string; read: boolean }) => {
      check(await supabase.from('cc_reports').update({ read_at: read ? new Date().toISOString() : null }).eq('id', id));
    },
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['report', v.id] });
    },
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      check(await supabase.from('cc_reports').delete().eq('id', id));
      await recordAudit('report.delete', 'report', id);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}
