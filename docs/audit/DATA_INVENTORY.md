# Inventory dữ liệu Qizzone

**Ngày audit:** 2026-11-18
**Phạm vi:** schema/code được track trong `devolop/AIV3`; kiểm tra metadata và exact aggregate production Supabase chỉ đọc ngày 2026-11-18. Core row counts, Supabase Auth và Storage được đối chiếu lúc 00:43:49 UTC; trạng thái aggregate của attempt được kiểm tra lại lúc 01:01:18 UTC. Không đọc row cá nhân, nội dung đề, đáp án hay payload.

## Nguồn dữ liệu và định danh

| Nguồn | Mục đích | Trạng thái |
|---|---|---|
| Firebase Authentication | Tài khoản, email/password, Google identity và Firebase UID | Dùng để đăng nhập; không đọc Firebase user records trong lần audit này |
| Supabase PostgreSQL | Hồ sơ, quiz, câu hỏi, attempts, answers, kết quả, practice và quota AI | Project active, PostgreSQL 17.11.0.003; exact aggregate row counts bên dưới |
| Supabase Storage | Avatar và media câu hỏi | Live có bucket `account-avatars` public, giới hạn 2 MiB, JPEG/PNG/WebP; snapshot chỉ đọc có 0 object, 0 tham chiếu ảnh câu hỏi và 0 avatar URL trỏ Storage. Chưa có bucket media câu hỏi |
| Trình duyệt | Legacy migration source còn ở localStorage; luồng autosave v2 hiện có IndexedDB snapshot/outbox | Không có backup/export dữ liệu trình duyệt; cần kiểm thử restore/quota và chỉ xóa key legacy sau khi migration đã được xác nhận |
| Supabase Edge Functions | Bootstrap/role/admin, Gemini, avatar | 6 function names được liệt kê live; deployed source revision/secrets chưa xác minh |

Không tìm thấy tích hợp Firestore trong source được audit. Điều này chưa xác nhận Firebase project không có dữ liệu ngoài code.

## Aggregate inventory Supabase live

Các số dưới đây là kết quả `COUNT(*)` chính xác ngày 2026-11-18; không truy vấn hay xuất row values. Không phải backup, checksum hay chứng cứ rằng dữ liệu đã được sao chép.

| Relation | Rows |
|---|---:|
| `profiles` | 12 |
| `quizzes` | 19 |
| `questions` | 1,324 |
| `question_answer_keys` | 1,324 |
| `exam_attempts` | 58 (2 chưa nộp, 56 đã nộp) |
| `exam_answers` | 1,447 |
| `exam_results` | 56 |
| `practice_sessions` | 5 |
| `practice_answers` | 163 |
| `data_migrations` | 2 |
| `storage.buckets` | 1 |
| `storage.objects` | 0 |
| `auth.users` | 0 (Supabase Auth; app profiles use Firebase UID) |
| Tham chiếu ảnh trong `questions` | 0 |
| Avatar URL trỏ Supabase Storage | 0 |

The Supabase table-list tool's row estimates were stale for profiles, quizzes, questions, and results; the exact counts above come from explicit aggregate SQL and supersede those estimates.

The 00:43:49 UTC exact aggregate recheck returned the same core counts: 12 profiles, 19 quizzes, 1,324 questions/answer keys, 58 attempts, 1,447 answers, 56 results, 5 practice sessions and 163 practice answers. It also reconfirmed 0 Supabase Auth users, 0 Storage objects and 2 attempts with `submitted_at IS NULL`. A follow-up aggregate-only attempt check at 01:01:18 UTC found 0 unexpired attempts, 1 expired attempt, and 1 attempt with no `ends_at`. The table-list endpoint reports approximate row estimates and was stale; the explicit `COUNT(*)` query is authoritative for the counts it queried. The migration tool now copies open attempts with their saved answers, order, revision, and nullable deadline so they can resume in V2; do not finalize or discard either attempt just to pass migration. A source write freeze, synchronized browser answers, and unchanged source digest are still required. Export, checksum, ownership mapping, and reconciliation remain outstanding; these counts are a baseline only, not proof of a backup or copy.

### Applied migration history versus checkout

Live Supabase reports these applied versions: `202609050001`, `202609090001`, `202609160001`, `202609250001`, `202610260000`, `202610260001`, `202610260002`, `20261026164438`, and `20261029072833`.

