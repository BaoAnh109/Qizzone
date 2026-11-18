# Northflank deployment runbook

**Product:** Qizzone
**Working branch:** `feat/qizzone-v2-backend-aiv3` (local worktree)
**Reviewed revision:** `c036103f4ebcbb1c9e80beeb4190d74518345990`
**Status:** Northflank staging resources exist in `Default`. PostgreSQL is running; API and worker are paused with CI/CD off. Both images built successfully for this revision, but neither image has been deployed. The migration job has not run. The $0 out-of-pocket limit remains in force; Northflank says Sandbox is for testing, not production. Vercel production has not been changed.

## Current platform state

The signed-in Northflank account shows one visible team, `Cryzy's Team` (Free), and one project named `Default`, in US Central (Council Bluffs). No old project exists in this account. The owner selected a $0 out-of-pocket limit: use only the Free Sandbox allowance and do not knowingly choose a configuration that may exceed it. The $50 billing threshold is not a hard spending cap. Public quota descriptions conflict: the [pricing page](https://northflank.com/pricing) lists two free projects, while [create-project docs](https://northflank.com/docs/v1/application/getting-started/create-a-project) say one project; keep using the confirmed `Default` project.

Northflank marked the [security incident](https://status.northflank.com/cmvv0rn5a092f14rutwccodpp) resolved on November 17, 2026 at 17:24 UTC; its independent forensic review continues. A staging exception exposed a PostgreSQL connection URI in Northflank logs. The credential is intentionally omitted from this file and chat; the owner must rotate the database credential in Northflank before either service is resumed. Do not inspect or copy the old value. The local nested app `.env` contains client-side `VITE_*` settings only; it does not contain Firebase Admin credentials or the Gemini worker key.

Current staging state: addon `qizzone-postgres-staging` is PostgreSQL 17, private-only with TLS, one `nf-compute-20` instance, and a 6 GiB disk. API and worker are at 0 instances with CI and CD disabled. Their previous deployed build was `b382ae7`; that build is stopped. Northflank successfully built the API (`dependent-grain-8592`) and worker (`miniature-eagle-3361`) from `c036103`; these are build artifacts only. Production Vercel was not modified.

## Build configuration

CI run [#161](https://github.com/BaoAnh109/Qizzone/actions/runs/44113974572) passed on the reviewed revision. Frontend dependency audit, lint, tests, TypeScript/Vite build, backend restore/audit/tests/build, and AMD64/ARM64 API and worker image builds all completed successfully. Run #158 included the PostgreSQL 17 concurrency test submitting one attempt 100 times through two independent API hosts. Images remain build-validated only; they were not pushed to a registry.

The latest PostgreSQL-backed local backend Release suite passed all 37 API and 7 worker tests with zero skips against temporary native PostgreSQL 17.12, including schedule transitions, JSONB assignment filtering, two-host submit contention, five-option constraints, owner-only avatar assignment, quiz/practice row-lock regressions, API cancellation, and worker abort of a mocked in-flight Gemini request. The regenerated 14-migration idempotent script applied twice on a disposable database; the schedule rollback removed its columns/history row and reapplying restored them. The migration CLI's synthetic fixture rehearsal (`backend/Qizzone.MigrationTool/Run-SyntheticRehearsal.ps1`) also passed, preserving a resumable open attempt with a null deadline, answer, and revision. This is local evidence only; no Northflank service/database or hosted-target migration/rollback rehearsal exists.

The isolated PostgreSQL database and repository-backed services have been provisioned. Configure or verify them as follows:

| Service | Build context | Dockerfile | Ingress / health |
|---|---|---|---|
| `qizzone-api` | `backend/` | `Dockerfile` | HTTP port `8080`; `/health/live` and `/health/ready` |
| `qizzone-worker` | `backend/` | `Qizzone.Worker/Dockerfile` | No public ingress |

Both services must use the same private PostgreSQL connection. Do not expose PostgreSQL publicly.

## Required runtime configuration

The following Northflank groups exist in `Default`. Keep the Firebase Admin credential API-only and the Gemini key worker-only. Store secret values only in Northflank; never put them in Git, images, chat, or logs. Backend credentials must be obtained from their provider consoles because there is no old project or secret store.

| Group | Type | Scope | Attach to | Names already present |
|---|---|---|---|---|
| `qizzone-backend-runtime` | Secret values | Runtime only | API only | `FIREBASE_SERVICE_ACCOUNT_JSON` |
| `qizzone-api-config` | Configuration values | Runtime only | API only | `Firebase__ProjectId`; `Cors__AllowedOrigins__0`; `AllowedHosts`; `Admin__BootstrapUids__0`; `ASPNETCORE_ENVIRONMENT`; `Media__RootPath` |
| `qizzone-worker-secrets` | Secret values | Runtime only | Worker only | `Gemini__ApiKey` |
| `qizzone-worker-config` | Configuration values | Runtime only | Worker only | `Gemini__Model`; `DOTNET_ENVIRONMENT` |

Do not create an empty `ConnectionStrings__Qizzone` value. Once the private PostgreSQL addon exists, link its connection details to the API and worker groups so the platform supplies the connection string. `Media__RootPath` must match the API's persistent volume mount; choose and fill it only after the volume exists.

The four application groups are restricted to one service each: the two API groups to `qizzone-api`, and the two worker groups to `qizzone-worker`. `qizzone-postgres-runtime` is restricted to those two services and linked to the addon; it is not yet available to `qizzone-migrate-staging`. The migration job's access must be approved at action time before that restriction is expanded.

| Workload | Required names |
|---|---|
| API | Linked private `ConnectionStrings__Qizzone`; `Firebase__ProjectId`; `FIREBASE_SERVICE_ACCOUNT_JSON` (or ADC); `Cors__AllowedOrigins__0`; `AllowedHosts`; `Admin__BootstrapUids__0`; `ASPNETCORE_ENVIRONMENT=Staging`; `Media__RootPath` plus a persistent volume mounted at the same path |
| Worker | Linked private `ConnectionStrings__Qizzone`; `Gemini__ApiKey`; `Gemini__Model`; `DOTNET_ENVIRONMENT=Staging` |

The API fails its production startup checks when database, Firebase Admin, allowed-origin/host, media path, or bootstrap-admin configuration is missing. The worker validates its Gemini key and model at startup. `Media__RootPath` is currently `/data/media`, but the Free project rejected the persistent-volume request (minimum 6 GiB at the displayed rate and no volume slot available). Treat uploaded files there as ephemeral; do not use this setup for durable user uploads. `deploy/.env.pilot.example` contains placeholders only.

## Free Sandbox sizing candidate

The PostgreSQL 17 creation form in the existing `Default` project defaulted to one replica, private access, TLS enabled, `nf-compute-20` (0.2 shared vCPU / 512 MiB), and a 6 GiB NVMe disk. At current public rates, that is about **$6.10/month** ($5.40 compute + $0.70 disk). An API and worker each at `nf-compute-20` would add about $5.40/month apiece, for **$16.90/month total** before image builds, logs, egress, backup storage, and other metered usage. The Free Sandbox includes up to $20/month of resources; this leaves only about $3.10 for all other usage, so this is a sizing candidate, not a guaranteed $0 bill. The API/worker memory limits are staging-only and require runtime validation. Do not enable public database access, extra replicas, backup schedules, larger plans, PAYG, or BYOC under the current $0 budget. If the final dashboard estimate does not stay inside the included allowance with a reasonable margin, do not create the resource.

## Database migration gate

The API does not apply EF migrations automatically at startup. CI and the local suite have applied EF migrations to isolated PostgreSQL 17 schemas. The Northflank target database now exists, but `deploy/migrations/qizzone-idempotent.sql` has not been run against it. The manual job `qizzone-migrate-staging` has no runs and currently lacks access to `qizzone-postgres-runtime`. Before running it, the owner must rotate the exposed database credential and explicitly approve granting this job access to that group. Apply only to this disposable staging database; never run it against the live Supabase source. The owner requested no database backup schedules.

The live Supabase migration history differs from the checkout for avatar storage, and the local question-media migration is not present in live history. Resolve that drift and complete export/reconciliation/backup/restore rehearsal before any data cutover.

## Remaining gates

- Reuse the empty `Default` project for isolated staging; do not upgrade under the $0 out-of-pocket limit. Northflank's current [pricing page](https://northflank.com/pricing) lists two free projects and up to $20/month of resources across two services and one database, while the [create-project docs](https://northflank.com/docs/v1/application/getting-started/create-a-project) say one free project. Edge was unavailable to recheck the account-specific quota, so treat `Default` as the only confirmed project. The Free Sandbox is for testing and should not be used for production. Verify the exact estimate and usage before each resource creation.
- Fill the prepared groups with a fresh Firebase Admin service-account JSON, Firebase project ID, Gemini API key and model, staging frontend/API hosts, verified bootstrap admin UID, environment names, and the volume mount path. Enter credentials directly into Northflank, never in chat or Git.
- Do not provision paid resources. The Free Sandbox is suitable only for staging/testing; production requires a separately approved nonzero budget and production-capable hosting.
- Obtain a deployable staging PostgreSQL connection and run target migration/rollback rehearsal.
- Deploy API and worker, then verify health endpoints, Firebase identity, private database networking, and a controlled Gemini job.
- Finish remaining feature parity, data reconciliation, browser E2E, load/failure tests, backup/restore, observability, and rollback evidence before production cutover.

The Northflank [Free Sandbox is intended for testing and should not be used for production](https://northflank.com/docs/v1/application/billing/pricing-on-northflank). The pricing page advertises up to $20/month of free resources, while billing documentation says overages can be charged to a payment method; the $50 threshold is not a hard cap. The database remains active and the two short image builds completed, so check the account's billing/usage page; the $0 out-of-pocket goal cannot be guaranteed by the threshold setting. The persistent media volume is unavailable in this project. The release gates in `docs/audit/RELEASE_READINESS.md` remain open. No production URL, DNS change, data cutover, or Vercel production deployment was performed; the Northflank API and worker are paused, and the `c036103` images are not deployed.
