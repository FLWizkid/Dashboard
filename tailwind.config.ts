import type { Config } from "tailwindcss";

/**
 * Every colour here resolves to a CSS custom property defined in
 * `src/app/globals.css`. Components therefore never hard-code a hex value and
 * both themes come for free — see that file for the palette and its contrast
 * budget.
 */
const rgb = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx,mdx}",
    "./src/components/**/*.{ts,tsx,mdx}",
  ],
  // Dark mode is driven by CSS variables (media query + `data-theme` override),
  // so the `dark:` variant is only needed for the rare thing tokens can't
  // express. Wiring it to the same attribute keeps the two in step.
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: rgb("bg"),
        surface: {
          DEFAULT: rgb("surface"),
          muted: rgb("surface-muted"),
          raised: rgb("surface-raised"),
        },
        line: {
          DEFAULT: rgb("border"),
          strong: rgb("border-strong"),
        },
        fg: {
          DEFAULT: rgb("fg"),
          muted: rgb("fg-muted"),
          subtle: rgb("fg-subtle"),
        },
        primary: {
          DEFAULT: rgb("primary"),
          hover: rgb("primary-hover"),
          fg: rgb("primary-fg"),
          soft: rgb("primary-soft"),
          "soft-fg": rgb("primary-soft-fg"),
        },
        accent: {
          DEFAULT: rgb("accent"),
          bright: rgb("accent-bright"),
          soft: rgb("accent-soft"),
        },
        // The navy frame. Constant across both themes on purpose — see the
        // note in globals.css.
        chrome: {
          DEFAULT: rgb("chrome"),
          raised: rgb("chrome-raised"),
          fg: rgb("chrome-fg"),
          "fg-muted": rgb("chrome-fg-muted"),
          line: rgb("chrome-line"),
        },
        // One tint per mailbox, always rendered next to the account's name.
        account: {
          1: rgb("account-1"),
          2: rgb("account-2"),
          3: rgb("account-3"),
          4: rgb("account-4"),
        },
        ring: rgb("ring"),
        danger: {
          DEFAULT: rgb("danger"),
          fg: rgb("danger-fg"),
        },
        warning: rgb("warning"),
        success: rgb("success"),
        priority: {
          critical: rgb("priority-critical"),
          "critical-soft": rgb("priority-critical-soft"),
          high: rgb("priority-high"),
          "high-soft": rgb("priority-high-soft"),
          normal: rgb("priority-normal"),
          "normal-soft": rgb("priority-normal-soft"),
          low: rgb("priority-low"),
          "low-soft": rgb("priority-low-soft"),
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 6px)",
      },
      // Elevation comes from the theme rather than from Tailwind's neutral
      // greys, because a grey shadow over a navy page reads as grime.
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        "gentle-out": "var(--ease-out)",
        "gentle-in-out": "var(--ease-in-out)",
      },
      transitionDuration: {
        fast: "var(--motion-fast)",
        base: "var(--motion-base)",
        slow: "var(--motion-slow)",
      },
      keyframes: {
        // Used by the task-complete moment; see src/lib/motion.ts.
        "check-draw": {
          from: { strokeDashoffset: "24" },
          to: { strokeDashoffset: "0" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "check-draw": "check-draw var(--motion-base) var(--ease-out) forwards",
        "rise-in": "rise-in var(--motion-base) var(--ease-out) both",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
