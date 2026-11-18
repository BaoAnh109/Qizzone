# Qizzone hiện trạng kiến trúc

**Ngày audit:** 2026-11-17
**Repository:** `BaoAnh109/Qizzone`
**Nhánh được giữ nguyên:** `devolop/AIV3`
**SHA bắt đầu:** `015f3e9efdcdc5bdf713d7c556efc95060f7de64`

## Tóm tắt

Frontend vẫn là React + TypeScript + Vite, Firebase Authentication và Supabase. Nhánh hiện tại đã bổ sung một ASP.NET Core 10 API, EF Core/Npgsql schema/migrations và adapters frontend cho identity/profile, admin, quiz, exam và practice. Các adapter hoạt động khi cấu hình `VITE_QIZZONE_API_BASE_URL`; service chưa chuyển tiếp tục dùng Supabase.

Đây là giai đoạn chuyển tiếp, chưa phải kiến trúc production độc lập Supabase. API/worker Gemini và migration idempotency đã được bổ sung; API integration tests pass trên PostgreSQL 17 ephemeral, nhưng chưa chạy trên target database hoặc gọi Gemini thật. API đã có upload media riêng và lưu file trên persistent volume; vẫn thiếu chuyển dữ liệu media hiện có, staging deployment, restore evidence và release pipeline.

## Thành phần hiện có

| Thành phần | Hiện trạng |
|---|---|
| Web | React 19, TypeScript, Vite, Tailwind; UI student/teacher/admin và bộ parser tài liệu phía trình duyệt |
| Đăng nhập | Firebase Auth phía client; API mới xác minh Firebase ID token qua Firebase Admin và yêu cầu email đã xác minh cho endpoint nghiệp vụ |
| Backend mới | ASP.NET Core 10 API, minimal endpoints, policy authorization, ProblemDetails, health live/ready, OpenAPI Development-only |
| PostgreSQL mới | EF Core/Npgsql entity model và migrations cho profile, quiz, answer keys, exam, practice, audit, AI jobs/outbox; migrations đã chạy trên PostgreSQL 17 ephemeral trong CI, chưa rehearsal với staging/production target |
| Endpoint API | Profile/role/admin, quiz CRUD/assignment/status/reports, exam start/autosave/submit/student and owned-quiz results, practice start/check/finish/retry/history, durable AI import jobs |
| Frontend migration | `firebaseAuthService`, `adminService`, `quizService`, `examSessionService`, `practiceService` có API branch và Supabase fallback |
| Dịch vụ chưa chuyển | Một số account settings và legacy migration vẫn phụ thuộc Supabase Edge/Storage/RPC; media upload mới dùng API khi có cấu hình API, còn Supabase là fallback; reports API is partial and Gemini API branch has not cut over |
| Container/CI | Có Dockerfiles API và worker; run #158 build thành công cả hai image cho linux/amd64 và linux/arm64; workflow chạy frontend/backend audit, tests và build; chưa publish image hoặc deploy |
| Data migration | Schema đích và bảng checkpoint có source code, nhưng chưa có exporter/importer/reconciliation chạy thật |

## Luồng chạy hiện tại

1. Firebase Auth cấp ID token.
2. Khi cấu hình API base, các service có adapter gửi ID token đến ASP.NET Core API; role/ownership được suy từ PostgreSQL.
3. Các service chưa migrate tiếp tục dùng Supabase RPC/PostgREST/Edge Functions/Storage.
4. API mới ghi dữ liệu nghiệp vụ vào PostgreSQL; cơ sở dữ liệu mới chưa được tạo trong staging hoặc production.

Supabase source project hiện vẫn active trên PostgreSQL 17.11.0.003 và chứa dữ liệu thật (aggregate counts nằm trong `DATA_INVENTORY.md`). Checkout và live migration history lệch nhau ở migration avatar; migration media câu hỏi mới nhất chỉ tồn tại cục bộ. Không được bật API base URL hoặc cutover dữ liệu trước khi xử lý migration drift và hoàn tất rehearsal.

Không được coi việc bật API base URL là cutover hoàn chỉnh: một phần màn hình vẫn cần Supabase.

## Phần kiến trúc đích còn thiếu

