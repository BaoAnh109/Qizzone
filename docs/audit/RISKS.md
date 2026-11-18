# Rủi ro và release blockers

**Ngày audit:** 2026-11-17
**Nhánh hiện tại:** `devolop/AIV3`

## Quyết định release

**NO-GO cho production.** API foundation và một phần chức năng đã có, nhưng hệ thống chưa cutover dữ liệu hoặc đạt feature parity. Chủ dự án đã cho phép tự rà soát/triển khai; release vẫn bị chặn bởi các điều kiện vận hành bên dưới. Northflank Free Sandbox chỉ dành cho thử nghiệm/hobby, không dùng cho production. Không có production deploy, DNS change, release branch hoặc thay đổi nhánh nào được thực hiện.

| Mức | Rủi ro | Bằng chứng / ảnh hưởng | Điều kiện đóng |
|---|---|---|---|
| P0 | Dữ liệu production chưa được di chuyển/đối soát | Supabase live có 12 profiles, 18 quizzes, 1,212 questions, 56 attempts, 1,431 answers, 54 results; chưa có export, checksums, UID mapping hoặc restore proof | ETL lặp lại an toàn, rehearsal staging, đối soát và backup restore đạt |
| P0 | Frontend còn phụ thuộc Supabase | API adapters chỉ phủ identity/admin, quiz, exam và practice; upload/avatar, reports, legacy import và một số account flows còn dùng Edge/RPC/Storage | Migrate parity theo matrix, loại fallback sau khi xác nhận cutover và chạy E2E đầy đủ |
| P0 | PostgreSQL schema chưa được rehearsal trên target | GitHub Actions run #158 pass trên PostgreSQL 17 ephemeral và per-test schema migration; có 100 submit đồng thời qua hai API host độc lập; chưa chạy với target staging/production hoặc rollback | Rehearse migrations and rollback against disposable target-equivalent staging, review SQL/constraints/indexes/transactions and expand multi-instance concurrency coverage |
| P0 | Migration history Supabase lệch checkout | Live avatar migration version là `20261029072833`, local file là `20261029130000_account_avatar_storage.sql`; local question-media migration chưa chạy live | Compare remote/local schema and migration contents; reconcile history with an explicit, backed-up migration plan before applying anything |
| P0 | Không có staging/production deployment | Edge workspace hiện có project Free rỗng; không có qizzone API/worker/database hoặc secret group; CI build container nhưng chưa deploy | Xác định vị trí credentials cũ, cung cấp kết nối DB và triển khai staging; production cần host phù hợp, smoke tests và release workflow |
| P0 | Backend credentials không sẵn có trong Northflank | Chủ dự án yêu cầu tái sử dụng secrets cũ; project Default không có secret group, local `.env` chỉ có client-side `VITE_*` values; backend cần database connection, Firebase Admin credential và worker Gemini key | Chỉ ra secret store/project đang chứa credentials cũ; không tạo hay xoay secrets theo chỉ thị hiện tại |
| P0 | Northflank incident affects existing credentials | Dashboard warns user-defined credentials created before Oct 30 are in scope; the owner explicitly directed reuse without rotation, but the current project has no secret group and backend credential availability is unverified | Keep this accepted owner direction documented; use existing values only after their source is identified and entered through the platform secret store |
| P0 | Autosave protocol đã có nhưng chưa được xác nhận production | IndexedDB snapshot/outbox, API mutation dedupe và khóa Web Locks theo attempt có local unit/API coverage; chưa có PostgreSQL, browser multi-tab/device, quota failure hoặc offline E2E | Xác nhận trên PostgreSQL/staging: ACK sau commit, durable retry, khóa giữa tab thật, conflict nhiều thiết bị và quota failure |
| P1 | AI worker mới được kiểm định local | API enqueue, PostgreSQL queue claim, Gemini REST, system instructions, schema validation, finite retry/lease recovery, per-user quota and idempotency are implemented; tests mock DB/provider boundaries | Apply migration on PostgreSQL; exercise real worker restart/lease recovery and controlled Gemini request on isolated staging; define cost/cache/retention policy and monitor quota |
| P1 | Reports/room/class parity thiếu | API trả student result và owned-quiz result có policy; teacher aggregates/filters/pagination/export, join-by-code/classroom lifecycle chưa đủ | Contract parity, ownership tests, query/index review và E2E |
| P1 | Storage chưa portable | Media/avatar còn Supabase Storage; API chỉ kiểm tra storage reference theo owner | Storage đích private, upload limits/scanning, object inventory/hash reconciliation và rollback plan |
| P1 | Live source helper warning | Supabase metadata flagged mutable search_path for `current_uid` and `app_role`; a new local migration pins both to an empty path; no live change has been applied | Reconcile migration history, apply in a reviewed source migration window, then re-run security advisors |
| P1 | Thiếu QA resilience và operational evidence | CI run #158: 165 frontend tests passed (24 skipped), npm audit reported 0 vulnerabilities, 18 API tests passed on ephemeral PostgreSQL 17 including 100 submits through two independent hosts, 6 worker tests passed with mocked Gemini, API/worker multi-arch builds passed; chưa có E2E, multi-instance load, chaos, backup restore, alert/SLO | Chạy kiểm thử trên staging/đủ tài nguyên và lưu báo cáo có cấu hình/tỷ lệ lỗi/p95/p99 thực |
| P1 | Không có deploy workflow hoặc release approval artifact | CI run #158 xanh, có build container nhưng chưa publish image hoặc deploy; chưa có release artifact, rollback/data runbook hoặc SHA sign-off | Staging-only deployment automation, manual production gate, rollback/data runbook và SHA sign-off |
| P2 | Workspace có bản sao app lồng nhau chưa track | Cục bộ Vitest phát hiện thêm test trong `Qizzone/qizzone`; đây là dữ liệu có sẵn, không được xóa | CI chạy checkout sạch và local test phải giới hạn `--dir src`; giữ nguyên thư mục user data |

