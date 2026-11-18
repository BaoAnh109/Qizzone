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
- Added worker/API contract tests and migration/audit documentation. Generated migration SQL was reviewed locally but has not been applied to PostgreSQL.

## Reproducible local results

| Check | Result | Scope/limit |
|---|---|---|
| Frontend Vitest: `vitest run --dir src` | 181 passed, 24 skipped; 36 files passed, 2 skipped | Source app only; nested user copy excluded |
| TypeScript `tsc -b` | Passed | Typecheck, no browser E2E |
| ESLint `eslint src` | Passed | Source app |
| Vite production build | Passed | Static bundle, no production env values |
| .NET Release tests | 17 API + 6 worker tests passed locally | Includes 100 concurrent submit and duplicate autosave tests; this local run used EF InMemory and worker tests mock Gemini HTTP |
| PostgreSQL CI path | Configured, not yet executed remotely | CI starts PostgreSQL 17 to match the source project; API test factories use isolated schemas and apply EF migrations before requests |
| .NET solution Release build | Passed | API and worker compile; no Docker image build |
| EF migration review | Idempotent SQL script generated (26,371 bytes); no pending model changes | No PostgreSQL execution or rollback rehearsal |
| NuGet vulnerable package audit | No vulnerable packages reported | Current configured NuGet advisory sources |
| npm dependency audit | Not run | npm CLI is not installed/on PATH in this environment; must be run in CI or a Node/npm-enabled release environment |

No GitHub Actions run from the current revision was verified. No deployed URL or runtime smoke test exists.

## Live source data evidence

The connected Supabase source project is active on PostgreSQL 17.11.0.003. Read-only exact aggregate counts found 12 profiles, 18 quizzes, 1,212 questions and answer keys, 56 attempts, 1,431 exam answers, 54 results, 5 practice sessions and 163 practice answers. One public `account-avatars` bucket has a 2 MiB limit and JPEG/PNG/WebP allowlist; it currently has zero objects. No personal rows or answer payloads were read.

Remote migration history differs from the checkout: live has avatar version `20261029072833`, while this checkout has `20261029130000_account_avatar_storage.sql`; local question-media migration `202611170001` is not applied. Reconcile migration history and schema before any source migration operation. These counts are an inventory only, not export/reconciliation/backup proof.

Security metadata review found RLS enabled across the business tables, with no direct policy for `exam_results` or `private.ai_limits` (reads/writes are routed through checked RPCs or service role). No inspected public/private function grants EXECUTE to `anon`. Two invoker identity helpers had mutable search paths; a local follow-up migration now pins them to an empty path. The migration has not been applied to the live source.

## Five release gates

| Gate | Status | Missing proof |
|---|---|---|
| Feature | **FAIL** | Autosave local outbox and API idempotency are implemented and unit/API-tested; uploads/storage, teacher reports/classes, full API parity and Supabase runtime migration remain |
| Data | **FAIL** | Production inventory/export/import, UID mapping, reconciliation, PostgreSQL rehearsal and restore |
| Security | **PARTIAL** | API enforces teacher ownership, image signature/size, quota and idempotency; no malware scanning, PostgreSQL IDOR/concurrency suite, external review or complete secret-rotation evidence |
| Quality | **FAIL** | Local tests/build pass; the 100-request submit race ran against EF InMemory with an in-process gate; PostgreSQL CI is configured but has no verified remote run; no E2E, k6, fault/restart, real browser multi-tab/device autosave, IndexedDB quota test or production-like test report |
| Operations | **FAIL** | No staging, cost/SLO/RPO/RTO evidence, backup restore, alerts/runbooks, rollback, release workflow or production-capable hosting. The owner has authorized self-review/deployment, but no production resources or secrets exist to execute a release. |

## Hosting decision

The signed-in Edge dashboard currently shows a Free team with one empty project and no Qizzone services or database. Northflank documentation says its free tier is for testing/hobby projects and should not be used for production. The dashboard also displays its security incident notice; Northflank's latest incident update in the reviewed status page says its forensic review remains ongoing and asks users to rotate stored secrets. No secret was copied or entered, no resource was created, and no DNS/traffic changed.

## Required before deployment

1. Complete feature parity, portable uploads/storage and teacher reports/classes; run browser coverage for the implemented autosave protocol.
2. Run PostgreSQL migrations against the intended version; execute SQL, constraints, indexes and rollback on a disposable staging database.
3. Create separate staging with rotated secrets, test Firebase identity, private DB networking and no production data; exercise the Gemini worker with a controlled non-sensitive fixture.
4. Complete source-data/object inventory, anonymized import rehearsal, row/hash reconciliation and a real backup/restore drill.
5. Pass E2E, security/ownership, autosave multi-tab/device race/offline/quota, load and failure-recovery checks; record real metrics and accepted RPO/RTO/cost.
6. Configure production-capable hosting, observability, backups, alerts and rollback. Keep other Git branches unchanged.

Until these are verified, the working tree is an implementation checkpoint, not a production release. Do not point the production frontend or domain at this API.
