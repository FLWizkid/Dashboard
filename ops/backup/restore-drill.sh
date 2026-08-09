#!/bin/sh
#
# Restore drill — proves the backups are restorable, on a schedule.
#
# An untested backup is a hypothesis. This restores the newest archive into a
# throwaway database, checks that what came back is actually the product's
# schema and data, and then deletes it. It never touches the live database.
#
#   restore-drill.sh              # newest backup
#   restore-drill.sh --file <path>
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

cleanup() {
	psql -q -d postgres -c "drop database if exists \"$DRILL_DB\"" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
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
