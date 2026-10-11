import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { MailProvider } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

const GUIDES: Record<MailProvider, { title: string; signIn: string; secrets: [string, string]; steps: string[] }> = {
  microsoft: {
    title: 'Set up Outlook (Microsoft 365)',
    signIn: 'doug@theonefor.ai',
    secrets: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
    steps: [
      'Go to portal.azure.com and sign in as a theonefor.ai admin. Open Microsoft Entra ID, then App registrations, then New registration.',
      'Name it "CIO Command Console". For supported account types choose "Accounts in any organizational directory and personal Microsoft accounts".',
      'Under Redirect URI choose the "Web" platform and paste the address below. Click Register.',
      'On the overview page, copy the "Application (client) ID".',
      'Open Certificates & secrets, click New client secret, pick 24 months, and copy the secret Value (not the ID). Put a reminder on your calendar to renew it.',
      'Open API permissions, click Add a permission, Microsoft Graph, Delegated, and add Mail.Read, Calendars.Read, User.Read, offline_access, openid and email. Click "Grant admin consent" if shown.',
    ],
  },
  google: {
    title: 'Set up Google Workspace (Gmail and Calendar)',
    signIn: 'doug@encountive.com',
    secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    steps: [
      'Go to console.cloud.google.com signed in as doug@encountive.com and create a project named "CIO Command Console".',
      'Open APIs & Services, then Library. Enable "Gmail API" and "Google Calendar API".',
      'Open OAuth consent screen. Choose user type "Internal" so only encountive.com accounts can use it and no Google review is needed.',
      'Open Credentials, Create credentials, OAuth client ID. Choose "Web application".',
      'Under Authorized redirect URIs, paste the address below. Click Create and copy the Client ID and Client secret.',
    ],
  },
};

export function SetupGuide({ provider, redirectUri, open, onOpenChange }: {
  provider: MailProvider;
  redirectUri: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const g = GUIDES[provider];
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={g.title} description="One-time setup. Access is read-only.">
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        {g.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      <p className="label mt-4">Redirect address</p>
      <div className="flex items-center gap-2 rounded-md border border-line bg-raised p-2">
        <code className="min-w-0 flex-1 break-all text-xs">{redirectUri}</code>
        <Button size="sm" onClick={copy} aria-label="Copy redirect address">
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="label mt-4">Then add two secrets</p>
      <p className="text-sm text-muted">
        In Bolt, click the database icon at the top of the screen, open Secrets, and add these two names with the values you copied.
        They are stored only on the server and never reach your browser.
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        <li><code className="rounded bg-raised px-1.5 py-0.5 text-xs">{g.secrets[0]}</code> the client ID</li>
        <li><code className="rounded bg-raised px-1.5 py-0.5 text-xs">{g.secrets[1]}</code> the client secret</li>
      </ul>
      <p className="mt-4 rounded-md bg-raised p-3 text-sm text-muted">
        Come back to this page and click Connect, then sign in as <span className="font-medium text-fg">{g.signIn}</span>.
      </p>
    </Dialog>
  );
}
