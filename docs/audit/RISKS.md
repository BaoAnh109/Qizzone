# Rủi ro và release blockers

**Ngày audit:** 2026-11-17
**Nhánh hiện tại:** `devolop/AIV3`

## Quyết định release

**NO-GO cho production.** API foundation và một phần chức năng đã có, nhưng hệ thống chưa cutover dữ liệu hoặc đạt feature parity. Chủ dự án đã cho phép tự rà soát/triển khai; release vẫn bị chặn bởi các điều kiện vận hành bên dưới. Northflank Free Sandbox chỉ dành cho thử nghiệm/hobby, không dùng cho production. Không có production deploy, DNS change, release branch hoặc thay đổi nhánh nào được thực hiện.

| Mức | Rủi ro | Bằng chứng / ảnh hưởng | Điều kiện đóng |
|---|---|---|---|
| P0 | Dữ liệu production chưa được di chuyển/đối soát | Supabase live có 12 profiles, 18 quizzes, 1,212 questions, 56 attempts, 1,431 answers, 54 results; chưa có export, checksums, UID mapping hoặc restore proof | ETL lặp lại an toàn, rehearsal staging, đối soát và backup restore đạt |
| P0 | Frontend còn phụ thuộc Supabase | API adapters chỉ phủ identity/admin, quiz, exam và practice; upload/avatar, reports, legacy import và một số account flows còn dùng Edge/RPC/Storage | Migrate parity theo matrix, loại fallback sau khi xác nhận cutover và chạy E2E đầy đủ |
| P0 | PostgreSQL schema chưa được xác nhận trên server thật | Migrations được sinh; CI đã cấu hình PostgreSQL 17 ephemeral và per-test schema migration nhưng chưa có remote run; local tests vẫn dùng EF InMemory | Xác nhận workflow pass trên clean PostgreSQL, review SQL/constraints/indexes/transactions và chạy multi-instance concurrency suite |
| P0 | Migration history Supabase lệch checkout | Live avatar migration version là `20261029072833`, local file là `20261029130000_account_avatar_storage.sql`; local question-media migration chưa chạy live | Compare remote/local schema and migration contents; reconcile history with an explicit, backed-up migration plan before applying anything |
| P0 | Không có staging/production deployment | Edge workspace hiện có project Free rỗng; không có qizzone API/worker/database; CI chỉ validate/build | Có staging đủ services/secrets, smoke tests và release workflow; production dùng gói phù hợp với uptime/durability |
| P0 | Credential/hosting risk cần xử lý trước khi gửi secret | Dashboard Northflank hiện hiển thị security incident notice và khuyến nghị xoay credential lưu trước 2026-10-30; điều tra forensic còn mở trong status update | Xác nhận trạng thái incident, dùng credential mới/đã xoay, kiểm tra audit/logs và đặt giới hạn ngân sách; không gửi secret qua Git/chat |
| P1 | Chưa có npm dependency audit | `npm` CLI không có trong môi trường này; NuGet audit đã chạy nhưng không thay cho kiểm tra dependencies frontend | Chạy `npm audit` từ CI hoặc môi trường release có Node/npm trước khi phát hành |
| P0 | Autosave protocol đã có nhưng chưa được xác nhận production | IndexedDB snapshot/outbox, API mutation dedupe và khóa Web Locks theo attempt có local unit/API coverage; chưa có PostgreSQL, browser multi-tab/device, quota failure hoặc offline E2E | Xác nhận trên PostgreSQL/staging: ACK sau commit, durable retry, khóa giữa tab thật, conflict nhiều thiết bị và quota failure |
| P1 | AI worker mới được kiểm định local | API enqueue, PostgreSQL queue claim, Gemini REST, system instructions, schema validation, finite retry/lease recovery, per-user quota and idempotency are implemented; tests mock DB/provider boundaries | Apply migration on PostgreSQL; exercise real worker restart/lease recovery and controlled Gemini request on isolated staging; define cost/cache/retention policy and monitor quota |
| P1 | Reports/room/class parity thiếu | API trả student result và owned-quiz result có policy; teacher aggregates/filters/pagination/export, join-by-code/classroom lifecycle chưa đủ | Contract parity, ownership tests, query/index review và E2E |
| P1 | Storage chưa portable | Media/avatar còn Supabase Storage; API chỉ kiểm tra storage reference theo owner | Storage đích private, upload limits/scanning, object inventory/hash reconciliation và rollback plan |
| P1 | Live source helper warning | Supabase metadata flagged mutable search_path for `current_uid` and `app_role`; a new local migration pins both to an empty path; no live change has been applied | Reconcile migration history, apply in a reviewed source migration window, then re-run security advisors |
| P1 | Thiếu QA resilience và operational evidence | 181 frontend tests + 17 API InMemory tests + 6 worker tests; test 100 submit đồng thời chỉ dùng EF InMemory/process-local gate; chưa có E2E, PostgreSQL multi-instance races, k6, chaos, backup restore, alert/SLO | Chạy kiểm thử trên staging/đủ tài nguyên và lưu báo cáo có cấu hình/tỷ lệ lỗi/p95/p99 thực |
| P1 | Không có deploy workflow hoặc release approval artifact | CI mới restore/audit/test/build; workflow không deploy; không ghi nhận remote CI xanh | Staging-only deployment automation, manual production gate, rollback/data runbook và SHA sign-off |
| P2 | Workspace có bản sao app lồng nhau chưa track | Cục bộ Vitest phát hiện thêm test trong `Qizzone/qizzone`; đây là dữ liệu có sẵn, không được xóa | CI chạy checkout sạch và local test phải giới hạn `--dir src`; giữ nguyên thư mục user data |

