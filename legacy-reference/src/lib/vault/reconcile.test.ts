import { describe, expect, it } from "vitest";

import {
  conflictPathFor,
  describeAction,
  hashContent,
  nextSyncedState,
  reconcile,
  type FileState,
  type NoteState,
  type SyncedState,
} from "./reconcile";

const NOW = new Date("2026-08-11T14:30:00.000Z");

const APP_CONTENT =
  "---\ntype: decision\ntitle: T\n---\n\n# T\n\n## Decision\n\nA\n";
const FILE_EDIT =
  "---\ntype: decision\ntitle: T\n---\n\n# T\n\n## Decision\n\nB\n";

const synced = (over: Partial<SyncedState> = {}): SyncedState => ({
  path: "Decisions/T.md",
  syncedHash: hashContent(APP_CONTENT),
  syncedVersion: 1,
  ...over,
});

const file = (content = APP_CONTENT): FileState => ({
  path: "Decisions/T.md",
  content,
});

const note = (over: Partial<NoteState> = {}): NoteState => ({
  path: "Decisions/T.md",
  content: APP_CONTENT,
  version: 1,
  ...over,
});

describe("hashContent", () => {
  it("is stable and content-addressed", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
    expect(hashContent("abc")).toHaveLength(64);
  });

  it("ignores line-ending differences", () => {
    // A vault synced through Windows and back must not look edited.
    expect(hashContent("a\r\nb")).toBe(hashContent("a\nb"));
  });
});

describe("nothing to do", () => {
  it("when neither side has anything", () => {
    expect(reconcile(null, null, null, NOW)).toMatchObject({ type: "none" });
  });

  it("when both sides are identical and unchanged", () => {
    expect(reconcile(synced(), file(), note(), NOW)).toMatchObject({
      type: "none",
      reason: "unchanged",
    });
  });

  it("when the app version moved but the rendering is byte-identical", () => {
    // Writing identical bytes would churn the mtime and make the next pass
    // think the file had moved.
    expect(
      reconcile(synced(), file(), note({ version: 7 }), NOW),
    ).toMatchObject({ type: "none" });
  });

  it("when both changed but happen to agree", () => {
    expect(
      reconcile(
        synced({ syncedHash: hashContent("older") }),
        file(FILE_EDIT),
        note({ content: FILE_EDIT, version: 9 }),
        NOW,
      ),
    ).toMatchObject({ type: "none" });
  });
});

describe("one side changed", () => {
  it("writes the file when the app changed", () => {
    const action = reconcile(
      synced(),
      file(),
      note({ content: FILE_EDIT, version: 2 }),
      NOW,
    );

    expect(action).toMatchObject({
      type: "write_file",
      path: "Decisions/T.md",
      content: FILE_EDIT,
      reason: "app_changed",
    });
  });

  it("takes the file's content when the vault changed", () => {
    const action = reconcile(synced(), file(FILE_EDIT), note(), NOW);

    expect(action).toMatchObject({
      type: "update_app",
      content: FILE_EDIT,
      reason: "file_changed",
    });
  });

  it("imports a file it has never seen", () => {
    expect(reconcile(null, file(FILE_EDIT), null, NOW)).toMatchObject({
      type: "create_note",
      reason: "new_in_vault",
    });
  });

  it("writes out a note that has never been synced", () => {
    expect(reconcile(null, null, note(), NOW)).toMatchObject({
      type: "write_file",
      reason: "new_in_app",
    });
  });

  it("does not write an archived note to the vault", () => {
    expect(
      reconcile(null, null, note({ isArchived: true }), NOW),
    ).toMatchObject({ type: "none" });
  });
});

describe("conflicts", () => {
  it("preserves both sides when each changed", () => {
    const action = reconcile(
      synced(),
      file(FILE_EDIT),
      note({ content: "---\ntitle: T\n---\n\nApp version\n", version: 2 }),
      NOW,
    );

    expect(action.type).toBe("conflict");
    if (action.type !== "conflict") return;

    // The app is the system of record, so it keeps the canonical path…
    expect(action.path).toBe("Decisions/T.md");
    expect(action.content).toContain("App version");
    // …and the vault's bytes are preserved, unaltered, beside it.
    expect(action.conflictContent).toBe(FILE_EDIT);
    expect(action.conflictPath).toBe(
      "Conflicts/T (from Obsidian 2026-08-11T14-30-00).md",
    );
  });

  it("never merges", () => {
    // A wrong merge of a decision log is worse than two files.
    const action = reconcile(
      synced(),
      file("file side"),
      note({ content: "app side", version: 2 }),
      NOW,
    );

    if (action.type !== "conflict") throw new Error("expected a conflict");
    expect(action.content).toBe("app side");
    expect(action.conflictContent).toBe("file side");
    expect(action.content).not.toContain("file side");
  });

  it("treats divergence with no synced record as a conflict, not a guess", () => {
    // Without the third value there is no way to know which side moved, and
    // guessing is how an edit disappears.
    const action = reconcile(
      { path: "Decisions/T.md", syncedHash: null, syncedVersion: null },
      file(FILE_EDIT),
      note(),
      NOW,
    );

    expect(action.type).toBe("conflict");
  });

  it("does not invent a conflict when there is no synced record but both agree", () => {
    expect(
      reconcile(
        { path: "Decisions/T.md", syncedHash: null, syncedVersion: null },
        file(),
        note(),
        NOW,
      ),
    ).toMatchObject({ type: "none" });
  });
});

