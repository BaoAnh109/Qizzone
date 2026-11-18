# Database schema and migration mappings

**Status:** implementation and local synthetic rehearsal reviewed; target schema and live-data reconciliation are not verified.
**Implementation branch:** `feat/qizzone-v2-backend-aiv3` (isolated worktree; not pushed)
**Reviewed source revision:** `3c5199581f72046e2595d865be18cc9567785657` plus the uncommitted working-tree changes. There is no frozen release SHA.

## Target schema

The EF Core model in `backend/Qizzone.Api/Data/QizzoneDbContext.cs` defines the application schema. The migrations currently in this checkout are listed below in execution order; generated SQL and the newest schedule migration were replayed on disposable PostgreSQL, not on a hosted target. No migration has been applied to a hosted target.

| Migration | Purpose |
|---|---|
| `20261118013035_InitialSchema` | Profiles, quizzes, questions and keys, exam/practice records, migration ledger, AI queue/quota, outbox, audit events |
| `20261118014947_AttemptRevisionConcurrencyMetadata` | Attempt revision metadata |
| `20261118015545_ProfileActiveRole` | Active role constrained by the stored base role |
| `20261118020346_PracticeAnswersNavigation` | Practice answer/session relationship model |
| `20261118023652_AiImportJobIdempotency` | AI request idempotency and fingerprint |
| `20261118030517_ExamAttemptMutationIdempotency` | Client mutation deduplication metadata |
| `20261118030631_ExamAttemptMutationRetentionIndex` | Mutation retention query index |
| `20261118053140_QuizResultReportColumns` | Stored/generated report fields and indexes |
| `20261118060000_ExamAttemptImmutableSnapshot` | Per-attempt content/answer-key snapshot and legacy backfill |
| `20261118060001_AddProfileStudentClass` | Student class for assignment matching |
| `20261118070000_AddMediaObjects` | Media metadata and owner quota queries |
| `20261118080000_AllowFiveOptionAnswers` | Answer constraints for up to five options |
| `20261118090000_CancelAiImportJobs` | Terminal `cancelled` AI job state |
| `20261118100000_ScheduleQuizRooms` | UTC open/close timestamps, scheduled status constraint, and transition-query indexes |

Core relationships and integrity rules:

- A profile is keyed by Firebase UID. Reviewer references point back to profiles. Role, active-role, approval and teacher-request states have check constraints; email is unique.
- A quiz belongs to one teacher profile. Its six-character code is unique. Questions cascade with the quiz, have unique ordinals per quiz, and use bounded supported types/JSON arrays. Each question has one separate answer-key row.
- A quiz room can be `draft`, `scheduled`, `published` (open), or `closed`. Scheduled rooms require `opens_at`; an optional `closes_at` must be later. Students can read/join only during the effective open window; a hosted worker persists scheduled transitions and audit events. Times are stored as PostgreSQL `timestamptz` and accepted as UTC instants.
- Exam attempts reference a quiz and student profile, persist their question order and immutable JSON snapshot, and use a revision concurrency token. Only one unsubmitted attempt per `(quiz_id, student_uid)` is permitted. Answers are unique per attempt/question; results are unique per attempt.
- Practice sessions reference a quiz/student and store their question/option order and explanation policy. Practice answers are unique per session/question.
- Media metadata belongs to a profile, has a restricted delete relationship, and constrains MIME, extension and size (up to 2 MiB per object). File bytes live outside PostgreSQL on a persistent volume.
- AI jobs belong to an owner profile and constrain state, retry count and JSON payload shape. Owner/idempotency key is unique when a key is present.
- AI limits, outbox, audit events, attempt-mutation receipts, media objects, and migration checkpoints have their own keys and query indexes. `media_objects`, `exam_attempt_mutations`, `ai_import_jobs`, `outbox_messages`, and `audit_events` are target-only during the Supabase relational import and must start empty.

## Supabase-to-PostgreSQL mapping

