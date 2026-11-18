# Northflank deployment runbook

**Product:** Qizzone
**Working branch:** `devolop/AIV3`
**Reviewed revision:** `ef5a34067f0c27c0fbb3300fa62dd263b6cfcda6`
**Status:** Not deployed; existing backend credentials are not available in the inspected project

## Current platform state

The signed-in Northflank account has a Free team and a project named `Default`. The project has no services, PostgreSQL addon, or secret groups. The dashboard is in the US Central region. The project therefore has no existing backend secret group to reuse.

The dashboard warns that user-defined credentials created before October 30 are in scope of the Northflank incident. The owner instructed that existing secrets be reused and not recreated. The only local `.env` found is in the untracked nested app copy and contains client-side `VITE_*` Firebase/Supabase configuration; it does not contain the API database connection, Firebase Admin service account, or Gemini worker key. No secret values were copied, rotated, or entered.

## Build configuration

CI run [#158](https://github.com/BaoAnh109/Qizzone/actions/runs/44099953969) passed the frontend, backend, and container-build jobs. The backend suite includes a PostgreSQL 17 concurrency test submitting one attempt 100 times through two independent API hosts. Buildx successfully built the API and worker for `linux/amd64` and `linux/arm64`. These images were build-validated only; they were not pushed to a registry.

When the existing credentials/database source is available, configure repository-backed services as follows:

| Service | Build context | Dockerfile | Ingress / health |
|---|---|---|---|
| `qizzone-api` | `backend/` | `Dockerfile` | HTTP port `8080`; `/health/live` and `/health/ready` |
| `qizzone-worker` | `backend/` | `Qizzone.Worker/Dockerfile` | No public ingress |

Both services must use the same private PostgreSQL connection. Do not expose PostgreSQL publicly.

## Required runtime configuration

Supply values from the existing secret store; do not put values in Git, images, or logs.

| Workload | Required names |
|---|---|
| API | `ConnectionStrings__Qizzone`; `Firebase__ProjectId`; `Firebase__ServiceAccountJson` (or `FIREBASE_SERVICE_ACCOUNT_JSON` / Google ADC); `Cors__AllowedOrigins__0`; `AllowedHosts`; `Admin__BootstrapUids__0`; `ASPNETCORE_ENVIRONMENT=Production` |
| Worker | `ConnectionStrings__Qizzone`; `Gemini__ApiKey`; `Gemini__Model` |

The API fails its production startup checks when database, Firebase Admin, allowed-origin/host, or bootstrap-admin configuration is missing. The worker validates its Gemini key and model at startup. `backend/.env.example` contains placeholders only.

## Database migration gate

The API does not apply EF migrations automatically at startup. CI has applied migrations to isolated PostgreSQL 17 test schemas, but no target database exists in the current Northflank project. Generate the idempotent SQL with the checked-in `dotnet-ef` tool manifest, inspect it, and apply it to a disposable target-equivalent database before staging. Do not run it against the live Supabase source.

The live Supabase migration history differs from the checkout for avatar storage, and the local question-media migration is not present in live history. Resolve that drift and complete export/reconciliation/backup/restore rehearsal before any data cutover.

## Remaining gates

- Locate the existing backend credentials and database connection the owner requested be reused. The current Northflank project has no secret group or database addon.
- Obtain a deployable staging PostgreSQL connection and run target migration/rollback rehearsal.
- Deploy API and worker, then verify health endpoints, Firebase identity, private database networking, and a controlled Gemini job.
- Finish remaining feature parity, data reconciliation, browser E2E, load/failure tests, backup/restore, observability, and rollback evidence before production cutover.

The Northflank Free Sandbox is a test environment and does not meet the production release gates in `docs/audit/RELEASE_READINESS.md`. No production URL, DNS change, data cutover, or live deployment is recorded by this runbook.
