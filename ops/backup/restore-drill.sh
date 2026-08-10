#!/bin/sh
#
# Restore drill — proves the backups are restorable, on a schedule.
#
# An untested backup is a hypothesis. This restores the newest archive into a
# throwaway database, checks that what came back is actually the product's
# schema and data, and then deletes it. It never touches the live database.
#
#   restore-drill.sh                        # newest local backup
#   restore-drill.sh --file <path>
#   BACKUP_IDENTITY=key.txt \
#     restore-drill.sh --file <path>.age    # the off-site copy
#
# A `.age` file is decrypted first, which is the drill that actually rehearses
# losing the box — the local dumps live on the same disk as the database.
#
# Exit status is the result, so cron mail or a monitor can act on it.

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DRILL_DB="${DRILL_DB:-restore_drill}"
FILE=""

log()  { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
pass() { log "  ok      $*"; }
fail() { log "  FAILED  $*"; failures=$((failures + 1)); }

failures=0

while [ $# -gt 0 ]; do
	case "$1" in
		--file) FILE="${2:-}"; shift 2 ;;
		*) log "unknown argument: $1"; exit 2 ;;
	esac
done

if [ -z "$FILE" ]; then
	FILE="$(ls -1t "$BACKUP_DIR"/cio-dashboard-*.dump 2>/dev/null | head -1 || true)"
fi

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
	log "DRILL FAILED: no backup to restore from"
	exit 1
fi

log "restore drill using $(basename "$FILE")"

# Age of the archive matters as much as its contents: a perfectly restorable
# backup from three weeks ago means the schedule stopped running.
age_hours=$(( ( $(date -u +%s) - $(date -u -r "$FILE" +%s) ) / 3600 ))
if [ "$age_hours" -gt 48 ]; then
	fail "newest backup is ${age_hours}h old — the schedule is not running"
else
	pass "newest backup is ${age_hours}h old"
fi

DECRYPTED=""

# Two separate jobs, deliberately not one function.
#
# `drop_drill_db` also runs *before* the restore, to clear a database left
# behind by an interrupted run. `cleanup` runs on the way out and additionally
# deletes the decrypted archive — folding the two together meant the pre-run
# reset removed the plaintext dump it was about to restore, and the drill
# reported "pg_restore could not restore this archive" about a file it had
# just deleted itself.
drop_drill_db() {
	psql -q -d postgres -c "drop database if exists \"$DRILL_DB\"" >/dev/null 2>&1 || true
}

cleanup() {
	drop_drill_db
	# Never leave a plaintext copy of an off-site archive lying about.
	[ -n "$DECRYPTED" ] && rm -f "$DECRYPTED"
	return 0
}
trap cleanup EXIT INT TERM

# ── The off-site copy ─────────────────────────────────────────────────────
#
# This is the leg that matters and the one nothing exercised: the local dumps
# are on the same machine as the database, so the only copy that survives the
# box is the encrypted one. It is also the easiest to break silently — rotate
# the age key, forget to update the recipient, and every upload from then on
# is a file nobody alive can open. Nothing about the backup log would say so.
#
#   restore-drill.sh --file /mnt/offsite/cio-dashboard-….dump.age
#
# with BACKUP_IDENTITY pointing at the private key. Run it from a *different*
# machine than the box, because that is the situation being rehearsed.
case "$FILE" in
	*.age)
		if [ -z "${BACKUP_IDENTITY:-}" ]; then
			log "DRILL FAILED: $(basename "$FILE") is encrypted; set BACKUP_IDENTITY"
			exit 1
		fi

		if [ ! -f "$BACKUP_IDENTITY" ]; then
			log "DRILL FAILED: BACKUP_IDENTITY ($BACKUP_IDENTITY) is not a file"
			exit 1
		fi

		DECRYPTED="$(mktemp -t restore-drill.XXXXXX.dump)"

		if ! age --decrypt --identity "$BACKUP_IDENTITY" --output "$DECRYPTED" "$FILE"; then
			log "DRILL FAILED: cannot decrypt — wrong key, or the key has rotated"
			exit 1
		fi

		pass "off-site archive decrypted with the recovery key"
		FILE="$DECRYPTED"
		;;
esac

drop_drill_db
psql -q -d postgres -c "create database \"$DRILL_DB\"" >/dev/null

if ! pg_restore --dbname="$DRILL_DB" --no-owner --no-privileges --exit-on-error "$FILE" >/dev/null 2>&1; then
	log "DRILL FAILED: pg_restore could not restore this archive"
	exit 1
fi
pass "archive restored"

query() { psql -tAd "$DRILL_DB" -c "$1" 2>/dev/null | tr -d ' \n'; }

# ── The schema the product needs ──────────────────────────────────────────
for table in tasks activity_categories task_links profiles; do
	if [ "$(query "select count(*) from information_schema.tables
	                where table_schema = 'public' and table_name = '$table'")" = "1" ]; then
		pass "table public.$table present"
	else
		fail "table public.$table missing"
	fi
done

# ── Row Level Security survived the round trip ────────────────────────────
# A restore that silently dropped RLS would look fine and be a data breach
# waiting for the next connection.
unprotected="$(query "select coalesce(string_agg(relname, ', '), '')
                        from pg_class c
                        join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'public'
                         and c.relkind = 'r'
                         and c.relname in ('tasks','activity_categories','task_links','profiles')
                         and not c.relrowsecurity")"

if [ -z "$unprotected" ]; then
	pass "row level security enabled on every restored table"
else
	fail "row level security missing on: $unprotected"
fi

policies="$(query "select count(*) from pg_policies where schemaname = 'public'")"
if [ "${policies:-0}" -ge 4 ]; then
	pass "${policies} RLS policies restored"
else
	fail "only ${policies:-0} RLS policies restored"
fi

# ── The generated columns still generate ──────────────────────────────────
if [ "$(query "select count(*) from information_schema.columns
                where table_name = 'tasks' and column_name = 'is_ready'
                  and is_generated = 'ALWAYS'")" = "1" ]; then
	pass "tasks.is_ready is still a generated column"
else
	fail "tasks.is_ready is not generated — the ready rule was lost"
fi

# ── Data, not just structure ──────────────────────────────────────────────
categories="$(query "select count(*) from public.activity_categories")"
if [ "${categories:-0}" -ge 8 ]; then
	pass "${categories} activity categories restored"
else
	fail "expected at least 8 activity categories, found ${categories:-0}"
fi

tasks="$(query "select count(*) from public.tasks")"
pass "${tasks:-0} tasks restored"

# Compare against the live database, so a backup that restores an empty
# schema cannot pass.
live_tasks="$(psql -tAc "select count(*) from public.tasks" 2>/dev/null | tr -d ' \n' || echo "")"
if [ -n "$live_tasks" ]; then
	if [ "${tasks:-0}" -ge 0 ] && [ "$live_tasks" -gt 0 ] && [ "${tasks:-0}" -eq 0 ]; then
		fail "live database has ${live_tasks} tasks but the restore has none"
	else
		pass "task counts consistent with live (${tasks:-0} restored / ${live_tasks} live)"
	fi
fi

# ── Verdict ───────────────────────────────────────────────────────────────
if [ "$failures" -eq 0 ]; then
	log "DRILL PASSED — this backup is restorable"
	exit 0
fi

log "DRILL FAILED — ${failures} check(s) failed"
exit 1
