#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/../../.." && pwd)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/qizzone-offsite-test.XXXXXX")"
test_root="$(realpath -- "$test_root")"
temp_root="$(realpath -- "${TMPDIR:-/tmp}")"
case "$test_root" in
    "$temp_root"/qizzone-offsite-test.*) ;;
    *) echo "Unexpected temporary test path; refusing cleanup." >&2; exit 1 ;;
esac

cleanup() {
    case "$test_root" in
        "$temp_root"/qizzone-offsite-test.*) rm -rf -- "$test_root" ;;
        *) echo "Unexpected cleanup path; refusing recursive removal." >&2 ;;
    esac
}
trap cleanup EXIT

mkdir -p -- "$test_root/bin" "$test_root/backups" "$test_root/remote"
printf 'test config\n' > "$test_root/rclone.conf"

cat > "$test_root/bin/rclone" <<'FAKE_RCLONE'
#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${1:-}" == --config && -r "${2:-}" ]] || { echo "Invalid config argument." >&2; exit 2; }
shift 2
subcommand="${1:-}"
shift
if [[ "$subcommand" == "listremotes" ]]; then
    printf 'mock:\n'
    exit 0
fi

file_list=""
positionals=()
while (($#)); do
    case "$1" in
        --files-from-raw) file_list="$2"; shift 2 ;;
        --checksum|--immutable|--download|--one-way) shift ;;
        *) positionals+=("$1"); shift ;;
    esac
done
[[ -r "$file_list" && ${#positionals[@]} -eq 2 ]] || { echo "Invalid transfer arguments." >&2; exit 2; }

source_dir="${positionals[0]}"
destination="${positionals[1]}"
[[ "$destination" == mock:* ]] || { echo "Destination is not a mock remote." >&2; exit 2; }
destination_dir="$MOCK_REMOTE_ROOT/${destination#mock:}"

case "$subcommand" in
    copy)
        mkdir -p -- "$destination_dir"
        while IFS= read -r file; do
            if [[ -e "$destination_dir/$file" ]]; then
                cmp -- "$source_dir/$file" "$destination_dir/$file" || {
                    echo "Immutable destination differs." >&2
                    exit 1
                }
            else
                cp -- "$source_dir/$file" "$destination_dir/$file"
            fi
        done < "$file_list"
        if [[ "${MOCK_CORRUPT_ON_COPY:-0}" == "1" ]]; then
            printf 'corrupted after upload' > "$destination_dir/qizzone-media-${MOCK_BACKUP_SET_ID}.tar.age"
        fi
        ;;
    check)
        while IFS= read -r file; do
            cmp -- "$source_dir/$file" "$destination_dir/$file"
        done < "$file_list"
        ;;
    *) echo "Unexpected rclone command: $subcommand" >&2; exit 2 ;;
esac
FAKE_RCLONE
chmod 700 -- "$test_root/bin/rclone"

export PATH="$test_root/bin:$PATH"
export MOCK_REMOTE_ROOT="$test_root/remote"
export QIZZONE_BACKUP_REMOTE="mock:qizzone/backups"
export QIZZONE_RCLONE_CONFIG_FILE="$test_root/rclone.conf"

create_backup_set() {
    local backup_set_id="$1"
    (
        cd -- "$test_root/backups"
        printf 'encrypted database fixture %s' "$backup_set_id" > "qizzone-postgres-$backup_set_id.dump.age"
        printf 'encrypted media fixture %s' "$backup_set_id" > "qizzone-media-$backup_set_id.tar.age"
        sha256sum "qizzone-postgres-$backup_set_id.dump.age" > "qizzone-postgres-$backup_set_id.dump.age.sha256"
        sha256sum "qizzone-media-$backup_set_id.tar.age" > "qizzone-media-$backup_set_id.tar.age.sha256"
    )
}

run_copy() {
    local backup_set_id="$1"
    bash "$repo_dir/deploy/scripts/copy-backups-offsite.sh" \
        "$test_root/backups/qizzone-postgres-$backup_set_id.dump.age" \
        "$test_root/backups/qizzone-media-$backup_set_id.tar.age"
}

good_set="20261118T123456Z-42-73"
create_backup_set "$good_set"
run_copy "$good_set"
good_remote="$test_root/remote/qizzone/backups/$good_set"
[[ "$(find "$good_remote" -maxdepth 1 -type f | wc -l)" -eq 4 ]]
cmp "$test_root/backups/qizzone-postgres-$good_set.dump.age" "$good_remote/qizzone-postgres-$good_set.dump.age"

corrupt_set="20261118T123457Z-42-74"
create_backup_set "$corrupt_set"
export MOCK_CORRUPT_ON_COPY=1 MOCK_BACKUP_SET_ID="$corrupt_set"
if run_copy "$corrupt_set" > "$test_root/corrupt.log" 2>&1; then
    echo "Corrupted remote read-back unexpectedly passed." >&2
    exit 1
fi
unset MOCK_CORRUPT_ON_COPY MOCK_BACKUP_SET_ID

invalid_remote_set="20261118T123458Z-42-75"
create_backup_set "$invalid_remote_set"
export QIZZONE_BACKUP_REMOTE="missing:qizzone/backups"
if run_copy "$invalid_remote_set" > "$test_root/remote.log" 2>&1; then
    echo "An unconfigured remote alias unexpectedly passed." >&2
    exit 1
fi
grep -q "remote name was not found" "$test_root/remote.log"

bad_sidecar_set="20261118T123459Z-42-76"
create_backup_set "$bad_sidecar_set"
printf 'tampered' >> "$test_root/backups/qizzone-postgres-$bad_sidecar_set.dump.age"
export QIZZONE_BACKUP_REMOTE="mock:qizzone/backups"
if run_copy "$bad_sidecar_set" > "$test_root/sidecar.log" 2>&1; then
    echo "A locally corrupted backup unexpectedly passed sidecar verification." >&2
    exit 1
fi

printf 'Offsite helper mock tests passed: copy/read-back, corrupted upload, unknown remote, and invalid local checksum.\n'
