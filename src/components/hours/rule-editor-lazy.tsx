"use client";

import dynamic from "next/dynamic";

/**
 * The classification rules, fetched when they are needed.
 *
 * Rules decide which calendar events count as work, and they are written once
 * and then left alone for months — while the rest of the hours page is read
 * every day. Shipping the editor in that route's initial bundle charges every
 * daily visit for a quarterly task.
 *
 * Split after the performance budget failed on this PR: three heaviest routes
 * came to 1605 kB against a 1600 kB cap. Trimming what nobody is waiting for
 * is the honest way back under, rather than raising the ceiling because the
 * number was inconvenient.
 */
const Editor = dynamic(
  () => import("./rule-editor").then((m) => m.RuleEditor),
  { loading: () => null },
);

export function RuleEditorLazy() {
  return <Editor />;
}
