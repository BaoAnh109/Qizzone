# Qizzone V2 single-host pilot

This is a portable, single-VM pilot bundle. It is preparation for isolated staging only; it is not a production deployment or an availability guarantee. It has not been run against a cloud host, real Firebase credentials, or a database. It does not change Vercel, DNS, Supabase, or production traffic.

The API and PostgreSQL run on a private Docker network. Caddy exposes the API over HTTPS. The API uses a restricted database role; the explicit migration job uses a separate schema-owner role. The Gemini worker and Supabase data-import tool are separate opt-in Compose overlays.

## Cost and availability

Northflank's free Developer Sandbox is for testing and should not host production applications. The no-cost compute candidate is an OCI Always Free A1 VM. A signed-in Edge session confirms the `qizzone` tenancy, Free Trial/Free Tier status, Account type `Promo`, and Singapore home region. In the VM create wizard, the default Oracle Linux 9 image had no available shapes; OCI says this may be caused by service limits or capacity. The instance inventory and Ubuntu image selector failed to load because of a console authentication error. Always Free labels/quota and A1 capacity are therefore unverified. Oracle may reclaim an Always Free VM after seven days below its idle thresholds. This bundle does not clear the production operations gate: all containers share one host and region, so host failure takes down the API and database together.

Do not upgrade a cloud account, select a paid resource, or create a resource unless its Always Free label and quotas have been verified. This repository contains no infrastructure provisioning command. No OCI resource or Northflank metered workload was created. Northflank has four secret/config groups with variable names only; every value is blank.

## Prepare a staging host

Use a clean Linux VM and a separate staging DNS name such as api.staging.example.com. Keep the current Vercel frontend and Supabase system of record in service. Do not change the production domain or frontend API URL as part of this pilot.

Install Docker Compose v2, OpenSSL, age, and standard GNU utilities on the host. Clone the intended repository revision, then prepare the environment file. The example CPU caps are API 1.0, PostgreSQL 0.5, Caddy 0.25, and optional worker 0.25 vCPU; the total is 2 OCPU when every service runs. The example memory caps total 6.25 GiB, leaving headroom on an Always Free A1 VM. These are ceilings for an isolated pilot, not capacity evidence; validate memory and latency before using them with real users.

    cp deploy/.env.pilot.example deploy/.env.pilot
    mkdir -p deploy/secrets
    chmod 700 deploy/secrets
    umask 077
    openssl rand -hex 32 > deploy/secrets/postgres-admin-password.txt
    openssl rand -hex 32 > deploy/secrets/qizzone-app-db-password.txt
    openssl rand -hex 32 > deploy/secrets/qizzone-migrator-db-password.txt

