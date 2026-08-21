"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import * as React from "react";

import {
  isThemeSetting,
  resolveTheme,
  THEME_SETTINGS,
  THEME_SETTING_LABELS,
  THEME_STORAGE_KEY,
  type ThemeSetting,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Light, dark, or whatever the machine says.
 *
 * ── Why it is three buttons and not a switch ─────────────────────────────
 * A two-state switch has to encode three states, and the usual fudge is to
 * let "off" mean both "light" and "I never touched this". Then the laptop
 * goes dark at sunset and the app does not, and there is no way to ask for
 * the old behaviour back short of clearing site data. Three radio-like
 * buttons say what they mean and cost one extra target.
 *
 * ── Why the choice is written before the class is ────────────────────────
 * `localStorage` is what the boot script in the layout reads on the next
 * load, so it is the durable half. Stamping `data-theme` is only the
 * immediate half. Writing storage first means a crash between the two leaves
 * the preference recorded rather than lost.
 *
 * The control renders nothing meaningful until mounted: the server cannot
 * know the preference (it lives in the browser), and guessing produces a
 * button that claims the wrong state for one frame.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [setting, setSetting] = React.useState<ThemeSetting>("system");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeSetting(stored)) setSetting(stored);
    } catch {
      // Blocked storage. `system` is the right thing to show.
    }
  }, []);

  // Following the system means following it as it changes, not once at boot.
  React.useEffect(() => {
    if (setting !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      document.documentElement.setAttribute(
        "data-theme",
        resolveTheme("system", media.matches),
      );
    };

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [setting]);

  const choose = (next: ThemeSetting) => {
    setSetting(next);

    try {
      if (next === "system") {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      }
    } catch {
      // The stamp below still works; it just will not survive a reload.
    }

    const prefersLight = window.matchMedia(
      "(prefers-color-scheme: light)",
    ).matches;
    document.documentElement.setAttribute(
      "data-theme",
      resolveTheme(next, prefersLight),
    );
  };

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      data-testid="theme-toggle"
      className={cn(
        "grid grid-cols-3 gap-1 rounded-md border border-chrome-line bg-chrome p-1",
        className,
      )}
    >
      {THEME_SETTINGS.map((option) => {
        const Icon = THEME_ICONS[option];
        const checked = mounted && setting === option;

        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={checked}
            data-testid={`theme-${option}`}
            onClick={() => choose(option)}
            className={cn(
              // 44px would eat the sidebar footer; 36 clears the 24px raycast
              // floor with room and this control is not a primary target.
              "flex min-h-9 flex-col items-center justify-center gap-0.5 rounded-sm text-[0.625rem] font-medium transition-colors duration-fast",
              checked
                ? "bg-chrome-raised text-chrome-fg"
                : "text-chrome-fg-muted hover:bg-chrome-raised/60 hover:text-chrome-fg",
            )}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {THEME_SETTING_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}

const THEME_ICONS: Record<ThemeSetting, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};
