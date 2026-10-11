"use client";

import dynamic from "next/dynamic";

import { Card } from "@/components/ui/card";

/**
 * The next-two-days card, loaded after the shell is interactive.
 *
 * ── Why this is deferred ─────────────────────────────────────────────────
 * Adding the card to the dashboard measurably delayed hydration on a phone:
 * the mobile suite began failing on taps that land immediately after
 * navigation, because the tap arrived before React had attached its handler.
 * The bottom bar is the whole of navigation on a phone, so a dashboard card
 * making it briefly dead is a real defect, not a test artefact — and one that
 * would have shown up as "the nav sometimes doesn't work", the kind of thing
 * you blame on your thumb.
 *
 * The card sits below the fold on a phone, so deferring it costs nothing that
 * is visible and buys back the shell's interactivity. The placeholder holds
 * the same space to keep the layout from jumping when it arrives.
 */
const NextTwoDays = dynamic(
  () => import("./next-two-days").then((module) => module.NextTwoDays),
  {
    loading: () => (
      <Card className="p-5" aria-busy>
        <p className="text-sm text-fg-muted">Next two days…</p>
      </Card>
    ),
  },
);

export function NextTwoDaysLazy({ className }: { className?: string }) {
  return <NextTwoDays className={className} />;
}