## Kiểm tra local

- GitHub Actions run [#158](https://github.com/BaoAnh109/Qizzone/actions/runs/44099953969): Frontend 165 passed, 24 skipped; npm audit, typecheck, ESLint and Vite build passed. Backend 18 API tests passed on ephemeral PostgreSQL 17, including 100 submit requests across two independent API hosts, and 6 worker tests passed with Gemini HTTP mocked. API and worker images built for both Linux architectures.
- API/worker solution Release build/tests passed; idempotent migration SQL generated (26,371 bytes) and EF model is current. A single-host concurrency test also runs against PostgreSQL in CI; the two-host test asserts one result, one audit event and one revision increment.
- NuGet and NPM vulnerability audits: no vulnerable packages reported by CI run #158.
- Multi-arch Docker builds passed in run #158. Target PostgreSQL migration/rollback, staging smoke, E2E, multi-instance load, fault injection, backup/restore và production deploy chưa chạy. Migration application in ephemeral PostgreSQL CI is covered by run #158.

## Northflank evidence

Dashboard Edge đã kiểm tra read-only: team Free, một project `Default`, chưa có service/database. Northflank công bố Free Sandbox **không nên dùng production** ([pricing docs](https://northflank.com/docs/v1/application/billing/pricing-on-northflank)). Northflank status page ngày 2026-11-06 cho biết investigation/forensic review còn tiếp tục và yêu cầu xoay secrets; dashboard vẫn hiện incident notice ([official incident status](https://status.northflank.com/cmvv0rn5a092f14rutwccodpp)). Không tạo resources hoặc gửi credential trong lúc các điều kiện này chưa được xử lý.

## Việc cần hoàn thành tiếp

1. Hoàn tất API parity, durable Gemini worker, uploads/storage và teacher reports; giữ secrets server-side.
2. Thực hiện schema review và PostgreSQL migration + import/reconcile rehearsal trên data test ẩn danh.
3. Chạy PostgreSQL integration và browser E2E cho IndexedDB outbox, offline/reload, multi-tab/device conflict, retry, deadline và quota failure.
4. Tạo staging biệt lập, chạy E2E/security/concurrency/load/restore, đo cost/SLO và lưu artifacts.
5. Khi đủ các gate còn thiếu, triển khai production trên hạ tầng phù hợp; giữ nguyên branch khác và không cắt traffic trước smoke/reconcile. Mọi bước có phí hoặc cần secret mới phải dùng thông tin/quyền truy cập tương ứng.
