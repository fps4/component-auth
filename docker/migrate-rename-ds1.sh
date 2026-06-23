#!/usr/bin/env bash
#
# One-time ds1 data migration for the component-auth → identity-service rename (ADR-0007).
#
# The rename changes two things that, together, would orphan the live MongoDB data on the next deploy:
#   1. the compose PROJECT name (component-auth → identity-service), so the named data volume moves
#      from `component-auth_mongo_data` to `identity-service_mongo_data` (a fresh, empty volume); and
#   2. the database name (MONGO_DB_NAME: component-auth → identity-service).
#
# This script does a logical dump of the OLD database and restores it into the NEW mongo container with
# a namespace remap — handling BOTH the volume move and the DB rename in one operation. The old
# container and volume are left untouched as a rollback until you remove them explicitly (see the end).
#
# Run it ON THE ds1 HOST (where `docker` reaches the daemon), as part of the FIRST deploy under the new
# names. Sequence:
#   1. (old stack still up)  ./migrate-rename-ds1.sh dump
#   2. deploy the new stack  (CI deploy-ds1.yml on main, or the manual compose up) — brings up
#                            `identity-service-mongo` with an empty volume
#   3. (new stack up)        ./migrate-rename-ds1.sh restore
#   4. verify, then later    ./migrate-rename-ds1.sh decommission
#
set -euo pipefail

OLD_DB="${OLD_DB:-component-auth}"
NEW_DB="${NEW_DB:-identity-service}"
OLD_MONGO="${OLD_MONGO:-component-auth-mongo}"
NEW_MONGO="${NEW_MONGO:-identity-service-mongo}"
OLD_VOLUME="${OLD_VOLUME:-component-auth_mongo_data}"
ARCHIVE="${ARCHIVE:-./ds1-${OLD_DB}-pre-rename.archive.gz}"

usage() { echo "usage: $0 {dump|restore|verify|decommission}"; exit 2; }
[ $# -eq 1 ] || usage

case "$1" in
  dump)
    echo "==> Dumping '$OLD_DB' from container '$OLD_MONGO' to $ARCHIVE"
    docker exec "$OLD_MONGO" sh -c "mongodump --db='$OLD_DB' --archive --gzip" > "$ARCHIVE"
    echo "    wrote $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1)). Keep this until the migration is verified."
    ;;

  restore)
    [ -f "$ARCHIVE" ] || { echo "::error:: $ARCHIVE not found — run '$0 dump' first"; exit 1; }
    echo "==> Restoring into '$NEW_DB' in container '$NEW_MONGO' (ns remap $OLD_DB.* -> $NEW_DB.*)"
    docker exec -i "$NEW_MONGO" sh -c \
      "mongorestore --archive --gzip --nsFrom='${OLD_DB}.*' --nsTo='${NEW_DB}.*' --drop" < "$ARCHIVE"
    echo "    restore complete. Run '$0 verify' to compare collection counts."
    ;;

  verify)
    echo "==> Comparing collection counts ($OLD_MONGO/$OLD_DB vs $NEW_MONGO/$NEW_DB)"
    js='db.getCollectionNames().sort().forEach(function(c){print(c+"\t"+db.getCollection(c).countDocuments({}))})'
    echo "--- OLD ($OLD_DB) ---"; docker exec "$OLD_MONGO" mongosh "$OLD_DB" --quiet --eval "$js" || true
    echo "--- NEW ($NEW_DB) ---"; docker exec "$NEW_MONGO" mongosh "$NEW_DB" --quiet --eval "$js" || true
    echo "    counts should match. Also sanity-check /health and a token issuance before decommissioning."
    ;;

  decommission)
    echo "==> Removing the old rollback volume '$OLD_VOLUME' and archive (IRREVERSIBLE)"
    read -r -p "    Confirm the migration is verified and you want to delete the old data? [type 'yes'] " ans
    [ "$ans" = "yes" ] || { echo "    aborted."; exit 1; }
    docker volume rm "$OLD_VOLUME" 2>/dev/null && echo "    removed volume $OLD_VOLUME" || echo "    volume $OLD_VOLUME already gone"
    rm -f "$ARCHIVE" && echo "    removed $ARCHIVE"
    ;;

  *) usage ;;
esac
