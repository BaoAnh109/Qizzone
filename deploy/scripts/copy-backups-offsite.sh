#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: QIZZONE_BACKUP_REMOTE=remote:path QIZZONE_RCLONE_CONFIG_FILE=/secure/path/rclone.conf bash deploy/scripts/copy-backups-offsite.sh /path/to/postgres.dump.age /path/to/media.tar.age" >&2
    exit 2
fi

: "${QIZZONE_BACKUP_REMOTE:?Set QIZZONE_BACKUP_REMOTE to an independent rclone remote and path.}"
: "${QIZZONE_RCLONE_CONFIG_FILE:?Set QIZZONE_RCLONE_CONFIG_FILE to a protected rclone config file.}"

backup_file="$(realpath -- "$1")"
media_backup_file="$(realpath -- "$2")"
backup_dir="$(dirname -- "$backup_file")"

command -v rclone >/dev/null 2>&1 || { echo "rclone is required for the offsite copy." >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required." >&2; exit 1; }
[[ -r "$QIZZONE_RCLONE_CONFIG_FILE" ]] || { echo "The rclone config file is not readable." >&2; exit 1; }
[[ "$(dirname -- "$media_backup_file")" == "$backup_dir" ]] || {
    echo "Both backup artifacts must be in the same local directory." >&2
    exit 1
}

backup_name="$(basename -- "$backup_file")"
media_backup_name="$(basename -- "$media_backup_file")"
if [[ "$backup_name" =~ ^qizzone-postgres-([0-9]{8}T[0-9]{6}Z-[0-9]+-[0-9]+)\.dump\.age$ ]]; then
    backup_set_id="${BASH_REMATCH[1]}"
else
    echo "The PostgreSQL backup name does not match the generated backup format." >&2
    exit 1
fi
[[ "$media_backup_name" == "qizzone-media-$backup_set_id.tar.age" ]] || {
    echo "The PostgreSQL and media backup names do not belong to the same backup set." >&2
    exit 1
}

for file in "$backup_file" "$backup_file.sha256" "$media_backup_file" "$media_backup_file.sha256"; do
    [[ -f "$file" && -r "$file" ]] || { echo "A backup artifact or SHA-256 sidecar is missing or unreadable." >&2; exit 1; }
done

(
    cd -- "$backup_dir"
    sha256sum --check --strict "$(basename -- "$backup_file").sha256"
    sha256sum --check --strict "$(basename -- "$media_backup_file").sha256"
)

remote_name="${QIZZONE_BACKUP_REMOTE%%:*}"
[[ "$QIZZONE_BACKUP_REMOTE" == *:* && -n "$remote_name" ]] || {
    echo "QIZZONE_BACKUP_REMOTE must use a configured rclone remote name, not a local path." >&2
    exit 1
}
available_remotes="$(rclone --config "$QIZZONE_RCLONE_CONFIG_FILE" listremotes)"
remote_is_configured=0
while IFS= read -r available_remote; do
    if [[ "$available_remote" == "$remote_name:" ]]; then
        remote_is_configured=1
        break
    fi
done <<< "$available_remotes"
[[ "$remote_is_configured" -eq 1 ]] || {
    echo "The configured rclone remote name was not found in the protected config file." >&2
    exit 1
}
remote_path="${QIZZONE_BACKUP_REMOTE%/}/$backup_set_id"

file_list="$(mktemp "${TMPDIR:-/tmp}/qizzone-backup-files.XXXXXX")"
trap 'rm -f -- "$file_list"' EXIT
chmod 600 -- "$file_list"
printf '%s\n' \
    "$backup_name" \
    "$(basename -- "$backup_file.sha256")" \
    "$media_backup_name" \
    "$(basename -- "$media_backup_file.sha256")" > "$file_list"

rclone --config "$QIZZONE_RCLONE_CONFIG_FILE" copy \
    --checksum \
    --immutable \
    --files-from-raw "$file_list" \
    "$backup_dir" \
    "$remote_path"

# Read the uploaded bytes back and compare them with the local encrypted artifacts.
rclone --config "$QIZZONE_RCLONE_CONFIG_FILE" check \
    --download \
    --one-way \
    --files-from-raw "$file_list" \
    "$backup_dir" \
    "$remote_path"

printf 'Encrypted backup set copied and read-back verified at %s\n' "$remote_path"
