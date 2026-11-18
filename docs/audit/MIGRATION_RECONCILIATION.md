# Migration reconciliation status

**Status: NO-GO for live cutover.** This report records one disposable-fixture rehearsal only. It is not evidence that production data has been exported, imported, backed up, restored, or reconciled.

## Live source baseline

The latest read-only Supabase aggregate snapshot is recorded in [DATA_INVENTORY.md](DATA_INVENTORY.md), dated 2026-11-18; core counts were rechecked at 00:43:49 UTC and attempt status at 01:01:18 UTC. It contained 12 profiles, 19 quizzes, 1,324 questions and answer keys, 58 exam attempts (2 with `submitted_at IS NULL`), 1,447 exam answers, 56 results, 5 practice sessions, and 163 practice answers. The follow-up aggregate found 0 unexpired attempts, 1 expired unsubmitted attempt, and 1 unsubmitted attempt with no `ends_at`. The audit read aggregate counts only; it did not export or inspect row contents. Counts are a baseline, not a source checksum or backup.

At the core snapshot, Supabase Auth and Storage object counts, question image references, and profile avatar references were zero. These values must be rechecked immediately before any cutover. The migration tool now includes every attempt and its saved answers, including attempts with `submitted_at IS NULL` and a null `ends_at`; the V2 model/API preserve nullable deadlines and support resuming the attempt. Live V1 `save_quiz` blocks edits to quizzes that already have attempts, supporting reconstruction of their question snapshots. The importer rechecks the source digest immediately before commit and rolls back if source data changed during import. A source write freeze and synchronization of browser-held answers are still required. The updated synthetic fixture's PostgreSQL 17.12 rehearsal passed: the resumable open attempt retained its null deadline, saved answer, and revision. Do not finalize or discard attempts automatically for migration.

A read-only refresh at 04:45 UTC on 2026-11-18 confirmed project `iqojrgrljrttqjbhcogr` is `ACTIVE_HEALTHY` on PostgreSQL 17.11 in `ap-southeast-2`. It returned the same nine live migration versions, latest `20261029072833`; the avatar migration version differs from the local filename and the local question-media and helper-search-path migrations are absent. Supabase security advisors observed at 04:45:32 UTC reported 2 RLS-enabled tables without direct policies, 2 mutable helper search paths, and 23 authenticated-executable `SECURITY DEFINER` functions. This refresh did not modify the source project.

A second read-only project/ledger check during the 05:23 UTC review found one Supabase project, still `ACTIVE_HEALTHY`, and the same nine migration records ending at `20261029072833`. No second project was created; no SQL or data was written by this check.

After that read-only check, the working tree gained the local migration `20261118042717_gate_practice_explanations.sql` to address the V1 practice-result disclosure. It is not present in the live migration ledger and has not been executed. Reconcile the existing avatar-version mismatch and missing local migrations before applying this or any other source migration; this addition is not evidence of a live fix.

A separate read-only source preflight reran the eight aggregate integrity checks implemented by `MigrationRunner` (quiz owners, question answer keys, valid answer keys, exam snapshot references, exam results, exam answers, practice question references, and practice answers). All eight returned zero violations. This is a status-only SQL check against the live source; it did not run `Qizzone.MigrationTool plan`, produce a source digest, export rows, or verify a backup/target.

A further read-only Supabase query on 2026-11-18 confirmed live V1 `question_answer_keys.correct_answers` and `practice_answers.selected_answers` constraints both stop at four. The deployed `save_quiz` requires 2–4 options, 1–4 correct answers and A–D IDs; `import_legacy_attempt`, `save_attempt`, and `check_practice_answer` also reject more than four selected answers. Local migration `20261118050412_allow_five_option_answers.sql` raises those limits to five while retaining other deployed function logic, and its ten-case pgTAP suite is in `supabase/tests/five_option_answers_test.sql`. All 14 checked-in SQL migrations then applied in timestamp order to a fresh disposable PostgreSQL 17.12 cluster with minimal Auth/Storage compatibility objects; every SQL test passed (**24/24**) against the resulting local schema and actual RPC bodies. The official Supabase Docker stack and hosted schema were not used. Migration history/schema drift must be resolved first, and this migration has not been applied to live Supabase.

## Synthetic rehearsal evidence

The repository script [`Run-SyntheticRehearsal.ps1`](../../backend/Qizzone.MigrationTool/Run-SyntheticRehearsal.ps1) ran against disposable native PostgreSQL 17.12. It applied the current EF migrations to a generated local target, cloned that schema to a synthetic source, seeded fabricated profile/quiz/question/exam/practice rows, and then ran the actual migration CLI.

The run verified:

- Two read-only plans of the unchanged fixture returned the same SHA-256 source digest.
- An incorrect digest returned the expected rejection code and left all target data tables empty.
- The approved digest imported the fixture; the importer reported 10 relational rows and matching target row counts/checksums.
- Replaying the same approved digest was a no-op.
- The imported exam snapshot contained the question recorded by each attempt; the fixture included a submitted attempt and an open attempt with `ends_at IS NULL`.
- The open attempt remained resumable after import with its saved answer (`B`) and revision (`7`) preserved; the run reported 2 attempts, 1 open attempt, and 1 practice answer.
- The script removed only its uniquely named disposable databases after the run.

The rehearsal exposed and fixed a PostgreSQL protocol error in the target row insert: the SQL positional placeholder did not match the named Npgsql parameter. The importer now uses the named `@row` placeholder.

A later source review found that the target-only table preflight omitted V2 `media_objects`. The importer now includes that table in the target-only row inspection/lock set. The updated synthetic rehearsal passed against disposable PostgreSQL 17.12: a target-only media row blocked both plan and apply, and the apply path wrote no source rows before the fixture was removed. This remains local synthetic evidence only; it does not establish that a hosted target is empty or safe to migrate.

## Evidence still required

- A full source backup/export and verified restore into isolated staging.
- Fresh source counts and a reviewed source checksum plan from that restored copy.
- Firebase UID, disabled/deleted account, verification-state, and role reconciliation.
- Storage object transfer and hash reconciliation if any objects or references exist at cutover.
- Import into an empty, migrated hosted staging target, followed by row/checksum and business-result comparisons.
- A restore drill and rollback evidence independent of the source backup itself.
- A source freeze through the final import and reconciliation window; the importer rechecks the source digest before commit but cannot stop new writes after that check.

No live Supabase or hosted target connection has been used by the migration importer. Do not enable the V2 API against migrated data or switch production traffic until the missing evidence is complete and reviewed.
