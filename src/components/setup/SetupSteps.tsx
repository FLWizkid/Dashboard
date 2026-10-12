import { useState, type ReactNode } from 'react';
import { ChevronDown, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMailAccounts, useMailMessages, useMailStatus } from '@/data/mail';
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

export const OUTLOOK_CALENDAR_STEPS = [
  'Go to outlook.office.com and sign in as doug@theonefor.ai with the same password you use for your GoDaddy email. This is ordinary Outlook on the web, not Azure.',
  'Click the gear icon at the top right, then Calendar, then Shared calendars.',
  'Under "Publish a calendar": pick Calendar in the first box, "Can view all details" in the second, then click Publish.',
  'Two links appear. Click the ICS link (the one ending in .ics) and choose Copy link.',
  'Back here, open the Connectors tab, paste it into the "Outlook calendar link" box and click Add calendar.',
  'If "Publish a calendar" is missing, GoDaddy has calendar publishing switched off. Call GoDaddy support and ask them to "allow calendar publishing for doug@theonefor.ai on my Microsoft 365 plan", then repeat these steps.',
];

export const FORWARDING_STEPS = [
  'Allow forwarding at GoDaddy: sign in at godaddy.com with your GoDaddy account login (not the email password). Open My Products, find Email and Office, and click Manage All to open the Email & Office Dashboard.',
  'In the dashboard, open the admin menu at the top and choose Email Forwarding. Under Forwarding Status, switch forwarding on for theonefor.ai and confirm.',
  'Set up the forward: go to outlook.office.com as doug@theonefor.ai. Click the gear icon, then Mail, then Forwarding.',
  'Switch on "Enable forwarding", type doug@encountive.com, tick "Keep a copy of forwarded messages", and click Save.',
  'Test it: from any other address, send a short email to doug@theonefor.ai. Within a few minutes it shows in Gmail and, after Sync now, in the console Inbox with the Doug IT badge.',
  'If the test never arrives, GoDaddy is still blocking outside forwarding. Call GoDaddy support and ask them to "turn on external email forwarding for theonefor.ai".',
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
  const gReady = mail.data?.providers.google?.configured ?? false;
  const messages = useMailMessages();
  const list = accounts.data ?? [];
  const forwarded = (messages.data ?? []).some((m) => m.identity === 'doug_it');
  const connected = (p: string) => list.some((a) => a.provider === p && a.status === 'connected');
  const keyStatus = (ready: boolean, p: string): Status =>
    connected(p) ? DONE : ready ? { status: 'attention', label: 'Keys in place, connect next' } : YOURS;

  return (
    <Panel title="Your steps" icon={<ListChecks />}
      subtitle="Everything only you can do, in order. Click a step to open it. Steps with a live status update on their own."
      loading={mail.isLoading} error={mail.error}
      onRefresh={() => { mail.refetch(); accounts.refetch(); messages.refetch(); auth.refetch(); }}
      refreshing={mail.isFetching || accounts.isFetching || auth.isFetching}>
      <ol className="space-y-2">
        <Step n={1} title="Show your Outlook calendar here (doug@theonefor.ai)" where="Outlook on the web, then this console. No Azure." status={connected('outlook_ics') ? DONE : YOURS} defaultOpen={!connected('outlook_ics')}>
          <p className="mb-3 text-sm text-muted">Your GoDaddy email runs on Microsoft 365. Instead of creating a Microsoft app, you publish a private read-only calendar link and paste it here. The console reads it every time it refreshes.</p>
          <Steps items={OUTLOOK_CALENDAR_STEPS} />
          <p className="mt-3 text-xs text-subtle">Anyone who has this link can see your calendar, so do not share it. To stop it, go back to Shared calendars in Outlook and click Unpublish.</p>
        </Step>

        <Step n={2} title="Create the Gmail and Google Calendar app (encountive.com)" where="Google Cloud console, then Bolt" status={keyStatus(gReady, 'google')}>
          <p className="mb-3 text-sm text-muted">Needed for your Encountive mail and calendar, and for theonefor.ai mail once it is forwarded in step 4.</p>
          <Steps items={GOOGLE_STEPS} />
          <Sub>Redirect address to paste in item 6</Sub>
          <CopyRow value={redirectUri} />
          <Sub>Then add these two keys in Bolt</Sub>
          <Steps items={SECRETS_STEPS} />
          <div className="mt-3"><Keys items={[['GOOGLE_CLIENT_ID', 'Client ID'], ['GOOGLE_CLIENT_SECRET', 'Client secret']]} /></div>
          <p className="mt-3 text-xs text-subtle">Bolt may also list other suggested names with empty values. Leave those blank; nothing else is needed.</p>
        </Step>

        <Step n={3} title="Connect Gmail (doug@encountive.com)" where="This console" status={connected('google') ? DONE : YOURS}>
          <Steps items={[
            'Open the Connectors tab on this page.',
            'Next to Google click Connect, sign in as doug@encountive.com and approve the read-only access.',
            'You land back here. Under Connected accounts, set Identity to Encountive.',
            'Click Sync now. Your inbox, calendar and Today page fill in within a minute.',
          ]} />
        </Step>

        <Step n={4} title="Forward doug@theonefor.ai mail into Gmail" where="GoDaddy, then Outlook on the web. No Azure." status={forwarded ? DONE : YOURS}>
          <p className="mb-3 text-sm text-muted">This gets your Doug IT mail into the console without any Microsoft app. Forwarded mail is tagged Doug IT automatically, and the original copy stays in Outlook.</p>
          <Steps items={FORWARDING_STEPS} />
        </Step>

        <Step n={5} title="Publish the console to a permanent address" where="Bolt" status={YOURS}>
          <Steps items={[
            'In Bolt, click Publish at the top right of the screen, then click Publish.',
            'When it finishes, click the pencil next to the address and pick a name you will keep, for example cio-console. Leave "Republish after updating" ticked and click Save.',
            'Send me the full address (it ends in .bolt.host). Windows Hello is tied to this exact address, so choose it before step 6.',
          ]} />
        </Step>

        <Step n={6} title="Switch on Windows Hello sign-in" where="Supabase (needs your database moved to your own Supabase account)" status={auth.data?.passkeys_enabled ? DONE : YOURS}>
          <p className="mb-3 text-sm text-muted">Bolt's own sign-in settings do not include a Windows Hello switch. To get it, the database has to be claimed into a Supabase account you own. Claiming keeps all data and needs a Bolt Pro or Teams plan.</p>
          <Steps items={[
            'In Bolt, click the database icon at the top center, then Advanced, then Claim database in Supabase. Sign in to or create a free Supabase account and finish the claim.',
            'At supabase.com/dashboard open the claimed project, then Authentication in the left menu.',
            'Open the Passkeys (or WebAuthn) settings and turn it on.',
            'Display name: CIO Command Console. Relying party ID: your address from step 5 without https:// (for example cio-console.bolt.host). Origins: the full address with https://. Save.',
            'Back in the console, sign in with your password, go to Settings > Account and click Add this PC. Windows asks for your PIN, fingerprint or face.',
            'Sign out. The sign-in page now shows "Sign in with Windows Hello". Your password still works.',
          ]} />
          <p className="mt-3 text-xs text-subtle">If you would rather not claim the database, password sign-in stays as it is and nothing else changes.</p>
        </Step>

        <Step n={7} title="Turn on email signing for theonefor.ai (DKIM)" where="Microsoft security page with your email login, then GoDaddy DNS. No Azure." status={YOURS}>
          <p className="mb-3 text-sm text-muted">I checked: theonefor.ai mail is not signed, so it is easier to fake mail from your address. The Operations page shows this as needing action until it is fixed.</p>
          <Steps items={[
            'Go to security.microsoft.com and sign in as doug@theonefor.ai with your GoDaddy email password. This is the Microsoft 365 security page, not Azure.',
            'Email & collaboration > Policies & rules > Threat policies > Email authentication settings > DKIM tab.',
            'Click theonefor.ai. If it offers Create DKIM keys, click it. It then shows two CNAME records (selector1 and selector2). Copy both.',
            'Go to dcc.godaddy.com > Domains > theonefor.ai > DNS > Add New Record. Type CNAME, Name selector1._domainkey, Value the first value Microsoft gave. Save. Repeat for selector2._domainkey.',
            'Wait about 30 minutes, return to the DKIM page, and switch "Sign messages for this domain with DKIM signatures" on.',
            'If the page says you do not have permission, skip the steps above. Call GoDaddy support and ask them to "turn on DKIM signing for theonefor.ai on my Microsoft 365 plan". They can do it from their side.',
          ]} />
        </Step>

        <Step n={8} title="Turn on email signing for encountive.com (DKIM)" where="Google Admin, then SiteGround DNS" status={YOURS}>
          <p className="mb-3 text-sm text-muted">I checked: Google Workspace signing is not published for encountive.com (Resend signing is fine).</p>
          <Steps items={[
            'Go to admin.google.com as doug@encountive.com. Apps > Google Workspace > Gmail > Authenticate email.',
            'Pick encountive.com, click Generate new record, keep 2048 bits and prefix google, click Generate.',
            'Copy the TXT record value (starts with v=DKIM1).',
            'Go to my.siteground.com > Websites > Site Tools for encountive.com > Domain > DNS Zone Editor > TXT. Name: google._domainkey. Value: paste. Create.',
            'Wait an hour, go back to Authenticate email in Google Admin and click Start authentication.',
          ]} />
        </Step>

        <Step n={9} title="Add spoofing protection (DMARC) to theonefor.ai and kreweandkin.com" where="GoDaddy DNS and Cloudflare" status={YOURS}>
          <p className="mb-3 text-sm text-muted">encountive.com already has one. This record starts in watch-only mode, so no mail is blocked; reports go to doug@theonefor.ai.</p>
          <Sub>Value for both domains</Sub>
          <CopyRow value={DMARC_VALUE} />
          <Sub>theonefor.ai at GoDaddy</Sub>
          <Steps items={['dcc.godaddy.com > Domains > theonefor.ai > DNS > Add New Record.', 'Type TXT, Name _dmarc, Value: paste the value above. Save.']} />
          <Sub>kreweandkin.com at Cloudflare</Sub>
          <Steps items={['dash.cloudflare.com > kreweandkin.com > DNS > Records > Add record.', 'Type TXT, Name _dmarc, Content: paste the value above. Save.', 'If Missy owns the Cloudflare account, she can add you as a member under Manage account > Members, or do these two steps herself.']} />
        </Step>

        <Step n={10} title="Get the console's own email sender ready (Resend)" where="resend.com, then Bolt" status={YOURS}>
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
