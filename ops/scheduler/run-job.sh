#!/bin/sh
#
# Calls one scheduled endpoint and reports what happened.
#
#   run-job.sh digests /api/digests/run
#
# ── Why this is not one line of curl in the crontab ──────────────────────
# Because a scheduler whose failures are invisible is worse than no scheduler:
# you believe the work is happening. Three things have to be true and none of
# them is curl's default:
#
#   1. **A non-2xx is a failure and says so.** `curl` exits 0 on a 500 unless
#      told otherwise, so the log would fill with successful-looking runs.
#   2. **The body is shown on failure.** The endpoints answer 503 with the
#      reason — "more than one account exists", "SUPABASE_SERVICE_ROLE_KEY is
#      not set" — and that sentence is the whole point of reading the log.
#   3. **The token never appears in the log**, including in an error. It is
#      passed via a header file rather than on the command line, so it is not
#      in the process list either.

set -eu

name="$1"
path="$2"

base="${DASHBOARD_URL:?DASHBOARD_URL is not set}"
token="${DASHBOARD_CRON_TOKEN:-${DIGEST_CRON_TOKEN:-}}"

if [ -z "$token" ]; then
	echo "[$name] no token configured; refusing to call $path" >&2
	echo "[$name] set DASHBOARD_CRON_TOKEN — see docs/scheduler.md" >&2
	exit 1
fi

# A header file, not `-H` on the command line: arguments are visible in the
# container's process list to anything that can read /proc.
headers="$(mktemp)"
trap 'rm -f "$headers" "$body"' EXIT
printf 'authorization: Bearer %s\n' "$token" > "$headers"

body="$(mktemp)"

status="$(
	curl --silent --show-error \
	     --max-time "${JOB_TIMEOUT:-300}" \
	     --header @"$headers" \
	     --header 'content-type: application/json' \
	     --output "$body" \
	     --write-out '%{http_code}' \
	     --request POST \
	     "${base}${path}" \
	|| echo 000
)"

case "$status" in
	2??)
		echo "[$name] ok $status $(head -c 400 "$body")"
		;;
	000)
		# Almost always the app still starting, or a restart mid-call. Worth a
		# line, not worth alarm: the next firing will pick the work up.
		echo "[$name] unreachable — $base" >&2
		exit 1
		;;
	*)
		echo "[$name] FAILED $status $(head -c 400 "$body")" >&2
		exit 1
		;;
esac
