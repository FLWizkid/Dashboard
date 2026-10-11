import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, OctagonAlert, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'success' | 'error' | 'info';
interface Toast { id: number; tone: Tone; text: string }

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-20 right-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2 lg:bottom-4" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? OctagonAlert : Info;
          return (
            <div key={t.id} className="pointer-events-auto flex items-start gap-2 rounded-lg border border-line bg-surface p-3 text-sm shadow-xl animate-fade-in">
              <Icon className={cn('mt-0.5 size-4 shrink-0', t.tone === 'success' && 'text-success-500', t.tone === 'error' && 'text-error-500', t.tone === 'info' && 'text-primary-500')} />
              <p className="flex-1">{t.text}</p>
              <button className="text-subtle hover:text-fg" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} aria-label="Dismiss">
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
