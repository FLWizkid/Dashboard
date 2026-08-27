"use client";

import dynamic from "next/dynamic";

import type { Task } from "@/lib/tasks/types";

/**
 * The log-time dialog, fetched when it is first opened rather than with the
 * page.
 *
 * Statically imported it cost `/dashboard/tasks` and `/dashboard` about 7 kB
 * of first-load JavaScript each and put the heaviest route over its budget —
 * 577 kB against a 570 kB cap. That is the budget doing exactly its job: this
 * is a dialog that appears only after you complete a task *and* accept the
 * offer to log time, so nobody who is just reading their list should be
 * waiting for it.
 *
 * Splitting is the honest fix rather than raising the ceiling. The import
 * starts the moment `task` becomes non-null, which is the same click that
 * opens it, and the dialog animates in a beat later.
 */
const Dialog = dynamic(
  () => import("./log-time-dialog").then((m) => m.LogTimeDialog),
  { loading: () => null },
);

export function LogTimeDialogLazy({
  task,
  onOpenChange,
}: {
  task: Task | null;
  onOpenChange: (open: boolean) => void;
}) {
  // Nothing is fetched until there is a task to log against — rendering the
  // wrapper unconditionally would defeat the split by pulling the chunk on
  // mount.
  if (!task) return null;
  return <Dialog task={task} onOpenChange={onOpenChange} />;
}
