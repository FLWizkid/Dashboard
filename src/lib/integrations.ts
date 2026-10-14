import type { SetupInfo } from '@/components/ui/field';

export const SETUP = {
  renewals: { phase: 4, what: 'Renewals due within 14 days.', steps: ['Phase 4 adds the SaaS register and renewal timeline.'] },
  requests: { phase: 4, what: 'Open IT requests from Melissa.', steps: ['Phase 4 adds Partner IT Requests.'] },
  github: { phase: 7, what: 'Open pull requests, failed builds and security alerts.', steps: ['Add a read-only GitHub token: Setup, Your steps, step 3. Status shows on the IT Operations page.'] },
  vercel: { phase: 7, what: 'Latest deployment status per project.', steps: ['Add a Vercel token: Setup, Your steps, step 3. Status shows on the IT Operations page.'] },
} satisfies Record<string, SetupInfo>;
