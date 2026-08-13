# Restore drill — evidence

A backup nobody has restored is a hypothesis. This is the transcript of an
actual run, not a description of one.

Performed **2026-08-10** against a database built by applying every migration
in `supabase/migrations/` in order, then seeding one owner, the eight default
activity categories and 25 tasks. Both legs of the drill were run: the local
archive, and — for the first time — the **encrypted off-site copy**.

Re-run it yourself with the commands in [§ Reproducing](#reproducing).

---

## 1. The backup run

```
2026-08-10T05:51:59Z  dumping drill_live from /tmp
2026-08-10T05:52:04Z  wrote cio-dashboard-20260810T055159Z.dump (168K, 25 tables)
2026-08-10T05:52:05Z  copied to secondary device
2026-08-10T05:52:05Z  uploaded cio-dashboard-20260810T055159Z.dump.age to …/offsite
2026-08-10T05:52:06Z  3-2-1 status: 4 copies, 2 media, 1 off-site
2026-08-10T05:52:06Z  backup complete
```

Which is 3-2-1 in full:

| Requirement | What satisfied it                                    |
| ----------- | ---------------------------------------------------- |
| 3 copies    | live database · `backups/` · `secondary/` · off-site |
| 2 media     | `backups/` and `secondary/` on separate devices      |
| 1 off-site  | `cio-dashboard-….dump.age`, encrypted before it left |

The archive is verified before it counts: `pg_restore --list` reads its table
of contents, the run refuses an archive with no table data, and the secondary
copy is compared against a SHA-256 of the original rather than assumed.

## 2. Restoring the local archive

```
2026-08-10T05:54:19Z  restore drill using cio-dashboard-20260810T055159Z.dump
  ok      newest backup is 0h old
  ok      archive restored
  ok      table public.tasks present
  ok      table public.activity_categories present
  ok      table public.task_links present
  ok      table public.profiles present
  ok      row level security enabled on every restored table
  ok      83 RLS policies restored
  ok      tasks.is_ready is still a generated column
  ok      8 activity categories restored
  ok      25 tasks restored
  ok      task counts consistent with live (25 restored / 25 live)
DRILL PASSED — this backup is restorable
```

The checks that matter beyond "it restored":

- **All 83 RLS policies came back.** A restore that silently dropped row level
  security would look completely healthy and be a data breach waiting for the
  next connection.
- **`tasks.is_ready` is still `GENERATED ALWAYS`.** The ready rule lives in the
  schema. A restore that turned it into an ordinary column would leave the
  product running with a rule that no longer applies to anything new.
- **The row counts are compared against the live database.** Without that, a
  backup that restores a perfect but empty schema passes every other check.

## 3. Restoring the off-site copy

This is the leg that rehearses actually losing the box, and it is the one
nothing had ever exercised — the local dumps live on the same disk as the
database they came from.

```
2026-08-10T05:53:58Z  restore drill using cio-dashboard-20260810T055159Z.dump.age
  ok      newest backup is 0h old
  ok      off-site archive decrypted with the recovery key
  ok      archive restored
  …
DRILL PASSED — this backup is restorable
```

Confirmed alongside it:

| Check                             | Result                           |
| --------------------------------- | -------------------------------- |
| Archive carries an `age` header   | `age-encryption.org/v1`          |
| Readable **without** the key      | no — `pg_restore` cannot open it |
| Restores **with** the key         | 25 tasks, 83 policies            |
| Wrong key                         | fails loudly, does not continue  |
| Decrypted plaintext after the run | removed on exit                  |
| Throwaway database after the run  | dropped                          |

## 4. Two bugs the drill found

Neither would have been found by reading the scripts.

**The drill deleted the archive it was about to restore.** Adding off-site
support meant `cleanup` had to remove the decrypted plaintext — but `cleanup`
was also called _before_ the restore, to clear a database left by an
interrupted run. So the pre-run reset deleted the file, and the drill reported
`pg_restore could not restore this archive` about a file it had just removed
itself. The two jobs are now separate functions.

**Killing the wrapper did not stop the server.** Unrelated to backups, found
the same way: `ops/check-csp.mjs` spawned `npx next start` and killed the `npx`
process, leaving the real server holding the port. The next run bound nothing,
silently talked to the _previous_ build, and reported on code that was no
longer on disk. It now kills the process group and refuses to run at all if
something is already answering.

## 5. What this drill does **not** prove

Stated plainly, because a drill that overstates itself is worse than none:

- **It ran on Linux, against a socket-connected Postgres.** The box is Windows
  with Docker Desktop, and the backup container talks to `db:5432` over the
  compose network. The scripts are identical; the environment is not.
- **`rclone` was a stand-in.** A shell script that copies to a local directory
  stood in for the real upload, so what is proven is _encrypt → transfer →
  decrypt → restore_, not that any particular remote is configured correctly.
  The first real run on the box is still the first real run.
- **The off-site key used here was generated for the drill.** Yours is the one
  that matters, and the only way to know it works is to run
  [§ Reproducing](#reproducing) against a real off-site archive with your own
  identity file.
- **No `pg_cron` was present**, so the scheduled path is untested here. The
  self-hosted Supabase image ships it; a stock Postgres does not.

## Reproducing

On the box, from the backup container:

```sh
# Local archive
docker compose exec backup /usr/local/bin/restore-drill.sh

# Off-site archive — run this from a DIFFERENT machine, which is the point
rclone copy "$BACKUP_RCLONE_REMOTE/cio-dashboard-….dump.age" .
BACKUP_IDENTITY=/path/to/age-identity.txt \
  ops/backup/restore-drill.sh --file cio-dashboard-….dump.age
```

Exit status is the verdict, so a scheduled task or a monitor can act on it
without parsing the log.

Do this **quarterly**, and after any change to the key, the remote or the
schema. Record the date here. A drill you did once in August is a drill you
have not done.

| Date       | Leg              | Result | Notes                              |
| ---------- | ---------------- | ------ | ---------------------------------- |
| 2026-08-10 | local + off-site | PASSED | first off-site drill; 2 bugs fixed |
