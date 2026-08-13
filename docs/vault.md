# The vault

Your notes live in a folder of Markdown files on your box that is a **valid
Obsidian vault**. Open it directly in Obsidian, on desktop or on a phone.
Nothing about it depends on this application: if the dashboard vanished
tomorrow, the folder would still be a complete, portable, useful set of notes.

That is what the specification means by local-first, and it is the constraint
everything below is shaped around. **No Notion, no cloud knowledge tool.**

---

## Layout

```
<vault root>/
├── README.md          Written once, then yours to edit
├── Decisions/         The decision log
├── Meetings/          Meeting notes
├── Follow-ups/        Notes that carry actions out of something else
├── Actions/           Standalone action items
├── Notes/             Everything else
└── Conflicts/         Copies preserved when a note was edited twice at once
```

Any other folder you create is **yours**. The sync walks only the folders
above, one level deep, and only `.md` files — your attachments, your own
folders and `.obsidian/` are never read or written.

`.obsidian/` is deliberately not created. Obsidian writes its own
configuration the first time it opens the folder, and pre-empting it with a
partial one is how you end up with a vault whose settings are subtly broken.

---

## What a note looks like

A decision note, which is the one the product is built around:

```markdown
---
type: decision
title: Consolidate on one identity provider
owner: Doug
decided: 2026-08-11
---

# Consolidate on one identity provider

## Decision

Move everything to Entra ID by Q1.

## Rationale

Two providers means two audit trails and twice the offboarding risk.

## Context

Raised by the SOC2 gap analysis.

## Follow-up actions

- [ ] Inventory the Okta apps #draft 👤 Maya ⏫ 📅 2026-09-01
```

**Decision and Rationale are sibling headings of equal weight.** Neither is the
title, neither is a subheading of the other. The specification makes them equal
anchors, and the reason shows up eighteen months later: a decision without its
reasoning is an edict you cannot re-evaluate.

`## Notes` carries any freeform prose. It has its own heading so the round trip
is unambiguous — prose written directly after `## Context` would otherwise read
as more Context on the way back in.

### Frontmatter

| Key       | Meaning                                                      |
| --------- | ------------------------------------------------------------ |
| `type`    | `decision` · `meeting` · `follow_up` · `action` · `freeform` |
| `title`   | The note's title                                             |
| `owner`   | Who owns it                                                  |
| `decided` | The date a decision was made                                 |

**Any other key you add is preserved untouched.** If a plugin writes
`cssclass`, `tags` or `aliases`, they come back exactly as they went in — even
keys the parser does not understand are re-emitted verbatim. The vault is
yours; we are a guest in it.

### Tasks

