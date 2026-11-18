#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
    echo "Usage: bash deploy/scripts/build-oci-images.sh <40-character-release-sha> [/etc/qizzone/production.env]" >&2
    exit 2
fi

expected_sha="$1"
env_file="${2:-/etc/qizzone/production.env}"
[[ "$expected_sha" =~ ^[[:xdigit:]]{40}$ ]] || {
    echo "Release SHA must be a full 40-character Git commit SHA." >&2
    exit 1
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/../.." && pwd)"
actual_sha="$(git -C "$repo_dir" rev-parse HEAD)"
[[ "$actual_sha" == "$expected_sha" ]] || {
    echo "Checked-out Git revision does not match the requested release SHA." >&2
    exit 1
}
[[ -z "$(git -C "$repo_dir" status --porcelain --untracked-files=all)" ]] || {
    echo "Refusing to build from a dirty checkout; commit or remove all tracked and untracked changes first." >&2
    exit 1
}
[[ -r "$env_file" ]] || { echo "Production environment file is not readable." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker is required on the native ARM64 build host." >&2; exit 1; }
docker compose version >/dev/null
case "$(uname -m)" in
    aarch64|arm64) ;;
    *) echo "Build images on the native OCI ARM64 host so local image architecture is explicit." >&2; exit 1 ;;
esac

export QIZZONE_RELEASE_SHA="$expected_sha"
compose=(
    docker compose
    --project-directory "$repo_dir/deploy"
    --env-file "$env_file"
    --file "$repo_dir/deploy/compose.oci.yaml"
    --file "$repo_dir/deploy/compose.oci.ai.yaml"
    --project-name qizzone-oci
    --profile migration
    --profile ai
)

"${compose[@]}" config --quiet
"${compose[@]}" build --pull api migrate worker

for image in "qizzone-api:$expected_sha" "qizzone-migrate:$expected_sha" "qizzone-worker:$expected_sha"; do
    image_revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")"
    [[ "$image_revision" == "$expected_sha" ]] || {
        echo "Built image revision label does not match the requested source SHA: $image" >&2
        exit 1
    }
    image_id="$(docker image inspect --format '{{.Id}}' "$image")"
    printf '%s %s %s\n' "$expected_sha" "$image" "$image_id"
done
