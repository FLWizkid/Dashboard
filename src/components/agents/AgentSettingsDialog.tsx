import { useState, type FormEvent } from 'react';
import { useUpdateAgent } from '@/data/agents';
import type { Agent, AgentEmailOn } from '@/lib/types';
import { errorMessage } from '@/lib/utils';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

const EMAIL_ON: { value: AgentEmailOn; label: string }[] = [
  { value: 'failure', label: 'Only when it fails' },
  { value: 'always', label: 'Every time a report arrives' },
  { value: 'never', label: 'Never' },
];

function Form({ agent, onDone }: { agent: Agent; onDone: () => void }) {
  const update = useUpdateAgent();
  const toast = useToast();
  const [emailOn, setEmailOn] = useState<AgentEmailOn>(agent.email_on);
  const [hours, setHours] = useState(agent.expected_every_hours ? String(agent.expected_every_hours) : '');
  const [notes, setNotes] = useState(agent.notes ?? '');
  const n = hours.trim() ? Number(hours) : null;
  const hoursError = n !== null && (!Number.isInteger(n) || n < 1 || n > 720) ? 'Use a whole number of hours from 1 to 720.' : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (hoursError) return;
    update.mutate(
      { id: agent.id, email_on: emailOn, expected_every_hours: n, notes: notes.trim() || null },
      { onSuccess: () => { toast('Agent settings saved'); onDone(); }, onError: (err) => toast(errorMessage(err), 'error') },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Email me a short note" hint="The note links to the full report here. Only sent to your approved notification address.">
        <Select value={emailOn} onChange={(e) => setEmailOn(e.target.value as AgentEmailOn)}>
          {EMAIL_ON.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </Field>
      <Field label="Expected to run every (hours)" hint="Leave blank to skip. The agent is flagged as overdue when it is a quarter past this and has not run." error={hoursError}>
        <Input inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 24 for daily" />
      </Field>
      <Field label="Notes">
        <textarea className="input min-h-[72px]" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!!hoursError || update.isPending}>{update.isPending ? 'Saving...' : 'Save'}</Button>
      </div>
    </form>
  );
}

export function AgentSettingsDialog({ agent, onClose }: { agent: Agent | null; onClose: () => void }) {
  return (
    <Dialog open={!!agent} onOpenChange={(o) => !o && onClose()} title={agent ? `${agent.name} settings` : 'Agent settings'} description="Choose when you get an email and how often this agent should run.">
      {agent && <Form key={agent.id} agent={agent} onDone={onClose} />}
    </Dialog>
  );
}
