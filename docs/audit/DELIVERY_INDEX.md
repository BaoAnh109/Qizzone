# V2 delivery artifact index

The V2 master plan's final artifact list is tracked here. “Artifact exists” means documentation is present; it does not mean its acceptance gate passed.

| Required artifact | Current file | Evidence status |
|---|---|---|
| Exact source revision and dependency versions | [SOURCE_REVISION.md](SOURCE_REVISION.md), repository lockfiles | **Incomplete** — current tree is dirty; no releasable SHA or release image digests. |
| Student/teacher/admin/import feature parity | [FEATURE_PARITY_MATRIX.md](FEATURE_PARITY_MATRIX.md) | **In progress** — local implementation and focused tests; authenticated staging parity is open. |
| Schema, seed, indexes, EF mappings | [DATABASE_SCHEMA_AND_MAPPINGS.md](DATABASE_SCHEMA_AND_MAPPINGS.md) | **Local review recorded** — hosted schema/data migration is not verified. |
| Authorization and security review | [AUTHORIZATION_AND_SECURITY.md](AUTHORIZATION_AND_SECURITY.md) | **Partial / NO-GO** — focused PostgreSQL regression passes on a minimal fixture; full migration-chain/staging verification, external review, and runtime checks remain. |
| Autosave protocol and failure behavior | [AUTOSAVE_PROTOCOL_AND_FAILURES.md](AUTOSAVE_PROTOCOL_AND_FAILURES.md) | **Local evidence recorded** — cross-device, real offline, quota, and staging failure tests are open. |
| AI extraction evaluation | [AI_EXTRACTION_EVALUATION.md](AI_EXTRACTION_EVALUATION.md) | **Limited** — one PDF replay; other formats/corpus accuracy and live Gemini cost are unmeasured. |
| Test plan and execution evidence | [TEST_PLAN_AND_RESULTS.md](TEST_PLAN_AND_RESULTS.md) | **Partial** — exact-release CI, full role E2E, staging, and failure evidence remain. |
| Load test report | [LOAD_TEST_REPORT.md](LOAD_TEST_REPORT.md) | **Partial** — focused 100-repeat idempotency check; broad 100-user capacity is unmeasured. |
| Migration reconciliation | [MIGRATION_RECONCILIATION.md](MIGRATION_RECONCILIATION.md) | **NO-GO** — synthetic fixture only; no export/restore/live import. |
| Backup and restore proof | [BACKUP_RESTORE_PROOF.md](BACKUP_RESTORE_PROOF.md) | **NOT PROVEN** — a synthetic local PostgreSQL dump/restore passed; real staging, encrypted media backup, offsite read-back, and production restore remain open. |
| Northflank sandbox deployment | [DEPLOY_NORTHFLANK_SANDBOX.md](../DEPLOY_NORTHFLANK_SANDBOX.md) | **Not deployed** — four variable-name groups are prepared with blank values; no runtime URL, host, or smoke evidence. |
| Production deployment plan | [DEPLOY_PRODUCTION.md](DEPLOY_PRODUCTION.md) | **NO-GO** — no qualified $0 production host and open release gates. |
| OCI Always Free implementation candidate | [QIZZONE_V2_OCI_ALWAYS_FREE_DEPLOY_PLAN.md](../plans/QIZZONE_V2_OCI_ALWAYS_FREE_DEPLOY_PLAN.md), [OCI Compose](../../deploy/compose.oci.yaml), [OCI runbook](../../deploy/README.md) | **Prepared only** — host/account, quota, free backup destination, Compose rendering, and restore evidence remain unverified. |
| Rollback and incident response | [ROLLBACK_AND_INCIDENT_RUNBOOK.md](ROLLBACK_AND_INCIDENT_RUNBOOK.md) | **Draft** — written procedure; no staging/production drill. |
| Release notes | [RELEASE_NOTES.md](RELEASE_NOTES.md) | **Checkpoint only** — no released version. |
| Release approval checklist | [RELEASE_APPROVAL_CHECKLIST.md](RELEASE_APPROVAL_CHECKLIST.md) | **NO-GO** — standing authorization to self-review/deploy exists, but no candidate SHA or staging evidence is available. |

No artifact contains secrets or production record contents. The authoritative combined release decision is in [RELEASE_READINESS.md](RELEASE_READINESS.md); the decision remains NO-GO until its evidence gaps are closed.
