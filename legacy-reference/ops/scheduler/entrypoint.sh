#!/bin/sh
#
# The clock.
#
# Three jobs, one mechanism:
#
#   digests    hourly     "is it 07:00 for anyone yet?"
#   vault      quarterly  reconcile notes with the Obsidian vault on disk
#   refresh    quarterly  re-fetch external references that have gone stale
#
# ── Why a sidecar and not pg_cron ────────────────────────────────────────
# pg_cron is an extension, and a stock Postgres does not have it — including
# the container the integration tests run against. The digest schedule was
# therefore installed only where the extension happened to exist, and needed
# `alter database ... set app.digest_endpoint` by hand on top. A container that
# runs cron is nine lines and works everywhere.
#
# It also puts the schedule next to the thing being scheduled. `docker compose
# logs scheduler` shows every firing and every failure, which is not true of a
# job living inside the database.
#
# pg_cron still works if it is present — the migration installs the digest
# schedule when it can. Running both is harmless: every job claims its period
# before doing anything, so a double firing is a no-op, by design.
#
# Passing any argument runs that command once instead of scheduling:
#
#   docker compose exec scheduler run-job.sh digests /api/digests/run
#   docker compose exec scheduler run-job.sh vault /api/vault/sync

set -eu

if [ $# -gt 0 ]; then
	exec "$@"
fi

DIGEST_CRON="${DIGEST_CRON_SCHEDULE:-5 * * * *}"
VAULT_CRON="${VAULT_CRON_SCHEDULE:-*/15 * * * *}"
REFRESH_CRON="${REFRESH_CRON_SCHEDULE:-*/15 * * * *}"
MAIL_CRON="${MAIL_CRON_SCHEDULE:-*/10 * * * *}"

: "${DASHBOARD_URL:?DASHBOARD_URL is not set — the scheduler has nothing to call}"

if [ -z "${DASHBOARD_CRON_TOKEN:-${DIGEST_CRON_TOKEN:-}}" ]; then
	echo "scheduler: no DASHBOARD_CRON_TOKEN set." >&2
	echo "scheduler: every job would be refused with 401. See docs/scheduler.md." >&2
	exit 1
fi

mkdir -p /etc/crontabs

# Cron runs with almost no environment, so anything the jobs need has to be
# written into the crontab itself.
{
	for name in DASHBOARD_URL DASHBOARD_CRON_TOKEN DIGEST_CRON_TOKEN JOB_TIMEOUT TZ
	do
		value="$(eval "printf '%s' \"\${$name:-}\"")"
		[ -n "$value" ] && printf '%s=%s\n' "$name" "$value"
	done

	printf '%s /usr/local/bin/run-job.sh digests /api/digests/run >> /proc/1/fd/1 2>&1\n' "$DIGEST_CRON"
	printf '%s /usr/local/bin/run-job.sh vault /api/vault/sync >> /proc/1/fd/1 2>&1\n' "$VAULT_CRON"
	printf '%s /usr/local/bin/run-job.sh refresh /api/connectors/refresh >> /proc/1/fd/1 2>&1\n' "$REFRESH_CRON"
	printf '%s /usr/local/bin/run-job.sh mail /api/mail/sync >> /proc/1/fd/1 2>&1\n' "$MAIL_CRON"
} > /etc/crontabs/root

chmod 600 /etc/crontabs/root

echo "target:          $DASHBOARD_URL"
echo "digests:         $DIGEST_CRON"
echo "vault sync:      $VAULT_CRON"
echo "context refresh: $REFRESH_CRON"
echo "mail sync:       $MAIL_CRON"

exec crond -f -l 8
