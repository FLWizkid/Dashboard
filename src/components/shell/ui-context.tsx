import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface UiState {
  quickAdd: { open: boolean; defaultDue?: string };
  logTime: boolean;
  focus: boolean;
  palette: boolean;
  taskId: string | null;
}

interface UiActions {
  state: UiState;
  openQuickAdd: (defaultDue?: string) => void;
  openLogTime: () => void;
  openFocus: () => void;
  openPalette: () => void;
  openTask: (id: string) => void;
  close: (key: 'quickAdd' | 'logTime' | 'focus' | 'palette' | 'taskId') => void;
}

const UiContext = createContext<UiActions | null>(null);

const initial: UiState = { quickAdd: { open: false }, logTime: false, focus: false, palette: false, taskId: null };

export function UiProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UiState>(initial);
  const value = useMemo<UiActions>(
    () => ({
      state,
      openQuickAdd: (defaultDue) => setState((s) => ({ ...s, palette: false, quickAdd: { open: true, defaultDue } })),
      openLogTime: () => setState((s) => ({ ...s, palette: false, logTime: true })),
      openFocus: () => setState((s) => ({ ...s, palette: false, focus: true })),
      openPalette: () => setState((s) => ({ ...s, palette: true })),
      openTask: (id) => setState((s) => ({ ...s, palette: false, taskId: id })),
      close: (key) =>
        setState((s) => ({ ...s, [key]: key === 'quickAdd' ? { open: false } : key === 'taskId' ? null : false })),
    }),
    [state],
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used inside UiProvider');
  return ctx;
}
