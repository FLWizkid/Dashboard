import { cn } from '@/lib/utils';

type Line = { kind: 'same' | 'added' | 'removed'; text: string };

const MAX_LINES = 3000;

function diffLines(before: string, after: string): Line[] | null {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > MAX_LINES || b.length > MAX_LINES) return null;
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: 'removed', text: a[i++] });
    else out.push({ kind: 'added', text: b[j++] });
  }
  while (i < n) out.push({ kind: 'removed', text: a[i++] });
  while (j < m) out.push({ kind: 'added', text: b[j++] });
  return out;
}

export function ReportDiff({ before, after }: { before: string; after: string }) {
  const lines = diffLines(before, after);
  if (!lines) return <p className="text-sm text-muted">These reports are too long to compare line by line.</p>;
  const added = lines.filter((l) => l.kind === 'added').length;
  const removed = lines.filter((l) => l.kind === 'removed').length;
  if (!added && !removed) return <p className="text-sm text-muted">No differences. This run said exactly the same as the previous one.</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        <span className="font-medium text-success-700 dark:text-success-300">{added} new line{added === 1 ? '' : 's'}</span>
        {' · '}
        <span className="font-medium text-error-700 dark:text-error-300">{removed} removed</span>
      </p>
      <div className="overflow-x-auto rounded-md border border-line font-mono text-xs leading-relaxed">
        {lines.map((l, idx) => (
          <div
            key={idx}
            className={cn(
              'whitespace-pre-wrap break-words px-3 py-0.5',
              l.kind === 'added' && 'bg-success-500/10 text-success-800 dark:text-success-200',
              l.kind === 'removed' && 'bg-error-500/10 text-error-800 line-through decoration-error-400/60 dark:text-error-200',
              l.kind === 'same' && 'text-muted',
            )}
          >
            <span className="mr-2 select-none text-subtle" aria-hidden>{l.kind === 'added' ? '+' : l.kind === 'removed' ? '-' : ' '}</span>
            {l.text || ' '}
          </div>
        ))}
      </div>
    </div>
  );
}
