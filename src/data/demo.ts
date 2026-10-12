import { addDays, setHours, startOfDay, subDays } from 'date-fns';
import { supabase } from '@/lib/supabase';
import type { Company, Identity, Priority, Recurrence, TaskStatus, TimeCategory } from '@/lib/types';
import { toDateKey } from '@/lib/utils';
import { check, recordAudit, unwrap } from './core';

const COMPANIES: { name: string; slug: string; identity: Identity; color: string }[] = [
  { name: 'Encountive', slug: 'encountive', identity: 'encountive', color: 'sky' },
  { name: 'Doug IT', slug: 'doug-it', identity: 'doug_it', color: 'teal' },
  { name: 'Krewe & Kin', slug: 'krewe-kin', identity: 'doug_it', color: 'amber' },
];

const PROJECTS: { name: string; company: string; identity: Identity }[] = [
  { name: 'Encountive Platform', company: 'encountive', identity: 'encountive' },
  { name: 'Manual Blood Pressure Trainer (WebXR)', company: 'encountive', identity: 'encountive' },
  { name: 'Encountive Website', company: 'encountive', identity: 'encountive' },
  { name: 'Email & Domain Cleanup', company: 'encountive', identity: 'encountive' },
  { name: 'Krewe & Kin Client Work', company: 'krewe-kin', identity: 'doug_it' },
];

async function ensureCompaniesAndProjects(): Promise<Company[]> {
  let companies = unwrap(await supabase.from('cc_companies').select('*')) as Company[];
  if (companies.length === 0) {
    companies = unwrap(await supabase.from('cc_companies').insert(COMPANIES).select('*')) as Company[];
  }
  const projects = unwrap(await supabase.from('cc_projects').select('id'));
  if (projects.length === 0) {
    const bySlug = new Map(companies.map((c) => [c.slug, c.id]));
    check(
      await supabase.from('cc_projects').insert(
        PROJECTS.map((p) => ({ name: p.name, identity: p.identity, company_id: bySlug.get(p.company) ?? null, status: 'active', owner: 'Doug' })),
      ),
    );
  }
  return companies;
}

async function insertDemoRows(companies: Company[]) {
  const today = new Date();
  const d = (offset: number) => toDateKey(addDays(today, offset));
  const co = (slug: string) => companies.find((c) => c.slug === slug)?.id ?? null;
  const projects = unwrap(await supabase.from('cc_projects').select('id,name')) as { id: string; name: string }[];
  const proj = (name: string) => projects.find((p) => p.name === name)?.id ?? null;

  type DemoTask = { title: string; status: TaskStatus; priority: Priority | null; due: number | null; category: string; company: string | null; identity: Identity | null; project?: string; recurrence?: Recurrence };
  const tasks: DemoTask[] = [
    { title: 'Renew encountive.com domain', status: 'ready', priority: 'high', due: 3, category: 'IT', company: 'encountive', identity: 'encountive', project: 'Email & Domain Cleanup' },
    { title: 'Set DMARC policy from p=none to quarantine', status: 'in_progress', priority: 'high', due: -2, category: 'Security', company: 'encountive', identity: 'encountive', project: 'Email & Domain Cleanup' },
    { title: 'Weekly backup restore check', status: 'ready', priority: 'medium', due: 0, category: 'IT', company: 'encountive', identity: 'encountive', recurrence: 'weekly' },
    { title: 'Review Google Workspace admin access', status: 'backlog', priority: 'medium', due: 6, category: 'Security', company: 'encountive', identity: 'encountive' },
    { title: 'Patch Windows workstation and update drivers', status: 'ready', priority: 'low', due: 0, category: 'IT', company: 'doug-it', identity: 'doug_it', recurrence: 'monthly' },
    { title: 'Cancel unused design tool trial', status: 'waiting', priority: 'low', due: -1, category: 'Vendor', company: 'doug-it', identity: null },
    { title: 'Rotate Vercel API token', status: 'backlog', priority: 'urgent', due: 1, category: 'Security', company: null, identity: null },
    { title: 'Deploy WebXR trainer build to staging', status: 'in_progress', priority: 'high', due: 2, category: 'Dev', company: 'encountive', identity: 'encountive', project: 'Manual Blood Pressure Trainer (WebXR)' },
    { title: 'Send Krewe & Kin client hosting invoice', status: 'ready', priority: 'medium', due: 4, category: 'Admin', company: 'krewe-kin', identity: 'doug_it', project: 'Krewe & Kin Client Work' },
    { title: 'Document DNS records for encountive.com', status: 'done', priority: 'medium', due: -3, category: 'IT', company: 'encountive', identity: 'encountive', project: 'Email & Domain Cleanup' },
    { title: 'Quarterly access review', status: 'backlog', priority: null, due: null, category: 'Security', company: 'encountive', identity: null },
  ];
  check(
    await supabase.from('cc_tasks').insert(
      tasks.map((t) => ({
        title: t.title,
        status: t.status,
        priority: t.priority,
        due_date: t.due === null ? null : d(t.due),
        category: t.category,
        company_id: t.company ? co(t.company) : null,
        project_id: t.project ? proj(t.project) : null,
        identity: t.identity,
        recurrence: t.recurrence ?? 'none',
        completed_at: t.status === 'done' ? subDays(today, 2).toISOString() : null,
        is_demo: true,
      })),
    ),
  );

  const entries: { day: number; hour: number; minutes: number; category: TimeCategory; company: string; description: string }[] = [
    { day: 0, hour: 9, minutes: 90, category: 'infrastructure', company: 'encountive', description: 'DNS audit for encountive.com' },
    { day: 0, hour: 13, minutes: 45, category: 'meetings', company: 'encountive', description: 'Weekly sync with Melissa' },
    { day: 1, hour: 10, minutes: 120, category: 'development', company: 'encountive', description: 'WebXR trainer build pipeline' },
    { day: 1, hour: 15, minutes: 30, category: 'vendor_admin', company: 'doug-it', description: 'Registrar and billing cleanup' },
    { day: 2, hour: 9, minutes: 60, category: 'security', company: 'encountive', description: 'MFA review on admin accounts' },
    { day: 2, hour: 14, minutes: 75, category: 'krewe_kin', company: 'krewe-kin', description: 'Client site hosting migration' },
  ];
  const monday = startOfDay(addDays(today, -((today.getDay() + 6) % 7)));
  const usable = entries.filter((e) => addDays(monday, e.day) <= today);
  if (usable.length) {
    check(
      await supabase.from('cc_time_entries').insert(
        usable.map((e) => ({
          started_at: setHours(addDays(monday, e.day), e.hour).toISOString(),
          minutes: e.minutes,
          category: e.category,
          company_id: co(e.company),
          description: e.description,
          is_demo: true,
        })),
      ),
    );
  }
}

export async function seedIfFirstRun(userId: string) {
  const claim = await supabase.from('cc_settings').update({ demo_seeded: true }).eq('user_id', userId).eq('demo_seeded', false).select('user_id');
  check(claim);
  if (!claim.data?.length) return false;
  const companies = await ensureCompaniesAndProjects();
  await insertDemoRows(companies);
  await recordAudit('demo.seed', 'demo');
  return true;
}

export async function reseedDemo() {
  await removeDemo();
  const companies = await ensureCompaniesAndProjects();
  await insertDemoRows(companies);
  await recordAudit('demo.reseed', 'demo');
}

export async function removeDemo() {
  check(await supabase.from('cc_time_entries').delete().eq('is_demo', true));
  check(await supabase.from('cc_tasks').delete().eq('is_demo', true));
  await recordAudit('demo.remove', 'demo');
}
