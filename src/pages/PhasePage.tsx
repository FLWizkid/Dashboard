import { Link, useLocation } from 'react-router-dom';
import { CircleDashed } from 'lucide-react';
import { ALL_NAV } from '@/components/shell/nav';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export function PhasePage() {
  const { pathname } = useLocation();
  const item = ALL_NAV.find((n) => n.to === pathname);
  if (!item) return <NotFound />;
  const Icon = item.icon;

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-16 text-center animate-fade-in">
      <div className="mb-4 flex size-14 items-center justify-center rounded-xl border border-dashed border-line bg-raised text-muted">
        <Icon className="size-6" />
      </div>
      <Badge className="mb-3"><CircleDashed /> Not built yet · Phase {item.phase}</Badge>
      <h1 className="text-2xl font-semibold">{item.label}</h1>
      {item.summary && <p className="mt-2 text-muted">{item.summary}</p>}
      <p className="mt-4 text-sm text-subtle">This screen arrives in Phase {item.phase}. Nothing here is simulated, so there is nothing to click yet.</p>
      <Button asChild variant="secondary" className="mt-6"><Link to="/">Back to Today</Link></Button>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted">That address does not match any screen in the console.</p>
      <Button asChild variant="secondary" className="mt-6"><Link to="/">Back to Today</Link></Button>
    </div>
  );
}
