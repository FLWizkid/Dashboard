import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUi } from './ui-context';

function isTyping(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Ctrl/Cmd + K', action: 'Open command palette' },
  { keys: '/', action: 'Search' },
  { keys: 'N', action: 'New task' },
  { keys: 'T', action: 'Log time' },
  { keys: 'F', action: 'Start focus' },
  { keys: 'G then T', action: 'Go to Today' },
  { keys: 'G then I', action: 'Go to Inbox' },
  { keys: 'G then A', action: 'Go to Agent Operations' },
  { keys: 'G then R', action: 'Go to Report Library' },
  { keys: 'G then W', action: 'Go to Weekly CIO Report' },
];

export function useGlobalShortcuts() {
  const ui = useUi();
  const navigate = useNavigate();
  const pendingG = useRef(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.openPalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (Date.now() - pendingG.current < 1200) {
        pendingG.current = 0;
        if (k === 't') navigate('/');
        else if (k === 'i') navigate('/inbox');
        else if (k === 'a') navigate('/agents');
        else if (k === 'r') navigate('/library');
        else if (k === 'w') navigate('/weekly');
        else return;
        e.preventDefault();
        return;
      }
      if (k === 'g') pendingG.current = Date.now();
      else if (k === '/') ui.openPalette();
      else if (k === 'n') ui.openQuickAdd();
      else if (k === 't') ui.openLogTime();
      else if (k === 'f') ui.openFocus();
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui, navigate]);
}
