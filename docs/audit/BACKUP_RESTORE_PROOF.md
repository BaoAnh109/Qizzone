# Backup and restore evidence

**Status: NOT PROVEN — release gate remains open.**
**Checked:** 2026-11-18

## Evidence recorded

| Check | Result | Limit |
|---|---|---|
| Bash syntax for backup, restore, and offsite scripts | Passed | Syntax only; no database, media volume, or provider was accessed. |
| Offsite helper mock test | Passed | Mock `rclone` verified sidecars, copy/read-back, and rejection of corruption, unknown remote, and bad checksum. No real provider credentials or remote were used. |
| Local synthetic PostgreSQL 17.12 custom-format backup/restore | Passed | An ephemeral WSL cluster listening only on a Unix socket was seeded with one quiz, one resumable attempt with a null deadline, one media metadata row, and one EF history row. `pg_dump -Fc`, SHA-256 verification, `pg_restore --exit-on-error`, and source/restore query snapshots matched; restore took about 17 ms. The schema and data were synthetic; this did not exercise the app schema, real media bytes, encryption, offsite storage, or production RTO/RPO. The scratch cluster and artifacts were removed. |
| PostgreSQL backup on a real staging dataset | Not run | No staged target or backup set exists. |
| Media backup on a real persistent volume | Not run | No target volume exists. |
| Encrypted offsite copy and independent read-back | Not run | No remote is configured. |
| Production-script encrypted PostgreSQL/media restore drill | Not run | Docker, `age`, a real backup set, and a persistent media volume are unavailable in this workspace. The synthetic database-only rehearsal above is supplementary evidence, not a substitute. |
| Recovery time / data-loss window | Not measured | RTO and RPO have not been approved or demonstrated. |

The implementation in `deploy/scripts/backup-postgres.sh` creates encrypted PostgreSQL and media artifacts with SHA-256 sidecars. `copy-backups-offsite.sh` can upload a matched set through `rclone` and read it back. `restore-drill.sh` verifies the sidecars, decrypts into uniquely named network-disabled disposable Docker resources, and checks that every database-referenced media object has the recorded hash; unreferenced files in the append-only volume are allowed. These script behaviors and a mock helper test do **not** constitute a backup or restore proof.

## Required evidence before cutover

1. Create a staging dataset with representative synthetic records and media; capture exact source revision, host, PostgreSQL version, and backup-set ID.
2. Run an encrypted backup, copy it to an independent failure domain, and verify the remote read-back.
3. Restore that set into an isolated environment. Record table count, row reconciliation, applied EF migrations, media object count/hash comparison, elapsed restore time, and any warnings.
4. Run API-level smoke checks against restored data, including a resumable exam attempt and an image reference.
5. Record measured RPO/RTO and the operator, date, command/result logs, and cleanup outcome. Never place secrets or personal production dumps in this repository.

Until these steps pass on a real staging backup, the data/recovery gate remains **NO-GO**.
