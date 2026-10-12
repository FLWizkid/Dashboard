import { useState, type ReactNode } from 'react';
import { ChevronDown, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMailAccounts, useMailStatus } from '@/data/mail';
import { useAuthSettings } from '@/auth/passkey';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { StatusPill, type HealthStatus } from '@/components/ui/badge';

export const SECRETS_STEPS = [
  'In Bolt, click the database icon at the top center of the screen.',
  'Click Secrets.',
  'For each key listed below: type the exact name in Name, paste the value in Value, then click Create secret.',
  'Come back to this page and refresh. The status changes to "Keys in place" and a Connect button appears on the Connectors tab.',
];

export const MICROSOFT_STEPS = [
  'Why Microsoft: your doug@theonefor.ai email from GoDaddy is Microsoft 365 underneath. GoDaddy resells it, and your Outlook and calendar live on Microsoft. So this one-time app is created in Microsoft\'s portal using that same GoDaddy email login. There is no separate Microsoft account.',
  'Go to portal.azure.com and type doug@theonefor.ai. Microsoft sends you to a GoDaddy sign-in page. Use the same password you use for your GoDaddy email.',
  'In the search bar at the top, type "App registrations" and open it. Click New registration.',
  'Name: CIO Command Console. Supported account types: "Accounts in this organizational directory only (single tenant)".',
  'Redirect URI: choose Web, paste the redirect address shown below, then click Register.',
  'On the Overview page, copy "Application (client) ID" into a notepad. You can ignore the other IDs.',
  'Left menu: Certificates & secrets > Client secrets > New client secret. Description: Console, Expires: 24 months, Add. Copy the Value column immediately (it is hidden after you leave the page). Do not copy the Secret ID.',
  'Left menu: API permissions > Add a permission > Microsoft Graph > Delegated permissions. Tick User.Read, Mail.Read, Calendars.Read, offline_access, openid and email. Click Add permissions. If a "Grant admin consent" button is available, click it; if it is greyed out, skip it, because you approve the access yourself when you click Connect later.',
  'If Azure says you are not allowed to register apps, stop and tell me the exact message. GoDaddy sometimes locks this, and there is a workaround.',
];

