#!/bin/sh
#
# One backup run: dump, verify, copy to the second device, encrypt and send
# off-site, then prune.
#
# 3-2-1, made concrete:
#   3 copies  — the live database, /backups, and the off-site remote
#   2 media   — /backups on this disk, /backups-secondary on another device
#   1 offsite — the age-encrypted copy pushed by rclone
#
# The local copies are left unencrypted deliberately: they sit on a
# BitLocker volume, and a restore drill that needs a key kept off the box is
# a restore drill that never runs. Only the copy that leaves is encrypted,
# with a key whose private half never touches this machine.
#
# Every run prints which of the three it actually achieved. A backup system
# that fails quietly is worse than none, because you stop worrying about it.

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
SECONDARY_DIR="${SECONDARY_DIR:-/backups-secondary}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${KEEP_MONTHLY:-24}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="cio-dashboard-${STAMP}"
DUMP="${BACKUP_DIR}/${NAME}.dump"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FAILED: $*"; exit 1; }

copies=1  # the live database
media=0
offsite=0

mkdir -p "$BACKUP_DIR"

# ── 1. Dump ───────────────────────────────────────────────────────────────
log "dumping ${PGDATABASE:-postgres} from ${PGHOST:-db}"

# Custom format: compressed, and pg_restore can pick individual objects out
# of it during a partial recovery. Written to .part first so an interrupted
# run can never leave something that looks like a finished backup.
pg_dump --format=custom --compress=6 --no-owner --no-privileges \
        --file="${DUMP}.part" \
  || fail "pg_dump failed"

mv "${DUMP}.part" "$DUMP"

# ── 2. Verify it is readable ──────────────────────────────────────────────
# Reading the table of contents catches a truncated or corrupt archive now,
# rather than during an actual recovery.
pg_restore --list "$DUMP" > "${DUMP}.toc" || fail "dump is not readable by pg_restore"

tables="$(grep -c 'TABLE DATA' "${DUMP}.toc" || true)"
rm -f "${DUMP}.toc"

[ "${tables:-0}" -gt 0 ] || fail "dump contains no table data"

sha256sum "$DUMP" | awk '{print $1}' > "${DUMP}.sha256"

size="$(du -h "$DUMP" | awk '{print $1}')"
log "wrote $(basename "$DUMP") (${size}, ${tables} tables)"
copies=$((copies + 1))

# ── 3. Second device ──────────────────────────────────────────────────────
if [ -d "$SECONDARY_DIR" ] && [ -w "$SECONDARY_DIR" ]; then
	cp "$DUMP" "${SECONDARY_DIR}/$(basename "$DUMP").part"
	mv "${SECONDARY_DIR}/$(basename "$DUMP").part" "${SECONDARY_DIR}/$(basename "$DUMP")"
	cp "${DUMP}.sha256" "${SECONDARY_DIR}/"

	if [ "$(sha256sum < "${SECONDARY_DIR}/$(basename "$DUMP")" | awk '{print $1}')" \
	   = "$(cat "${DUMP}.sha256")" ]; then
		log "copied to secondary device"
		copies=$((copies + 1))
		media=1
	else
		log "WARNING: secondary copy does not match its checksum — treating as absent"
		rm -f "${SECONDARY_DIR}/$(basename "$DUMP")"
	fi
else
	log "WARNING: ${SECONDARY_DIR} is not writable — no second-device copy"
fi

# ── 4. Off-site, encrypted before it leaves ───────────────────────────────
if [ -n "${BACKUP_RECIPIENT:-}" ] && [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
	encrypted="${BACKUP_DIR}/${NAME}.dump.age"

	age --encrypt --recipient "$BACKUP_RECIPIENT" --output "$encrypted" "$DUMP" \
	  || fail "age encryption failed — nothing sent off-site"

	# Refuse to upload something that isn't actually age-encrypted. The
	# header check is cheap insurance against a future edit that reorders
	# these steps and ships plaintext to a third party.
	head -c 21 "$encrypted" | grep -q 'age-encryption.org' \
	  || fail "encrypted file lacks an age header — refusing to upload"

	if rclone copy "$encrypted" "$BACKUP_RCLONE_REMOTE" --no-traverse; then
		log "uploaded $(basename "$encrypted") to ${BACKUP_RCLONE_REMOTE}"
		copies=$((copies + 1))
		offsite=1
	else
		log "WARNING: rclone upload failed — no off-site copy this run"
	fi

	rm -f "$encrypted"
else
	log "WARNING: off-site copy not configured (BACKUP_AGE_RECIPIENT and BACKUP_RCLONE_REMOTE)"
fi

# ── 5. Prune ──────────────────────────────────────────────────────────────
# Grandfather-father-son: keep the last N dailies, then one per week, then
# one per month. Pruning runs after a successful backup only, so a broken
# run never deletes the last good copy.
prune_dir() {
	dir="$1"
	[ -d "$dir" ] || return 0

	kept_weeks=""
	kept_months=""
	index=0

	# Newest first.
	for file in $(ls -1 "$dir"/cio-dashboard-*.dump 2>/dev/null | sort -r); do
		index=$((index + 1))
		base="$(basename "$file")"
		day="$(echo "$base" | sed -n 's/^cio-dashboard-\([0-9]\{8\}\)T.*/\1/p')"
		[ -n "$day" ] || continue

		if [ "$index" -le "$KEEP_DAILY" ]; then
			continue
		fi

		# %V is the ISO week; %Y%m the month.
		week="$(date -u -d "$day" +%G%V 2>/dev/null || echo "")"
		month="$(echo "$day" | cut -c1-6)"

		if [ -n "$week" ] && [ "$(printf '%s' "$kept_weeks" | tr ' ' '\n' | grep -cx "$week")" -eq 0 ] \
		   && [ "$(printf '%s' "$kept_weeks" | wc -w)" -lt "$KEEP_WEEKLY" ]; then
			kept_weeks="$kept_weeks $week"
			continue
		fi

		if [ "$(printf '%s' "$kept_months" | tr ' ' '\n' | grep -cx "$month")" -eq 0 ] \
		   && [ "$(printf '%s' "$kept_months" | wc -w)" -lt "$KEEP_MONTHLY" ]; then
			kept_months="$kept_months $month"
			continue
		fi

		rm -f "$file" "${file}.sha256"
		log "pruned $(basename "$file") from $(basename "$dir")"
	done
}

prune_dir "$BACKUP_DIR"
prune_dir "$SECONDARY_DIR"

# ── 6. Say where we actually stand ────────────────────────────────────────
log "3-2-1 status: ${copies} copies, $((media + 1)) media, ${offsite} off-site"

if [ "$media" -eq 0 ] || [ "$offsite" -eq 0 ]; then
	log "NOT yet a 3-2-1 backup. See docs/backups.md."
	exit 0
fi

log "backup complete"
