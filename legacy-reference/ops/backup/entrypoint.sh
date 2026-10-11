#!/bin/sh
#
# Runs the backup schedule.
#
# Two jobs: the nightly backup (BACKUP_CRON) and a weekly restore drill. The
# drill is not optional decoration — a backup nobody has restored is a guess,
# and this is the thing that turns it into a fact.
#
# Passing any argument runs that command once instead of scheduling, which is
# how you take a manual backup:
#
#   docker compose exec backup backup.sh
#   docker compose exec backup restore-drill.sh
#   docker compose exec backup restore.sh --list

set -eu

if [ $# -gt 0 ]; then
	exec "$@"
fi

BACKUP_CRON="${BACKUP_CRON:-0 2 * * *}"
DRILL_CRON="${DRILL_CRON:-30 3 * * 0}"

mkdir -p /etc/crontabs

# Cron runs with almost no environment, so the connection settings and the
# schedule's own knobs have to be written into the crontab itself.
{
	for name in PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE \
	            BACKUP_DIR SECONDARY_DIR BACKUP_RECIPIENT BACKUP_RCLONE_REMOTE \
	            RCLONE_CONFIG KEEP_DAILY KEEP_WEEKLY KEEP_MONTHLY TZ
	do
		value="$(eval "printf '%s' \"\${$name:-}\"")"
		[ -n "$value" ] && printf '%s=%s\n' "$name" "$value"
	done

	printf '%s /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1\n' "$BACKUP_CRON"
	printf '%s /usr/local/bin/restore-drill.sh >> /proc/1/fd/1 2>&1\n' "$DRILL_CRON"
} > /etc/crontabs/root

echo "backup schedule:       $BACKUP_CRON"
echo "restore drill:         $DRILL_CRON"
echo "off-site configured:   $([ -n "${BACKUP_RECIPIENT:-}" ] && [ -n "${BACKUP_RCLONE_REMOTE:-}" ] && echo yes || echo 'NO — see docs/backups.md')"

# -f foreground, -l 8 so the log shows what it started and when.
exec crond -f -l 8
