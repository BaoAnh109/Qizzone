# Qizzone V2 production release runbook

**Status:** NO-GO; staging and release gates are incomplete
**Implementation branch:** `feat/qizzone-v2-backend-aiv3` (isolated worktree; do not switch or modify other branches)
**Reviewed candidate:** `3c5199581f72046e2595d865be18cc9567785657`

## Active hosting plan

The owner set a hard $0 out-of-pocket limit and requested execution of the OCI Always Free plan. The active candidate and step-by-step status are tracked in [QIZZONE_V2_OCI_ALWAYS_FREE_DEPLOY_PLAN.md](../plans/QIZZONE_V2_OCI_ALWAYS_FREE_DEPLOY_PLAN.md). The Northflank notes below are the previous provider assessment; they do not authorize provisioning. The OCI Compose/environment/systemd files are only local preparation. Production remains NO-GO until account, region/quota, capacity, DNS, independent free backup storage, staging, migration/restore, feature, and release gates are evidenced.

## Current service state

- Vercel production currently serves commit `3c519958` from `devolop/AIV3`. The Vercel project dashboard says future production updates come from `main`.
- A read-only browser check on 2026-11-18 reached the public `/login` route. This confirms the site responds; it does not identify the deployed SHA or verify authenticated API flows.
- The latest read-only Edge check showed the Free team (`Cryzy's Team`), one `Default` project and `Default` environment in US Central (Council Bluffs), Developer Sandbox, `$0.00 of $50.00` used, and an active payment method. The project page offered repository deployment and database creation; Services and Addons views had no inventory rows, which does not independently prove resource absence. The owner confirmed no previous Northflank project exists and directed us to start from scratch. Public quota docs conflict: [pricing](https://northflank.com/pricing) lists two free projects, while the [create-project guide](https://northflank.com/docs/v1/application/getting-started/create-a-project) says one.
- The owner chose $0 out-of-pocket and asked to use a free option where possible. The current Northflank Free Sandbox can be used for isolated testing only, not production.
- No Northflank service/database, metered workload, migration, DNS entry, or traffic route was created or changed. Four Northflank secret/config groups now contain variable names only; their values remain blank and no credential was entered.
- Prepared an unexecuted portable single-host pilot bundle under deploy/: Caddy ingress, private PostgreSQL networking with separate API/migration roles, opt-in AI/data-import jobs, file-based secret configuration, encrypted backup/isolated restore-drill scripts, and an optional rclone offsite-copy helper with read-back verification. It is not a production deployment or proof of recovery.
- Northflank states that its Free Sandbox is for testing and should not be used for production. Its security incident was marked resolved on November 17, 2026 at 17:24 UTC, but the forensic review continues and Northflank asks users to rotate all project/integration secrets and review provider logs. No old project exists in the signed-in account; create fresh credentials directly in provider consoles and enter them only in the platform secret store.

## No-interruption deployment rules

1. While any gate below is open, do not push to any branch connected to Vercel. Vercel creates Preview deployments on branch pushes and a Production deployment when the configured production branch is updated ([Git deployments](https://vercel.com/docs/git)). Do not promote a build, change production settings, or change DNS during implementation.
2. Keep the current Vercel production deployment serving users while building and testing isolated OCI staging. Use a staging database and test Firebase identity; never point staging at production Supabase or production exam data.
3. Deploy the API and worker alongside the current frontend. Keep Supabase as the active system of record until import reconciliation, E2E smoke, and rollback evidence pass.
4. The OCI beta footprint is one VM with one API container, so a later API replacement can briefly interrupt API requests. For first cutover, start and health-check V2 before promoting the frontend. If uninterrupted backend rollout is required, this $0 single-host candidate fails the gate and V1 stays active.
5. Run database changes as an explicit one-off migration step after a verified backup and before deploying code that depends on them. Prefer expand → migrate → contract so the old application continues to work during rollout.
6. After all five release gates are GO, create a staged Production build with automatic domain assignment disabled, verify that build directly without assigning the production domain, then promote that exact staged build manually. Vercel documents that staged Production promotion reassigns the domain without a rebuild; promoting a Preview instead triggers a full rebuild ([promotion workflow](https://vercel.com/docs/deployments/promoting-a-deployment)). Keep the previous deployment available for rollback.

Provider references for the previous Northflank assessment: [production release and rolling deployments](https://northflank.com/docs/v1/application/production-workloads/release-for-production), [health checks](https://northflank.com/docs/v1/application/observe/configure-health-checks), [database migration sequencing](https://northflank.com/docs/v1/application/release/run-migrations), [Free Sandbox limitations](https://northflank.com/docs/v1/application/billing/pricing-on-northflank), [security incident notice](https://status.northflank.com/cmvv0rn5a092f14rutwccodpp).

## Cost gate

The Northflank Free Sandbox includes up to $20/month of Northflank Cloud resources for testing, but Northflank says it should not be used for production. The owner's approved out-of-pocket budget is **$0/month**; do not upgrade to PAYG/BYOC or create workloads that could exceed the included allowance. The latest billing page showed `$0.00 of $50.00` used and an active payment method. That $50 threshold is not a hard spend cap; Northflank applies credits before automatically charging any remaining balance. Current Northflank docs state that users must add a payment method before creating resources; the pricing page's “no card needed” statement conflicts with its detailed billing guide. The project inventory is not fully verified: the dashboard has one `Default` project, and Services/Addons views showed no rows. A staging sizing candidate using PostgreSQL 17 at `nf-compute-20` with a 6 GiB disk, plus API and worker each at `nf-compute-20`, estimates **$16.90/month before build, logs, egress, backups, or other charges**, leaving about $3.10 of the free allowance for them. This estimate has not been submitted in the dashboard and the small memory plans are not validated. Without a verified hard $0 cap, this margin does not make provisioning safe under the approved budget. A rough production shape with two API replicas (1 vCPU / 2 GB each), one worker (0.5 vCPU / 1 GB), and a 10 GB PostgreSQL addon is approximately **$73/month before egress, backup/log storage, HA replicas, tax, and other charges**. Northflank is not a $0 production option. See [Northflank pricing](https://northflank.com/pricing), [billing setup](https://northflank.com/docs/v1/application/billing/pricing-on-northflank), and [billing thresholds](https://northflank.com/docs/v1/application/billing/billing-thresholds) for the current allowance and charge sequence.

### No-cost candidate researched: Oracle Cloud Always Free

Oracle currently documents an Always Free Ampere A1 allowance of 2 OCPUs and 12 GB RAM, 200 GB combined block volume, 20 GB combined object/archive storage and up to five block-volume backups in the tenancy home region. The account must stay within the Always Free allocation and must not be upgraded to a paid account to preserve the user's $0 cap. Oracle also documents temporary lack of A1 host capacity and possible reclamation of idle Always Free instances after a seven-day window when CPU, network and (for A1) memory utilization are all below specified thresholds. See [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) and [Free Tier account behavior](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm).

A single A1 VM could host Caddy, the Qizzone API, PostgreSQL and the AI worker within the published compute allowance, with database backups copied to OCI Object Storage. This is a **candidate for an isolated, low-scale pilot only**: all application roles share one host and one provider region, so it does not provide multi-host availability or an independent disaster-recovery region. A read-only Edge check reached the `qizzone` tenancy. The Console says the tenancy is in a Free Trial, Billing shows Plan type `Free Tier` and Account type `Promo`, and the region menu confirms Singapore as home region. The VM wizard reports no available shapes for its default Oracle Linux 9 image; OCI says service limits or capacity may be responsible. The instance and image lists fail to load because of console authentication errors, so A1 quota, capacity, Always Free labels and inventory remain unverified. No cloud resource has been created. Do not provision anything until a clearly Always Free shape and quota are confirmed; set compartment quotas and avoid paid upgrade prompts. If the project requires resilient official exam operations, the free single-host candidate does not pass the production operations gate.

### Existing Supabase Free project: staging-only fallback

A read-only connected-account check on 2026-11-18 found the existing `Qizzone` organization on the Free plan and its `qizzone` project `ACTIVE_HEALTHY` on PostgreSQL 17.11.0.003 in `ap-southeast-2`; one project is present. Current Supabase billing documentation includes two Free projects per owner/admin account, but this does not make a new project a production-ready V2 host. Free projects can pause after seven days of low activity, enter read-only mode above 500 MB of database data, and do not receive automatic daily backups. A second isolated Free project may be considered for migration rehearsal only, after the owner selects the organization and the provider confirms a $0 quote. No project was created and no source data was copied. See [Supabase Free Plan quotas](https://supabase.com/docs/guides/platform/billing-on-supabase), [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [database size limits](https://supabase.com/docs/guides/platform/database-size), and [backup guidance](https://supabase.com/docs/guides/platform/backups).

Therefore the $0 limit has a possible pilot path but **no currently qualified production host**. Full production remains NO-GO until hosting, failure tolerance, backup/restore, cost boundary, monitoring and release gates are proven.

Other no-cost offers do not currently clear the production gate either. Google's Cloud Run request-billed tier includes monthly CPU/RAM/request allowances, but usage beyond them is billed, so it is not a hard $0 cap ([Cloud Run pricing](https://cloud.google.com/run/pricing)). Render explicitly says its free services are not for production; web services sleep after 15 minutes idle and free PostgreSQL expires after 30 days without backups ([Render free service limitations](https://render.com/docs/free)). Supabase Free includes 500 MB database storage but may pause after a week of low activity and excludes automatic backups/PITR ([Supabase pricing](https://supabase.com/pricing), [free-project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)). These are test/hobby options, not a verified always-available production target for this app.

## Release gates

### Gate 1 — functional parity

- Complete the feature matrix for student, teacher, and admin flows, including room/join-by-code lifecycle and class-assignment eligibility, uploads/storage, reports, and all account flows.
- Pass browser E2E for auth, quiz authoring, join, exam, autosave/offline reload, submit/grading, result, practice, admin, and document import.
- Confirm no required production operation still depends on an unported Supabase RPC, Edge Function, or Storage path after the planned cutover.

### Gate 2 — data and recovery

- Capture a source backup and prove restore before migration rehearsal.
- A synthetic rehearsal of `backend/Qizzone.MigrationTool` passed against disposable PostgreSQL 17.12: digest gate, apply, idempotent replay, target counts/checksums, and reconstructed exam snapshots all verified. Its open attempt had `ends_at IS NULL` and retained saved answer `B`, revision `7`, and resumability. A synthetic target-only `media_objects` row also blocked both plan and apply without importing source rows. Still rehearse it on a backup-restored staging target before cutover. The tool preserves Firebase UIDs/business IDs and verifies relational row counts/checksums, but does not create backups, move storage objects, map Firebase account state, or prove business-level reconciliation; cover those separately.
- Rehearse on isolated staging; reconcile required row counts, foreign keys, answer keys, attempts/results, and object hashes.
- Record RPO/RTO, backup retention, restore evidence, and data-safe rollback. A frontend/DNS rollback alone is not safe after writes have moved.

### Gate 3 — security

- Create fresh Firebase Admin and Gemini credentials in the respective provider consoles; store values only in root-protected host secret files outside Git and image build arguments.
- Verify Firebase token issuer/audience/revocation and server-side role/ownership checks, private database networking, TLS, CORS, upload validation, quotas, and no answer-key leakage.
- Keep all runtime credentials in the protected host secret directory; never write their values to Git, logs, command arguments, or this runbook.

### Gate 4 — quality

- Run CI on the exact release SHA; complete Playwright E2E, multi-tab/offline/quota autosave cases, 100-user load on production-sized infrastructure, concurrency, worker/API restart, and migration/restore tests.
- Record environment, hardware, p95/p99, error rate, autosave integrity, submit integrity, and worker recovery results. Do not extrapolate production capacity from Free Sandbox.

### Gate 5 — operations

- Use production-capable hosting with approved cost, resource sizing, backup policy, alerts, incident runbook, SLO, and rollback plan.
- Confirm API health/readiness, database private endpoint, worker queue metrics, log redaction, and production monitoring before switching traffic.
- Retain the old Supabase services and frontend deployment through the agreed rollback window; decommission only after sign-off.

## Cutover sequence (only after all five gates pass)

1. Record the approved SHA and release artifact hashes. Confirm active attempts and browser-pending answers are synchronized for import/resume, then announce the planned source write freeze.
2. Verify a fresh source backup and a successful restore to an isolated target. Start a short read-only/maintenance window for the final export.
3. Execute reviewed PostgreSQL migrations once. Run the tool's read-only `plan`, review its digest and blocker report, then use `apply --expected-source-digest` only after backup/restore proof, the source is frozen, browsers have synchronized pending answers, external auth/storage references are reconciled, and an isolated rehearsal has passed. The importer preserves open attempts and their answers for V2 resume, including null deadlines; it rechecks the source digest before commit and rolls back if it changed. Reconcile counts/hashes and business results before allowing writes.
4. Deploy API and worker using rolling readiness checks. Test public API health, private DB access, Firebase login, create/join, autosave, submit, result, and one controlled AI job.
5. Promote the verified frontend deployment to production manually. Smoke-test login, core student/teacher flows, browser console/network, and error metrics.
6. Watch latency, errors, worker backlog, database health, autosave acknowledgements, and submission counts through the rollback window.
7. If any data discrepancy or critical error appears, stop new writes first. If the new system has accepted writes, reconcile/reverse-sync before routing users back; do not only revert DNS or the Vercel alias.
8. Sign off the release only after evidence, RPO/RTO, monitoring, and rollback checks are recorded. Keep Supabase until the rollback period is closed.

## Rollback

- **Before new-system writes:** manually restore the previous Vercel production deployment and keep Supabase active; verify login and core flows.
- **After new-system writes:** pause writes on both systems, preserve both databases, reconcile the write interval, then choose reverse-sync or a planned maintenance restore. Never discard or silently split acknowledged exam answers/results.
- **Schema change:** do not assume an EF `Down` migration is a safe production rollback. Use a reviewed forward-fix or restore the verified backup after protecting post-backup writes.
- **Worker failure:** pause AI processing only; exam autosave/submission must remain available. Retry durable jobs after database and worker health return.

## Current blockers

- The owner authorized starting from scratch, but required Firebase Admin and Gemini credentials have not yet been created.
- The owner set the out-of-pocket spending cap to $0; Northflank Free Sandbox cannot be treated as production. Oracle's official Free Tier currently includes an Ampere A1 allowance equivalent to 2 OCPU/12 GB RAM and 200 GB block storage in the tenancy's home region, but Oracle states that Free Tier has no SLA. A single-VM deployment would still colocate API, worker, and PostgreSQL without high availability; it does not satisfy the plan's current production availability/recovery gate ([Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Free Tier FAQ](https://www.oracle.com/cloud/free/faq/)).
- OCI Console access and Free Trial/Free Tier status are confirmed in the signed-in Edge profile for tenancy `qizzone`: Billing shows Plan type `Free Tier`, Account type `Promo`, and the region menu identifies Singapore as home region. The VM wizard shows no shapes for its default image and says service limits or capacity may be the cause; A1 Always Free labels, quota/capacity and full resource inventory remain unverified. No cloud resources have been created. `qizzone.site` is planned but has not been purchased or configured; a domain purchase is outside the current $0 cap.
- Hosted-target/backup-restored migration rehearsal, target PostgreSQL, Firebase staging identity, source-data import/reconciliation, storage migration, real Gemini test, E2E/load/failure tests, backup/restore, and monitoring/rollback proof remain incomplete. The local synthetic fixture rehearsal is recorded separately and does not satisfy these gates.
- Therefore the candidate SHA is not a production release and must not replace the live deployment yet.

## Pilot artifact status

The deploy/pilot bundle is intended only for isolated staging. Standalone Compose 2.40.3 rendered the base and optional worker/import overlays with dummy secret paths; no containers or images were built, and PostgreSQL role initialization has not been run against PostgreSQL. The Docker Engine remains unavailable. The backup/restore scripts have not been run against real database or media data. The offsite helper passed syntax and mock-rclone checks, including read-back corruption rejection, but no real provider or destination is configured. No cloud host, database, DNS record, secret value, offsite destination, or production route was created or changed. Northflank has four names-only secret/config groups with blank values. The bundle also has no high availability, external monitoring, or zero-downtime API release mechanism, so it cannot satisfy the production operations gate on its own.
