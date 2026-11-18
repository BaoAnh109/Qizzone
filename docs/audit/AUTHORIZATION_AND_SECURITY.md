# Authorization and security review

**Status:** local implementation review is partial; external security review and staging/production verification are incomplete.
**Implementation branch:** `feat/qizzone-v2-backend-aiv3` (isolated worktree; not pushed)
**Reviewed source revision:** `3c5199581f72046e2595d865be18cc9567785657` plus uncommitted working-tree changes; no release SHA is frozen.

## Identity and role authority

- Firebase Authentication remains the identity provider. `FirebaseAdminTokenVerifier` verifies ID tokens with revocation checking enabled and extracts UID, email, name and verified-email state. Production startup requires a Firebase project, service-account/ADC credential, exact CORS origins, a non-wildcard host allowlist, persistent media path and at least one bootstrap-admin UID.
- `ProfileClaimsTransformation` loads the profile from PostgreSQL and derives application roles from that row; a client-supplied role is not authoritative. Unapproved or missing profiles receive no active application role. Teacher capability for a student account requires an approved, unblocked teacher request.
- Route groups require `ActiveUser`, `Student`, `Teacher`, or `Admin` policies. Admin review rejects self-review, changes only a pending request, and records an audit event.

## Resource ownership and answer-key access

| Resource/action | Required boundary in V2 API |
|---|---|
| Profile | Authenticated Firebase UID; updates apply to the caller's own profile |
| Teacher/admin mutation | Teacher role plus quiz owner UID, or admin role where explicitly supported |
| Exam attempt | Student role and exact attempt owner UID for get/save/submit |
| Practice session | Student role and exact session owner UID |
| AI import job | Teacher role; job status/result and cancellation are scoped to owner, with admin cancellation explicitly authorized |
| Media upload/reference | Active verified account; upload ownership and quiz media references are validated against the caller UID |
| Answer keys | Separate database entity; student quiz reads omit keys. Grading is server-side; exam result review is filtered by `allow_review` unless teacher/admin is authorized. Practice explanation responses honor `show_explanation` in the V2 API. |

The API validates selected answers against the attempt's immutable question snapshot, not a mutable client score. Quiz mutation is owner-checked and rejected once an exam or practice session exists. Teacher reports are owner-scoped; student reads redact assigned recipient email lists.

## Input, media and secret controls

- Request body size is capped at 10 MiB at Kestrel. Image uploads are capped at 2 MiB each and 250 MiB per owner, check file signatures against declared JPEG/PNG/WebP MIME, write atomically to persistent storage, and store SHA-256 metadata. Media GET uses immutable UUID paths, `nosniff`, content type and a content-derived ETag. Reads are intentionally public to match the current public V1 bucket behavior; this exposes anyone holding the URL to that image.
- Quiz media references must point to media owned by the author. Images are not migrated by the relational importer; the importer blocks when storage objects or recognized source references exist.
- Gemini calls are made by the worker using a runtime-only API key. The worker validates source signatures and bounds request/retry/quota behavior. Do not put Firebase service-account or Gemini secrets in Git, image layers, client variables or logs.
- Account/profile update and media API tests cover ownership and validation paths. Local tests do not replace secret-store validation, malware scanning or an external penetration test.

## Findings and known exposure

- **Open release blocker:** added local source migration `20261118042717_gate_practice_explanations.sql` to return JSON `null` for disabled explanations both when first finishing a session and when replaying an already stored result. Five pgTAP assertions pass on PostgreSQL 17.12 with a minimal Supabase-compatible schema fixture, including cross-student denial. The migration has not been applied to Supabase or exercised against its full migration chain; the live behavior remains unremediated until migration history is reconciled and an isolated full-schema run plus staged rollout are verified. No production SQL was changed.
- **Open P2 finding:** the live `public.mark_data_migration` RPC is executable by authenticated users and writes only under `current_uid()`, but its body previously accepted arbitrary `source_id` values and reports without an explicit size limit. Repeated calls could grow the per-user marker table. Added local migration `20261118045106_limit_legacy_migration_markers.sql` to require an identity, allow only the frontend's `legacy-browser-v1` source, validate status, and cap JSON-object reports at 64 KiB. Nine pgTAP assertions pass twice on a scratch PostgreSQL 17.12 minimal fixture, including migration replay. This fix is not applied live or tested against the full Supabase chain; reconcile migration history before rollout.
- **Open feature/security parity blocker:** the live V1 save/import/exam/practice RPCs and two answer-table checks cap choices at A–D / four. That is incompatible with the five-option editor and V2 API. Local migration `20261118050412_allow_five_option_answers.sql` updates those limits and preserves unrelated deployed function logic. The actual local SQL chain passed its ten-case pgTAP suite on disposable PostgreSQL 17.12; the migration remains unapplied while live/local ledgers differ, and official Supabase Auth/Storage runtime behavior is not covered by the compatibility bootstrap.
- **Open release blocker:** the live Supabase migration ledger differs from local history (avatar version mismatch; question-media and helper-search-path hardening migrations not applied). Reconcile schema/history before applying any source migration.
- Supabase security advisors previously reported two RLS-enabled tables without direct policies and mutable search paths on `current_uid` and `app_role`. The local migration pins helper search paths but has not been applied live. The review checked current public `SECURITY DEFINER` functions and selected ownership/role guards; this was not a complete function-by-function external review or penetration test.
- There is no malware/content scanning for uploaded images. Signature/size checks do not establish that an image is safe or that it contains no sensitive content.
- Public immutable media URLs are intentionally readable without authentication. Verify this exposure is acceptable for every uploaded image before cutover.
- Student class is self-reported, so class assignment is a compatibility filter, not a trusted school roster or authorization boundary.
- The AI worker supports owner/admin cancellation. The frontend now treats `cancelled` as terminal and sends cancellation through the authenticated owner endpoint; a focused mocked-API unit test passes. This is code-level coverage only until staging confirms owner/admin boundaries and in-flight cancellation behavior.
- No authenticated staging E2E, multi-tenant penetration test, load/fault report, secret-rotation evidence, verified alerting, or production network/TLS review exists.

## Evidence and disposition

The latest PostgreSQL-backed local Release suite passed 39 API and 7 worker tests with zero skips on disposable PostgreSQL 17.12; CI run #161 covers the base commit only. The local suite exercises ownership, role, answer-key, media, schedule/assignment, concurrency and AI cancellation paths but does not validate deployed identity configuration, secret handling, Supabase migration drift, or the live schema. All 14 checked-in Supabase SQL migrations applied in order on a fresh PostgreSQL 17.12 cluster with minimal Auth/Storage compatibility objects; the three SQL test files passed **24/24** (practice explanation, migration markers and five-option RPCs). The official Supabase Docker stack, managed Auth/Storage runtime and staging remain unverified.

**Security gate: PARTIAL / NO-GO.** Before cutover, reconcile source migration history, remediate or retire the V1 explanation leak, roll out marker-RPC bounds and five-option support (or route all writes to migrated V2), prove Firebase and authorization flows on isolated staging, review public media policy, add an upload safety decision, rotate and verify runtime credentials, and obtain the planned external security review. No secrets or personal record contents are included in this report.
