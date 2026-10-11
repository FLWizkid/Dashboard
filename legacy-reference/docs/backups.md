# Backups

The rule this follows is 3-2-1: **three** copies, on **two** kinds of media,
**one** of them off-site. It is worth being precise about what counts, because
the common failure is believing you have three when you have one.

| Copy | What                                    | Where                                        | Encrypted                   |
| ---- | --------------------------------------- | -------------------------------------------- | --------------------------- |
| 1    | The live database                       | `db-data` volume on the box                  | At rest, by BitLocker       |
| 2    | Nightly `pg_dump`                       | `ops/backups/` on the box                    | At rest, by BitLocker       |
| 3    | The same dump on a **different device** | `BACKUP_SECONDARY_PATH` — second disk or NAS | At rest, if you encrypt it  |
| 3′   | The same dump, off-site                 | An `rclone` remote                           | **`age`, before it leaves** |

A second folder on the same disk is not a second copy. A copy on the same
machine is not off-site. The scripts will not pretend otherwise: every run
prints what it actually achieved, and says **"NOT yet a 3-2-1 backup"** until
all three are real.

---

## How it runs

The `backup` service is a small container beside the database. It has no
schedule of its own beyond a cron table written at start-up:

| Job               | Default       | Variable      |
| ----------------- | ------------- | ------------- |
| Backup            | 02:00 daily   | `BACKUP_CRON` |
| **Restore drill** | 03:30 Sundays | `DRILL_CRON`  |

The drill is not optional decoration. A backup nobody has restored is a
hypothesis; the drill is what makes it a fact.

---

## What one backup run does

1. **Dumps** with `pg_dump --format=custom`, writing to `.part` first so an
   interrupted run cannot leave something that looks finished.
2. **Verifies** by reading the archive's table of contents back with
   `pg_restore --list`, and fails if it contains no table data. A truncated
   dump is caught now, not during a recovery.
3. **Checksums** it into a `.sha256` beside the archive.
4. **Copies** to the second device and re-checksums there. A copy that does
   not match is deleted rather than counted.
5. **Encrypts** with `age` to your public key, checks the result really
   carries an age header, and only then uploads with `rclone`.
6. **Prunes** on a grandfather-father-son schedule — and only after a
   successful run, so a broken backup can never delete the last good one.

Defaults: 14 daily, 8 weekly, 24 monthly. Twenty-four months matches the
product's retention default.

---

## What the drill checks

`restore-drill.sh` restores the newest archive into a throwaway database and
then asks whether what came back is actually usable:

- The newest backup is **less than 48 hours old** — a perfectly restorable
  backup from three weeks ago means the schedule stopped running.
- `pg_restore` completes with `--exit-on-error`.
- `tasks`, `activity_categories`, `task_links` and `profiles` all exist.
- **Row Level Security is still enabled on every one of them**, and the
  policies came back. A restore that silently dropped RLS would look fine and
  be a breach waiting for the next connection.
- `tasks.is_ready` is still a **generated** column, so the ready rule survived.
- At least the eight seeded categories are present.
- The restored task count is consistent with the live database — a backup
  that restores an empty schema cannot pass.

Then it drops the throwaway database. It never touches the live one.

---

## Setting up the off-site copy

Two things, once.

### 1. An age key pair

Generate it **somewhere other than the box** — a machine whose loss is not the
same event as losing the box.

```bash
age-keygen -o dashboard-backup.key
# Public key: age1qz...
```

- Put the **public** key in `.env` as `BACKUP_AGE_RECIPIENT`. That is all the
  box needs: it can encrypt, and it cannot decrypt.
- Store the **private** key in your password manager. Not on the box.

> A backup you cannot decrypt is not a backup. If both the box and the private
> key are lost in the same event, copy 3 is gone.

### 2. An rclone remote

```powershell
docker compose run --rm backup rclone config
```

Follow the prompts to create a remote — Backblaze B2, S3, Google Drive,
whatever you use. The config is written to `ops/backup/rclone/rclone.conf`,
which is git-ignored.

Then set both values in `.env` and restart the sidecar:

```
BACKUP_AGE_RECIPIENT=age1qz...
BACKUP_RCLONE_REMOTE=offsite:cio-dashboard-backups
```

```powershell
docker compose up -d backup
docker compose exec backup backup.sh      # confirm it says 1 off-site
```

---

## Restoring

### Prove a backup is good (safe, no side effects)

```powershell
docker compose exec backup restore-drill.sh
```

### Restore into a scratch database to look around

```powershell
docker compose exec backup restore.sh --list
docker compose exec backup restore.sh --into scratch
docker compose exec db psql -U postgres -d scratch -c "select count(*) from tasks"
```

### Restore over the live database

The one genuinely destructive operation here. It requires `--force`, and it
takes a safety dump of the current database before touching anything.

```powershell
docker compose stop app
docker compose exec backup restore.sh --into postgres --force
docker compose start app
```

### Restore from the off-site copy

The box cannot decrypt it — that is the point. On the machine holding the
private key:

```bash
rclone copy offsite:cio-dashboard-backups/cio-dashboard-20260809T020000Z.dump.age .
age --decrypt -i dashboard-backup.key -o restore.dump cio-dashboard-20260809T020000Z.dump.age
```

Then copy `restore.dump` into `ops/backups/` on the box and use
`restore.sh --file`.

---

## Rebuilding from nothing

If the box is gone entirely, in order:

1. New machine: steps 2–7 of the [runbook](runbook-windows.md).
2. Restore `JWT_SECRET`, `POSTGRES_PASSWORD` and the API keys from your
   password manager into `.env`, rather than generating new ones — the tokens
   in the backup were signed with the old secret.
3. Fetch and decrypt the newest off-site archive.
4. `restore.sh --into postgres --force`.
5. Re-apply the migrations. They are idempotent, so this closes any gap
   between the backup's schema and the current code.
6. Reissue the certificate and start the stack.
7. Run the drill. You have just discovered whether all of the above is true.

---

## When something is wrong

**"NOT yet a 3-2-1 backup"** — expected until both off-site settings are set.
The line above it says which of the three you have.

**Secondary copy warning** — `BACKUP_SECONDARY_PATH` is not mounted or not
writable. A NAS that is asleep or unauthenticated is the usual cause.

**`rclone upload failed`** — check the remote:
`docker compose run --rm backup rclone lsd <remote>:`.

**`DRILL FAILED: pg_restore could not restore this archive`** — treat as an
incident. Run the drill against the previous archive
(`restore-drill.sh --file ...`) to find out how far back the damage goes.

**Backups are growing faster than expected** — from P2, mail bodies and
attachments dominate. Reduce `KEEP_DAILY` before reducing `KEEP_MONTHLY`;
the monthly copies are the ones that matter for retention.

---

## Related

[Runbook](runbook-windows.md) · [Threat model](threat-model.md) ·
[Data model](data-model.md)
