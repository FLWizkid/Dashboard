#!/bin/sh
#
# Restore a backup.
#
#   restore.sh --list
#   restore.sh --into scratch                    # newest backup, new database
#   restore.sh --into scratch --file <path>
#   restore.sh --into postgres --force           # over the live database
#
# Restoring over the live database is the one genuinely destructive thing in
# this repository, so it needs --force and it takes a safety dump first.

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
TARGET=""
FILE=""
FORCE=0

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FAILED: $*"; exit 1; }

usage() {
	sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

while [ $# -gt 0 ]; do
	case "$1" in
		--into)  TARGET="${2:-}"; shift 2 ;;
		--file)  FILE="${2:-}"; shift 2 ;;
		--force) FORCE=1; shift ;;
		--list)
			ls -1t "$BACKUP_DIR"/cio-dashboard-*.dump 2>/dev/null \
			  | while read -r f; do
					printf '%s  %s\n' "$(du -h "$f" | awk '{print $1}')" "$(basename "$f")"
				done
			exit 0
			;;
		-h|--help) usage 0 ;;
		*) log "unknown argument: $1"; usage 1 ;;
	esac
done

[ -n "$TARGET" ] || { log "--into <database> is required"; usage 1; }

# Newest backup unless one was named.
if [ -z "$FILE" ]; then
	FILE="$(ls -1t "$BACKUP_DIR"/cio-dashboard-*.dump 2>/dev/null | head -1 || true)"
	[ -n "$FILE" ] || fail "no backups in $BACKUP_DIR"
fi

[ -f "$FILE" ] || fail "$FILE does not exist"

# An .age file needs the private key, which deliberately does not live on
# this box. Decrypt it wherever that key is kept, then restore the result.
case "$FILE" in
	*.age) fail "$FILE is encrypted. Decrypt it first: age --decrypt -i <key> -o <out>.dump $FILE" ;;
esac

# ── Integrity ─────────────────────────────────────────────────────────────
if [ -f "${FILE}.sha256" ]; then
	if [ "$(sha256sum < "$FILE" | awk '{print $1}')" != "$(cat "${FILE}.sha256")" ]; then
		fail "checksum mismatch — this archive is damaged, do not restore it"
	fi
	log "checksum ok"
else
	log "WARNING: no .sha256 beside this archive; integrity unverified"
fi

pg_restore --list "$FILE" > /dev/null || fail "archive is unreadable"

# ── Guard the live database ───────────────────────────────────────────────
exists="$(psql -tAc "select 1 from pg_database where datname = '$TARGET'" postgres || true)"

if [ "$exists" = "1" ] && [ "$FORCE" -ne 1 ]; then
	fail "database '$TARGET' already exists. Re-run with --force to overwrite it."
fi

if [ "$exists" = "1" ]; then
	safety="${BACKUP_DIR}/pre-restore-${TARGET}-$(date -u +%Y%m%dT%H%M%SZ).dump"
	log "taking a safety dump of '$TARGET' first"
	pg_dump --format=custom --compress=6 --no-owner --no-privileges \
	        --dbname="$TARGET" --file="$safety" \
	  || fail "could not take a safety dump; refusing to overwrite"
	log "safety dump: $safety"

	log "dropping '$TARGET'"
	psql -q -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$TARGET' and pid <> pg_backend_pid()" > /dev/null
	psql -q -d postgres -c "drop database \"$TARGET\""
fi

psql -q -d postgres -c "create database \"$TARGET\""

# ── Restore ───────────────────────────────────────────────────────────────
log "restoring $(basename "$FILE") into '$TARGET'"

# --no-owner because the roles on a recovery box may not match the ones the
# dump was taken from; ownership is re-established by the migrations.
pg_restore --dbname="$TARGET" --no-owner --no-privileges --exit-on-error "$FILE" \
  || fail "pg_restore reported errors"

count="$(psql -tAd "$TARGET" -c "select count(*) from information_schema.tables where table_schema = 'public'")"
log "restored — ${count} tables in public"
log "done"
