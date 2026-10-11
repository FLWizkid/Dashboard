import "server-only";

import { ownerFilter, owned, type DataScope } from "@/lib/db/scope";
import {
  markdownToNote,
  vaultPathFor,
  type NoteDocument,
} from "@/lib/notes/markdown";

import { deleteVaultFile, ensureVault, readVault, writeVaultFile } from "./fs";
import type { SyncNote, VaultFileRecord, VaultSyncPorts } from "./sync";

/**
 * The sync job's ports, wired to Postgres and the disk.
 *
 * Thin on purpose. Every decision lives in `sync.ts` and `reconcile.ts`, which
 * are tested against an in-memory world; anything clever here would be logic
 * that only runs on the box.
 */

interface NoteRow {
  id: string;
  kind: NoteDocument["kind"];
  title: string;
  decision: string | null;
  rationale: string | null;
  context: string | null;
  owner: string | null;
  decided_on: string | null;
  body: string;
  vault_path: string | null;
  version: number;
  is_archived: boolean;
  created_at: string;
}

const NOTE_COLUMNS =
  "id, kind, title, decision, rationale, context, owner, decided_on, body, " +
  "vault_path, version, is_archived, created_at";

export class VaultNotConfiguredError extends Error {
  constructor() {
    super(
      "DASHBOARD_VAULT_PATH is not set, so there is nowhere to sync to. " +
        "See docs/vault.md.",
    );
    this.name = "VaultNotConfiguredError";
  }
}

export function vaultRoot(env = process.env): string | null {
  const root = env.DASHBOARD_VAULT_PATH?.trim();
  return root ? root : null;
}

export function createSupabaseVaultPorts(
  scope: DataScope,
  root: string,
): VaultSyncPorts {
  return {
    async ensureVault() {
      await ensureVault(root);
    },

    async readVault() {
      return readVault(root);
    },

    async writeFile(path, content) {
      await writeVaultFile(root, path, content);
    },

    async deleteFile(path) {
      await deleteVaultFile(root, path);
    },

    async listNotes(): Promise<SyncNote[]> {
      const supabase = await scope.client();

      const { data, error } = await supabase
        .from("notes")
        .select(NOTE_COLUMNS)
        .match(ownerFilter(scope))
        .returns<NoteRow[]>();

      if (error) throw new Error(error.message);

      return (data ?? []).map((row) => ({
        id: row.id,
        vaultPath: row.vault_path,
        version: row.version,
        isArchived: row.is_archived,
        document: toDocument(row),
      }));
    },

    async listFileRecords(): Promise<VaultFileRecord[]> {
      const supabase = await scope.client();

      const { data, error } = await supabase
        .from("vault_files")
        .select("path, note_id, synced_hash, synced_version")
        .match(ownerFilter(scope))
        .returns<
          {
            path: string;
            note_id: string | null;
            synced_hash: string | null;
            synced_version: number | null;
          }[]
        >();

      if (error) throw new Error(error.message);

      return (data ?? []).map((row) => ({
        path: row.path,
        noteId: row.note_id,
        syncedHash: row.synced_hash,
        syncedVersion: row.synced_version,
      }));
    },

    async createNote(path, document) {
      const supabase = await scope.client();

      const { data, error } = await supabase
        .from("notes")
        .insert(
          owned(scope, {
            ...toRow(document),
            vault_path: path,
          }),
        )
        .select("id, version")
        .single<{ id: string; version: number }>();

      if (error) throw new Error(error.message);
      return data;
    },

    async updateNote(id, document) {
      const supabase = await scope.client();

      // The version is bumped here rather than by a trigger so the number the
      // sync records is the number the write produced. Reading it back
      // afterwards would leave a window in which another edit lands between.
      const { data: current, error: readError } = await supabase
        .from("notes")
        .select("version")
        .match({ ...ownerFilter(scope), id })
        .single<{ version: number }>();

      if (readError) throw new Error(readError.message);

      const version = current.version + 1;

      const { error } = await supabase
        .from("notes")
        .update({ ...toRow(document), version })
        .match({ ...ownerFilter(scope), id });

      if (error) throw new Error(error.message);
      return { version };
    },

    async archiveNote(id) {
      const supabase = await scope.client();

      const { error } = await supabase
        .from("notes")
        .update({ is_archived: true })
        .match({ ...ownerFilter(scope), id });

      if (error) throw new Error(error.message);
    },

    async setNotePath(id, path) {
      const supabase = await scope.client();

      const { error } = await supabase
        .from("notes")
        .update({ vault_path: path })
        .match({ ...ownerFilter(scope), id });

      if (error) throw new Error(error.message);
    },

    async recordFile(input) {
      const supabase = await scope.client();

      const { error } = await supabase.from("vault_files").upsert(
        owned(scope, {
          path: input.path,
          note_id: input.noteId,
          synced_hash: input.hash,
          synced_version: input.version,
          state: input.state,
          conflict_path: input.conflictPath,
          last_error: input.error,
          last_synced_at: new Date().toISOString(),
        }),
        { onConflict: "user_id,path" },
      );

      if (error) throw new Error(error.message);
    },

    async forgetFile(path) {
      const supabase = await scope.client();

      const { error } = await supabase
        .from("vault_files")
        .delete()
        .match({ ...ownerFilter(scope), path });

      if (error) throw new Error(error.message);
    },
  };
}

function toDocument(row: NoteRow): NoteDocument {
  return {
    kind: row.kind,
    title: row.title,
    decision: row.decision,
    rationale: row.rationale,
    context: row.context,
    owner: row.owner,
    decidedOn: row.decided_on,
    body: row.body,
    // Follow-ups and unrecognised frontmatter round-trip through the body,
    // which is what `markdownToNote` put there when the file was read.
    followUps: [],
    extraFrontmatter: { data: {}, unknown: [] },
  };
}

function toRow(document: NoteDocument) {
  return {
    kind: document.kind,
    title: document.title,
    decision: document.decision,
    rationale: document.rationale,
    context: document.context,
    owner: document.owner,
    decided_on: document.decidedOn,
    body: document.body,
  };
}

export { markdownToNote, vaultPathFor };