The 00:44 UTC ledger recheck returned the same nine live versions. The checkout instead names the avatar migration `20261029130000_account_avatar_storage.sql`; the version differs from live history and must be reconciled before any CLI migration push. The local `202611170001_question_media.sql` is not applied live; the live bucket inventory confirms question media storage is not provisioned there. Fresh advisors at 00:45 UTC report two RLS-enabled tables without policies, mutable `search_path` on `current_uid` and `app_role`, 23 authenticated-executable `SECURITY DEFINER` functions, 3 unindexed foreign keys, 3 unused indexes, and no health findings. A follow-up local migration pins the two identity helper search paths, but has not been applied to Supabase.

## Bảng PostgreSQL đã thấy trong migrations

### `public`

- `profiles`: Firebase UID, email, tên, role, trạng thái duyệt, yêu cầu/chặn role, avatar và timestamps.
- `quizzes`: chủ sở hữu, mã phòng, tiêu đề, môn học, trạng thái, settings JSONB, legacy ID và timestamps.
- `questions`: quiz, thứ tự, nội dung, media JSONB, loại câu hỏi, options JSONB, điểm và legacy ID.
- `question_answer_keys`: answer key và giải thích tách riêng khỏi nội dung câu hỏi.
- `exam_attempts`: học sinh, quiz, thời gian, revision và trạng thái làm/nộp.
- `exam_answers`: đáp án chọn và trạng thái câu hỏi theo attempt.
- `exam_results`: payload kết quả sau khi chấm.
- `data_migrations`: checkpoint/report cho import legacy.
- `practice_sessions`: phiên luyện tập, trạng thái, thứ tự câu, cấu hình và kết quả.
- `practice_answers`: đáp án đã kiểm tra trong phiên luyện.

### `private` và managed schemas

- `private.ai_limits`: quota theo UID.
- Live `storage.buckets` / `storage.objects`: chỉ có bucket `account-avatars`, public read, giới hạn loại/size; hiện 0 objects. Metadata live không có policy trên `storage.objects`; upload avatar trong source đi qua Edge Function dùng service key sau khi tự xác minh Firebase ID token.
- `qizzone-question-media` và policy public-read/teacher-upload chỉ được định nghĩa trong migration cục bộ `202611170001_question_media.sql`, chưa có trên Supabase live.
- `auth.users` thuộc Firebase/Supabase integration hiện tại; cần audit riêng cách Firebase JWT được xác minh ở Supabase.

## RPC và thao tác dữ liệu nghiệp vụ đã thấy

- Identity/profile: `update_my_profile`, `bootstrap-profile`, `request-teacher-role`, `switch-account-role`, `manage-teacher-approvals`.
- Quiz: `list_quizzes`, `save_quiz`, `set_quiz_assignments`, `set_quiz_status`, `delete_quiz`.
- Thi: `start_attempt`, `save_attempt`, `submit_attempt`, `finalize_expired`, `list_sessions`, `list_results`; `private.finalize_attempt` chấm và tạo result.
- Practice: `start_practice`, `start_practice_retry`, `get_practice_session`, `check_practice_answer`, `finish_practice`, `list_practice_history`.
- Import/ops: `import_legacy_attempt`, `mark_data_migration`, `consume_ai_quota`.

Các bảng nghiệp vụ live có RLS. `exam_results` không có policy trực tiếp và kết quả được đọc qua RPC có kiểm tra quyền; `private.ai_limits` chỉ dùng service role. RPC `SECURITY DEFINER` cần giữ nguyên ownership, tính ẩn của answer key, transaction, revision, idempotency và các ràng buộc trong PL/pgSQL.

## Migration files

1. `202609050001_cloud.sql` — schema lõi, role/RLS, quiz, attempts, grading và quota.
2. `202609090001_teacher_approval.sql` — trạng thái duyệt giáo viên.
3. `202609160001_student_teacher_switch.sql` — chuyển role student/teacher.
4. `202609250001_quiz_assignments.sql` — giao quiz theo lớp/email.
5. `202610260000_redact_assigned_emails.sql` — che email assignment trong kết quả đọc.
6. `202610260001_practice.sql` — bảng và RPC luyện tập.
7. `202610260002_practice_retry.sql` — retry phiên luyện.
8. `20261026164438_practice_retry_checked_only.sql` — retry dựa trên câu đã kiểm tra.
9. `20261029130000_account_avatar_storage.sql` — avatar storage (checkout); version live được ghi nhận là `20261029072833`, cần reconcile.
10. `202611170001_question_media.sql` — media câu hỏi và validation (chưa áp dụng live).
11. `202611170002_harden_identity_helpers.sql` — pin search path cho `current_uid` và `app_role` (chưa áp dụng live).

## Edge Functions

- `bootstrap-profile`
- `extract-quiz-with-gemini`
- `manage-teacher-approvals`
- `request-teacher-role`
- `switch-account-role`
- `upload-account-avatar`

