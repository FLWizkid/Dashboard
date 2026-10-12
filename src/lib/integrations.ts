import type { SetupInfo } from '@/components/ui/field';

export const SETUP = {
  agents: {
    phase: 5,
    what: 'Latest report from each Claude agent, with failed, missed or misrouted runs flagged.',
    steps: [
      'Phase 5 adds the Agent registry, seeded with your Claude agents (status: Unverified until you confirm each).',
      'Each agent gets a reporting key and a copy-paste snippet so its runs show up here.',
    ],
  },
  renewals: { phase: 4, what: 'Renewals due within 14 days.', steps: ['Phase 4 adds the SaaS register and renewal timeline.'] },
  requests: { phase: 4, what: 'Open IT requests from Melissa.', steps: ['Phase 4 adds Partner IT Requests.'] },
  resend: {
    phase: 3,
    what: 'Sending alerts, digests and test messages from console@notify.theonefor.ai via Resend.',
    steps: [
      'Create a Resend account and add the sending subdomain notify.theonefor.ai.',
      'Add the SPF and DKIM records Resend gives you at your DNS host (exact records listed when this is built).',
      'Add the Resend API key in Bolt under the database icon, then Secrets. It is stored only on the server.',
    ],
  },
  github: { phase: 7, what: 'Open pull requests, failed builds and security alerts.', steps: ['Create a read-only fine-grained GitHub token in Phase 7.'] },
  vercel: { phase: 7, what: 'Latest deployment status per project.', steps: ['Create a Vercel API token in Phase 7.'] },
} satisfies Record<string, SetupInfo>;
