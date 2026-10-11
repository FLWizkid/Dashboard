import { useEffect, useState } from 'react';

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('cc-theme', dark ? 'dark' : 'light');
    } catch {
      /* storage unavailable: theme still applies for this session */
    }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}
