import { MAIL_PROVIDERS, type MailAccount, type MailProvider } from '@/lib/types';
import { cn } from '@/lib/utils';
import { IdentityBadge } from '@/components/ui/badge';

export function ProviderMark({ provider, className }: { provider: MailProvider; className?: string }) {
  const p = MAIL_PROVIDERS[provider];
  return (
    <span
      className={cn('inline-flex size-5 shrink-0 items-center justify-center rounded text-xs font-semibold', p.mark, className)}
      title={p.label}
      aria-label={p.label}
    >
      {p.short}
    </span>
  );
}

export function SourceBadge({ account, compact }: { account: MailAccount | undefined; compact?: boolean }) {
  if (!account) return <span className="text-xs text-subtle">Unknown source</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={`${MAIL_PROVIDERS[account.provider].app} · ${account.email}`}>
      <ProviderMark provider={account.provider} />
      {!compact && <span className="truncate text-xs text-muted">{account.email}</span>}
      <IdentityBadge identity={account.identity} compact />
    </span>
  );
}