Live metadata cho biết cả sáu function đặt `verify_jwt=false`; source dùng Firebase Admin `verifyIdToken(token, true)` bên trong từng handler để kiểm tra signature, issuer, audience, expiry, revocation và disabled-user status. Deployed source revision/configuration chưa được đối chiếu với checkout.

## Dữ liệu cần thu thập trước migration thật

- Snapshot/export có backup; tổng kích thước và checksum theo bảng; mapping UID/account state. Aggregate counts hiện tại không thay thế các chứng cứ này.
- Số attempts đang mở, submissions, results và practice sessions theo trạng thái.
- Object count/size/hash và mapping path trong quiz/questions/profiles; aggregate hiện tại là 0 object và 0 ảnh/avatar reference, phải kiểm tra lại ngay trước cutover.
- Firebase UID/email mapping, custom claims, disabled/deleted accounts và trạng thái xác minh email.
- Function secrets/versions/quota; không đưa secret values vào report hoặc Git.
- Export rehearsal lặp lại được, import staging, so sánh counts/checksum, test quyền và restore từ backup.

Các con số trên chưa có trong checkout; không dùng dữ liệu cá nhân hoặc production dump để suy đoán.

## PostgreSQL schema đích được tạo trong backend

`backend/Qizzone.Api/Data/QizzoneDbContext.cs` và migrations định nghĩa target tables cho `profiles`, `quizzes`, `questions`, `question_answer_keys`, `exam_attempts`, `exam_answers`, `exam_results`, `practice_sessions`, `practice_answers`, `data_migrations`, `ai_import_jobs`, `outbox_messages`, `ai_rate_limits` và `audit_events`. Định nghĩa EF không chứng minh bảng đã tồn tại trong Northflank hay có dữ liệu.

Đã thêm `backend/Qizzone.MigrationTool` để lập plan chỉ đọc (row counts/SHA-256 theo bảng và các blocker aggregate) và import relational data có digest gate vào target PostgreSQL rỗng sau khi migration schema tối thiểu mà tool yêu cầu (`20261118080000_AllowFiveOptionAnswers`) đã được áp dụng. Tool giữ ID/UID, dựng snapshot đề thi theo thứ tự câu của attempt, kiểm tra quan hệ dữ liệu, xác nhận checksum target và đọc lại digest source trước khi commit; từ chối khi có object/media/avatar trên Supabase Storage, có Supabase Auth user, hoặc target đã có dữ liệu khác. Tool không từ chối attempt đang mở: nó sao chép attempt và câu trả lời đã lưu để V2 có thể resume. Diễn tập fixture giả lập đã đạt trên PostgreSQL 17.12 dùng riêng trong máy: digest lặp lại ổn định, digest sai không ghi dữ liệu, apply nhập đúng fixture, chạy lại không đổi dữ liệu, checksum và snapshot đều được đối chiếu. Fixture gồm hai exam attempts, trong đó một attempt đang mở có `ends_at IS NULL`; sau import, câu trả lời `B`, revision `7` và khả năng resume vẫn được giữ. Migration AI cancellation `20261118090000_CancelAiImportJobs` và generated deployment/rollback SQL scripts đã được apply/rollback kiểm chứng trên PostgreSQL tạm; script idempotent chạy hai lần rồi chạy lại sau rollback, và job `cancelled` giả lập được đổi thành `failed`. Chưa áp dụng lên target hoặc kết nối/import dữ liệu Supabase thật. Vẫn cần freeze các ghi nguồn đến hết cutover vì không thể loại bỏ race với giao dịch mới ngay sau lần kiểm tra cuối. Supabase không lưu `active_role` trong profile; tool đặt `active_role` theo role gốc, nên người đã duyệt teacher nhưng đang xem ở student view sẽ cần chọn lại teacher view sau lần đăng nhập đầu tiên.

Xem chi tiết cách chạy, bằng chứng fixture và phần còn thiếu trong [MIGRATION_RECONCILIATION.md](MIGRATION_RECONCILIATION.md).

Tool không tạo backup, không chuyển object storage, không ánh xạ Firebase account state, không chứng minh được restore, và không thay thế rehearsal/đối soát nghiệp vụ. Aggregate counts phía trên vẫn chỉ là baseline hiện trạng; chưa có source export/checksum, live target import, object transfer, reconciliation report hay backup/restore evidence. Importer hiện giữ nguyên attempt chưa nộp thay vì bắt buộc kết thúc; source phải được đóng băng và digest được kiểm tra lại trước commit để tránh mất câu trả lời mới. Vì vậy target database chưa thể nhận traffic hoặc được xem là bản sao authoritative.
