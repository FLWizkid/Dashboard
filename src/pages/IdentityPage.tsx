import { Navigate, useParams } from 'react-router-dom';
import { ArrowRightLeft, Fingerprint } from 'lucide-react';
import { PageHeader, type PageTab } from '@/components/ui/page-header';
import { IdentityAudit, useIdentityFindingCount } from '@/components/identity/IdentityAudit';
import { MigrationTracker } from '@/components/identity/MigrationTracker';

const SECTIONS: (PageTab & { description: string })[] = [
  { key: 'review', label: 'Review', to: '/identity/review', icon: Fingerprint, description: 'Anything filed under the wrong identity, or with no identity at all.' },
  { key: 'moves', label: 'Migration tracker', to: '/identity/moves', icon: ArrowRightLeft, description: 'Accounts being moved from one email address to another, step by step.' },
];

export function IdentityPage() {
  const { section } = useParams();
  const findings = useIdentityFindingCount();
  const current = SECTIONS.find((s) => s.key === section);
  if (!current) return <Navigate to="/identity/review" replace />;
  const tabs = SECTIONS.map((s) => (s.key === 'review' && findings ? { ...s, count: findings, tone: 'alert' as const } : s));
  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <PageHeader title="Identity" description={current.description} tabs={tabs} activeTab={current.key} />
      <div className="animate-fade-in" key={current.key}>
        {current.key === 'review' && <IdentityAudit />}
        {current.key === 'moves' && <MigrationTracker />}
      </div>
    </div>
  );
}
