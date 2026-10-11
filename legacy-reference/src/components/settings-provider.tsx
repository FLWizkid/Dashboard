"use client";

import * as React from "react";

import { DEFAULT_DUE_HOUR } from "@/lib/quick-add/parse";
import { detectTimeZone, isValidTimeZone } from "@/lib/time/zone";

/**
 * Owner preferences that affect how dates are read and written.
 *
 * Timezone is auto-detected from the browser with an explicit override, per
 * the product defaults. The override lives in `localStorage` for now; when the
 * settings module lands it moves to a `profiles` column and this provider
 * reads it from the server instead — the rest of the app talks to the hook,
 * not to the storage.
 */
const STORAGE_KEY = "dashboard.settings.v1";

export interface Settings {
  timeZone: string;
  /** Wall-clock hour a bare date snaps to. */
  defaultDueHour: number;
  /** 1 = Monday. The work week default is Mon–Fri. */
  weekStartsOn: 0 | 1;
}

interface SettingsContextValue extends Settings {
  /** `true` until the browser-side timezone has been resolved. */
  ready: boolean;
  setTimeZone: (timeZone: string | null) => void;
}

const SettingsContext = React.createContext<SettingsContextValue | null>(null);

const FALLBACK: Settings = {
  timeZone: "UTC",
  defaultDueHour: DEFAULT_DUE_HOUR,
  weekStartsOn: 1,
};

function readOverride(): Partial<Settings> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Settings>) : {};
  } catch {
    return {};
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  // Server and first client render must agree, so start from the fallback and
  // resolve the real zone in an effect. Anything time-shaped renders a
  // suppressed-hydration placeholder until `ready` flips.
  const [settings, setSettings] = React.useState<Settings>(FALLBACK);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const override = readOverride();
    const detected = detectTimeZone();
    const timeZone =
      override.timeZone && isValidTimeZone(override.timeZone)
        ? override.timeZone
        : detected;

    setSettings({
      timeZone,
      defaultDueHour: override.defaultDueHour ?? FALLBACK.defaultDueHour,
      weekStartsOn: override.weekStartsOn ?? FALLBACK.weekStartsOn,
    });
    setReady(true);
  }, []);

  const setTimeZone = React.useCallback((timeZone: string | null) => {
    setSettings((current) => {
      const next: Settings = {
        ...current,
        timeZone:
          timeZone && isValidTimeZone(timeZone) ? timeZone : detectTimeZone(),
      };
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(timeZone ? { timeZone } : {}),
        );
      } catch {
        // Private browsing or a full quota — the in-memory value still applies.
      }
      return next;
    });
  }, []);

  const value = React.useMemo<SettingsContextValue>(
    () => ({ ...settings, ready, setTimeZone }),
    [settings, ready, setTimeZone],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const context = React.useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used inside a SettingsProvider");
  }
  return context;
}
