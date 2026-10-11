# Backup sidecar.
#
# Based on the Postgres image itself so pg_dump is guaranteed to match the
# server major version — a mismatched dump utility is the classic way to
# discover, during a restore, that your backups were never usable.
FROM postgres:15-alpine

# age  — client-side encryption for the off-site copy.
# rclone — moves that copy off the box.
# tzdata — so BACKUP_CRON means what you think at 02:00 local.
RUN apk add --no-cache age rclone tzdata

COPY backup.sh restore.sh restore-drill.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh \
             /usr/local/bin/restore.sh \
             /usr/local/bin/restore-drill.sh \
             /usr/local/bin/entrypoint.sh

ENV BACKUP_DIR=/backups \
    SECONDARY_DIR=/backups-secondary \
    RCLONE_CONFIG=/config/rclone/rclone.conf

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
