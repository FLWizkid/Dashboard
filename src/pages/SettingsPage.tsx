import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BellRing, Fingerprint, Keyboard, LogOut, Plug, Send, Timer, UserRound } from 'lucide-react';
import { z } from 'zod';
import { IDENTITIES } from '@/lib/types';
import { SETUP } from '@/lib/integrations';
import { errorMessage } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useSettings, useUpdateSettings } from '@/data/settings';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge, StatusPill } from '@/components/ui/badge';
import { Field, NotConnected } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { SHORTCUTS } from '@/components/shell/shortcuts';
import { CompaniesSettings } from '@/components/settings/CompaniesSettings';
import { AuditLogPanel, DemoDataSettings, ExportSettings } from '@/components/settings/DataSettings';

const INTEGRATIONS: { key: keyof typeof SETUP; title: string }[] = [
  { key: 'calendar', title: 'Calendars' },
  { key: 'mail', title: 'Mailboxes' },
  { key: 'agents', title: 'Agent digest' },
  { key: 'resend', title: 'Email sending (Resend)' },
  { key: 'github', title: 'GitHub' },
  { key: 'vercel', title: 'Vercel' },
];

const email = z.string().trim().email();

function GeneralSettings() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const toast = useToast();
  const [address, setAddress] = useState('');
  const [focusMin, setFocusMin] = useState('25');
  const [breakMin, setBreakMin] = useState('5');

  useEffect(() => {
    if (!settings.data) return;
    setAddress(settings.data.notification_address);
    setFocusMin(String(settings.data.focus_minutes));
    setBreakMin(String(settings.data.break_minutes));
  }, [settings.data]);

  const addressValid = email.safeParse(address).success;
  const f = Number(focusMin);
  const b = Number(breakMin);
  const timesValid = Number.isInteger(f) && f >= 5 && f <= 180 && Number.isInteger(b) && b >= 1 && b <= 60;
  const dirty = !!settings.data && (address.trim() !== settings.data.notification_address || f !== settings.data.focus_minutes || b !== settings.data.break_minutes);

  async function save() {
    if (!addressValid) return toast('Enter a valid email address.', 'error');
    if (!timesValid) return toast('Focus must be 5-180 minutes and break 1-60.', 'error');
    try {
      await update.mutateAsync({ notification_address: address.trim(), focus_minutes: f, break_minutes: b });
      toast('Settings saved');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <Panel
      title="Notifications & focus"
      icon={<BellRing />}
      updatedAt={settings.dataUpdatedAt}
      onRefresh={() => settings.refetch()}
      refreshing={settings.isFetching}
      loading={settings.isLoading}
      error={settings.error}
    >
      <div className="space-y-4">
        <Field label="Console notification address" hint={addressValid ? 'Where the console sends alerts and the weekly report.' : 'Enter a valid email address.'}>
          <div className="flex gap-2">
            <input className="input flex-1" type="email" value={address} onChange={(e) => setAddress(e.target.value)} aria-invalid={!addressValid} />
            <Button variant="secondary" disabled title="Needs email sending, set up in Phase 5"><Send /> Send test</Button>
          </div>
        </Field>
        <NotConnected title="Email sending" info={SETUP.resend} compact />
        <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
          <Field label="Focus length (min)"><input className="input font-mono" inputMode="numeric" value={focusMin} onChange={(e) => setFocusMin(e.target.value)} /></Field>
          <Field label="Break length (min)"><input className="input font-mono" inputMode="numeric" value={breakMin} onChange={(e) => setBreakMin(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" onClick={save} disabled={!dirty || update.isPending}><Timer /> Save changes</Button>
        </div>
      </div>
    </Panel>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const toast = useToast();

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <GeneralSettings />
          <DemoDataSettings />
          <CompaniesSettings />
          <Panel title="Identities" icon={<Fingerprint />} subtitle="Every task, project and company belongs to one">
            <ul className="space-y-3">
              {IDENTITIES.map((i) => (
                <li key={i.value} className="flex items-start gap-3">
                  <Badge className={i.tone}>{i.label}</Badge>
                  <div className="min-w-0 text-sm">
                    <p className="font-mono text-xs text-muted">{i.address}</p>
                    <p className="text-muted">{i.belongs}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Connections" icon={<Plug />} subtitle="Each grey item arrives in a later phase.">
            <ul className="space-y-2">
              <li className="flex items-center gap-3 rounded-md border border-line p-2">
                <Activity className="size-4 shrink-0 text-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">IT health checks</p>
                  <p className="text-xs text-subtle">Public registry and DNS lookups. No account needed.</p>
                </div>
                <StatusPill status="healthy" label="Connected" />
                <Button asChild size="sm"><Link to="/ops">Manage</Link></Button>
              </li>
              {INTEGRATIONS.map((i) => (
                <li key={i.key}>
                  <NotConnected title={i.title} info={SETUP[i.key]} compact />
                </li>
              ))}
            </ul>
          </Panel>
          <ExportSettings />
          <AuditLogPanel />
          <Panel title="Keyboard shortcuts" icon={<Keyboard />}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="contents">
                  <dt><kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd></dt>
                  <dd className="text-muted">{s.action}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Account" icon={<UserRound />}>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="flex-1 truncate text-sm">{user?.email}</span>
                <Button variant="secondary" onClick={async () => { const { error } = await supabase.auth.signOut(); if (error) toast(errorMessage(error), 'error'); }}><LogOut /> Sign out</Button>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted">
                <StatusPill status="unknown" label="Two-factor: not set up" />
                <span>Planned before any connections go live.</span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
