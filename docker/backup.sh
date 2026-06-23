#!/usr/bin/env bash
#
# Nightly MongoDB backup for identity-service (ADR-0007, ADR-0008). The live database is the system of
# record; this captures a point-in-time snapshot (tenants, clients, users, issued tokens, lockout
# counters, key history, audit log) for disaster recovery.
#
# Backups are PLAINTEXT (ADR-0008, superseding the age/SOPS scheme of ADR-0006): they are written to a
# controlled, off-container path (default /mnt/backup/identity-service) whose access control is the
# protection. No SOPS, no age key.
#
#   backup.sh backup            # dump + store + prune (the nightly action)
#   backup.sh restore <file>    # mongorestore a snapshot (with confirmation; DROPS existing collections)
#
# Runs on the ds1 HOST (where `docker` reaches the daemon). Schedule from the host crontab, e.g. 02:30:
#   30 2 * * *  /home/<user>/identity-service/docker/backup.sh backup >> ~/is-backup.log 2>&1
#
set -euo pipefail

MONGO_CONTAINER="${MONGO_CONTAINER:-identity-service-mongo}"
DB="${MONGO_DB_NAME:-identity-service}"
BACKUP_DIR="${BACKUP_DIR:-/mnt/backup/identity-service}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

stamp() { date -u +%Y%m%d-%H%M%S; }

case "${1:-}" in
  backup)
    mkdir -p "$BACKUP_DIR"
    out="$BACKUP_DIR/${DB}-$(stamp).archive.gz"
    echo "==> Dumping '$DB' from '$MONGO_CONTAINER' → $out"
    docker exec "$MONGO_CONTAINER" sh -c "mongodump --db='$DB' --archive --gzip" > "$out"
    echo "    wrote $(du -h "$out" | cut -f1)"

    echo "==> Pruning snapshots older than ${RETENTION_DAYS}d in $BACKUP_DIR"
    find "$BACKUP_DIR" -maxdepth 1 -name "${DB}-*.archive.gz" -type f -mtime "+${RETENTION_DAYS}" -print -delete || true
    echo "    done."
    ;;

  restore)
    file="${2:-}"
    [ -f "$file" ] || { echo "usage: $0 restore <snapshot.archive.gz>"; exit 2; }
    echo "==> Restoring $file into '$DB' on '$MONGO_CONTAINER' (existing collections will be DROPPED)"
    read -r -p "    Confirm restore? [type 'yes'] " ans; [ "$ans" = "yes" ] || { echo "    aborted."; exit 1; }
    docker exec -i "$MONGO_CONTAINER" sh -c "mongorestore --db='$DB' --archive --gzip --drop" < "$file"
    echo "    restore complete."
    ;;

  *) echo "usage: $0 {backup|restore <file>}"; exit 2 ;;
esac
