/**
 * The blocks of time you can log with one tap.
 *
 * One list, imported by every surface that offers them, so the quick-log card
 * and the log-on-complete dialog can never drift into offering different
 * durations for the same action.
 *
 * ── Thirty minutes is the floor ──────────────────────────────────────────
 * A quarter of an hour is below the resolution anyone reconstructs
 * accurately after the fact, and offering it invites a precision the memory
 * cannot supply.
 */
export const LOG_PRESETS = [30, 45, 60, 90] as const;

export type LogPreset = (typeof LOG_PRESETS)[number];

/** "30m", "1h", "1.5h" — the label on the button. */
export function presetLabel(minutes: number): string {
  return minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`;
}
