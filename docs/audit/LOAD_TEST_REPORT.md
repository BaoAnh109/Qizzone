# Load and concurrency report

**Status:** concurrency regressions pass locally/CI; production load capacity is not measured.
**Implementation branch:** `feat/qizzone-v2-backend-aiv3` (isolated worktree; not pushed)
**Reviewed source revision:** `3c5199581f72046e2595d865be18cc9567785657` plus uncommitted working-tree changes; no release SHA is frozen.

## Executed evidence

| Run | Workload | Observed result | What it proves |
|---|---|---|---|
| GitHub Actions run [#158](https://github.com/BaoAnh109/Qizzone/actions/runs/44099953969) | One attempt submitted 100 times through two independent API hosts on ephemeral PostgreSQL 17 | One result, one audit event, one attempt revision increment | The duplicate submit path is idempotent under multi-host concurrency for this test. |
| Local PostgreSQL 17.12 Release suite | Exam/practice row-lock contention, scheduled-room transitions, assignment query, API integration regressions and the global 20-attempt admission race | 39 API + 7 worker tests passed, zero skipped | Selected database invariants and transactional paths work on a disposable local PostgreSQL instance; this is not a sustained capacity/load test. |
| Synthetic migration rehearsal on PostgreSQL 17.12 | Digest plan/rejection, relational import, replay, target checksum and open-attempt resume | Passed; open null-deadline attempt retained answer `B` and revision `7` | Importer mechanics on fabricated data; not production workload or migration capacity. |

## Not measured

- No k6 or equivalent load profile has been run.
- No 100-user scenario covering login, quiz list, autosave, submit, result, reports, and AI queue has run.
- No throughput, p50/p95/p99 latency, error-rate, CPU/memory, connection-pool, queue-depth or saturation numbers were collected.
- No sustained autosave writes, independent concurrent attempts, database restart, worker restart, network partition, backup restore under load, or regional/host failure was exercised.
- No production-sized or staging hardware exists in the current environment; no capacity or availability estimate is implied.

## Required performance run before release

Run against isolated staging with synthetic accounts/data and a declared load profile matching concurrent students, answer cadence, quiz length, and AI import frequency. Capture the exact image SHA, resource sizing, PostgreSQL configuration, request mix, duration, warm-up, ramp and test data. Report p50/p95/p99 per route, HTTP error rate, database lock/connection behavior, autosave ACK delay, duplicate submit results, worker lag/retries, CPU/RAM/disk/network and recovery after restarts. Re-run integrity queries afterward to verify no missing, duplicated or cross-owned answers/results. The plan's 100-concurrent-attempt acceptance target remains unproven.
