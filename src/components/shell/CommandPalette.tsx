import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import * as D from '@radix-ui/react-dialog';
import { CheckSquare, Clock, Mic, MicOff, Moon, Plus, Search, Timer } from 'lucide-react';
import { useTasks } from '@/data/tasks';
import { cn } from '@/lib/utils';
import { ALL_NAV } from './nav';
import { useUi } from './ui-context';

type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognition(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

const itemCls = 'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-fg aria-selected:bg-raised [&_svg]:size-4 [&_svg]:text-subtle';

export function CommandPalette({ onToggleTheme }: { onToggleTheme: () => void }) {
  const ui = useUi();
  const navigate = useNavigate();
  const { data: tasks = [] } = useTasks();
  const [search, setSearch] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const open = ui.state.palette;

  useEffect(() => {
    if (!open) {
      setSearch('');
      setVoiceError(null);
    }
  }, [open]);

  const run = (fn: () => void) => {
    ui.close('palette');
    fn();
  };

  function listen() {
    const rec = getRecognition();
    if (!rec) {
      setVoiceError('Voice commands are not supported in this browser. Try Chrome or Edge.');
      return;
    }
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.onresult = (e) => setSearch(e.results[0]?.[0]?.transcript.replace(/[.?!]$/, '') ?? '');
    rec.onend = () => setListening(false);
    rec.onerror = () => {
      setListening(false);
      setVoiceError('Could not hear that. Check microphone permission and try again.');
    };
    setListening(true);
    rec.start();
  }

  return (
    <D.Root open={open} onOpenChange={(o) => (o ? ui.openPalette() : ui.close('palette'))}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <D.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-surface shadow-2xl animate-fade-in">
          <D.Title className="sr-only">Command palette</D.Title>
          <D.Description className="sr-only">Search commands, pages and tasks, or speak a command</D.Description>
          <Command label="Command palette" loop>
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="size-4 text-subtle" />
              <Command.Input value={search} onValueChange={setSearch} placeholder="Type or say a command: new task, log time, go to tasks…" className="h-12 flex-1 bg-transparent text-base text-fg placeholder:text-subtle focus:outline-none" />
              <button onClick={listen} disabled={listening} className={cn('rounded p-1.5 transition-colors', listening ? 'bg-error-500/15 text-error-500' : 'text-subtle hover:bg-raised hover:text-fg')} aria-label="Speak a command" title="Voice command">
                {listening ? <MicOff className="size-4 animate-pulse" /> : <Mic className="size-4" />}
              </button>
            </div>
            {voiceError && <p className="border-b border-line px-3 py-2 text-xs text-warning-700 dark:text-warning-400">{voiceError}</p>}
            <Command.List className="max-h-[50vh] overflow-y-auto p-2">
              <Command.Empty className="px-2 py-6 text-center text-sm text-muted">No matches.</Command.Empty>
              <Command.Group heading="Actions" className="text-xs text-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
                <Command.Item className={itemCls} keywords={['add', 'create', 'todo']} onSelect={() => run(() => ui.openQuickAdd())}><Plus /> New task <Kbd>N</Kbd></Command.Item>
                <Command.Item className={itemCls} keywords={['hours', 'track', 'log']} onSelect={() => run(ui.openLogTime)}><Clock /> Log time <Kbd>T</Kbd></Command.Item>
                <Command.Item className={itemCls} keywords={['pomodoro', 'timer', 'start']} onSelect={() => run(ui.openFocus)}><Timer /> Start focus <Kbd>F</Kbd></Command.Item>
                <Command.Item className={itemCls} keywords={['dark', 'light', 'mode']} onSelect={() => run(onToggleTheme)}><Moon /> Toggle dark / light</Command.Item>
              </Command.Group>
              <Command.Group heading="Go to" className="text-xs text-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
                {ALL_NAV.map((n) => (
                  <Command.Item key={n.to} className={itemCls} value={`go to ${n.label}`} keywords={['open', 'show']} onSelect={() => run(() => navigate(n.to))}>
                    <n.icon /> {n.label}
                    {n.phase > 1 && <span className="ml-auto text-xs text-subtle">Phase {n.phase}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
              {search.length > 1 && (
                <Command.Group heading="Tasks" className="text-xs text-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
                  {tasks.slice(0, 200).map((t) => (
                    <Command.Item key={t.id} className={itemCls} value={`task ${t.title} ${t.id}`} onSelect={() => run(() => ui.openTask(t.id))}>
                      <CheckSquare /> <span className={cn('truncate', t.status === 'done' && 'line-through text-subtle')}>{t.title}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="ml-auto rounded border border-line bg-raised px-1.5 font-mono text-[11px] text-muted">{children}</kbd>;
}