`backend/Qizzone.MigrationTool/MigrationCatalog.cs` validates source columns, builds deterministic source projections, and maps these relations:

| Supabase source | PostgreSQL target | Mapping / preservation rule |
|---|---|---|
| `public.profiles` | `public.profiles` | Preserve Firebase UID, identity/profile, base role, approval and reviewer fields. Set target `active_role = role`, because V1 does not persist the currently selected view. |
| `public.quizzes` | `public.quizzes` | Preserve IDs, owner UIDs, room codes, settings and legacy IDs. |
| `public.questions` | `public.questions` | Preserve IDs, quiz IDs, order, content, options, points and legacy IDs. If the source schema lacks `images`, the importer maps it to an empty JSON array. |
| `public.question_answer_keys` | `public.question_answer_keys` | Preserve answer arrays, explanations, timestamps and question IDs. |
| `public.exam_attempts` | `public.exam_attempts` | Preserve attempt/business IDs, owner, saved question order, timer/policy fields, nullable deadline, revision and legacy ID. Build the target snapshot from the source quiz/questions/answer keys in the attempt's saved question order. |
| `public.exam_answers` | `public.exam_answers` | Preserve attempt/question IDs, selected answers and update time, including answers on unsubmitted attempts. |
| `public.exam_results` | `public.exam_results` | Preserve result/attempt IDs and payload. Target computed report columns derive from the payload. |
| `public.practice_sessions` | `public.practice_sessions` | Preserve session IDs, question/option order, explanation policy, state and result. |
| `public.practice_answers` | `public.practice_answers` | Preserve checked/selected answers, correctness and explanation fields. API responses must still enforce the session's explanation policy. |
| `public.data_migrations` | `public.data_migrations` | Preserve UID/source/version keys and report state. |
| `private.ai_limits` | `public.ai_rate_limits` | Rename `uid` to `firebase_uid` and `bucket` to `window_started_at`; preserve request count. |

All imported business IDs and Firebase UIDs are retained so existing relationships and ownership continue to resolve. The importer uses a read-only repeatable-read source snapshot and a serializable target transaction, rejects mismatched source digests and non-empty/conflicting targets, checks relational integrity, compares table row counts and SHA-256 digests, verifies reconstructed attempt snapshots, then rechecks the source digest before commit. Replaying the exact plan against its already-imported target is a no-op.

## Preconditions and exclusions

- The reviewed synthetic rehearsal on disposable PostgreSQL 17.12 passed, including a resumable open attempt with `ends_at IS NULL`, saved answer `B`, revision `7`, digest rejection without target writes, matching imported checksums, and idempotent replay.
- The importer does not copy Supabase Auth users or Storage objects. It blocks apply if Auth users, Storage objects, question-media references, or avatar Storage references exist. Recheck these counts and explicitly map/transfer them before any live cutover.
- The source baseline previously showed zero Supabase Auth users and zero Storage objects, but those aggregate observations are dated and do not prove current state. No live rows were exported or imported.
- The target database has not been provisioned. No hosted migration, backup restore, source/target reconciliation, business-level comparison, or target rollback has been performed.
- A source write freeze and synchronization of browser-held answers are required during cutover. The digest check detects concurrent changes but does not prevent writes after the check.
- The live Supabase migration ledger differs from local migration filenames/history. The local `20261118042717_gate_practice_explanations.sql` migration is unexecuted; reconcile the drift before applying it or any other source-side SQL change.

## Verification required for acceptance

1. Capture a source backup and prove restore to an isolated, access-controlled staging database.
2. Recheck source schema/history and aggregate counts; review a new read-only plan and digest from the restored source.
3. Migrate the target schema from an empty database, rehearse importer and rollback against representative data, and reconcile row counts, digests, foreign keys, answer keys, attempts, results and media hashes.
4. Test Firebase identity/role mapping and all saved-attempt resume behavior on staging before traffic is enabled.
5. Record target migration, restore and rollback evidence. This document is a mapping artifact, not a staging or production acceptance record.