Follow-up actions use the [Obsidian Tasks](https://publish.obsidian.md/tasks/)
format, so the plugin's queries work on these files with no configuration:

```markdown
- [ ] Inventory the Okta apps #draft 👤 Maya ⏫ 📅 2026-09-01 🆔 <id>
```

| Marker        | Meaning                                                 |
| ------------- | ------------------------------------------------------- |
| `🔺 ⏫ 🔼 🔽` | Critical · High · Normal · Low                          |
| `📅`          | Due date                                                |
| `✅`          | Completed date                                          |
| `🆔`          | The task's id, so edits match up rather than duplicate  |
| `👤`          | Owner — **our convention**, not an Obsidian Tasks field |
| `#draft`      | Not committed to yet                                    |

A **draft** needs an owner, a due date and a priority before it becomes live
work. Until then it stays off the board, off the dashboard and out of every
count. You can supply the missing pieces just as well by editing the line in
Obsidian as by using the app.

---

## Sync rules

Changes flow both ways, on a schedule and on demand. Reconciliation compares
**three** values, not two:

| Value         | Where it comes from                                 |
| ------------- | --------------------------------------------------- |
| The file      | SHA-256 of what is on disk now                      |
| The app       | The note's version number                           |
| The last sync | The hash and version recorded when they last agreed |

Two values cannot tell you _which_ side changed — in every interesting case
both differ from each other. The third makes the question answerable.

Content hashes rather than timestamps, because **mtime lies**: sync clients
rewrite files unchanged, filesystems disagree about granularity, phones have
their own opinion of the clock, and "touched" is not "edited". Line endings are
normalised before hashing, so a vault that has been through Windows does not
look edited on every pass.

### What happens

| Situation                       | What happens                            |
| ------------------------------- | --------------------------------------- |
| Neither changed                 | Nothing                                 |
| Only the app changed            | The file is rewritten                   |
| Only the file changed           | The app takes the file's content        |
| A new file appears              | A note is created from it               |
| A new note is created           | A file is written                       |
| **Both changed**                | **Conflict — see below**                |
| The note is deleted in the app  | The file is deleted                     |
| The file is deleted in Obsidian | **The note is archived, not destroyed** |

Writes are **atomic**: every file is written to a temporary name in the same
directory and renamed over the target. Obsidian's file watcher, a sync client
uploading, or a power cut mid-write can never see half a note.

### Deletion is not symmetric, on purpose

Deleting a **note in the app** deletes the file. Deleting a **file in the
vault** archives the note — recoverable — rather than destroying it.

That asymmetry is deliberate. Sync clients and phones delete files by accident
far more often than people delete decisions on purpose, and an archived note
can be brought back while a deleted one cannot. If the app has edits the vault
never saw, the file is simply rewritten instead: its copy was strictly older
than what was lost.

---

## Conflicts

When the same note was edited in **both** places between syncs:

1. The app's version keeps the original filename. The app is the system of
   record, and that rule has to be fixed for the outcome to be predictable.
2. **Your file's bytes are written, unaltered, to `Conflicts/`** as
   `<name> (from Obsidian 2026-08-11T14-30-00).md`.
3. Nothing is merged.

Nothing is merged because a wrong three-way merge of a decision log is worse
than two files sitting next to each other — it produces a document that reads
as though someone decided it, which nobody did. And nothing is discarded,
because that is the one outcome there is no recovering from.

Both copies are in the vault, so Obsidian shows them side by side. Reconcile by
hand, then delete the conflict copy.

If you would rather the vault won, copy the conflict file's content over the
original in Obsidian; the next sync sees the file as changed and takes it.

---

## Opening the vault in Obsidian

### Desktop

1. Install Obsidian from <https://obsidian.md>.
2. **Open folder as vault**, and pick the vault root.
3. That is all. No plugins are required.

Recommended, not required:

- **Tasks** — makes the checkboxes queryable (`not done due before tomorrow`).
- **Dataview** — tables over the frontmatter, e.g. every decision this quarter.

### Mobile

The vault is on your box, so the phone needs a way to reach it. In order of
how well they work:

1. **A file-sync tool you already run** — Syncthing, Resilio, or your NAS's
   own client — pointed at the vault folder. Obsidian mobile then opens the
   synced copy. This is the option that works offline.
2. **Obsidian Sync**, Obsidian's paid service. Note that this puts a copy of
   your notes in their cloud; it is end-to-end encrypted, but it is a decision
   worth making on purpose given the rest of this product's posture.
3. **Tailscale plus a file browser app**, for occasional access rather than
   day-to-day editing.

Whichever you choose, the conflict rules above still apply — a phone edit and
an app edit between syncs produce a conflict copy, not a lost note.

> **Do not point two different sync tools at the same vault.** They will fight,
> and while nothing here loses data, you will spend an evening in
> `Conflicts/`.

---

## Backups

The vault is inside the backup scope only if it lives where the backup job can
see it. Set `VAULT_ROOT` to a path on the volume covered by
[the 3-2-1 backups](backups.md) — the notes are not in Postgres, so the
database dump does not contain them.

The vault is plain text, so it also works extremely well with `git` if you want
per-note history beyond what the app keeps. Initialise a repository in the
vault root and commit on a schedule; nothing in the sync is disturbed by a
`.git` folder.

---

## When something looks wrong

**A note appeared in `Conflicts/`** — expected, and it means nothing was lost.
Compare the two, keep what you want, delete the copy.

**A note I deleted in Obsidian came back** — the app had edits the vault had
not seen, so it restored the file rather than lose them. Delete it in the app
instead.

**A note I deleted in Obsidian is gone from the app too** — it was archived,
not destroyed. Unarchive it in the app.

**Files are not appearing** — check `VAULT_ROOT` points where you think, and
that the note is not archived. Only the six managed folders are written.

**Everything shows as changed on every sync** — something is rewriting the
files. A sync client that normalises line endings or strips trailing newlines
will do this; exclude the vault from it, or let it be the only thing syncing
the folder.

---

## Related

[Notes and Kanban](modules/notes.md) · [Backups](backups.md) ·
[Data model](data-model.md) · [Threat model](threat-model.md)

---

## The notes interface

`/dashboard/notes` — a list beside an editor, with capture in a single field
at the top. Everything else about a note is added afterwards, which is the
same capture-first shape the task inbox uses and for the same reason: the
moment you need to write something down is never the moment you have time to
classify it.

### Decision and reasoning are sibling fields

Two boxes of the same size, side by side, with equal labels. The product now
says this in three places — the generated `is_complete_decision` column, the
two `##` headings in the Markdown, and the editor itself.

**A decision saves without its reasoning.** You capture the decision in the
meeting and write down why afterwards; refusing the save would mean losing the
decision entirely. Incomplete is a marked state — a banner in the editor
naming what is missing, and a warning glyph in the list so the gaps are
findable without opening every note.

### Links resolve when the page arrives

Typing `[[` opens a menu of the notes that exist. It never refuses a title
that doesn't: linking a page before writing it is how Obsidian works and how
thinking works, and the unresolved link is itself information — a note you
have decided you owe yourself. Writing that page resolves every link that was
waiting for it.

Links are **rebuilt from the note's prose on every save** rather than tracked
incrementally. The text is what round-trips to the vault and what a person
edits in Obsidian; an index that can drift from it is worse than no index.

Deleting a note leaves inbound links **unresolved rather than removing them**,
because the prose still says `[[Whatever]]` and an index that disagrees with
the file is the one state worth avoiding.

### Turning it on

Point `DASHBOARD_VAULT_PATH` at the folder you open in Obsidian and restart:

```dotenv
DASHBOARD_VAULT_PATH=/mnt/c/Users/doug/Vault
```

The scheduler reconciles it every fifteen minutes; `POST /api/vault/sync` does
it now. **Unset is a supported configuration** — notes live in Postgres, the
job answers `configured: false`, and nothing touches the disk.

### Renaming a note

A note's filename comes from its title, so renaming one moves its file. A move
is a delete and a create, and doing them in the wrong order against a file
that has been edited in Obsidian would throw the edit away. So the move is
only performed when the old path has nothing outstanding: if the file has
unread changes, they are taken first and the rename waits for the next pass.
One extra pass is a much better cost than one lost edit.

### Two notes with the same title

"Weekly sync" is not a unique name, and the database's unique index on
`vault_path` would reject the second. The second file is suffixed — `Weekly
sync 2.md` — which is what Obsidian itself does.
