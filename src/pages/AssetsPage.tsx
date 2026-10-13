import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { AppWindow, ClipboardList, HardDrive, KeyRound, Plus, ShieldCheck } from 'lucide-react';
import type { AccessGrant, Hardware, SaasTool } from '@/lib/types';
import { identityLabel } from '@/lib/types';
import { errorMessage, safeHref, toDateKey } from '@/lib/utils';
import { REVIEW_EVERY_DAYS, daysSince, daysUntil, isUnused, money, prettyDate } from '@/lib/spend';
import { useRecords, useSaveRecord } from '@/data/records';
import { useCompanies } from '@/data/organization';
import { PageHeader, type PageTab } from '@/components/ui/page-header';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { RecordDialog } from '@/components/records/RecordDialog';
import { Pill, RecordTable } from '@/components/records/RecordTable';
import { HARDWARE_FIELDS, TOOL_DEFAULTS, TOOL_FIELDS, accessFields } from '@/components/assets/fields';
import { Checklists } from '@/components/assets/Checklists';

type Editing<T> = T | 'new' | null;

function useCompanyName() {
  const companies = useCompanies();
  const map = new Map((companies.data ?? []).map((c) => [c.id, c.name]));
  return (id: string | null) => (id ? map.get(id) ?? '' : '');
}

const reviewDue = (g: AccessGrant) => !g.last_reviewed_on || daysSince(g.last_reviewed_on) > REVIEW_EVERY_DAYS;

function SoftwareRegister() {
  const tools = useRecords<SaasTool>('cc_saas_tools');
  const companyName = useCompanyName();
  const [editing, setEditing] = useState<Editing<SaasTool>>(null);
  const rows = tools.data ?? [];
  return (
    <Panel
      title="Software and subscriptions"
      icon={<AppWindow />}
      subtitle={`${rows.filter((t) => t.status !== 'cancelled').length} active`}
      subtitleInline
      actions={<Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus /> Add tool</Button>}
      loading={tools.isLoading}
      error={tools.error}
      empty={rows.length === 0}
      bodyClassName="p-0"
      emptyState={<div className="p-3"><EmptyState icon={<AppWindow />} title="No tools recorded" text="Add every app you or your companies pay for or sign in to. Costs and renewal dates feed Renewals & Spend." action={<Button variant="primary" onClick={() => setEditing('new')}><Plus /> Add tool</Button>} /></div>}
    >
      <RecordTable
        table="cc_saas_tools"
        rows={rows}
        nameOf={(t) => t.name}
        onEdit={setEditing}
        rowClass={(t) => (t.status === 'cancelled' ? 'opacity-60' : undefined)}
        columns={[
          {
            label: 'Tool',
            render: (t) => (
              <div>
                {safeHref(t.url) ? <a href={safeHref(t.url)} target="_blank" rel="noreferrer" className="font-medium hover:text-primary-600 hover:underline">{t.name}</a> : <span className="font-medium">{t.name}</span>}
                {t.category && <p className="text-xs text-subtle">{t.category}</p>}
              </div>
            ),
          },
          { label: 'Company', render: (t) => <span className="text-muted">{companyName(t.company_id) || identityLabel(t.identity)}</span>, wideOnly: true },
          { label: 'Signs in with', render: (t) => <span className="text-muted">{t.login_account}</span>, wideOnly: true },
          { label: 'Cost', render: (t) => (t.billing_cycle === 'none' ? <span className="text-subtle">Free</span> : `${money(Number(t.cost_amount))}/${t.billing_cycle === 'annual' ? 'yr' : 'mo'}`) },
          {
            label: 'Status',
            render: (t) => (
              <div className="flex flex-wrap gap-1">
                <Pill tone={t.status === 'active' ? 'success' : t.status === 'trial' ? 'warning' : 'neutral'}>{t.status === 'active' ? 'Active' : t.status === 'trial' ? 'Trial' : 'Cancelled'}</Pill>
                {isUnused(t) && <Pill tone="warning">Unused?</Pill>}
              </div>
            ),
          },
        ]}
      />
      <RecordDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? 'Add tool' : 'Edit tool'}
        table="cc_saas_tools"
        fields={TOOL_FIELDS}
        record={editing && editing !== 'new' ? editing : null}
        defaults={TOOL_DEFAULTS}
      />
    </Panel>
  );
}

