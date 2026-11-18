# Autosave protocol and failure behavior

**Status:** local implementation evidence exists; authenticated staging and cross-device acceptance remain open.
**Implementation branch:** `feat/qizzone-v2-backend-aiv3` (isolated worktree; not pushed)
**Reviewed source revision:** `3c5199581f72046e2595d865be18cc9567785657` plus uncommitted working-tree changes; no release SHA is frozen.

## Data and acknowledgement flow

1. A student answer, cleared answer, or flagged-question change updates the in-memory exam session. Navigation-only changes do not create an answer mutation.
2. The browser writes a full attempt snapshot to IndexedDB (`qizzone-exam-autosave`, keyed by attempt ID) and queues an ordered mutation. The snapshot contains attempt/student IDs, expected server revision, answers, flags, current question index, sequence, mutation UUID, writer-session UUID, retry count and lease state.
3. The UI debounces rapid changes (250 ms in the current store) and sends one mutation at a time. A network error leaves the mutation and latest draft in IndexedDB. Reload recovery restores queued content before retrying.
4. The API requires a Firebase-authenticated student who owns the attempt, a matching `Idempotency-Key`/mutation UUID, positive client sequence, writer-session UUID and expected revision. It validates that every question and selected option belongs to the attempt snapshot, rejects a submitted/expired attempt, then atomically saves answers, flags, index, increments the revision and records a request fingerprint.
5. A matching duplicate mutation returns the committed attempt without writing again. Reusing the same mutation UUID with different content returns a conflict. On a valid response, the browser acknowledges that mutation and advances later queued mutations to the returned server revision. It displays server-saved only after that acknowledgement.
6. After a successful submit, the attempt's local draft/outbox is cleared and the local writer lock is released. If the deadline has passed, the server rejects further autosaves; finalization uses answers already committed on the server and the UI warns that newer local edits were not included.

## Concurrency and conflict rules

- The browser uses the Web Locks API with an exclusive, per-attempt lock. A second tab in the same browser fails closed rather than writing the same IndexedDB snapshot concurrently. Unsupported Web Locks are also a visible error.
- The API uses a per-attempt in-process gate plus PostgreSQL revision concurrency and a unique `(attempt_id, mutation_id)` receipt key. These server-side checks protect multi-instance writes and lost-response retries; the browser lock alone is not treated as cross-device protection.
- If a stale local draft has an older revision than the server, the store preserves the draft, shows a conflict, and does not send it over the newer server state. The user must resolve/reload rather than silently overwrite another device's answer.
- IndexedDB write failure sets `local-error` and prevents the autosave send path from claiming a local durable save. A legacy localStorage draft is migrated into IndexedDB before the old copy is removed.
- The IndexedDB writer keeps a lease while a mutation is marked `sending`; an expired lease can be queued again after a tab crash. Retry delays are exponential and bounded; after automatic retries stop, the UI exposes an error and manual retry path.

## Current verification evidence

- Store tests cover debounce/coalescing to the latest answer, offline failure → reload recovery → server acknowledgement, localStorage draft migration, stale-revision conflict preservation, no autosave for navigation alone, and deadline behavior using already server-saved answers.
- The local Edge Playwright suite has three isolated scenarios against a mocked API. It covers reload recovery after API 503 and fifth-option selection, and same-browser two-tab writer exclusion. These scenarios are not authenticated staging E2E.
- PostgreSQL API integration tests cover revisioned saves, duplicate idempotency, mismatched mutation reuse and concurrent submissions. CI run #158 covered 100 repeated submissions through two API hosts and verified one result, one audit event and one revision increment.
- The latest local PostgreSQL 17.12 Release suite passed 39 API and 7 worker tests with zero skips. It does not prove offline recovery against a live API, cross-device behavior, or production load.

## Acceptance gaps

- Real network loss/reconnect and browser process termination against staging.
- Cross-device revision conflict resolution and user-facing recovery guidance.
- IndexedDB quota/eviction, private-browsing and storage permission behavior in supported browsers.
- Authenticated E2E for answer changes, submit, result and reload against a deployed V2 API.
- Production-sized load, browser/network telemetry and explicit retention/cleanup policy for local drafts and mutation receipts.

Until these checks pass, the local protocol and mocked/API tests are implementation evidence, not proof that exam answers are safe under all production failure modes. No claim of zero answer loss should be made for edits that were not acknowledged by the server.
