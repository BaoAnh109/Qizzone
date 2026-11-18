#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
deploy_dir="$(cd -- "$script_dir/.." && pwd)"
repo_dir="$(cd -- "$deploy_dir/.." && pwd)"
env_file="${QIZZONE_BACKUP_ENV_FILE:-${QIZZONE_PILOT_ENV_FILE:-$deploy_dir/.env.pilot}}"
compose_file="${QIZZONE_BACKUP_COMPOSE_FILE:-$deploy_dir/compose.pilot.yaml}"
project_name="${QIZZONE_BACKUP_PROJECT_NAME:-qizzone-pilot}"
backup_dir="${QIZZONE_BACKUP_DIR:-$deploy_dir/backups}"
media_volume="${QIZZONE_BACKUP_MEDIA_VOLUME:-${QIZZONE_PILOT_MEDIA_VOLUME:-qizzone-pilot_qizzone_pilot_media_data}}"
media_image="${QIZZONE_MEDIA_BACKUP_IMAGE:-postgres:17.12-alpine3.24}"

: "${AGE_RECIPIENT:?Set AGE_RECIPIENT to the backup recipient public key.}"
case "${QIZZONE_BACKUP_REQUIRE_OFFSITE:-0}" in
    0|1) ;;
    *) echo "QIZZONE_BACKUP_REQUIRE_OFFSITE must be 0 or 1." >&2; exit 1 ;;
esac
case "${QIZZONE_BACKUP_DELETE_LOCAL_AFTER_OFFSITE:-0}" in
    0|1) ;;
    *) echo "QIZZONE_BACKUP_DELETE_LOCAL_AFTER_OFFSITE must be 0 or 1." >&2; exit 1 ;;
esac
if [[ "${QIZZONE_BACKUP_REQUIRE_OFFSITE:-0}" == "1" && -z "${QIZZONE_BACKUP_REMOTE:-}" ]]; then
    echo "Offsite backups are required but QIZZONE_BACKUP_REMOTE is empty." >&2
    exit 1
fi
command -v docker >/dev/null 2>&1 || { echo "docker is required." >&2; exit 1; }
command -v age >/dev/null 2>&1 || { echo "age is required." >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required." >&2; exit 1; }
command -v flock >/dev/null 2>&1 || { echo "flock is required to prevent overlapping backup jobs." >&2; exit 1; }
[[ -r "$env_file" ]] || { echo "Compose environment file is not readable." >&2; exit 1; }
docker volume inspect "$media_volume" >/dev/null 2>&1 || {
    echo "Persistent media volume '$media_volume' does not exist; refusing to create an empty backup volume." >&2
    exit 1
}

mkdir -p -- "$backup_dir"
chmod 700 -- "$backup_dir"
exec 9>"$backup_dir/.qizzone-backup.lock"
flock -n 9 || { echo "Another Qizzone backup is already running." >&2; exit 1; }
timestamp="$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM"
backup_file="$backup_dir/qizzone-postgres-$timestamp.dump.age"
media_backup_file="$backup_dir/qizzone-media-$timestamp.tar.age"
[[ ! -e "$backup_file" && ! -e "$backup_file.sha256" &&
    ! -e "$media_backup_file" && ! -e "$media_backup_file.sha256" ]] || {
    echo "Backup output already exists; refusing to overwrite it." >&2
    exit 1
}
partial_db="$(mktemp "$backup_dir/.qizzone-postgres-$timestamp.XXXXXX.partial")"
partial_media="$(mktemp "$backup_dir/.qizzone-media-$timestamp.XXXXXX.partial")"
cleanup_partial() {
    rm -f -- "$partial_db" "$partial_media"
}
trap cleanup_partial EXIT

docker compose \
    --project-directory "$deploy_dir" \
    --env-file "$env_file" \
    --file "$compose_file" \
    --project-name "$project_name" \
    exec --no-TTY postgres \
    sh -eu -c 'exec pg_dump -Fc --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    | age --recipient "$AGE_RECIPIENT" --output "$partial_db"

docker run --rm --network none \
    --volume "$media_volume:/media:ro" \
    --entrypoint tar "$media_image" \
    -cf - -C /media . \
    | age --recipient "$AGE_RECIPIENT" --output "$partial_media"

chmod 600 -- "$partial_db" "$partial_media"
db_hash="$(sha256sum "$partial_db" | awk '{ print $1 }')"
media_hash="$(sha256sum "$partial_media" | awk '{ print $1 }')"
mv -- "$partial_db" "$backup_file"
mv -- "$partial_media" "$media_backup_file"
printf '%s  %s\n' "$db_hash" "$(basename -- "$backup_file")" > "$backup_file.sha256"
printf '%s  %s\n' "$media_hash" "$(basename -- "$media_backup_file")" > "$media_backup_file.sha256"
chmod 600 -- "$backup_file" "$backup_file.sha256" "$media_backup_file" "$media_backup_file.sha256"
printf 'Encrypted PostgreSQL backup created: %s\n' "$backup_file"
printf 'Encrypted media backup created: %s\n' "$media_backup_file"
printf 'SHA-256 sidecars created for both backups.\n'
if [[ -n "${QIZZONE_BACKUP_REMOTE:-}" ]]; then
    bash "$script_dir/copy-backups-offsite.sh" "$backup_file" "$media_backup_file"
    if [[ "${QIZZONE_BACKUP_DELETE_LOCAL_AFTER_OFFSITE:-0}" == "1" ]]; then
        shopt -s nullglob
        local_backups=(
            "$backup_dir"/qizzone-postgres-*.dump.age
            "$backup_dir"/qizzone-postgres-*.dump.age.sha256
            "$backup_dir"/qizzone-media-*.tar.age
            "$backup_dir"/qizzone-media-*.tar.age.sha256
        )
        if (("${#local_backups[@]}" > 0)); then
            rm -- "${local_backups[@]}"
            printf 'Removed local encrypted backup copies after verified offsite upload.\n'
        fi
    fi
else
    if [[ "${QIZZONE_BACKUP_REQUIRE_OFFSITE:-0}" == "1" ]]; then
        echo "Offsite backups are required but were not uploaded." >&2
        exit 1
    fi
    printf 'Offsite copy not configured; these backups remain on this host.\n'
fi
