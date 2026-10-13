import { useState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { checkInUrl, useAgentKey, useCreateAgentKey } from '@/data/agents';
import { errorMessage, relativeTime } from '@/lib/utils';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="label">{label}</p>
        <Button size="sm" variant="ghost" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-raised p-2 text-xs">{text}</pre>
    </div>
  );
}

export function ConnectClaudeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const key = useAgentKey();
  const create = useCreateAgentKey();
  const toast = useToast();
  const [plain, setPlain] = useState<string | null>(null);

  const generate = () =>
    create.mutate(undefined, {
      onSuccess: (k) => setPlain(k),
      onError: (e) => toast(errorMessage(e), 'error'),
    });

  const shownKey = plain ?? 'YOUR_KEY';
  const instructions = `At the very start of this task, open this address once:
${checkInUrl(shownKey, 'AGENT NAME', 'started')}

When the task is finished, open:
${checkInUrl(shownKey, 'AGENT NAME', 'succeeded')}

If the task fails, open this instead (you may add &message=short+reason):
${checkInUrl(shownKey, 'AGENT NAME', 'failed')}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPlain(null);
        onOpenChange(o);
      }}
      side="right"
      title="Connect Claude"
      description="Each Claude agent checks in at the start and end of a run. Agents appear here automatically the first time they check in."
    >
      <div className="space-y-4 text-sm">
        <section className="space-y-2">
          <h3 className="font-semibold">1. Your private check-in key</h3>
          {plain ? (
            <>
              <CopyBlock label="Key (shown only once)" text={plain} />
              <p className="text-xs text-warning-700 dark:text-warning-300">Save it now. Only a scrambled copy is stored, so it cannot be shown again.</p>
            </>
          ) : key.data ? (
            <p className="text-muted">A key ending in <span className="font-medium text-fg">...{key.data.key_hint}</span> was created {relativeTime(key.data.created_at)}. Making a new one stops the old one from working.</p>
          ) : (
            <p className="text-muted">No key yet. Create one to let your agents report in.</p>
          )}
          <Button variant={key.data && !plain ? 'secondary' : 'primary'} onClick={generate} disabled={create.isPending || key.isLoading}>
            <KeyRound /> {create.isPending ? 'Creating...' : key.data ? 'Make a new key' : 'Create key'}
          </Button>
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold">2. Add this to each agent's instructions in Claude</h3>
          <p className="text-muted">Replace AGENT NAME with the agent's name (spaces are fine as %20 or +). {plain ? 'Your key is already filled in.' : 'Replace YOUR_KEY with your key.'}</p>
          <CopyBlock label="Agent instructions" text={instructions} />
        </section>

        <section className="space-y-1 text-muted">
          <h3 className="font-semibold text-fg">Good to know</h3>
          <p>Claude does not let other apps look inside it, so this page only knows what your agents report. An agent that says "started" but never finishes shows as Stalled after 6 hours.</p>
        </section>
      </div>
    </Dialog>
  );
}