- PostgreSQL-backed AI worker chưa chạy với database hoặc Gemini live; cần staging rehearsal cho lease/retry/retention/quota. API xóa prompt/ảnh khi job terminal.
- API nhận avatar/ảnh câu hỏi, kiểm tra chữ ký MIME/kích thước, quota theo chủ sở hữu và ghi file atomic vào persistent volume; PostgreSQL lưu owner/hash. Chưa migrate object/reference cũ, backup/restore volume chưa diễn tập, và URL đọc media hiện public immutable để khớp bucket hiện có.
- Room/join-by-code lifecycle and broader API contract parity; class targeting uses assigned class labels rather than a separate classroom entity.
- Browser E2E cho IndexedDB outbox/ACK/replay, Web Lock thực giữa các tab, conflict nhiều thiết bị, quota failure và mạng chập chờn; local tests đã kiểm tra fail-closed lock path nhưng chưa chạy browser/PostgreSQL thật.
- Import dữ liệu Supabase/Storage/Firebase mapping, kiểm tra legacy localStorage và đối soát counts/checksums.
- PostgreSQL migration/API integration: GitHub Actions run [#158](https://github.com/BaoAnh109/Qizzone/actions/runs/44099953969) passed on ephemeral PostgreSQL 17 with per-test schemas and 100 submissions through two API hosts. Latest local full Release suite applied all EF migrations to temporary native PostgreSQL 17.12 and passed 39 API + 7 worker tests with zero skips, including scheduled transitions, JSONB assignment filtering, owner-only avatar assignment, API cancellation, worker abort of a mocked in-flight Gemini call, and the 20-attempt cross-request capacity race. The regenerated full 14-migration SQL applied twice; schedule downgrade/reapply and the synthetic migration rehearsal passed. Vẫn thiếu target staging/production migration, backup ngoài môi trường, restore drill, RPO/RTO và target rollback evidence.
- Docker Compose runtime, image publish, Northflank staging, Vercel Preview tích hợp API.
- E2E, concurrency/load/chaos/security tests và SLO/cost evidence.

## Kiểm thử và kiểm tra

- Frontend GitHub Actions run #158: **165 passed**, **24 skipped**, 0 failed; 33 test files passed, 2 skipped; typecheck, lint, npm audit and Vite build passed.
- Backend GitHub Actions run #158: **18 API tests passed on PostgreSQL 17 ephemeral + 6 worker tests** with mocked Gemini HTTP; one API test submits concurrently through two independent hosts and verifies a single persisted result. This does not validate migration against the intended environment or sustained load/failure recovery.
- Latest PostgreSQL-backed .NET Release suite: **39 API + 7 worker tests passed, zero skipped**, on disposable native PostgreSQL 17.12. It applied all EF migrations and exercised the 20-attempt cross-request race; the full idempotent SQL artifact replayed twice, and schedule downgrade/reapply was checked on a disposable database. The updated synthetic migration rehearsal preserved an open attempt with a null deadline. This does not validate the target database, live source data migration, sustained load or failure recovery.
- GitHub Actions run #158 successfully built API and worker images for `linux/amd64` and `linux/arm64`; images were not pushed to a registry.
- API/worker Release build đạt; idempotent migration SQL and rollback for AI cancellation were generated in `%TEMP%` and replayed on disposable PostgreSQL, but have not been run against the intended target database.
- `tsc -b`, ESLint `src`, Vite production build: đạt.
- NuGet vulnerability audit in CI: không phát hiện vulnerable packages theo nguồn advisory hiện tại. npm audit in CI reported 0 vulnerabilities.
- The prior single-host 100-submit test still checks same-host serialization (using EF InMemory when local PostgreSQL is not configured); CI run #158 also covers 100 submissions across two independent hosts on PostgreSQL. Neither test substitutes for staging, sustained load, failure recovery, restore or deploy evidence.

## Deploy hiện tại

Edge hiện hiển thị team Free `Cryzy's Team`, project/environment `Default`, Developer Sandbox, mức dùng `$0.00 of $50.00`, và payment method active. Trang project cho phép bắt đầu deploy repository hoặc thêm database; Services/Addons không hiển thị inventory rows nên chưa thể xác nhận đầy đủ resource inventory. `.env` local được kiểm tra chỉ có biến `VITE_*`; backend connection string, Firebase Admin credential và Gemini key chưa có trong môi trường được kiểm tra. Chủ dự án xác nhận không có Northflank project cũ để khôi phục; backend credentials cần tạo mới nếu sau này có staging/hosting được cấp phép. Chưa triển khai V2 production.
