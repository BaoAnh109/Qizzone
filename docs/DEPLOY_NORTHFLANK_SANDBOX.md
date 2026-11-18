# Northflank deployment runbook

**Product:** Qizzone
**Working branch:** `feat/qizzone-v2-backend-aiv3` (local worktree)
**Reviewed revision:** `3c5199581f72046e2595d865be18cc9567785657`
**Status:** Local worktree changes are uncommitted and are not covered by the reviewed revision or CI run #161. Not deployed; Free Sandbox can only be considered for isolated testing. Owner's out-of-pocket limit is $0, and Northflank says its Sandbox should not be used for production.

## Current platform state

The last signed-in Northflank check showed one visible team, `Cryzy's Team` (Free), and one project named `Default`. The personal account had no organizations or other visible team. The project region is US Central (Council Bluffs). The owner clarified that no old Northflank project exists and asked to build the environment from scratch. The owner selected a $0 out-of-pocket limit: use only the Free Sandbox's included allowance, and do not proceed with any configuration whose usage or add-on charges could exceed it. Northflank's billing overview showed $0 usage against a $50 billing threshold; that threshold is not authorization to spend or a hard spending cap. The project creation form previously reported the free PaaS project limit reached, so `Default` is the only known project to reuse. Current public quota descriptions conflict: the [pricing page](https://northflank.com/pricing) lists two free projects, while [create-project docs](https://northflank.com/docs/v1/application/getting-started/create-a-project) say one project. Edge was unavailable for a fresh account check during this review; do not rely on another project slot until the dashboard confirms it.

Northflank marked the [security incident](https://status.northflank.com/cmvv0rn5a092f14rutwccodpp) resolved on November 17, 2026 at 17:24 UTC; the independent forensic review continues. Northflank asks users to rotate all project and integration secrets and review provider logs. No old Northflank project exists in the signed-in account, so backend credentials must be newly provisioned. The only local `.env` found is in the untracked nested app copy and contains client-side `VITE_*` Firebase/Supabase configuration; it does not contain the API database connection, Firebase Admin service account, or Gemini worker key. Four Northflank secret/config groups now contain names only; every value remains blank. No new secret values have been generated, copied, or entered.

## Build configuration

CI run [#161](https://github.com/BaoAnh109/Qizzone/actions/runs/44113974572) passed on the reviewed revision. Frontend dependency audit, lint, tests, TypeScript/Vite build, backend restore/audit/tests/build, and AMD64/ARM64 API and worker image builds all completed successfully. Run #158 included the PostgreSQL 17 concurrency test submitting one attempt 100 times through two independent API hosts. Images remain build-validated only; they were not pushed to a registry.

The latest PostgreSQL-backed local backend Release suite passed all 37 API and 7 worker tests with zero skips against temporary native PostgreSQL 17.12, including schedule transitions, JSONB assignment filtering, two-host submit contention, five-option constraints, owner-only avatar assignment, quiz/practice row-lock regressions, API cancellation, and worker abort of a mocked in-flight Gemini request. The regenerated 14-migration idempotent script applied twice on a disposable database; the schedule rollback removed its columns/history row and reapplying restored them. The migration CLI's synthetic fixture rehearsal (`backend/Qizzone.MigrationTool/Run-SyntheticRehearsal.ps1`) also passed, preserving a resumable open attempt with a null deadline, answer, and revision. This is local evidence only; no Northflank service/database or hosted-target migration/rollback rehearsal exists.

After a new isolated PostgreSQL database and fresh runtime credentials are provisioned, configure repository-backed services as follows:

| Service | Build context | Dockerfile | Ingress / health |
|---|---|---|---|
| `qizzone-api` | `backend/` | `Dockerfile` | HTTP port `8080`; `/health/live` and `/health/ready` |
| `qizzone-worker` | `backend/` | `Qizzone.Worker/Dockerfile` | No public ingress |

Both services must use the same private PostgreSQL connection. Do not expose PostgreSQL publicly.

## Required runtime configuration

The following Northflank groups are prepared in `Default`; all values are blank. Keep the Firebase Admin credential API-only and the Gemini key worker-only. Do not put secrets in Git, images, or logs. The owner confirmed there is no previous project or secret store, so backend credentials must be freshly created in their provider consoles.

| Group | Type | Scope | Attach to | Names already present |
|---|---|---|---|---|
| `qizzone-backend-runtime` | Secret values | Runtime only | API only | `FIREBASE_SERVICE_ACCOUNT_JSON` |
| `qizzone-api-config` | Configuration values | Runtime only | API only | `Firebase__ProjectId`; `Cors__AllowedOrigins__0`; `AllowedHosts`; `Admin__BootstrapUids__0`; `ASPNETCORE_ENVIRONMENT`; `Media__RootPath` |
| `qizzone-worker-secrets` | Secret values | Runtime only | Worker only | `Gemini__ApiKey` |
| `qizzone-worker-config` | Configuration values | Runtime only | Worker only | `Gemini__Model`; `DOTNET_ENVIRONMENT` |

Do not create an empty `ConnectionStrings__Qizzone` value. Once the private PostgreSQL addon exists, link its connection details to the API and worker groups so the platform supplies the connection string. `Media__RootPath` must match the API's persistent volume mount; choose and fill it only after the volume exists.

All four groups are still project-unrestricted and are not attached to any workload. When API and worker services exist, restrict and attach the two API groups only to `qizzone-api` and the two worker groups only to `qizzone-worker` before entering credentials.

| Workload | Required names |
|---|---|
| API | Linked private `ConnectionStrings__Qizzone`; `Firebase__ProjectId`; `FIREBASE_SERVICE_ACCOUNT_JSON` (or ADC); `Cors__AllowedOrigins__0`; `AllowedHosts`; `Admin__BootstrapUids__0`; `ASPNETCORE_ENVIRONMENT=Staging`; `Media__RootPath` plus a persistent volume mounted at the same path |
| Worker | Linked private `ConnectionStrings__Qizzone`; `Gemini__ApiKey`; `Gemini__Model`; `DOTNET_ENVIRONMENT=Staging` |

The API fails its production startup checks when database, Firebase Admin, allowed-origin/host, persistent media path, or bootstrap-admin configuration is missing. The worker validates its Gemini key and model at startup. `deploy/.env.pilot.example` contains placeholders only.

## Free Sandbox sizing candidate

The PostgreSQL 17 creation form in the existing `Default` project defaulted to one replica, private access, TLS enabled, `nf-compute-20` (0.2 shared vCPU / 512 MiB), and a 6 GiB NVMe disk. At current public rates, that is about **$6.10/month** ($5.40 compute + $0.70 disk). An API and worker each at `nf-compute-20` would add about $5.40/month apiece, for **$16.90/month total** before image builds, logs, egress, backup storage, and other metered usage. The Free Sandbox includes up to $20/month of resources; this leaves only about $3.10 for all other usage, so this is a sizing candidate, not a guaranteed $0 bill. The API/worker memory limits are staging-only and require runtime validation. Do not enable public database access, extra replicas, backup schedules, larger plans, PAYG, or BYOC under the current $0 budget. If the final dashboard estimate does not stay inside the included allowance with a reasonable margin, do not create the resource.

## Database migration gate

The API does not apply EF migrations automatically at startup. CI and the latest local test suite have applied EF migrations to isolated PostgreSQL 17 schemas, but no target database exists in the current Northflank project. The local `deploy/migrations/qizzone-idempotent.sql` companion currently contains all 14 migration IDs in this worktree; it is uncommitted and unapplied. Re-review it against the exact clean release revision and apply it only to a disposable staging database. Do not run it against the live Supabase source.

The live Supabase migration history differs from the checkout for avatar storage, and the local question-media migration is not present in live history. Resolve that drift and complete export/reconciliation/backup/restore rehearsal before any data cutover.

## Remaining gates

- Reuse the empty `Default` project for isolated staging; do not upgrade under the $0 out-of-pocket limit. Northflank's current [pricing page](https://northflank.com/pricing) lists two free projects and up to $20/month of resources across two services and one database, while the [create-project docs](https://northflank.com/docs/v1/application/getting-started/create-a-project) say one free project. Edge was unavailable to recheck the account-specific quota, so treat `Default` as the only confirmed project. The Free Sandbox is for testing and should not be used for production. Verify the exact estimate and usage before each resource creation.
- Fill the prepared groups with a fresh Firebase Admin service-account JSON, Firebase project ID, Gemini API key and model, staging frontend/API hosts, verified bootstrap admin UID, environment names, and the volume mount path. Enter credentials directly into Northflank, never in chat or Git.
- Do not provision paid resources. The Free Sandbox is suitable only for staging/testing; production requires a separately approved nonzero budget and production-capable hosting.
- Obtain a deployable staging PostgreSQL connection and run target migration/rollback rehearsal.
- Deploy API and worker, then verify health endpoints, Firebase identity, private database networking, and a controlled Gemini job.
- Finish remaining feature parity, data reconciliation, browser E2E, load/failure tests, backup/restore, observability, and rollback evidence before production cutover.

The Northflank [Free Sandbox is intended for testing and should not be used for production](https://northflank.com/docs/v1/application/billing/pricing-on-northflank). The pricing page advertises up to $20/month of free resources and says no card is needed, while the detailed billing guide says every user must add a payment method before creating resources. The [billing-threshold guide](https://northflank.com/docs/v1/application/billing/billing-thresholds) lists $50 as the default threshold, applies credits to invoices, and charges any remainder to the payment method; this is not a hard spending cap. Northflank also says the threshold cannot be set below credits previously purchased. Since the owner set a $0 out-of-pocket cap and the resource estimate leaves little room for metered build/log/egress/storage costs, the sandbox cannot currently be provisioned with a verified zero-charge boundary. No metered workload resources are being created. The Free Sandbox does not meet the production release gates in `docs/audit/RELEASE_READINESS.md`. No production URL, DNS change, data cutover, or Northflank workload deployment is recorded by this runbook.
