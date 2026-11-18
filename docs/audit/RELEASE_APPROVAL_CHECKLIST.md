# Release approval checklist

**Current decision: NO-GO.** Production promotion is not ready because release gates remain open. The owner has already authorized self-review and deployment once the gates pass; this checklist records technical evidence and does not require another approval request.

| Gate | Required evidence | Current status |
|---|---|---|
| Functional parity | Feature matrix complete; authenticated E2E for student, teacher, admin, import, exam, practice, and reports; no open P0/P1 | **OPEN** — teacher scheduling and frontend AI cancellation are wired locally; the API caps concurrent active attempts at 20. Local PostgreSQL integration verifies the cross-request race, resume at capacity, and expiry freeing a slot. Several role/import flows still have only mocked/local coverage, and these UI flows lack browser/staging E2E. |
| Data and recovery | Source backup and verified restore; hosted rehearsal from restored data; migration/checksum/identity/media reconciliation; autosave and submit integrity | **OPEN** — synthetic migration and local dump/restore rehearsals passed; no real source export, backup, hosted target, or import. |
| Security | Token and ownership review, live V1 findings remediated or retired, media exposure decision, external review, runtime secret controls | **OPEN** — all 14 checked-in SQL migrations applied and 24/24 pgTAP assertions pass on disposable PostgreSQL 17.12 with minimal Auth/Storage compatibility objects. Official Supabase runtime, live ledger reconciliation/rollout, media decision, external review and runtime checks remain. |
| Quality | Clean CI on exact SHA; required E2E, load, concurrency, retry/chaos, restart and recovery runs; artifact hashes recorded | **OPEN** — CI #161 covers base SHA only; local focused evidence does not cover staging or full 100-user workload. |
| Operations | Approved production host/cost; HTTPS, monitoring/alerts, measured RPO/RTO, backup/restore and rollback drills | **OPEN** — $0 limit is set; Northflank Sandbox is testing-only; no qualified production host or operational drill exists. |

## Promotion record

- Candidate release SHA: **not frozen**
- API / worker image digests: **not built for release**
- Staging smoke URL and evidence: **none**
- Backup-set / restore evidence: **synthetic local PostgreSQL dump/restore only; no staging or production backup set**
- Owner authorization: **standing instruction to self-review and deploy after all gates pass**; release SHA and no-interruption traffic plan are not frozen yet
- Production deployment / promotion time: **none**

Do not promote or switch production traffic unless every gate is marked GO with reproducible evidence and the exact release SHA plus no-interruption traffic plan are recorded. The standing owner instruction already authorizes self-review and deployment after these conditions are met. Preserve the current production deployment and Supabase source until the rollback window closes.