function HardwareRegister() {
  const hw = useRecords<Hardware>('cc_hardware');
  const companyName = useCompanyName();
  const [editing, setEditing] = useState<Editing<Hardware>>(null);
  const rows = hw.data ?? [];
  return (
    <Panel
      title="Hardware"
      icon={<HardDrive />}
      subtitle={`${rows.filter((h) => h.status === 'in_use').length} in use`}
      subtitleInline
      actions={<Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus /> Add device</Button>}
      loading={hw.isLoading}
      error={hw.error}
      empty={rows.length === 0}
      bodyClassName="p-0"
      emptyState={<div className="p-3"><EmptyState icon={<HardDrive />} title="No devices recorded" text="Laptops, phones, security keys and network gear, with who has them and when warranties end." action={<Button variant="primary" onClick={() => setEditing('new')}><Plus /> Add device</Button>} /></div>}
    >
      <RecordTable
        table="cc_hardware"
        rows={rows}
        nameOf={(h) => h.name}
        onEdit={setEditing}
        rowClass={(h) => (h.status === 'retired' ? 'opacity-60' : undefined)}
        columns={[
          { label: 'Device', render: (h) => <div><p className="font-medium">{h.name}</p>{h.kind && <p className="text-xs text-subtle">{h.kind}</p>}</div> },
          { label: 'Assigned to', render: (h) => <span className="text-muted">{h.assigned_to}</span> },
          { label: 'Company', render: (h) => <span className="text-muted">{companyName(h.company_id)}</span>, wideOnly: true },
          { label: 'Serial', render: (h) => <span className="font-mono text-xs text-muted">{h.serial}</span>, wideOnly: true },
          {
            label: 'Warranty',
            render: (h) => {
              if (!h.warranty_until) return <span className="text-subtle">-</span>;
              const d = daysUntil(h.warranty_until);
              return <Pill tone={d < 0 ? 'neutral' : d <= 60 ? 'warning' : 'success'}>{d < 0 ? 'Expired' : prettyDate(h.warranty_until)}</Pill>;
            },
          },
          { label: 'Status', render: (h) => <Pill tone={h.status === 'in_use' ? 'success' : 'neutral'}>{h.status === 'in_use' ? 'In use' : h.status === 'spare' ? 'Spare' : 'Retired'}</Pill> },
        ]}
      />
      <RecordDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? 'Add device' : 'Edit device'}
        table="cc_hardware"
        fields={HARDWARE_FIELDS}
        record={editing && editing !== 'new' ? editing : null}
        defaults={{ status: 'in_use' }}
      />
    </Panel>
  );
}

