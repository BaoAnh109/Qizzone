# Qizzone V2 implementation checkpoint — 2026-11-18

**Release status:** not released. This is a summary of the current working-tree implementation, not a versioned production release. See [SOURCE_REVISION.md](SOURCE_REVISION.md).

## Implemented in the current worktree

- ASP.NET Core API, Firebase ID-token verification, PostgreSQL/EF Core schema and migrations, and a separate PostgreSQL-backed Gemini worker.
- Quiz, room lookup, exam attempts, immutable per-attempt question/answer snapshots, server grading, practice, reports, admin pagination, class/email assignment checks, and persistent media APIs.
- Browser IndexedDB attempt snapshots and outbox retry/acknowledgement, stable mutation IDs, conflict preservation, and same-browser tab writer exclusion.
- Deterministic PDF/DOCX/image extraction paths with Gemini fallback and review-before-publish flow; answer-option support up to five choices.
- A digest-gated Supabase relational-import tool that preserves open attempts in a synthetic fixture rehearsal.
- Target import preflight now counts V2-only media objects and refuses to treat a target with uploaded media as empty; a synthetic assertion has been added but awaits PostgreSQL execution.
- Pilot Compose, encrypted database/media backup scripts, an offsite-copy helper, and an isolated restore-drill script.

## Known release limitations

- No frozen release commit, clean-checkout CI for the current worktree, Northflank staging URL, or deployed V2 API/worker exists.
- Frontend AI job polling now stops on the backend `cancelled` state, and teachers can cancel V2 extraction jobs from the progress card. This is not yet verified against a deployed/staging API.
- Full authenticated role-parity E2E, cross-device/offline/quota scenarios, broad load/fault testing, and external security review remain incomplete.
- Live Supabase data has not been exported, backed up/restored, imported, or reconciled. The migration ledger drift, zero-count baselines, active-attempt state, and application/verification of the practice-explanation fix still require resolution.
- No real Gemini request, production media backup/restore, monitoring/alerting proof, RPO/RTO measurement, or data-safe rollback drill exists.
- Northflank Free Sandbox is not production hosting; no qualified $0 production host has been verified. Production remains on the existing Vercel/Supabase path.

## User-visible impact

None. No production deployment, route change, DNS change, or live database write was made for this checkpoint.