describe("deletion is not symmetric", () => {
  it("deleting the note removes the file", () => {
    expect(reconcile(synced(), file(), null, NOW)).toMatchObject({
      type: "delete_file",
      reason: "deleted_in_app",
    });
  });

  it("deleting the file archives the note rather than destroying it", () => {
    // Sync clients and phones delete files by accident far more often than
    // people delete decisions on purpose.
    expect(reconcile(synced(), null, note(), NOW)).toMatchObject({
      type: "archive_note",
      reason: "deleted_in_vault",
    });
  });

  it("restores the file when the app has edits the vault never saw", () => {
    // The app's copy is strictly newer than whatever was deleted.
    expect(reconcile(synced(), null, note({ version: 5 }), NOW)).toMatchObject({
      type: "write_file",
      reason: "app_changed",
    });
  });

  it("leaves an archived note with no file alone", () => {
    expect(
      reconcile(synced(), null, note({ isArchived: true }), NOW),
    ).toMatchObject({ type: "none" });
  });
});

describe("no path loses data", () => {
  const cases: {
    name: string;
    synced: SyncedState | null;
    file: FileState | null;
    note: NoteState | null;
  }[] = [
    { name: "both new", synced: null, file: file(FILE_EDIT), note: note() },
    {
      name: "app changed",
      synced: synced(),
      file: file(),
      note: note({ content: FILE_EDIT, version: 2 }),
    },
    {
      name: "file changed",
      synced: synced(),
      file: file(FILE_EDIT),
      note: note(),
    },
    {
      name: "both changed",
      synced: synced(),
      file: file("x"),
      note: note({ content: "y", version: 2 }),
    },
    { name: "file deleted", synced: synced(), file: null, note: note() },
    { name: "note deleted", synced: synced(), file: file(), note: null },
    { name: "unseen file", synced: null, file: file(), note: null },
    { name: "unwritten note", synced: null, file: null, note: note() },
  ];

  it.each(cases)(
    "$name: every action either does nothing or keeps both sides",
    ({ synced: s, file: f, note: n }) => {
      const action = reconcile(s, f, n, NOW);

      // The only action that discards content is delete_file, and it is
      // reachable exclusively when the note is already gone from the app —
      // i.e. the owner deleted it on purpose, in the system of record.
      if (action.type === "delete_file") {
        expect(n).toBeNull();
        return;
      }

      // archive_note is recoverable by definition.
      if (action.type === "conflict") {
        expect(action.conflictContent).toBe(f?.content);
        expect(action.content).toBe(n?.content);
      }

      expect(action.type).not.toBe("merge");
    },
  );

  it("is deterministic — the same inputs give the same answer", () => {
    const args = [
      synced(),
      file(FILE_EDIT),
      note({ content: "z", version: 3 }),
    ] as const;

    expect(reconcile(...args, NOW)).toEqual(reconcile(...args, NOW));
  });
});

describe("conflictPathFor", () => {
  it("files conflicts in their own folder, named for where and when", () => {
    expect(conflictPathFor("Decisions/2026-08-11 Vendor renewal.md", NOW)).toBe(
      "Conflicts/2026-08-11 Vendor renewal (from Obsidian 2026-08-11T14-30-00).md",
    );
  });

  it("copes with a path that has no folder", () => {
    expect(conflictPathFor("Scratch.md", NOW)).toContain(
      "Conflicts/Scratch (from",
    );
  });
});

describe("nextSyncedState", () => {
  it("records the hash of what was written", () => {
    const action = reconcile(
      synced(),
      file(),
      note({ content: FILE_EDIT, version: 2 }),
      NOW,
    );
    const next = nextSyncedState(
      action,
      note({ content: FILE_EDIT, version: 2 }),
      file(),
    );

    expect(next.hash).toBe(hashContent(FILE_EDIT));
    expect(next.version).toBe(2);
    expect(next.state).toBe("synced");
  });

  it("marks a conflict as such rather than as synced", () => {
    const action = reconcile(
      synced(),
      file("a"),
      note({ content: "b", version: 2 }),
      NOW,
    );
    expect(nextSyncedState(action, note({ version: 2 }), file("a")).state).toBe(
      "conflict",
    );
  });

  it("does not claim a version that does not exist yet when importing", () => {
    const action = reconcile(null, file(FILE_EDIT), null, NOW);
    expect(nextSyncedState(action, null, file(FILE_EDIT)).version).toBeNull();
  });

  it("clears the record when the file goes away", () => {
    const action = reconcile(synced(), null, note(), NOW);
    expect(nextSyncedState(action, note(), null)).toMatchObject({
      hash: null,
      state: "missing",
    });
  });
});

describe("describeAction", () => {
  it("says something useful for every action", () => {
    const actions = [
      reconcile(synced(), file(), note(), NOW),
      reconcile(
        synced(),
        file(),
        note({ content: FILE_EDIT, version: 2 }),
        NOW,
      ),
      reconcile(synced(), file(FILE_EDIT), note(), NOW),
      reconcile(null, file(), null, NOW),
      reconcile(synced(), file(), null, NOW),
      reconcile(synced(), null, note(), NOW),
      reconcile(synced(), file("a"), note({ content: "b", version: 2 }), NOW),
    ];

    for (const action of actions) {
      expect(describeAction(action).length, action.type).toBeGreaterThan(5);
    }
  });
});
