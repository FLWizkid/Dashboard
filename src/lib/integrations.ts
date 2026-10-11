import type { SetupInfo } from '@/components/ui/field';

export const SETUP = {
  calendar: {
    phase: 4,
    what: 'Merged Outlook (theonefor.ai) and Google (encountive.com) calendars, read-only.',
    steps: [
      'Deploy the console to its permanent web address first (sign-in links must use that address, not the preview).',
      'Register a Microsoft app in the Azure Portal, then a Google OAuth app in the encountive.com Workspace. Step-by-step instructions come with Phase 4.',
      'Click Connect in Settings for each account.',
    ],
  },
  mail: {
    phase: 4,
    what: 'Critical unread mail from VIP senders across all three inboxes.',
    steps: [
      'Connect Outlook and Gmail in Phase 4.',
      'Run the small Proton relay program on your Windows PC (provided in Phase 4) for the Proton inbox.',
    ],
  },
  agents: {
    phase: 3,
    what: 'Latest report from each Claude and Perplexity agent, with failed or missed runs flagged.',
    steps: [
      'Phase 3 adds the Agent registry with your eight existing agents (status: Stopped by me).',
      'Each agent gets a reporting key and a copy-paste snippet so its runs show up here.',
    ],
  },
  renewals: { phase: 3, what: 'Renewals due within 14 days.', steps: ['Phase 3 adds the SaaS register and renewal timeline.'] },
  requests: { phase: 3, what: 'Open IT requests from Melissa.', steps: ['Phase 3 adds Partner IT Requests.'] },
  resend: {
    phase: 5,
    what: 'Sending alerts, digests and test messages from console@notify.theonefor.ai via Resend.',
    steps: [
      'Create a Resend account and add the sending subdomain notify.theonefor.ai.',
      'Add the SPF and DKIM records Resend gives you at your DNS host (documented in Phase 5).',
      'Paste the Resend API key when asked; it is stored only on the server.',
    ],
  },
  github: { phase: 5, what: 'Open pull requests, failed builds and security alerts.', steps: ['Create a read-only fine-grained GitHub token in Phase 5.'] },
  vercel: { phase: 5, what: 'Latest deployment status per project.', steps: ['Create a Vercel API token in Phase 5.'] },
} satisfies Record<string, SetupInfo>;