export const GOOGLE_STEPS = [
  'Go to console.cloud.google.com signed in as doug@encountive.com.',
  'Top bar: click the project picker > New project. Name: CIO Command Console. Organization: encountive.com. Create, then make sure it is selected.',
  'Menu > APIs & Services > Library. Search "Gmail API", open it, click Enable. Go back, search "Google Calendar API", click Enable.',
  'Menu > APIs & Services > OAuth consent screen (may be called Google Auth Platform > Branding). Click Get started. App name: CIO Command Console, support email: doug@encountive.com. Audience: Internal. Contact email: doug@encountive.com. Finish and Create.',
  'Go to Clients (or Credentials > Create credentials > OAuth client ID). Application type: Web application. Name: CIO Command Console.',
  'Under Authorized redirect URIs click Add URI and paste the redirect address shown below. Click Create.',
  'Copy the Client ID and the Client secret shown in the popup into a notepad.',
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

function Keys({ items }: { items: [string, string][] }) {
  return (
    <ul className="space-y-2">
      {items.map(([name, what]) => (
        <li key={name} className="text-sm">
          <CopyRow value={name} />
          <p className="mt-1 text-xs text-subtle">Value: {what}</p>
        </li>
      ))}
    </ul>
  );
}

function Steps({ items }: { items: string[] }) {
  return <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">{items.map((s) => <li key={s}>{s}</li>)}</ol>;
}

function Sub({ children }: { children: ReactNode }) {
  return <p className="label mt-4">{children}</p>;
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

const DMARC_VALUE = 'v=DMARC1; p=none; rua=mailto:doug@theonefor.ai';

export function SetupSteps() {
  const mail = useMailStatus();
  const accounts = useMailAccounts();
  const auth = useAuthSettings();
  const redirectUri = mail.data?.redirectUri ?? '';
  const msReady = mail.data?.providers.microsoft?.configured ?? false;
  const gReady = mail.data?.providers.google?.configured ?? false;
  const list = accounts.data ?? [];
  const connected = (p: string) => list.some((a) => a.provider === p && a.status === 'connected');
  const keyStatus = (ready: boolean, p: string): Status =>
    connected(p) ? DONE : ready ? { status: 'attention', label: 'Keys in place, connect next' } : YOURS;

  return (
    <Panel title="Your steps" icon={<ListChecks />}
      subtitle="Everything only you can do, in order. Click a step to open it. Steps with a live status update on their own."
      loading={mail.isLoading} error={mail.error}
      onRefresh={() => { mail.refetch(); accounts.refetch(); auth.refetch(); }}
      refreshing={mail.isFetching || accounts.isFetching || auth.isFetching}>
      <ol className="space-y-2">
        <Step n={1} title="Create the Outlook and calendar app (doug@theonefor.ai, GoDaddy email)" where="Microsoft portal using your GoDaddy email login, then Bolt" status={keyStatus(msReady, 'microsoft')} defaultOpen={!msReady}>
          <Steps items={MICROSOFT_STEPS} />
          <Sub>Redirect address to paste in step 5</Sub>
          <CopyRow value={redirectUri} />
          <Sub>Then add these two keys in Bolt</Sub>
          <Steps items={SECRETS_STEPS} />
          <div className="mt-3"><Keys items={[
            ['MICROSOFT_CLIENT_ID', 'Application (client) ID'],
            ['MICROSOFT_CLIENT_SECRET', 'the secret Value (not the Secret ID)'],
          ]} /></div>
        </Step>

        <Step n={2} title="Create the Gmail and Google Calendar app (encountive.com)" where="Google Cloud console, then Bolt" status={keyStatus(gReady, 'google')}>
          <Steps items={GOOGLE_STEPS} />
          <Sub>Redirect address to paste in step 6</Sub>
          <CopyRow value={redirectUri} />
          <Sub>Then add these two keys in Bolt</Sub>
          <Steps items={SECRETS_STEPS} />
          <div className="mt-3"><Keys items={[['GOOGLE_CLIENT_ID', 'Client ID'], ['GOOGLE_CLIENT_SECRET', 'Client secret']]} /></div>
        </Step>

        <Step n={3} title="Connect your mailboxes and calendars" where="This console" status={list.length && list.every((a) => a.identity) ? DONE : YOURS}>
          <Steps items={[
            'Open the Connectors tab on this page.',
            'Next to Outlook click Connect, and sign in as doug@theonefor.ai. Approve the read-only access.',
            'You land back here. Under Connected accounts, set Identity to Doug IT.',
            'Click Connect next to Google, sign in as doug@encountive.com, approve, and set Identity to Encountive.',
            'Click Sync now on each. Your inbox, calendar and Today page fill in within a minute.',
          ]} />
        </Step>

        <Step n={4} title="Publish the console to a permanent address" where="Bolt" status={YOURS}>
          <Steps items={[
            'In Bolt, click Publish at the top right of the screen, then click Publish.',
            'When it finishes, click the pencil next to the address and pick a name you will keep, for example cio-console. Leave "Republish after updating" ticked and click Save.',
            'Send me the full address (it ends in .bolt.host). Windows Hello is tied to this exact address, so choose it before step 5.',
          ]} />
        </Step>

        <Step n={5} title="Switch on Windows Hello sign-in" where="Supabase (needs your database moved to your own Supabase account)" status={auth.data?.passkeys_enabled ? DONE : YOURS}>
          <p className="mb-3 text-sm text-muted">Bolt's own sign-in settings do not include a Windows Hello switch. To get it, the database has to be claimed into a Supabase account you own. Claiming keeps all data and needs a Bolt Pro or Teams plan.</p>
          <Steps items={[
            'In Bolt, click the database icon at the top center, then Advanced, then Claim database in Supabase. Sign in to or create a free Supabase account and finish the claim.',
            'At supabase.com/dashboard open the claimed project, then Authentication in the left menu.',
            'Open the Passkeys (or WebAuthn) settings and turn it on.',
            'Display name: CIO Command Console. Relying party ID: your address from step 4 without https:// (for example cio-console.bolt.host). Origins: the full address with https://. Save.',
            'Back in the console, sign in with your password, go to Settings > Account and click Add this PC. Windows asks for your PIN, fingerprint or face.',
            'Sign out. The sign-in page now shows "Sign in with Windows Hello". Your password still works.',
          ]} />
          <p className="mt-3 text-xs text-subtle">If you would rather not claim the database, password sign-in stays as it is and nothing else changes.</p>
        </Step>

        <Step n={6} title="Turn on email signing for theonefor.ai (DKIM)" where="Microsoft Defender, then GoDaddy DNS" status={YOURS}>
          <p className="mb-3 text-sm text-muted">I checked: theonefor.ai mail is not signed, so it is easier to fake mail from your address. The Operations page shows this as needing action until it is fixed.</p>
          <Steps items={[
            'Go to security.microsoft.com signed in as doug@theonefor.ai.',
            'Email & collaboration > Policies & rules > Threat policies > Email authentication settings > DKIM tab.',
            'Click theonefor.ai. If it offers Create DKIM keys, click it. It then shows two CNAME records (selector1 and selector2). Copy both.',
            'Go to dcc.godaddy.com > Domains > theonefor.ai > DNS > Add New Record. Type CNAME, Name selector1._domainkey, Value the first value Microsoft gave. Save. Repeat for selector2._domainkey.',
            'Wait about 30 minutes, return to the DKIM page in Defender, and switch "Sign messages for this domain with DKIM signatures" on.',
          ]} />
        </Step>

        <Step n={7} title="Turn on email signing for encountive.com (DKIM)" where="Google Admin, then SiteGround DNS" status={YOURS}>
          <p className="mb-3 text-sm text-muted">I checked: Google Workspace signing is not published for encountive.com (Resend signing is fine).</p>
          <Steps items={[
            'Go to admin.google.com as doug@encountive.com. Apps > Google Workspace > Gmail > Authenticate email.',
            'Pick encountive.com, click Generate new record, keep 2048 bits and prefix google, click Generate.',
            'Copy the TXT record value (starts with v=DKIM1).',
            'Go to my.siteground.com > Websites > Site Tools for encountive.com > Domain > DNS Zone Editor > TXT. Name: google._domainkey. Value: paste. Create.',
            'Wait an hour, go back to Authenticate email in Google Admin and click Start authentication.',
          ]} />
        </Step>

        <Step n={8} title="Add spoofing protection (DMARC) to theonefor.ai and kreweandkin.com" where="GoDaddy DNS and Cloudflare" status={YOURS}>
          <p className="mb-3 text-sm text-muted">encountive.com already has one. This record starts in watch-only mode, so no mail is blocked; reports go to doug@theonefor.ai.</p>
          <Sub>Value for both domains</Sub>
          <CopyRow value={DMARC_VALUE} />
          <Sub>theonefor.ai at GoDaddy</Sub>
          <Steps items={['dcc.godaddy.com > Domains > theonefor.ai > DNS > Add New Record.', 'Type TXT, Name _dmarc, Value: paste the value above. Save.']} />
          <Sub>kreweandkin.com at Cloudflare</Sub>
          <Steps items={['dash.cloudflare.com > kreweandkin.com > DNS > Records > Add record.', 'Type TXT, Name _dmarc, Content: paste the value above. Save.', 'If Missy owns the Cloudflare account, she can add you as a member under Manage account > Members, or do these two steps herself.']} />
        </Step>

        <Step n={9} title="Get the console's own email sender ready (Resend)" where="resend.com, then Bolt" status={YOURS}>
          <p className="mb-3 text-sm text-muted">This is for the next phase (alerts and Send test). encountive.com is already verified in a Resend account, so the quickest path is to reuse it.</p>
          <Steps items={[
            'Go to resend.com and sign in to the account that verified encountive.com. If you are not sure which, open Domains and look for encountive.com marked Verified.',
            'API Keys > Create API key. Name: CIO Console. Permission: Sending access. Domain: encountive.com. Create, then copy the key (shown once).',
            'Add it in Bolt the same way as the other keys (database icon > Secrets), with the name below.',
            'Tell me which address alerts should come from, for example console@encountive.com.',
          ]} />
          <div className="mt-3"><Keys items={[['RESEND_API_KEY', 'the key you just created']]} /></div>
        </Step>
      </ol>
    </Panel>
  );
}
