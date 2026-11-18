# Qizzone release readiness review

**Audit date:** 2026-11-17
**Working branch:** `devolop/AIV3` (unchanged)
**Starting revision:** `015f3e9efdcdc5bdf713d7c556efc95060f7de64`
**Decision:** **NO-GO for production**

## Work completed on the current branch

- Added ASP.NET Core 10 API, Firebase Admin token verification, PostgreSQL/EF Core models and migrations, Dockerfile and backend CI validation.
- Added API flows for profile/role/admin, quiz CRUD/assignments, server-controlled exam attempts/grading and practice sessions.
- Added frontend API adapters for auth/profile, admin, quiz, exam and practice; legacy Supabase paths remain for unconverted services.
- Added email verification status/resend UX and tests, plus API URL validation for HTTPS or local loopback HTTP.
- Added a PostgreSQL-backed Gemini worker for extraction and answer solving, bounded retries/lease recovery, teacher ownership, source-image validation, per-user quotas, request idempotency and prompt/image retention cleanup.
- Added IndexedDB exam snapshots/outbox, coalescing for unsent edits, stable mutation IDs, ordered retry/ack, revision conflict preservation and deadline warning UX; the API deduplicates committed mutations and the worker expires dedupe rows after 30 days.
- Added an owner-scoped teacher report API with server-side aggregates, search/status filters, pagination and question analytics; the teacher page uses server pagination and fetches all filtered rows for CSV export. The PostgreSQL integration test awaits CI.
- Added worker/API contract tests and migration/audit documentation. CI applied EF migrations to isolated PostgreSQL 17 schemas; the generated idempotent deployment script has not been run against the intended target database.

## CI and local validation

| Check | Result | Scope/limit |
|---|---|---|
| Frontend Vitest | 165 passed, 24 skipped; 33 files passed, 2 skipped | GitHub Actions run #158, source app only; nested user copy excluded |
| TypeScript `tsc -b` | Passed | GitHub Actions run #158; no browser E2E |
| ESLint `eslint src` | Passed | GitHub Actions run #158 |
| Vite production build | Passed | GitHub Actions run #158; static bundle, no production env values |
| NPM dependency audit | Passed; 0 vulnerabilities | GitHub Actions run #158, `npm audit --audit-level=high` |
| .NET API integration tests | 18 passed against PostgreSQL 17, including 100 concurrent submissions across two independent API hosts | GitHub Actions run #158; ephemeral service and isolated per-test schema, not the intended staging/production database |
| .NET worker tests | 6 passed | GitHub Actions run #158; Gemini HTTP is mocked |
| .NET solution Release build | Passed | GitHub Actions run #158; API and worker compile |
| API and worker containers | Both images built for `linux/amd64` and `linux/arm64` | GitHub Actions run #158; build-only, not pushed to a registry or deployed |
| PostgreSQL CI path | Passed remotely | Run #158 starts PostgreSQL 17 and applies EF migrations in isolated schemas; no target-environment migration or rollback rehearsal |
| EF migration review | Idempotent SQL script generated (26,371 bytes); no pending model changes | CI migration execution passed on ephemeral PostgreSQL; deployment script has not run against a target database and no rollback rehearsal exists |
| NuGet vulnerable package audit | No vulnerable packages reported | Current configured NuGet advisory sources |
| npm dependency audit | Passed; 0 vulnerabilities reported | Confirmed by GitHub Actions run #158 against the checked-in lockfile |

GitHub Actions run [#158](https://github.com/BaoAnh109/Qizzone/actions/runs/44099953969) passed on implementation revision `ef5a34067f0c27c0fbb3300fa62dd263b6cfcda6`. The cross-host PostgreSQL test submitted the same attempt 100 times through two API hosts and verified one result, one audit event and one revision increment. No deployed URL or runtime smoke test exists.

## Live source data evidence

The connected Supabase source project is active on PostgreSQL 17.11.0.003. Read-only exact aggregate counts found 12 profiles, 18 quizzes, 1,212 questions and answer keys, 56 attempts, 1,431 exam answers, 54 results, 5 practice sessions and 163 practice answers. One public `account-avatars` bucket has a 2 MiB limit and JPEG/PNG/WebP allowlist; it currently has zero objects. No personal rows or answer payloads were read.

Remote migration history differs from the checkout: live has avatar version `20261029072833`, while this checkout has `20261029130000_account_avatar_storage.sql`; local question-media migration `202611170001` is not applied. Reconcile migration history and schema before any source migration operation. These counts are an inventory only, not export/reconciliation/backup proof.

Security metadata review found RLS enabled across the business tables, with no direct policy for `exam_results` or `private.ai_limits` (reads/writes are routed through checked RPCs or service role). No inspected public/private function grants EXECUTE to `anon`. Two invoker identity helpers had mutable search paths; a local follow-up migration now pins them to an empty path. The migration has not been applied to the live source.

## Five release gates

| Gate | Status | Missing proof |
|---|---|---|
| Feature | **FAIL** | Autosave and teacher reports are implemented and locally validated; uploads/storage, classroom and join-by-code lifecycle, broader API parity and Supabase runtime migration remain |
| Data | **FAIL** | Production inventory/export/import, UID mapping, reconciliation, PostgreSQL rehearsal and restore |
| Security | **PARTIAL** | API enforces teacher ownership, image signature/size, quota and idempotency; no malware scanning, broader PostgreSQL ownership/concurrency suite, external review or complete secret-rotation evidence |
| Quality | **FAIL** | Frontend CI passed (165 tests, 24 skipped), npm audit reported 0 vulnerabilities, 18 API tests passed on ephemeral PostgreSQL 17 (including a two-host 100-submit concurrency test), 6 worker tests passed with mocked Gemini, and API/worker images built for both architectures in run #158; no E2E, k6, fault/restart, real browser multi-tab/device autosave, IndexedDB quota test or production-like test report |
| Operations | **FAIL** | No staging, cost/SLO/RPO/RTO evidence, backup restore, alerts/runbooks, rollback or deploy workflow. The Northflank project has no service, database addon or secret group; backend credentials were not found in the inspected local app configuration. Northflank displays an incident notice for credentials created before Oct 30; the owner directed reuse without rotation, so exposure remains unverified. |

## Hosting decision

The signed-in Edge dashboard currently shows a Free team with one empty project, no Qizzone services/database, and no secret group. Northflank documentation says its free tier is for testing/hobby projects and should not be used for production. The dashboard warns that user-defined credentials created before Oct 30 are in scope. The owner directed reuse without rotation and clarified that the old credentials are in another Northflank team/project; that location is not yet identified. No secret was copied or entered, no resource was created, and no DNS/traffic changed.

## Required before deployment

1. Complete feature parity, portable uploads/storage and teacher reports/classes; run browser coverage for the implemented autosave protocol.
2. Run PostgreSQL migrations against the intended version; execute SQL, constraints, indexes and rollback on a disposable staging database.
3. Create separate staging using the existing credentials the owner identifies, test Firebase identity, private DB networking and no production data; exercise the Gemini worker with a controlled non-sensitive fixture.
4. Complete source-data/object inventory, anonymized import rehearsal, row/hash reconciliation and a real backup/restore drill.
5. Pass E2E, security/ownership, autosave multi-tab/device race/offline/quota, load and failure-recovery checks; record real metrics and accepted RPO/RTO/cost.
6. Configure production-capable hosting, observability, backups, alerts and rollback. Keep other Git branches unchanged.

Until these are verified, the working tree is an implementation checkpoint, not a production release. Do not point the production frontend or domain at this API.