function AccessReviews() {
  const grants = useRecords<AccessGrant>('cc_access_grants');
  const tools = useRecords<SaasTool>('cc_saas_tools');
  const save = useSaveRecord('cc_access_grants');
  const toast = useToast();
  const [editing, setEditing] = useState<Editing<AccessGrant>>(null);
  const toolList = tools.data ?? [];
  const toolName = new Map(toolList.map((t) => [t.id, t.name]));
  const rows = [...(grants.data ?? [])].sort((a, b) => Number(reviewDue(b)) - Number(reviewDue(a)));
  const due = rows.filter(reviewDue).length;

  const markReviewed = (g: AccessGrant) =>
    save.mutate({ id: g.id, last_reviewed_on: toDateKey(new Date()) }, { onSuccess: () => toast(`Reviewed ${g.person}`), onError: (e) => toast(errorMessage(e), 'error') });

  const canAdd = toolList.length > 0;
  return (
    <Panel
      title="Who has access"
      icon={<KeyRound />}
      subtitle={due ? `${due} due for review (every ${REVIEW_EVERY_DAYS} days)` : `All reviewed within ${REVIEW_EVERY_DAYS} days`}
      subtitleInline
      actions={<Button size="sm" variant="primary" disabled={!canAdd} title={canAdd ? undefined : 'Add a tool first'} onClick={() => setEditing('new')}><Plus /> Add access</Button>}
      loading={grants.isLoading || tools.isLoading}
      error={grants.error ?? tools.error}
      empty={rows.length === 0}
      bodyClassName="p-0"
      emptyState={
        <div className="p-3">
          <EmptyState
            icon={<ShieldCheck />}
            title="No access recorded"
            text={canAdd ? 'Record who can sign in to each tool. Reviewing them regularly catches accounts that should have been removed.' : 'Add your tools under Software first, then record who has access to each.'}
            action={canAdd ? <Button variant="primary" onClick={() => setEditing('new')}><Plus /> Add access</Button> : undefined}
          />
        </div>
      }
    >
      <RecordTable
        table="cc_access_grants"
        rows={rows}
        nameOf={(g) => `${g.person} access`}
        onEdit={setEditing}
        columns={[
          { label: 'Person', render: (g) => <span className="font-medium">{g.person}</span> },
          { label: 'Tool', render: (g) => toolName.get(g.tool_id) ?? '' },
          { label: 'Level', render: (g) => <span className="text-muted">{g.level}</span>, wideOnly: true },
          {
            label: 'Last reviewed',
            render: (g) => (
              <div className="flex flex-wrap items-center gap-2">
                {reviewDue(g) ? <Pill tone="warning">{g.last_reviewed_on ? `Due · ${prettyDate(g.last_reviewed_on)}` : 'Never reviewed'}</Pill> : <span className="text-muted">{prettyDate(g.last_reviewed_on)}</span>}
                {reviewDue(g) && <Button size="sm" variant="ghost" onClick={() => markReviewed(g)} disabled={save.isPending}>Mark reviewed</Button>}
              </div>
            ),
          },
        ]}
      />
      <RecordDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? 'Add access' : 'Edit access'}
        table="cc_access_grants"
        fields={accessFields(toolList)}
        record={editing && editing !== 'new' ? editing : null}
        defaults={{ granted_on: toDateKey(new Date()), last_reviewed_on: toDateKey(new Date()) }}
      />
    </Panel>
  );
}

const SECTIONS: (PageTab & { description: string })[] = [
  { key: 'software', label: 'Software', to: '/assets/software', icon: AppWindow, description: 'Every app and subscription, who signs in, and what it costs.' },
  { key: 'hardware', label: 'Hardware', to: '/assets/hardware', icon: HardDrive, description: 'Devices, who has them and warranty dates.' },
  { key: 'access', label: 'Access reviews', to: '/assets/access', icon: KeyRound, description: 'Who can sign in to what, reviewed every 90 days.' },
  { key: 'checklists', label: 'Onboarding & offboarding', to: '/assets/checklists', icon: ClipboardList, description: 'Step-by-step lists for people joining or leaving.' },
];

export function AssetsPage() {
  const { section } = useParams();
  const grants = useRecords<AccessGrant>('cc_access_grants');
  const due = (grants.data ?? []).filter(reviewDue).length;
  const current = SECTIONS.find((s) => s.key === section);
  if (!current) return <Navigate to="/assets/software" replace />;
  const tabs = SECTIONS.map((s) => (s.key === 'access' && due ? { ...s, count: due, tone: 'alert' as const } : s));

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <PageHeader title="Assets & Access" description={current.description} tabs={tabs} activeTab={current.key} />
      <div className="animate-fade-in" key={current.key}>
        {current.key === 'software' && <SoftwareRegister />}
        {current.key === 'hardware' && <HardwareRegister />}
        {current.key === 'access' && <AccessReviews />}
        {current.key === 'checklists' && <Checklists />}
      </div>
    </div>
  );
}
