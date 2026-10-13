import { useState, type ReactNode } from 'react';
import { ChevronDown, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMailAccounts, useMailStatus } from '@/data/mail';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { StatusPill, type HealthStatus } from '@/components/ui/badge';
import { OAuthRow, OutlookLinkRow } from './ConnectorsSection';

export const SECRETS_STEPS = [
  'In Bolt (the editor window you are chatting with me in), click the database icon at the top center of the screen.',
  'Click Secrets.',
  'Type GOOGLE_CLIENT_ID in Name, paste the Client ID in Value, click Create secret.',
  'Type GOOGLE_CLIENT_SECRET in Name, paste the Client secret in Value, click Create secret.',
  'Leave any other suggested rows with empty values alone.',
];

export const MICROSOFT_STEPS = [
  'Open entra.microsoft.com in a new tab and sign in as doug@theonefor.ai. This is Microsoft\'s free admin site for your Microsoft 365 account; no Azure subscription is needed.',
  'Left menu: Applications (or Identity > Applications) > App registrations > New registration.',
  'Name: CIO Command Console. Supported account types: "Accounts in this organizational directory only". Redirect URI: choose Web, paste the address below. Click Register.',
  'On the Overview page, copy "Application (client) ID" and "Directory (tenant) ID" into a notepad.',
  'Left menu: Certificates & secrets > Client secrets > New client secret. Description Console, expiry 24 months, click Add. Copy the Value column right away (not the Secret ID); it is shown only once.',
  'Left menu: API permissions > Add a permission > Microsoft Graph > Delegated permissions. Tick Mail.Read, Calendars.Read, User.Read, offline_access, openid and email, then click Add permissions.',
  'Click "Grant admin consent for" your organization and confirm, if that button is shown.',
  'If Entra says you do not have access, GoDaddy is holding the admin rights for your Microsoft 365 plan. Call GoDaddy support and ask them to "let me register an app in Microsoft Entra for theonefor.ai and grant it admin consent".',
];

export const MICROSOFT_SECRETS_STEPS = [
  'In Bolt, click the database icon at the top center of the screen, then Secrets.',
  'Type MICROSOFT_CLIENT_ID in Name, paste the Application (client) ID in Value, click Create secret.',
  'Type MICROSOFT_TENANT_ID in Name, paste the Directory (tenant) ID in Value, click Create secret.',
  'Type MICROSOFT_CLIENT_SECRET in Name, paste the secret Value in Value, click Create secret.',
];

export const OUTLOOK_CALENDAR_STEPS = [
  'In your Outlook tab (outlook.cloud.microsoft), click the gear icon at the top right.',
  'Click Calendar, then Shared calendars.',
  'Under "Publish a calendar": first box Calendar, second box "Can view all details", then click Publish.',
  'Two links appear. Click the ICS link (the one ending in .ics) and choose Copy link.',
  'Paste it into the box below and click Add calendar.',
  'If "Publish a calendar" is missing, GoDaddy has it switched off. Call GoDaddy support and ask them to "allow calendar publishing for doug@theonefor.ai on my Microsoft 365 plan".',
];

export const GOOGLE_STEPS = [
  'Open console.cloud.google.com in a new tab, signed in as doug@encountive.com.',
  'Top bar: click the project picker, then New project. Name it CIO Command Console, Organization encountive.com, click Create, and make sure it is selected.',
  'Menu > APIs & Services > Library. Search "Gmail API", open it, click Enable. Go back, search "Google Calendar API", click Enable.',
  'Menu > APIs & Services > OAuth consent screen (may be called Google Auth Platform). Click Get started. App name CIO Command Console, support email doug@encountive.com, Audience Internal, contact email doug@encountive.com. Finish and Create.',
  'Go to Clients (or Credentials > Create credentials > OAuth client ID). Type Web application, name CIO Command Console.',
  'Under Authorized redirect URIs click Add URI, paste the address below, click Create.',
  'A popup shows a Client ID and a Client secret. Copy both into a notepad.',
];

export function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-raised p-2">
      <code className="min-w-0 flex-1 break-all text-xs">{value}</code>
      <Button size="sm" onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch { setCopied(false); }
      }} aria-label="Copy value">
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function Steps({ items }: { items: string[] }) {
  return <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">{items.map((s) => <li key={s}>{s}</li>)}</ol>;
}

function Sub({ children }: { children: ReactNode }) {
  return <p className="label mt-5">{children}</p>;
}

type Status = { status: HealthStatus; label: string };
const YOURS: Status = { status: 'unknown', label: 'Your action' };
const DONE: Status = { status: 'healthy', label: 'Done' };

function Step({ n, title, where, status, children, defaultOpen }: {
  n: number; title: string; where: string; status: Status; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <li className="rounded-md border border-line">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
          status.status === 'healthy' ? 'bg-success-500/15 text-success-700 dark:text-success-300' : 'bg-raised text-fg')}>{n}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-subtle">{where}</span>
        </span>
        <StatusPill status={status.status} label={status.label} />
        <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="animate-fade-in border-t border-line px-4 py-4">{children}</div>}
    </li>
  );
}

