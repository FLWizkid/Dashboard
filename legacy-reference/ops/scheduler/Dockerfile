# Scheduler sidecar.
#
# Alpine plus curl and cron. Deliberately not the application image: this needs
# to be able to run when the app is restarting, and building it from the app's
# 400 MB of runtime would couple the two for no gain.
#
# tzdata so a cron expression means what you think it means at 07:00 local.
FROM alpine:3.20

RUN apk add --no-cache curl tzdata

COPY run-job.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/run-job.sh /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
