#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: AGE_IDENTITY_FILE=/path/to/private-key bash deploy/scripts/restore-drill.sh /path/to/backup.dump.age /path/to/media.tar.age" >&2
    exit 2
fi

backup_file="$(realpath -- "$1")"
media_backup_file="$(realpath -- "$2")"
: "${AGE_IDENTITY_FILE:?Set AGE_IDENTITY_FILE to the backup decryption identity file.}"
: "${POSTGRES_IMAGE:=postgres:17.12-alpine3.24}"

for file in "$backup_file" "$media_backup_file"; do
    [[ -r "$file" ]] || { echo "Backup file is not readable." >&2; exit 1; }
    [[ -r "$file.sha256" ]] || { echo "Backup SHA-256 sidecar is missing." >&2; exit 1; }
done
[[ -r "$AGE_IDENTITY_FILE" ]] || { echo "Age identity file is not readable." >&2; exit 1; }

for command_name in age docker sha256sum; do
    command -v "$command_name" >/dev/null 2>&1 || { echo "$command_name is required." >&2; exit 1; }
done

verify_backup() {
    local file="$1"
    local expected_hash actual_hash
    expected_hash="$(awk 'NR == 1 { print $1 }' "$file.sha256")"
    actual_hash="$(sha256sum "$file" | awk '{ print $1 }')"
    [[ "$expected_hash" =~ ^[[:xdigit:]]{64}$ && "$expected_hash" == "$actual_hash" ]] || {
        echo "Backup checksum verification failed." >&2
        exit 1
    }
}
verify_backup "$backup_file"
verify_backup "$media_backup_file"

suffix="$(date -u +%Y%m%d%H%M%S)-$$-$RANDOM"
container_name="qizzone-restore-drill-$suffix"
volume_name="qizzone-restore-drill-$suffix"
media_volume_name="qizzone-restore-media-$suffix"
container_created=0
volume_created=0
media_volume_created=0
cleaned=0

report_leftovers() {
    if [[ "$cleaned" -ne 1 && ( "$container_created" -eq 1 || "$volume_created" -eq 1 || "$media_volume_created" -eq 1 ) ]]; then
        printf 'Restore drill did not finish; disposable resources were left for inspection: container=%s db_volume=%s media_volume=%s\n' \
            "$container_name" "$volume_name" "$media_volume_name" >&2
    fi
}
trap report_leftovers EXIT

if docker volume inspect "$volume_name" >/dev/null 2>&1 ||
    docker volume inspect "$media_volume_name" >/dev/null 2>&1 ||
    docker container inspect "$container_name" >/dev/null 2>&1; then
    echo "Generated restore-drill name already exists; refusing to reuse it." >&2
    exit 1
fi

docker volume create --label "qizzone.restore-drill=$suffix" "$volume_name" >/dev/null
volume_created=1
docker volume create --label "qizzone.restore-drill=$suffix" "$media_volume_name" >/dev/null
media_volume_created=1
docker run \
    --detach \
    --name "$container_name" \
    --label "qizzone.restore-drill=$suffix" \
    --network none \
    --volume "$volume_name:/var/lib/postgresql/data" \
    --volume "$media_volume_name:/restore-media" \
    --env POSTGRES_DB=qizzone_restore \
    --env POSTGRES_USER=postgres \
    --env POSTGRES_HOST_AUTH_METHOD=trust \
    "$POSTGRES_IMAGE" >/dev/null
container_created=1

ready=0
for _ in {1..60}; do
    if docker exec "$container_name" pg_isready --username=postgres --dbname=qizzone_restore >/dev/null 2>&1; then
        ready=1
        break
    fi
    sleep 1
done
[[ "$ready" -eq 1 ]] || { echo "Disposable PostgreSQL did not become ready." >&2; exit 1; }

age --decrypt --identity "$AGE_IDENTITY_FILE" --output - "$backup_file" \
    | docker exec --interactive "$container_name" \
        pg_restore --username=postgres --dbname=qizzone_restore --no-owner --no-acl --exit-on-error
