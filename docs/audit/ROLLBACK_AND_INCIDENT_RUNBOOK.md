# Rollback and incident runbook

**Status:** procedural draft; no staging or production drill has passed.
**Scope:** future V2 cutover while the existing Vercel/Supabase path remains the active service.

## Release safety rules

- Keep the current production frontend and Supabase services serving users while V2 is built and validated.
- Do not push a candidate revision to a Vercel-connected branch while release gates are open. Do not change the production branch, domain, DNS, API URL, or deployment settings during implementation.
- Northflank Free Sandbox is staging only. The approved out-of-pocket limit is $0; do not create a resource whose charges cannot be held within that limit.
- Promote only an exact, reviewed artifact after all release gates pass. Where Vercel is used, stage the Production build with automatic domain assignment disabled, verify that build, then manually promote that exact build. Preserve the previous deployment for rollback.
- A frontend alias/DNS rollback is not data-safe after V2 has accepted writes.

## Before a cutover window

1. Record the signed release SHA, image digests, migration versions, source aggregate counts/digest, and target backup-set ID.
2. Verify a backup restore in isolated staging and retain the evidence in `BACKUP_RESTORE_PROOF.md`.
3. Confirm Firebase identity/role reconciliation, media hashes, migration checksums, API health, alerts, and rollback operators.
4. Rehearse the exact route and write-freeze procedure. Confirm the V1 source remains available and that acknowledged browser outbox mutations are synchronized.
5. Define a short, announced source write freeze. Do not start migration until the plan digest matches the reviewed source snapshot.

## Incident triage

1. Declare an incident when there is suspected answer/result loss or leakage, cross-user access, sustained API/DB failure, a failed migration, or a material mismatch in import counts/hashes.
2. Preserve evidence: deployment and image IDs, UTC timestamps, health/alert state, redacted logs, migration status, and database counts. Do not copy tokens, answer keys, or personal record contents into tickets or this repository.
3. If exam integrity or ownership is uncertain, stop new writes to the affected path first. Keep read-only access only if it is known safe. Do not restart migrations or delete resources to clear an error.
4. Notify the project owner with affected flows, user-visible impact, last known good revision, data-preservation steps, and the next decision needed.
5. Resume only after the cause is contained, integrity checks pass, and the owner accepts the recovery plan.

## Rollback decision

### Before V2 accepts writes

- Stop or disable V2 API/worker traffic while preserving its database and logs for investigation.
- Restore the previous Vercel production deployment and keep Supabase as the system of record.
- Verify sign-in, quiz listing/join, exam save/submit, results, and the practice-explanation behavior. The local source migration `20261118042717_gate_practice_explanations.sql` is unexecuted; do not claim the live V1 RPC is fixed until the migration is applied through the reconciled, tested rollout or the V1 path is retired.

### After V2 accepts writes

- Pause writes on both systems and preserve both databases and media volumes.
- Determine the exact write interval and reconcile attempts, answers, results, practice sessions, and media. The current importer is one-way and is not a reverse-sync tool.
- Choose a reviewed reverse-sync or a planned maintenance restore only after the write set and integrity checks are understood. Keep users in a safe read-only/maintenance state if reconciliation is incomplete.
- Route traffic back only after the destination contains every acknowledged answer/result. Never discard V2 writes by alias rollback alone.

### Migration or infrastructure failure

- Do not assume an EF `Down` migration is a safe production rollback. Prefer a reviewed forward fix or restore of a verified backup after protecting writes made since that backup.
- If the worker fails, pause AI jobs only; preserve exam autosave and submission service where safe. Resume durable jobs after database and worker health recover.
- If the single host or database is unavailable, follow the approved recovery plan. The current pilot bundle has no HA and has not demonstrated recovery time.

## Closeout record

Record incident start/end (UTC), impact, affected release SHA, data integrity result, recovery steps, measured downtime, lost/duplicated writes (target: zero acknowledged exam answers), backup IDs, and follow-up actions. Keep the previous production path until the agreed rollback window closes.
