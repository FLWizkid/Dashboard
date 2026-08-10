import type { Metadata } from "next";

import { TimerView } from "@/components/pomodoro/timer-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pomodoro",
};

/**
 * The focus timer.
 *
 * Completed focus intervals become `focused` hours; breaks never do. Stopping
 * early still records the time actually spent — see `docs/hours.md`.
 */
export default function PomodoroPage() {
  return <TimerView />;
}
