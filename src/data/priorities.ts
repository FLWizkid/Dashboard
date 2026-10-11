import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { PriorityPick } from '@/lib/types';
import { toDateKey } from '@/lib/utils';
import { check, recordAudit, unwrap } from './core';

export function usePriorities(day = toDateKey(new Date())) {
  return useQuery({
    queryKey: ['priorities', day],
    queryFn: async () => unwrap(await supabase.from('cc_priorities').select('*').eq('day', day).order('rank')) as PriorityPick[],
  });
}

export function useSetPriorities(day = toDateKey(new Date())) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskIds: string[]) => {
      check(await supabase.from('cc_priorities').delete().eq('day', day));
      if (taskIds.length) {
        check(await supabase.from('cc_priorities').insert(taskIds.slice(0, 3).map((task_id, i) => ({ day, task_id, rank: i + 1 }))));
      }
      await recordAudit('priorities.set', 'priorities');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['priorities', day] }),
  });
}
