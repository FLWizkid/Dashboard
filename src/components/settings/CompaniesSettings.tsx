import { useState } from 'react';
import { Building2, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { IDENTITIES, type Company, type Identity } from '@/lib/types';
import { errorMessage } from '@/lib/utils';
import { useCompanies, useDeleteCompany, useSaveCompany } from '@/data/organization';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { IdentityBadge } from '@/components/ui/badge';
import { Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

type Draft = { id?: string; name: string; identity: Identity | null };

export function CompaniesSettings() {
  const companies = useCompanies();
  const save = useSaveCompany();
  const del = useDeleteCompany();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function submit() {
    if (!draft?.name.trim()) return toast('A company needs a name.', 'error');
    try {
      await save.mutateAsync({ ...draft, name: draft.name.trim() });
      toast('Company saved');
      setDraft(null);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  const editor = draft && (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <input className="input min-w-[160px] flex-1" autoFocus placeholder="Company name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      <Select className="w-auto" value={draft.identity ?? ''} onChange={(e) => setDraft({ ...draft, identity: (e.target.value || null) as Identity | null })} aria-label="Identity">
        <option value="">Identity unset</option>
        {IDENTITIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
      </Select>
      <Button size="icon" variant="primary" onClick={submit} disabled={save.isPending} aria-label="Save company"><Check /></Button>
      <Button size="icon" variant="ghost" onClick={() => setDraft(null)} aria-label="Cancel"><X /></Button>
    </div>
  );

  const rows = companies.data ?? [];
  return (
    <Panel
      title="Companies"
      icon={<Building2 />}
      subtitle="Used for tasks, time and @mentions in Quick Add"
      updatedAt={companies.dataUpdatedAt}
      onRefresh={() => companies.refetch()}
      refreshing={companies.isFetching}
      loading={companies.isLoading}
      error={companies.error}
      actions={!draft && <Button size="sm" variant="secondary" onClick={() => setDraft({ name: '', identity: null })}><Plus /> Add</Button>}
    >
      {rows.length === 0 && !draft && <EmptyState title="No companies" text="Add one to tag tasks and time." />}
      <ul className="divide-y divide-line">
        {rows.map((c: Company) =>
          draft?.id === c.id ? (
            <li key={c.id}>{editor}</li>
          ) : (
            <li key={c.id} className="group flex items-center gap-3 py-2">
              <span className="flex-1 text-sm font-medium">{c.name}</span>
              <span className="hidden font-mono text-xs text-subtle sm:inline">@{c.slug}</span>
              <IdentityBadge identity={c.identity} />
              {confirmId === c.id ? (
                <>
                  <span className="text-xs text-muted">Delete? Linked items are unlinked.</span>
                  <Button size="sm" variant="danger" onClick={async () => { try { await del.mutateAsync(c.id); toast('Company deleted'); } catch (e) { toast(errorMessage(e), 'error'); } setConfirmId(null); }}>Delete</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>Keep</Button>
                </>
              ) : (
                <>
                  <Button size="iconSm" variant="ghost" onClick={() => setDraft({ id: c.id, name: c.name, identity: c.identity })} aria-label={`Edit ${c.name}`}><Pencil /></Button>
                  <Button size="iconSm" variant="ghost" onClick={() => setConfirmId(c.id)} aria-label={`Delete ${c.name}`}><Trash2 /></Button>
                </>
              )}
            </li>
          ),
        )}
        {draft && !draft.id && <li>{editor}</li>}
      </ul>
    </Panel>
  );
}