The database password files must contain 64 lowercase hexadecimal characters. Build the two connection-string files from those password files without printing them:

    printf 'Host=postgres;Port=5432;Database=qizzone;Username=qizzone_app;Password=%s;SSL Mode=Disable' "$(cat deploy/secrets/qizzone-app-db-password.txt)" > deploy/secrets/qizzone-app-connection-string.txt
    printf 'Host=postgres;Port=5432;Database=qizzone;Username=qizzone_migrator;Password=%s;SSL Mode=Disable' "$(cat deploy/secrets/qizzone-migrator-db-password.txt)" > deploy/secrets/qizzone-migrator-connection-string.txt
    chmod 600 deploy/secrets/*

Create a Firebase test project and place its service-account JSON at the path configured by FIREBASE_SERVICE_ACCOUNT_FILE. Fill in FIREBASE_PROJECT_ID and a verified test administrator's Firebase UID in deploy/.env.pilot. Keep the Firebase file and database connection strings out of Git and logs. Compose secrets in this single-host setup are read-only file mounts, not an encrypted secrets vault; protect the host, filesystem, and backups.

Set API_HOST to the staging hostname, ACME_EMAIL to an operational email, and FRONTEND_ORIGIN to the staging frontend origin. Point only the staging DNS record to the VM. Ports 80 and 443 must be reachable for Caddy certificate issuance. The example values are placeholders.

## Start the pilot

From the repository root, review the rendered configuration and build the images. The config command checks syntax and referenced secret files but does not contact or create cloud resources:

    docker compose --project-directory deploy --env-file deploy/.env.pilot --project-name qizzone-pilot -f deploy/compose.pilot.yaml config --quiet
    docker compose --project-directory deploy --env-file deploy/.env.pilot --project-name qizzone-pilot -f deploy/compose.pilot.yaml build api migrate
    docker compose --project-directory deploy --env-file deploy/.env.pilot --project-name qizzone-pilot -f deploy/compose.pilot.yaml up -d postgres

On a new database volume, the Postgres init script creates the restricted API role and separate migration role. Do not change those secret files after the volume has initialized unless you also rotate the corresponding PostgreSQL roles deliberately.

Review the generated, idempotent PostgreSQL companion at `deploy/migrations/qizzone-idempotent.sql`; it covers every migration in the current API assembly, through `20261118100000_ScheduleQuizRooms`. The migration runner below applies the EF migrations as the single one-off schema operation; do not also execute the SQL companion against the same database.

    docker compose --project-directory deploy --env-file deploy/.env.pilot --project-name qizzone-pilot -f deploy/compose.pilot.yaml --profile migration run --rm migrate

Only after that succeeds, start the API and HTTPS proxy:

    docker compose --project-directory deploy --env-file deploy/.env.pilot --project-name qizzone-pilot -f deploy/compose.pilot.yaml up -d api caddy

Check /health/live and /health/ready on the staging hostname. Do not use a production Firebase project or production exam data for the first smoke checks.

## Optional Gemini worker

The worker is not started by the base Compose file. For a controlled test only, create a Gemini API key in Google AI Studio, store it in the configured secret file, and include the worker overlay:

    docker compose --project-directory deploy --env-file deploy/.env.pilot --project-name qizzone-pilot -f deploy/compose.pilot.yaml -f deploy/compose.pilot.ai.yaml --profile ai up --build -d worker

At this audit date, Google's pricing page lists standard `gemini-3.8-flash` input and output as free on the Free Tier, subject to model eligibility and rate limits. Paid usage is metered; current listed rates are $0.75/$3.75 per million input/output tokens through 2026-12-31 and $1.50/$7.50 starting 2027-01-01. Google says Free Tier content may be used to improve its products. Under the owner's $0 cap, keep the key on a Free Tier project with no billing account linked, check project eligibility and quotas before use, and send synthetic, non-sensitive staging data only. The worker remains disabled until that setup is confirmed. See Google's [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing?hl=en) and [billing tiers](https://ai.google.dev/gemini-api/docs/billing?hl=en).

## Optional Supabase data-import tool

The import overlay mounts a source Supabase connection string from a file and runs plan by default. Add the source secret file only to a protected staging host. First run the read-only plan and review its aggregate blockers and digest:

    docker compose --project-directory deploy --env-file deploy/.env.pilot --project-name qizzone-pilot -f deploy/compose.pilot.yaml -f deploy/compose.pilot.import.yaml --profile data-migration run --rm data-migration plan

Do not run apply until there is a verified source backup and restore, an isolated rehearsal, storage and Firebase identity reconciliation, a source write freeze, and an explicitly reviewed plan digest. The importer preserves open attempts, saved answers, order, revision, and nullable deadlines for V2 resume; confirm browsers have synchronized pending answers before the freeze. It rechecks the source digest before committing and rolls back if the source changed during import. The owner authorized production as the end goal, subject to the $0 budget, no-interruption rollout, release gates, and current-branch-only constraint; these gates are still open.

## Encrypted backup and restore drill

Install age on the host and keep the age private identity off the application VM. Set AGE_RECIPIENT to the matching public recipient key and create a local encrypted PostgreSQL-and-media backup:

AGE_RECIPIENT=age1... bash deploy/scripts/backup-postgres.sh

The script emits a PostgreSQL `.dump.age` and media-volume `.tar.age`, each with a SHA-256 sidecar. It snapshots PostgreSQL first and then archives the append-only media volume; the media archive may contain unreferenced files, but must include every object in the database snapshot. Without an offsite setting, the files remain on this host. To copy them to an independent rclone remote, configure a protected rclone config file and run:

    QIZZONE_BACKUP_REMOTE=backupremote:qizzone/backups \
    QIZZONE_RCLONE_CONFIG_FILE=/secure/path/rclone.conf \
    AGE_RECIPIENT=age1... \
    bash deploy/scripts/backup-postgres.sh

The offsite helper verifies the local sidecars, copies only the encrypted database/media artifacts and their sidecars to a unique backup-set directory, then reads the remote bytes back for comparison. It fails if a configured upload or read-back check fails. Use a distinct provider/account or failure domain, restrict remote permissions to the backup prefix, protect the rclone config, and set provider-side retention/immutability only after checking the cost and retention behavior. This mechanism has not been connected to a real remote and does not prove recovery.

Run the local mock test for copy, read-back corruption, unknown-remote, and local-sidecar failure behavior:

    bash deploy/scripts/tests/copy-backups-offsite.sh

For an isolated restore drill, provide the decryption identity on a protected test machine and pass a staging backup:

    AGE_IDENTITY_FILE=/secure/path/age-identity.txt bash deploy/scripts/restore-drill.sh deploy/backups/qizzone-postgres-timestamp.dump.age deploy/backups/qizzone-media-timestamp.tar.age

For an offsite set, copy one unique backup-set directory into a new empty protected local directory first; the restore drill then checks the downloaded sidecars before decrypting:

    BACKUP_SET_ID=20261118T123456Z-1234-5678
    RESTORE_DIR=/secure/restore-staging/$BACKUP_SET_ID
    mkdir -m 700 -p "$RESTORE_DIR"
    rclone --config "$QIZZONE_RCLONE_CONFIG_FILE" copy --immutable \
      "${QIZZONE_BACKUP_REMOTE%/}/$BACKUP_SET_ID" "$RESTORE_DIR"
    AGE_IDENTITY_FILE=/secure/path/age-identity.txt bash deploy/scripts/restore-drill.sh \
      "$RESTORE_DIR/qizzone-postgres-$BACKUP_SET_ID.dump.age" \
      "$RESTORE_DIR/qizzone-media-$BACKUP_SET_ID.tar.age"

The drill verifies both checksums, restores PostgreSQL and media into uniquely named disposable volumes on a network-disabled Docker network, verifies that every database-referenced media object has the recorded SHA-256, tolerates unreferenced files in the append-only media archive, and checks the public table and EF migration counts. It removes only those generated resources after successful validation. If it fails, it leaves the generated names in the error message for inspection. Use synthetic or staging data until local handling and cleanup are approved.

## Stop and data retention

Stopping services while keeping data:

    docker compose --project-directory deploy --env-file deploy/.env.pilot --project-name qizzone-pilot -f deploy/compose.pilot.yaml down

Do not use down --volumes on a host with data you need. Removing the PostgreSQL volume destroys the pilot database. This guide does not automatically remove the persistent pilot volumes.

## Current release status

No container build, database migration, restore drill, cloud provisioning, DNS change, Vercel deployment, or production traffic change has been performed from this bundle. The exact worktree changes still need a clean CI run and a Docker Compose validation on a disposable host. This one-host candidate is not a production host; retain the current Vercel/Supabase production path until all feature, data, security, quality, and operations gates pass.

## OCI production candidate configuration

The OCI files are a separate production candidate. They do not change the pilot project or any Vercel setting. The compose project is qizzone-oci; its database, media, and Caddy volumes have explicit names that do not overlap the pilot volumes. PostgreSQL stays on an internal Docker network, and only Caddy publishes ports 80/443. The sample host limits total 2 OCPU and 6.25 GiB of container memory; they are sizing ceilings, not load evidence.

OCI Container Registry is not used by this $0 plan. Oracle's Container Registry documentation says stored images are charged. The build script instead requires a clean checkout at a full Git SHA, builds the API, migration tool, and worker on a native ARM64 host, labels each image with that SHA, and prints each local image ID. Preserve those three image IDs with the release record. The tags are unique per source commit in this workflow but are local tags, not registry digests.

On a verified host, install Docker Compose v2, age, rclone, and GNU utilities. Create /etc/qizzone and /etc/qizzone/secrets with owner root and mode 700; keep secret files mode 600. Copy the example environment file outside the checkout, then fill in the real API hostname, Firebase project/admin UID, and clean release SHA:

    sudo install -d -o root -g root -m 700 /etc/qizzone /etc/qizzone/secrets
    sudo install -o root -g root -m 600 deploy/.env.oci.example /etc/qizzone/production.env

Attach a separate Always Free OCI block volume for Docker data, confirm its device and filesystem by UUID, and mount it at /srv/qizzone-data. Persist the mount by UUID in /etc/fstab, using the filesystem type actually present on the confirmed volume:

    UUID=<confirmed-volume-uuid> /srv/qizzone-data <confirmed-filesystem> defaults 0 2

Configure Docker's data root by merging the key from deploy/docker-daemon.json.example into /etc/docker/daemon.json; do not overwrite existing daemon settings. Install deploy/systemd/docker-data-root.conf.example as the docker.service drop-in. The drop-in makes Docker fail unless the data volume is mounted, so containers cannot silently fall back to the boot disk:

    sudo install -d -o root -g root -m 755 /etc/systemd/system/docker.service.d
    sudo install -o root -g root -m 644 deploy/systemd/docker-data-root.conf.example /etc/systemd/system/docker.service.d/10-qizzone-data-volume.conf
    sudo systemctl daemon-reload
    sudo mount /srv/qizzone-data
    sudo mountpoint -q /srv/qizzone-data
    sudo install -d -o root -g root -m 700 /srv/qizzone-data/docker /srv/qizzone-data/backups
    sudo systemctl start docker
    docker info --format '{{.DockerRootDir}}'

The last command must report /srv/qizzone-data/docker. The Compose named volumes and downloaded images will then live on the attached block volume; the boot volume remains separate. Do not format a device until the OCI attachment and device identity are confirmed.

Create the database password and connection-string files, Firebase service-account file, and Gemini key file directly on the host through a protected editor or secret-management workflow. Do not place secret values in Git, shell history, process arguments, or image build arguments. Keep API_HOST set to a hostname whose DNS points to this VM; keep FRONTEND_ORIGIN set to the intended Vercel frontend origin. Never use the example hostname for a real release.

Check out the approved release commit with a clean working tree. Run the image build script from that checkout; it renders Compose configuration, refuses dirty or mismatched revisions, builds only the three SHA-labelled images, and reports the image IDs:

    bash deploy/scripts/build-oci-images.sh <full-40-character-release-sha> /etc/qizzone/production.env

Use explicit migration sequencing after a verified database backup. First start PostgreSQL alone, wait until it is healthy, and run the one-off migration:

    docker compose --project-directory deploy --env-file /etc/qizzone/production.env --project-name qizzone-oci -f deploy/compose.oci.yaml up -d postgres
    docker compose --project-directory deploy --env-file /etc/qizzone/production.env --project-name qizzone-oci --profile migration -f deploy/compose.oci.yaml run --rm migrate

After the migration is reviewed for that exact release, start the API and Caddy without allowing Compose to rebuild:

    docker compose --project-directory deploy --env-file /etc/qizzone/production.env --project-name qizzone-oci -f deploy/compose.oci.yaml up -d --no-build api caddy

Start the worker only after configuring a valid Gemini key and accepting the provider cost/quota:

    docker compose --project-directory deploy --env-file /etc/qizzone/production.env --project-name qizzone-oci --profile ai -f deploy/compose.oci.yaml -f deploy/compose.oci.ai.yaml up -d --no-build worker

### Scheduled encrypted offsite backup

The systemd unit runs the existing PostgreSQL and media backup script after each 20-minute idle interval. It requires a configured rclone remote; the helper verifies uploaded bytes by reading them back. The unit removes local encrypted backup copies only after that verification succeeds, so the chosen remote must have enough free capacity and a retention policy. A failed remote leaves local copies on disk and needs an operator response; this bundle does not configure an alerting destination.

Create /etc/qizzone/backup.env from deploy/systemd/qizzone-backup.env.example, configure an independent non-OCI remote whose $0 quota and lifecycle policy have been confirmed, and keep /etc/qizzone/rclone.conf mode 600. Store the age private identity offline; only its public recipient is required by the server.

    sudo install -o root -g root -m 600 deploy/systemd/qizzone-backup.env.example /etc/qizzone/backup.env
    sudo install -o root -g root -m 644 deploy/systemd/qizzone-backup.service /etc/systemd/system/qizzone-backup.service
    sudo install -o root -g root -m 644 deploy/systemd/qizzone-backup.timer /etc/systemd/system/qizzone-backup.timer
    sudo systemctl daemon-reload
    sudo systemctl enable --now qizzone-backup.timer
    sudo systemctl start qizzone-backup.service
    sudo systemctl status qizzone-backup.service

Download a verified backup set into a protected, empty directory before using restore-drill.sh. The schedule alone does not prove an RPO of one hour: record successful run duration, offsite read-back, retention, and an isolated restore result before accepting that target.

These OCI artifacts are configuration only. Tenancy, Free Trial/Free Tier account status, and Singapore home region are verified, but no Always Free shape/quota, A1 capacity, API hostname, free offsite destination, Docker host, or cloud resource has been verified. Do not switch the production frontend from Supabase until every release gate has passed.
