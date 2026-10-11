export type Identity = 'encountive' | 'doug_it' | 'krewe_kin' | 'personal';
export type TaskStatus = 'backlog' | 'ready' | 'in_progress' | 'waiting' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'annually';
export type TimeCategory = 'infrastructure' | 'security' | 'development' | 'vendor_admin' | 'meetings' | 'krewe_kin';
export type ProjectStatus = 'planned' | 'active' | 'on_hold' | 'done';

export const IDENTITIES: { value: Identity; label: string; address: string; belongs: string; tone: string }[] = [
  {
    value: 'encountive',
    label: 'Encountive',
    address: 'doug@encountive.com',
    belongs: 'Customers, partners, investors, Encountive vendors, domain/DNS/hosting, the product, Workspace admin, anything your partner should inherit.',
    tone: 'border-primary-500/40 bg-primary-500/10 text-primary-700 dark:text-primary-300',
  },
  {
    value: 'doug_it',
    label: 'Doug IT',
    address: 'doug@theonefor.ai',
    belongs: 'Your IT working inbox: agent notifications, monitoring alerts, personally-held accounts, trials, newsletters, consulting, and this console\'s mail.',
    tone: 'border-accent-500/40 bg-accent-500/10 text-accent-700 dark:text-accent-300',
  },
  {
    value: 'krewe_kin',
    label: 'Krewe & Kin',
    address: 'doug@theonefor.ai',
    belongs: 'Krewe & Kin web studio client work.',
    tone: 'border-warning-500/40 bg-warning-500/10 text-warning-800 dark:text-warning-300',
  },
  {
    value: 'personal',
    label: 'Personal',
    address: 'dougtully@proton.me',
    belongs: 'Personal life only. Shown for triage, never used for business sending.',
    tone: 'border-neutral-500/40 bg-neutral-500/10 text-neutral-700 dark:text-neutral-300',
  },
];

export const identityLabel = (v: Identity | null | undefined) => IDENTITIES.find((i) => i.value === v)?.label ?? 'Unset';

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Done' },
];

export const PRIORITIES: { value: Priority; label: string; rank: number; tone: string }[] = [
  { value: 'urgent', label: 'Urgent', rank: 4, tone: 'text-error-600 dark:text-error-400' },
  { value: 'high', label: 'High', rank: 3, tone: 'text-warning-700 dark:text-warning-400' },
  { value: 'medium', label: 'Medium', rank: 2, tone: 'text-primary-700 dark:text-primary-300' },
  { value: 'low', label: 'Low', rank: 1, tone: 'text-muted' },
];

export const priorityRank = (p: Priority | null) => PRIORITIES.find((x) => x.value === p)?.rank ?? 0;

export const RECURRENCES: { value: Recurrence; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annually', label: 'Annually' },
];

export const TIME_CATEGORIES: { value: TimeCategory; label: string; bar: string }[] = [
  { value: 'infrastructure', label: 'Infrastructure', bar: 'bg-primary-500' },
  { value: 'security', label: 'Security', bar: 'bg-error-500' },
  { value: 'development', label: 'Development', bar: 'bg-accent-500' },
  { value: 'vendor_admin', label: 'Vendor/Admin', bar: 'bg-warning-500' },
  { value: 'meetings', label: 'Meetings', bar: 'bg-secondary-400' },
  { value: 'krewe_kin', label: 'Krewe & Kin', bar: 'bg-success-500' },
];

export const categoryLabel = (v: string | null | undefined) => TIME_CATEGORIES.find((c) => c.value === v)?.label ?? v ?? '';

export const PROJECT_STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'done', label: 'Done' },
];

export interface Settings {
  user_id: string;
  notification_address: string;
  show_demo: boolean;
  demo_seeded: boolean;
  ops_seeded: boolean;
  last_time_description: string | null;
  last_time_category: TimeCategory | null;
  last_time_company_id: string | null;
  focus_minutes: number;
  break_minutes: number;
  updated_at: string;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  identity: Identity | null;
  color: string;
  is_demo: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  owner: string;
  next_milestone: string | null;
  milestone_date: string | null;
  company_id: string | null;
  identity: Identity | null;
  is_demo: boolean;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: Priority | null;
  due_date: string | null;
  snoozed_until: string | null;
  category: string | null;
  company_id: string | null;
  project_id: string | null;
  identity: Identity | null;
  recurrence: Recurrence;
  completed_at: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface TimeEntry {
  id: string;
  started_at: string;
  minutes: number;
  category: TimeCategory;
  company_id: string | null;
  project_id: string | null;
  task_id: string | null;
  description: string | null;
  source: 'manual' | 'focus';
  is_demo: boolean;
}

export interface FocusSession {
  id: string;
  task_id: string | null;
  label: string | null;
  category: TimeCategory;
  company_id: string | null;
  planned_minutes: number;
  started_at: string;
  ended_at: string | null;
  status: 'running' | 'completed' | 'cancelled';
  time_entry_id: string | null;
}

export interface PriorityPick {
  id: string;
  day: string;
  task_id: string;
  rank: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  created_at: string;
}

export type MonitorKind = 'domain' | 'email_auth' | 'website' | 'database' | 'manual';
export type CheckStatus = 'healthy' | 'attention' | 'action' | 'unknown';

export const MONITOR_KINDS: { value: MonitorKind; label: string; hint: string }[] = [
  { value: 'domain', label: 'Domain', hint: 'Registration expiry, transfer lock and name servers from the public registry.' },
  { value: 'email_auth', label: 'Email authentication', hint: 'Mail servers plus SPF, DKIM and DMARC records from public DNS.' },
  { value: 'website', label: 'Website', hint: 'Whether the site answers, how fast, and when its security certificate expires.' },
  { value: 'database', label: 'Console database', hint: 'Confirms the database behind this console answers.' },
  { value: 'manual', label: 'Manual system', hint: 'Something you confirm by hand on a schedule, like a backup restore test.' },
];

export const monitorKindLabel = (k: MonitorKind) => MONITOR_KINDS.find((m) => m.value === k)?.label ?? k;

export interface Monitor {
  id: string;
  kind: MonitorKind;
  label: string;
  target: string | null;
  identity: Identity | null;
  company_id: string | null;
  warn_days: number;
  critical_days: number;
  slow_ms: number;
  dkim_selectors: string[];
  check_every_days: number;
  enabled: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubCheck {
  name: string;
  status: CheckStatus;
  message: string;
}

export interface CheckResult {
  id: string;
  monitor_id: string;
  checked_at: string;
  status: CheckStatus;
  summary: string;
  details: { checks?: SubCheck[]; meta?: Record<string, string> } | null;
  duration_ms: number | null;
  source: 'auto' | 'manual';
}

export type MailProvider = 'microsoft' | 'google';

export const MAIL_PROVIDERS: Record<MailProvider, { label: string; app: string; short: string; mark: string }> = {
  microsoft: { label: 'Microsoft 365 / Outlook', app: 'Outlook', short: 'O', mark: 'bg-primary-600 text-white' },
  google: { label: 'Google Workspace / Gmail', app: 'Gmail', short: 'G', mark: 'bg-error-600 text-white' },
};

export interface MailAccount {
  id: string;
  provider: MailProvider;
  email: string;
  identity: Identity | null;
  label: string | null;
  status: 'connected' | 'error';
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface MailMessage {
  id: string;
  account_id: string;
  thread_id: string | null;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string;
  is_unread: boolean;
  is_important: boolean;
  web_link: string | null;
}

export interface CalendarEvent {
  id: string;
  account_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  organizer: string | null;
  web_link: string | null;
  is_cancelled: boolean;
}
