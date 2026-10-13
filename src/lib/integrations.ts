import type { SetupInfo } from '@/components/ui/field';

export const SETUP = {
  renewals: { phase: 4, what: 'Renewals due within 14 days.', steps: ['Phase 4 adds the SaaS register and renewal timeline.'] },
  requests: { phase: 4, what: 'Open IT requests from Melissa.', steps: ['Phase 4 adds Partner IT Requests.'] },
  github: { phase: 7, what: 'Open pull requests, failed builds and security alerts.', steps: ['Create a read-only fine-grained GitHub token in Phase 7.'] },
  vercel: { phase: 7, what: 'Latest deployment status per project.', steps: ['Create a Vercel API token in Phase 7.'] },
} satisfies Record<string, SetupInfo>;
