# Qizzone hiện trạng kiến trúc

**Ngày audit:** 2026-11-17
**Repository:** `BaoAnh109/Qizzone`
**Nhánh được giữ nguyên:** `devolop/AIV3`
**SHA bắt đầu:** `015f3e9efdcdc5bdf713d7c556efc95060f7de64`

## Tóm tắt

Frontend vẫn là React + TypeScript + Vite, Firebase Authentication và Supabase. Nhánh hiện tại đã bổ sung một ASP.NET Core 10 API, EF Core/Npgsql schema/migrations và adapters frontend cho identity/profile, admin, quiz, exam và practice. Các adapter hoạt động khi cấu hình `VITE_QIZZONE_API_BASE_URL`; service chưa chuyển tiếp tục dùng Supabase.

Đây là giai đoạn chuyển tiếp, chưa phải kiến trúc production độc lập Supabase. API/worker Gemini và migration idempotency đã được bổ sung, nhưng chưa chạy trên PostgreSQL hoặc gọi Gemini thật. Upload/object storage mới, data import/reconciliation, staging deployment, restore evidence và release pipeline vẫn chưa có.

## Thành phần hiện có

| Thành phần | Hiện trạng |
|---|---|
| Web | React 19, TypeScript, Vite, Tailwind; UI student/teacher/admin và bộ parser tài liệu phía trình duyệt |
| Đăng nhập | Firebase Auth phía client; API mới xác minh Firebase ID token qua Firebase Admin và yêu cầu email đã xác minh cho endpoint nghiệp vụ |
| Backend mới | ASP.NET Core 10 API, minimal endpoints, policy authorization, ProblemDetails, health live/ready, OpenAPI Development-only |
| PostgreSQL mới | EF Core/Npgsql entity model và migrations cho profile, quiz, answer keys, exam, practice, audit, AI jobs/outbox; chưa apply/rehearse trên PostgreSQL thật |
| Endpoint API | Profile/role/admin, quiz CRUD/assignment/status, exam start/autosave/submit/student and owned-quiz results, practice start/check/finish/retry/history, durable AI import jobs |
| Frontend migration | `firebaseAuthService`, `adminService`, `quizService`, `examSessionService`, `practiceService` có API branch và Supabase fallback |
| Dịch vụ chưa chuyển | Upload/avatar/media, teacher reports/analytics, một số account settings và legacy migration vẫn phụ thuộc Supabase Edge/Storage/RPC; Gemini API branch có worker nhưng chưa cutover |
| Container/CI | Có Dockerfiles API và worker; workflow kiểm tra frontend, backend/worker restore, vulnerability audit, tests và build; chưa có deploy job |
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
- Media/avatar upload và storage portable; inventory/transfer object chưa làm.
- Reports/analytics cho giáo viên, lớp/phòng thi, exports và đầy đủ contract parity.
- Browser E2E cho IndexedDB outbox/ACK/replay, Web Lock thực giữa các tab, conflict nhiều thiết bị, quota failure và mạng chập chờn; local tests đã kiểm tra fail-closed lock path nhưng chưa chạy browser/PostgreSQL thật.
- Import dữ liệu Supabase/Storage/Firebase mapping, kiểm tra legacy localStorage và đối soát counts/checksums.
- PostgreSQL migration/API integration: CI đã cấu hình PostgreSQL 17 service (khớp major version Supabase source) và schema riêng theo test factory, nhưng chưa có remote workflow run để xác nhận; vẫn thiếu backup ngoài môi trường, restore drill, RPO/RTO và rollback test.
- Docker/Compose execution, ARM64 build evidence, Northflank staging, Vercel Preview tích hợp API.
- E2E, concurrency/load/chaos/security tests và SLO/cost evidence.

## Kiểm tra local

- Frontend source `src`: **181 passed**, **24 skipped**, 0 failed; 36 test files passed, 2 skipped.
- Backend `dotnet test --configuration Release`: **17 API + 6 worker tests** passed local, gồm test 100 submit đồng thời trên EF InMemory; Gemini HTTP được mock. Workflow CI đã cấu hình PostgreSQL 17 + per-factory schema migration, chưa có remote run.
- API/worker Release build đạt; idempotent migration SQL 26,371 bytes đã sinh tại `%TEMP%`, chưa áp dụng PostgreSQL.
- `tsc -b`, ESLint `src`, Vite production build: đạt.
- NuGet vulnerability audit: không phát hiện vulnerable packages theo nguồn advisory hiện tại.
- Test 100 submit song song chỉ xác nhận serialization trong một API process với EF InMemory; chưa chứng minh nhiều instance trên PostgreSQL. Các kết quả local không thay thế PostgreSQL integration, staging, E2E, tải, restore hay deploy evidence.

## Deploy hiện tại

Không tìm thấy cấu hình/secret của Vercel hoặc Northflank trong checkout. Phiên Edge được chủ dự án dùng sẵn cho Northflank đang hiển thị team Free và project `Default` chưa có service/database. Dashboard cũng hiển thị cảnh báo sự cố bảo mật/khuyến nghị xoay vòng credential lưu trước 30-10-2026. Northflank Free Sandbox được tài liệu chính thức ghi rõ không dành cho production. Không có production deploy nào được thực hiện.