## Kiểm tra local

- Frontend source `src`: 181 passed, 24 skipped; typecheck, ESLint và Vite build đạt.
- Backend Release tests: 17 API tests + 6 worker tests passed; API tests use EF InMemory and Gemini HTTP is mocked.
- API/worker solution Release build/tests passed; idempotent migration SQL generated (26,371 bytes) and EF model is current. The 100-submit test uses EF InMemory, not a real multi-instance database.
- NuGet vulnerability audit: không phát hiện vulnerable package.
- Docker build, PostgreSQL migration execution, staging smoke, E2E, multi-instance load, fault injection, backup/restore và production deploy chưa chạy.

## Northflank evidence

Dashboard Edge đã kiểm tra read-only: team Free, một project `Default`, chưa có service/database. Northflank công bố Free Sandbox **không nên dùng production** ([pricing docs](https://northflank.com/docs/v1/application/billing/pricing-on-northflank)). Northflank status page ngày 2026-11-06 cho biết investigation/forensic review còn tiếp tục và yêu cầu xoay secrets; dashboard vẫn hiện incident notice ([official incident status](https://status.northflank.com/cmvv0rn5a092f14rutwccodpp)). Không tạo resources hoặc gửi credential trong lúc các điều kiện này chưa được xử lý.

## Việc cần hoàn thành tiếp

1. Hoàn tất API parity, durable Gemini worker, uploads/storage và teacher reports; giữ secrets server-side.
2. Thực hiện schema review và PostgreSQL migration + import/reconcile rehearsal trên data test ẩn danh.
3. Chạy PostgreSQL integration và browser E2E cho IndexedDB outbox, offline/reload, multi-tab/device conflict, retry, deadline và quota failure.
4. Tạo staging biệt lập, chạy E2E/security/concurrency/load/restore, đo cost/SLO và lưu artifacts.
5. Khi đủ các gate còn thiếu, triển khai production trên hạ tầng phù hợp; giữ nguyên branch khác và không cắt traffic trước smoke/reconcile. Mọi bước có phí hoặc cần secret mới phải dùng thông tin/quyền truy cập tương ứng.