const SET_ASIDE = [
  ['Publishing', 'Optional. The console is this app, the screen you see in Bolt\'s preview. Publishing only gives it its own web address so you can open it in a normal browser tab.'],
  ['Windows Hello', 'Set aside as you asked. Password sign-in keeps working.'],
  ['Email signing and spoofing records (DKIM, DMARC)', 'Nothing changes on your domains. The IT Operations page only reports what it sees; you can ignore those notes.'],
  ['Email alerts (Resend)', 'Not needed while the console is monitoring only.'],
] as const;

export function SetupSteps() {
  const mail = useMailStatus();
  const accounts = useMailAccounts();
  const redirectUri = mail.data?.redirectUri ?? '';
  const gReady = mail.data?.providers.google?.configured ?? false;
  const mReady = mail.data?.providers.microsoft?.configured ?? false;
  const list = accounts.data ?? [];
  const connected = (p: string) => list.some((a) => a.provider === p && a.status === 'connected');
  const googleStatus: Status = connected('google') ? DONE : gReady ? { status: 'attention', label: 'Keys in place, click Connect' } : YOURS;
  const msStatus: Status = connected('microsoft') ? DONE : mReady ? { status: 'attention', label: 'Keys in place, click Connect' } : YOURS;

  return (
    <div className="space-y-4">
      <Panel title="Your steps" icon={<ListChecks />}
        subtitle="All read-only. Your email keeps working exactly as it does today; the console just shows a copy."
        loading={mail.isLoading} error={mail.error}
        onRefresh={() => { mail.refetch(); accounts.refetch(); }}
        refreshing={mail.isFetching || accounts.isFetching}>
        <ol className="space-y-2">
          <Step n={1} title="Sign in to Microsoft 365 for mail and calendar (doug@theonefor.ai)" where="Microsoft Entra, then Bolt, then the Connect button in this step" status={msStatus} defaultOpen={!connected('microsoft')}>
            <p className="mb-3 text-sm text-muted">
              Microsoft only lets an outside program read Outlook mail after you sign in and approve it, using Microsoft's own sign-in. You register the console once with Microsoft, the same way as Google in step 3. Mail is read-only: nothing is sent, moved or deleted.
            </p>
            <Sub>Part A: register the console with Microsoft</Sub>
            <Steps items={MICROSOFT_STEPS} />
            <Sub>Address to paste in Part A, item 3</Sub>
            <CopyRow value={redirectUri} />
            <Sub>Part B: give the three values to the console</Sub>
            <Steps items={MICROSOFT_SECRETS_STEPS} />
            <Sub>Part C: connect</Sub>
            <p className="mb-2 text-sm text-muted">Click Refresh at the top of this box. The button below turns into Connect. Click it, sign in as doug@theonefor.ai and approve. Once connected, you can remove the calendar link from step 2 so events do not show twice.</p>
            {mail.data && <OAuthRow provider="microsoft" configured={mReady} redirectUri={redirectUri} showGuide={false} />}
          </Step>

          <Step n={2} title="Or: show only your Outlook calendar with a link (doug@theonefor.ai)" where="Your Outlook tab, then the box in this step" status={connected('outlook_ics') || connected('microsoft') ? DONE : YOURS}>
            <p className="mb-3 text-sm text-muted">Outlook gives you a private read-only link to your calendar. Paste it here and the console reads it on every refresh. Nothing in Outlook changes.</p>
            <Steps items={OUTLOOK_CALENDAR_STEPS} />
            <div className="mt-4"><OutlookLinkRow showGuide={false} /></div>
            <p className="mt-3 text-xs text-subtle">Do not share this link. To stop it later, go back to Shared calendars in Outlook and click Unpublish.</p>
          </Step>

          <Step n={3} title="Show your Gmail and Google Calendar here (doug@encountive.com)" where="Google Cloud, then Bolt, then the Connect button in this step" status={googleStatus} defaultOpen={connected('microsoft') && !connected('google')}>
            <p className="mb-3 text-sm text-muted">
              Google does not let any outside program read Gmail until its owner registers that program with Google. Apps like Superhuman did this for themselves; this console is your own, so you register it once.
              It is a permission slip, not a new app or mailbox. Mail is read-only: nothing is sent, moved, forwarded or deleted.
            </p>
            <Sub>Part A: register the console with Google</Sub>
            <Steps items={GOOGLE_STEPS} />
            <Sub>Address to paste in Part A, item 6</Sub>
            <CopyRow value={redirectUri} />
            <Sub>Part B: give the two values to the console</Sub>
            <Steps items={SECRETS_STEPS} />
            <Sub>Part C: connect</Sub>
            <p className="mb-2 text-sm text-muted">Click Refresh at the top of this box. The button below turns into Connect. Click it, sign in as doug@encountive.com and approve. You come back here and your mail and calendar fill in.</p>
            {mail.data && <OAuthRow provider="google" configured={gReady} redirectUri={redirectUri} showGuide={false} />}
          </Step>
        </ol>
      </Panel>

      <Panel title="Set aside for now" subtitle="Not needed for monitoring. Nothing to do here.">
        <ul className="space-y-3">
          {SET_ASIDE.map(([title, text]) => (
            <li key={title} className="text-sm">
              <p className="font-medium">{title}</p>
              <p className="text-muted">{text}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
