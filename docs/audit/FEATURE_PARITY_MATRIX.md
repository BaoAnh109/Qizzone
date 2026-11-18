# Ma trận feature parity

**Ngày audit:** 2026-11-17
**Nhánh:** `devolop/AIV3`

Trạng thái dưới đây phân biệt code/API test với nghiệm thu production. GitHub Actions run [#155](https://github.com/BaoAnh109/Qizzone/actions/runs/44095085400) đã chạy 17 API tests trên PostgreSQL 17 ephemeral với schema riêng theo test; chưa có staging integration hoặc browser E2E.

| Feature | V1 hiện có | API mới trên nhánh hiện tại | Trạng thái / còn thiếu |
|---|---|---|---|
| Đăng ký, đăng nhập, Google, reset mật khẩu | Firebase Auth | Firebase Admin ID-token validation; frontend có email verification/resend flow | API không thay Firebase client; callback/provider flow chưa E2E; email status và revoked/disabled behavior cần staging verify |
| Hồ sơ, role hoạt động, yêu cầu giáo viên | Supabase profile/RPC/Edge | `/api/v1/me`, teacher request, role switch, policy theo profile DB | 12 integration tests bao phủ bootstrap, verified email, request và role switch; avatar/account settings còn Supabase |
| Admin duyệt giáo viên và quản lý tài khoản | Supabase Edge/RPC và PostgREST fallback | `/api/v1/admin/*`, role check và audit event | Endpoint tests có; fallback chưa gỡ, admin account bootstrap cần staging runbook, management filters/pagination chưa đầy đủ |
| Quiz/câu hỏi CRUD | Supabase RPC/PostgREST | `/api/v1/quizzes` CRUD, status; ownership/input/media reference validation; student read che answer key/assigned emails | API tests có; clone/immutable quiz-version snapshot parity chưa có; media upload còn Supabase |
| Phân công đề | `set_quiz_assignments` settings JSONB | API update assignments và redaction ở student reads | Unit/API coverage chưa đại diện mọi class/email behavior; không có E2E assignment flow |
| Room/join policies | Room code từ quiz và RPC | Quiz code/assignment; exam start theo quiz ID | Chưa có đầy đủ room lifecycle/join-by-code API adapter, lớp học, expired/closed/eligibility parity |
| Exam start/resume/timer | Supabase RPC | Server timer, max-attempt checks, start/resume và answer-key separation | API integration test pass; chưa có PostgreSQL transaction/race/100-concurrent tests, quiz-version snapshot chưa có |
| Autosave | RPC revision + legacy localStorage draft recovery | IndexedDB snapshot/outbox, coalescing, stable mutation ID, ordered retry/ACK, server dedupe, revision conflict preservation and per-attempt Web Lock so one browser tab can write | Local tests cover recovery, coalescing, ack, duplicate retry, conflict, and fail-closed behavior when a tab lock is unavailable. Real browser multi-tab/device, PostgreSQL race, quota and offline E2E remain |
| Submit/expiry/grading | RPC finalize/grade | Server-authoritative grading, deadline finalization, idempotent submit | API test với 100 submit đồng thời trên EF InMemory pass; chưa chứng minh cạnh tranh giữa nhiều process/PostgreSQL, fault hoặc DB restart |
| Results/history | Supabase `list_sessions`/`list_results` | Student-owned active attempts; student sees own results; teacher sees full results for owned quizzes; admin can review all | Test kiểm tra quyền và `allowReview`; teacher aggregates/filters/pagination/CSV chưa có |
| Practice/retry/history | Supabase practice RPC | API start/get/check/finish/retry/history, ownership và key policy | Lifecycle integration + service routing tests pass; concurrency test trên PostgreSQL và E2E chưa có |
| Import PDF/DOCX/image/OCR | Frontend PDF.js/Mammoth/Tesseract + review UI | Parser phía trình duyệt; API durable job; dedicated Gemini worker | Worker receives prompt/image, limits requests, validates image signatures, claims PostgreSQL jobs atomically, retries bounded and normalizes structure. OCR/parser remain client-side; fixture accuracy benchmark and live PostgreSQL rehearsal are outstanding |
| Gemini fallback/solve | Supabase Edge Function `extract-quiz-with-gemini` | `/api/v1/ai-import-jobs` plus worker REST integration; frontend enqueue/status polling when API base is enabled | Worker uses secret-only `x-goog-api-key`, structured JSON, owner-only status/results, 24h per-user quota, idempotency and terminal prompt cleanup. No real provider call or PostgreSQL worker run; Supabase Edge remains fallback until API cutover |
| Hình câu hỏi/avatar | Supabase Storage | API chặn foreign-owner media refs; chưa có upload/object store | Storage transfer, authz signed URLs, hash reconcile và avatar parity chưa làm |
| Legacy browser data | `legacyMigrationService` vào Supabase | Có bảng checkpoint schema | Chưa có importer destination PostgreSQL, migration CLI/job hoặc đối soát |
| Deploy & operations | Vercel frontend/Supabase backend | API Dockerfile và CI validation | Không có staging deployment, deploy workflow, observability/SLO/backup/restore/cutover |

## Chứng cứ kiểm thử

- Frontend CI: 165 passed, 24 skipped (33 files passed, 2 skipped); typecheck, lint, production build and npm audit passed in run #155.
- Backend CI: 17 WebApplicationFactory API tests passed against ephemeral PostgreSQL 17; 6 Gemini worker client tests passed with mocked HTTP.
- Solution Release build/tests, EF model check and idempotent migration SQL generation passed (26,371 bytes). Run #155 applies migrations in isolated per-test PostgreSQL schemas and builds both backend images for AMD64/ARM64. The 100-request submit test still uses an in-process attempt gate, not a PostgreSQL/multi-instance race test.
- NuGet advisory audit: không phát hiện package có lỗ hổng theo nguồn hiện tại.
- npm audit against the checked-in lockfile: 0 vulnerabilities reported in CI run #155.
- Chưa có trạng thái `PASS` cho E2E, PostgreSQL multi-instance race/load, security review, target migration rehearsal, restore hoặc production deploy.
