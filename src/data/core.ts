import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export function unwrap<R extends { data: unknown; error: PostgrestError | null }>(res: R): NonNullable<R['data']> {
  if (res.error) throw new Error(friendlyDbError(res.error));
  if (res.data === null || res.data === undefined) throw new Error('No data returned.');
  return res.data as NonNullable<R['data']>;
}

export function check(res: { error: PostgrestError | null }) {
  if (res.error) throw new Error(friendlyDbError(res.error));
}

function friendlyDbError(err: PostgrestError) {
  if (err.message.includes('cc_tasks_ready_requirements')) {
    return 'A task needs a priority and a due date before it can be Ready.';
  }
  if (err.code === '42501') return 'You are not allowed to change this record. Try signing in again.';
  return err.message;
}

export async function recordAudit(action: string, entity: string, entityId?: string | null) {
  const { error } = await supabase.from('cc_audit_log').insert({ action, entity, entity_id: entityId ?? null });
  if (error) console.warn('Audit entry failed', error.message);
}
