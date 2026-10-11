/**
 * The vault on disk.
 *
 * A folder of Markdown files that is a valid Obsidian vault — nothing more
 * exotic than that. No database, no index file, no sidecar metadata: if this
 * application vanished, the folder would remain a complete, useful, portable
 * set of notes, which is the whole point of "local-first".
 *
 * ── Two rules this module exists to guarantee ────────────────────────────
 *
 * 1. **Writes are atomic.** Every file is written to a temporary name in the
 *    same directory and then renamed over the target. A rename within a
 *    filesystem is atomic, so a crash — or Obsidian's file watcher reading at
 *    the wrong moment, or a sync client uploading mid-write — never sees a
 *    half-written note. Writing in place would make truncation a routine
 *    outcome of an unlucky power cut.
 *
 * 2. **Nothing escapes the vault.** Every path is resolved and checked to be
 *    inside the root before anything touches it. A note title is user input
 *    and it becomes a filename; `../../.ssh/authorized_keys` must be a
 *    rejected path, not a clever one.
 */

import { constants } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { KIND_FOLDER } from "@/lib/notes/markdown";

export class VaultPathError extends Error {
  constructor(path: string) {
    super(
      `Refusing to touch ${JSON.stringify(path)}: it is outside the vault.`,
    );
    this.name = "VaultPathError";
  }
}

export interface VaultFile {
  /** Relative to the vault root, always with forward slashes. */
  path: string;
  content: string;
  mtime: Date;
}

/** Folders the sync manages. Anything else in the vault is left alone. */
export const MANAGED_FOLDERS = [
  ...new Set(Object.values(KIND_FOLDER)),
  "Conflicts",
] as const;

/**
 * Resolves a vault-relative path to an absolute one, refusing to escape.
 *
 * Exported because the check is worth testing directly — it is the boundary
 * between "a note title" and "a path on the owner's machine".
 */
export function resolveInVault(root: string, path: string): string {
  if (path.includes("\0")) throw new VaultPathError(path);

  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, path);
  const rel = relative(absoluteRoot, target);

  if (
    rel === "" ||
    rel.startsWith("..") ||
    resolve(absoluteRoot, rel) !== target
  ) {
    throw new VaultPathError(path);
  }

  return target;
}

/** Normalises a filesystem path to the vault's forward-slash convention. */
function toVaultPath(root: string, absolute: string): string {
  return relative(resolve(root), absolute).split(sep).join("/");
}

/**
 * Creates the vault skeleton.
 *
 * Deliberately does **not** create `.obsidian/` — Obsidian writes its own
 * configuration the first time it opens the folder, and pre-empting it with a
 * partial one is how you get a vault with broken settings.
 */
export async function ensureVault(root: string): Promise<void> {
  await mkdir(resolve(root), { recursive: true });

  for (const folder of MANAGED_FOLDERS) {
    await mkdir(join(resolve(root), folder), { recursive: true });
  }

  // A README so someone opening the folder in six months knows what it is and
  // what writes to it. Written once; never overwritten, because the owner may
  // have edited it.
  const readmePath = join(resolve(root), "README.md");
  if (!(await exists(readmePath))) {
    await fsWriteFile(readmePath, VAULT_README, "utf8");
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads every Markdown file the sync manages.
 *
 * Only the managed folders are walked. The owner's own folders, attachments
 * and `.obsidian/` are none of our business, and walking them would mean
 * reading files we have no reason to open.
 */
export async function readVault(root: string): Promise<VaultFile[]> {
  const absoluteRoot = resolve(root);
  const files: VaultFile[] = [];

  for (const folder of MANAGED_FOLDERS) {
    const directory = join(absoluteRoot, folder);
    if (!(await exists(directory))) continue;

    for (const entry of await readdir(directory, { withFileTypes: true })) {
      // One level deep. Nested folders inside a managed folder are the
      // owner's arrangement, not ours to interpret.
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md"))
        continue;

      const absolute = join(directory, entry.name);
      const [content, info] = await Promise.all([
        readFile(absolute, "utf8"),
        stat(absolute),
      ]);

      files.push({
        path: toVaultPath(absoluteRoot, absolute),
        content,
        mtime: info.mtime,
      });
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Reads one file, or `null` when it is not there. */
export async function readVaultFile(
  root: string,
  path: string,
): Promise<VaultFile | null> {
  const absolute = resolveInVault(root, path);

  try {
    const [content, info] = await Promise.all([
      readFile(absolute, "utf8"),
      stat(absolute),
    ]);
    return { path, content, mtime: info.mtime };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Writes a file atomically.
 *
 * Temporary file in the same directory, then rename. Same directory matters:
 * a rename across filesystems is a copy, which is not atomic and defeats the
 * point.
 */
export async function writeVaultFile(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  const absolute = resolveInVault(root, path);
  await mkdir(dirname(absolute), { recursive: true });

  const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`;

  try {
    await fsWriteFile(temporary, content, "utf8");
    await rename(temporary, absolute);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Removes a file. Missing is success — the desired state is "not there". */
export async function deleteVaultFile(
  root: string,
  path: string,
): Promise<void> {
  await rm(resolveInVault(root, path), { force: true });
}

const VAULT_README = `# CIO Dashboard vault

This folder is an [Obsidian](https://obsidian.md) vault. Open it directly —
File → Open folder as vault — on desktop or mobile.

## What is here

| Folder | Contents |
| ------ | -------- |
| \`Decisions/\` | The decision log. Decision and Rationale are equal anchors. |
| \`Meetings/\` | Meeting notes. |
| \`Follow-ups/\` | Notes that exist to carry actions out of something else. |
| \`Actions/\` | Standalone action items. |
| \`Notes/\` | Everything else. |
| \`Conflicts/\` | Copies preserved when a note was edited in two places at once. |

Any other folder you create is yours; the dashboard does not read or write it.

## Editing

Edit freely, here or in the app. Changes flow both ways. If the same note is
edited in both places between syncs, the app's version keeps the original
filename and **your** version is preserved in \`Conflicts/\` — nothing is
merged and nothing is thrown away.

## Tasks

Follow-up actions are written as [Obsidian Tasks](https://publish.obsidian.md/tasks/)
checkboxes, so the plugin's queries work on them unchanged:

    - [ ] Inventory the Okta apps #draft 👤 Maya ⏫ 📅 2026-09-01

\`👤\` is a convention of this vault, not an Obsidian Tasks field. \`#draft\`
means the action has not been committed to yet — it needs an owner, a due date
and a priority before it becomes live work.
`;
