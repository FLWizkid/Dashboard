import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, CheckCircle2, Fingerprint } from 'lucide-react';
import { IDENTITIES, identityLabel, type Identity, type SaasTool } from '@/lib/types';
import { errorMessage } from '@/lib/utils';
import { useCompanies, useProjects } from '@/data/organization';
import { useTasks } from '@/data/tasks';
import { useRecords } from '@/data/records';
import { useSetIdentity, type IdentityTable } from '@/data/identity';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { IdentityBadge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { MoveDialog } from './MigrationTracker';

type Kind = 'Company' | 'Project' | 'Task' | 'Tool';

interface Finding {
  key: string;
  kind: Kind;
  table: IdentityTable;
  id: string;
  name: string;
  current: Identity | null;
  suggested: Identity | null;
  reason: string;
  link: string;
  moveFrom?: { tool: SaasTool; from: string };
}

const identityOfAddress = (address: string | null | undefined): Identity | null =>
  IDENTITIES.find((i) => i.address.toLowerCase() === address?.trim().toLowerCase())?.value ?? null;

const LINKS: Record<Kind, string> = { Company: '/settings/companies', Project: '/projects', Task: '/tasks', Tool: '/assets/software' };

function useFindings() {
  const companies = useCompanies();
  const projects = useProjects();
  const tasks = useTasks();
  const tools = useRecords<SaasTool>('cc_saas_tools');
  const companyById = new Map((companies.data ?? []).map((c) => [c.id, c]));
  const projectById = new Map((projects.data ?? []).map((p) => [p.id, p]));
  const out: Finding[] = [];

  const check = (kind: Kind, table: IdentityTable, id: string, name: string, current: Identity | null, parent: { name: string; identity: Identity | null } | null) => {
    if (!current) {
      out.push({ key: `${table}:${id}`, kind, table, id, name, current, suggested: parent?.identity ?? null, reason: parent?.identity ? `No identity chosen. ${parent.name} is ${identityLabel(parent.identity)}.` : 'No identity chosen.', link: LINKS[kind] });
    } else if (parent?.identity && parent.identity !== current) {
      out.push({ key: `${table}:${id}`, kind, table, id, name, current, suggested: parent.identity, reason: `${parent.name} is ${identityLabel(parent.identity)}, but this is ${identityLabel(current)}.`, link: LINKS[kind] });
    }
  };

  for (const c of companies.data ?? []) check('Company', 'cc_companies', c.id, c.name, c.identity, null);
  for (const p of projects.data ?? []) check('Project', 'cc_projects', p.id, p.name, p.identity, p.company_id ? companyById.get(p.company_id) ?? null : null);
  for (const t of tasks.data ?? []) {
    if (t.status === 'done') continue;
    const parent = (t.project_id ? projectById.get(t.project_id) : undefined) ?? (t.company_id ? companyById.get(t.company_id) : undefined) ?? null;
    check('Task', 'cc_tasks', t.id, t.title, t.identity, parent);
  }
  for (const tool of tools.data ?? []) {
    if (tool.status === 'cancelled') continue;
    const loginIdentity = identityOfAddress(tool.login_account);
    const company = tool.company_id ? companyById.get(tool.company_id) ?? null : null;
    if (tool.identity && loginIdentity && loginIdentity !== tool.identity) {
      out.push({
        key: `tool-login:${tool.id}`, kind: 'Tool', table: 'cc_saas_tools', id: tool.id, name: tool.name, current: tool.identity, suggested: loginIdentity,
        reason: `Signs in with ${tool.login_account} (${identityLabel(loginIdentity)}) but belongs to ${identityLabel(tool.identity)}. Move the login, or change the identity.`,
        link: LINKS.Tool, moveFrom: { tool, from: tool.login_account ?? '' },
      });
    } else {
      check('Tool', 'cc_saas_tools', tool.id, tool.name, tool.identity, loginIdentity ? { name: `Its login ${tool.login_account}`, identity: loginIdentity } : company);
    }
  }

  return {
    findings: out,
    loading: companies.isLoading || projects.isLoading || tasks.isLoading || tools.isLoading,
    error: companies.error ?? projects.error ?? tasks.error ?? tools.error,
    totals: { companies: companies.data?.length ?? 0, projects: projects.data?.length ?? 0, tasks: (tasks.data ?? []).filter((t) => t.status !== 'done').length, tools: tools.data?.length ?? 0 },
  };
}

export function useIdentityFindingCount() {
  return useFindings().findings.length;
}

export function IdentityAudit() {
  const { findings, loading, error, totals } = useFindings();
  const setIdentity = useSetIdentity();
  const toast = useToast();
  const [move, setMove] = useState<Finding['moveFrom'] | null>(null);

  const apply = (f: Finding, identity: Identity) =>
    setIdentity.mutate({ table: f.table, id: f.id, identity }, {
      onSuccess: () => toast(`${f.name} set to ${identityLabel(identity)}`),
      onError: (e) => toast(errorMessage(e), 'error'),
    });

  const checked = totals.companies + totals.projects + totals.tasks + totals.tools;

  return (
    <Panel
      title="Identity review"
      icon={<Fingerprint />}
      subtitle={`${checked} records checked · ${findings.length} need a look`}
      subtitleInline
      loading={loading}
      error={error}
      empty={findings.length === 0}
      bodyClassName="p-0"
      emptyState={<div className="p-3"><EmptyState icon={<CheckCircle2 />} title="Everything is filed under the right identity" text="Companies, projects, open tasks and tools all have an identity that matches where they belong." /></div>}
    >
      <ul>
        {findings.map((f) => (
          <li key={f.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2 last:border-0 transition-colors hover:bg-raised/60">
            <span className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-subtle">{f.kind}</span>
            <div className="min-w-0 flex-1">
              <Link to={f.link} className="font-medium hover:text-primary-600 hover:underline">{f.name}</Link>
              <p className="text-xs text-muted">{f.reason}</p>
            </div>
            <IdentityBadge identity={f.current} compact />
            <div className="flex flex-wrap items-center gap-2">
              {f.suggested && (
                <Button size="sm" variant="primary" onClick={() => apply(f, f.suggested as Identity)} disabled={setIdentity.isPending}>
                  Set to {identityLabel(f.suggested)}
                </Button>
              )}
              {f.moveFrom && (
                <Button size="sm" onClick={() => setMove(f.moveFrom)}><ArrowRightLeft /> Plan a move</Button>
              )}
              <Select
                className="h-8 w-auto text-xs"
                value=""
                onChange={(e) => e.target.value && apply(f, e.target.value as Identity)}
                aria-label={`Choose identity for ${f.name}`}
                disabled={setIdentity.isPending}
              >
                <option value="">Choose...</option>
                {IDENTITIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
              </Select>
            </div>
          </li>
        ))}
      </ul>
      <MoveDialog
        open={move !== null}
        onOpenChange={(o) => !o && setMove(null)}
        record={null}
        defaults={move ? {
          title: `Move ${move.tool.name} login`,
          tool_id: move.tool.id,
          from_address: move.from,
          to_identity: move.tool.identity,
          to_address: IDENTITIES.find((i) => i.value === move.tool.identity)?.address ?? '',
          status: 'planned',
        } : undefined}
      />
    </Panel>
  );
}
