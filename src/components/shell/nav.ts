import {
  Activity, BookOpen, Bot, CalendarDays, CheckSquare, Clock, FileBarChart, FolderKanban, HardDrive,
  Inbox, LayoutDashboard, LifeBuoy, Library, Receipt, Settings, ShieldCheck, Wrench, type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  phase: number;
  built?: boolean;
  summary?: string;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Daily',
    items: [
      { to: '/', label: 'Today', icon: LayoutDashboard, phase: 1 },
      { to: '/tasks', label: 'Tasks', icon: CheckSquare, phase: 1 },
      { to: '/projects', label: 'Projects', icon: FolderKanban, phase: 1 },
      { to: '/time', label: 'Time & Focus', icon: Clock, phase: 1 },
      { to: '/inbox', label: 'Unified Inbox', icon: Inbox, phase: 3, summary: 'Triage-only merged view of Outlook and Gmail with source and identity badges and convert-to-task.' },
      { to: '/calendar', label: 'Calendar', icon: CalendarDays, phase: 3, summary: 'Merged read-only day and week view of Outlook and Google calendars plus your focus blocks.' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/ops', label: 'IT Operations', icon: Activity, phase: 2, summary: 'Status lights for domains, email authentication, uptime and certificates, Supabase, Resend, agents and manual systems, with history.' },
      { to: '/assets', built: true, label: 'Assets & Access', icon: HardDrive, phase: 4, summary: 'SaaS and hardware registers, access reviews, offboarding and onboarding checklists.' },
      { to: '/spend', built: true, label: 'Renewals & Spend', icon: Receipt, phase: 4, summary: 'Monthly and annual spend by company, renewal timeline with 30/14/7-day alerts, unused-tool flags.' },
      { to: '/security', built: true, label: 'Security', icon: ShieldCheck, phase: 4, summary: 'Security checklist, incident log, change log with rollback steps, customer-readiness and agent governance.' },
      { to: '/requests', built: true, label: 'Partner Requests', icon: LifeBuoy, phase: 4, summary: 'Helpdesk-lite for Melissa plus a plain-English printable status page.' },
    ],
  },
  {
    label: 'Agents',
    items: [
      { to: '/agents', label: 'Agent Operations', icon: Bot, phase: 3, summary: 'Each Claude agent with its status and when it last ran.' },
      { to: '/library', label: 'Report Library', icon: Library, phase: 4, summary: 'Every agent output as its own screen with search, source location, and compare-with-previous-run.' },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { to: '/notes', label: 'Runbooks & Notes', icon: BookOpen, phase: 4, summary: 'Markdown notes and runbook templates with make-task-from-selection and ZIP export. (Not assigned to a phase in your brief; proposed for Phase 4 alongside agent runbooks.)' },
      { to: '/weekly', label: 'Weekly CIO Report', icon: FileBarChart, phase: 5, summary: 'One-click Monday report with copy-as-Markdown and .docx export.' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/setup', label: 'Setup', icon: Wrench, phase: 1 },
      { to: '/settings', label: 'Settings', icon: Settings, phase: 1 },
    ],
  },
];

export const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items);

export const BUILT_THROUGH_PHASE = 3;
export const isBuilt = (n: NavItem) => n.built ?? n.phase <= BUILT_THROUGH_PHASE;