age --decrypt --identity "$AGE_IDENTITY_FILE" --output - "$media_backup_file" \
    | docker exec --interactive --user 0 "$container_name" tar -xf - -C /restore-media

table_count="$(docker exec "$container_name" psql --no-psqlrc --tuples-only --no-align \
    --username=postgres --dbname=qizzone_restore \
    --command "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")"
migration_count="$(docker exec "$container_name" psql --no-psqlrc --tuples-only --no-align \
    --username=postgres --dbname=qizzone_restore \
    --command 'SELECT count(*) FROM public."__EFMigrationsHistory"')"
media_object_count="$(docker exec "$container_name" psql --no-psqlrc --tuples-only --no-align \
    --username=postgres --dbname=qizzone_restore \
    --command 'SELECT count(*) FROM public.media_objects')"
expected_media="$(docker exec "$container_name" psql --no-psqlrc --tuples-only --no-align \
    --username=postgres --dbname=qizzone_restore \
    --command "SELECT lower(replace(id::text, '-', '')) || extension || ' ' || sha256 FROM public.media_objects ORDER BY 1")"
actual_media="$(docker exec --user 0 "$container_name" sh -eu -c '
for file in /restore-media/*.jpg /restore-media/*.png /restore-media/*.webp; do
    [ -f "$file" ] || continue
    sha256sum "$file"
done
' | awk '{ name = $2; sub(/^.*\//, "", name); print name " " $1 }' | sort)"
missing_media="$(comm -23 \
    <(printf '%s\n' "$expected_media" | sort) \
    <(printf '%s\n' "$actual_media" | sort))"
row_counts="$(docker exec --interactive "$container_name" psql --no-psqlrc --set=ON_ERROR_STOP=1 \
    --tuples-only --no-align --username=postgres --dbname=qizzone_restore <<'SQL'
SELECT format('SELECT count(*) FROM %I.%I;', schemaname, tablename)
FROM pg_tables
WHERE schemaname = 'public' AND tablename <> '__EFMigrationsHistory'
ORDER BY tablename
\gexec
SQL
)"
business_row_count="$(printf '%s\n' "$row_counts" | awk 'NF { total += $1 } END { print total + 0 }')"

[[ "$table_count" =~ ^[0-9]+$ && "$table_count" -gt 1 ]] || {
    echo "Restore validation found too few public tables." >&2
    exit 1
}
[[ "$migration_count" =~ ^[0-9]+$ && "$migration_count" -gt 0 ]] || {
    echo "Restore validation found no EF migration history." >&2
    exit 1
}
[[ "$business_row_count" =~ ^[0-9]+$ ]] || {
    echo "Restore validation could not compute the aggregate business-row count." >&2
    exit 1
}
[[ "$media_object_count" =~ ^[0-9]+$ && -z "$missing_media" ]] || {
    echo "Restore validation found a missing or changed referenced media object." >&2
    exit 1
}

printf 'Restore verified in isolated PostgreSQL: public_tables=%s business_rows=%s media_objects=%s applied_ef_migrations=%s\n' \
    "$table_count" "$business_row_count" "$media_object_count" "$migration_count"
container_label="$(docker inspect --format '{{ index .Config.Labels "qizzone.restore-drill" }}' "$container_name")"
volume_label="$(docker volume inspect --format '{{ index .Labels "qizzone.restore-drill" }}' "$volume_name")"
media_volume_label="$(docker volume inspect --format '{{ index .Labels "qizzone.restore-drill" }}' "$media_volume_name")"
[[ "$container_label" == "$suffix" && "$volume_label" == "$suffix" && "$media_volume_label" == "$suffix" ]] || {
    echo "Generated-resource labels did not match; refusing to remove any resource." >&2
    exit 1
}
docker rm --force "$container_name" >/dev/null
container_created=0
docker volume rm "$volume_name" >/dev/null
volume_created=0
docker volume rm "$media_volume_name" >/dev/null
media_volume_created=0
cleaned=1
printf 'Disposable restore container and volumes removed after successful validation.\n'
