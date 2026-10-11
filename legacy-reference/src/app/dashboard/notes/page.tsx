import type { Metadata } from "next";

import { NotesView } from "@/components/notes/notes-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notes",
};

/**
 * The knowledge layer.
 *
 * Local-first Markdown in an Obsidian-compatible vault — no cloud knowledge
 * tool. Every note here is a file you own; see `docs/vault.md`.
 */
export default function NotesPage() {
  return <NotesView />;
}
