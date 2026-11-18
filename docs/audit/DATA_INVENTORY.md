# Inventory dữ liệu Qizzone

**Ngày audit:** 2026-11-17
**Phạm vi:** schema/code được track trong `devolop/AIV3`; kiểm tra metadata production Supabase chỉ đọc ngày 2026-11-17. Không đọc row cá nhân, đề, đáp án hay payload.

## Nguồn dữ liệu và định danh

| Nguồn | Mục đích | Trạng thái |
|---|---|---|
| Firebase Authentication | Tài khoản, email/password, Google identity và Firebase UID | Dùng để đăng nhập; không đọc Firebase user records trong lần audit này |
| Supabase PostgreSQL | Hồ sơ, quiz, câu hỏi, attempts, answers, kết quả, practice và quota AI | Project active, PostgreSQL 17.11.0.003; exact aggregate row counts bên dưới |
| Supabase Storage | Avatar và media câu hỏi | Live có bucket `account-avatars` public, giới hạn 2 MiB, JPEG/PNG/WebP; 0 object. Chưa có bucket media câu hỏi |
| Trình duyệt | Legacy migration source còn ở localStorage; luồng autosave v2 hiện có IndexedDB snapshot/outbox | Không có backup/export dữ liệu trình duyệt; cần kiểm thử restore/quota và chỉ xóa key legacy sau khi migration đã được xác nhận |
| Supabase Edge Functions | Bootstrap/role/admin, Gemini, avatar | 6 function names được liệt kê live; deployed source revision/secrets chưa xác minh |

Không tìm thấy tích hợp Firestore trong source được audit. Điều này chưa xác nhận Firebase project không có dữ liệu ngoài code.

## Aggregate inventory Supabase live

Các số dưới đây là kết quả `COUNT(*)` chính xác ngày 2026-11-17; không truy vấn hay xuất row values. Không phải backup, checksum hay chứng cứ rằng dữ liệu đã được sao chép.

| Relation | Rows |
|---|---:|
| `profiles` | 12 |
| `quizzes` | 18 |
| `questions` | 1,212 |
| `question_answer_keys` | 1,212 |
| `exam_attempts` | 56 |
| `exam_answers` | 1,431 |
| `exam_results` | 54 |
| `practice_sessions` | 5 |
| `practice_answers` | 163 |
| `data_migrations` | 2 |
| `storage.buckets` | 1 |
| `storage.objects` | 0 |
| `auth.users` | 0 (Supabase Auth; app profiles use Firebase UID) |

The Supabase table-list tool's row estimates were stale for profiles, quizzes, and results; the exact counts above come from explicit aggregate SQL and supersede those estimates.

### Applied migration history versus checkout

Live Supabase reports these applied versions: `202609050001`, `202609090001`, `202609160001`, `202609250001`, `202610260000`, `202610260001`, `202610260002`, `20261026164438`, and `20261029072833`.

The checkout instead names the avatar migration `20261029130000_account_avatar_storage.sql`; the version differs from live history and must be reconciled before any CLI migration push. The local `202611170001_question_media.sql` is not applied live; the live bucket inventory confirms question media storage is not provisioned there. A follow-up local migration pins the two identity helper search paths, but has not been applied to Supabase.

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
- Object count/size/hash và mapping path trong quiz/questions/profiles; hiện mới biết live có một bucket public và 0 object.
- Firebase UID/email mapping, custom claims, disabled/deleted accounts và trạng thái xác minh email.
- Function secrets/versions/quota; không đưa secret values vào report hoặc Git.
- Export rehearsal lặp lại được, import staging, so sánh counts/checksum, test quyền và restore từ backup.

Các con số trên chưa có trong checkout; không dùng dữ liệu cá nhân hoặc production dump để suy đoán.

## PostgreSQL schema đích được tạo trong backend

`backend/Qizzone.Api/Data/QizzoneDbContext.cs` và migrations định nghĩa target tables cho `profiles`, `quizzes`, `questions`, `question_answer_keys`, `exam_attempts`, `exam_answers`, `exam_results`, `practice_sessions`, `practice_answers`, `data_migrations`, `ai_import_jobs`, `outbox_messages`, `ai_rate_limits` và `audit_events`. Định nghĩa EF không chứng minh bảng đã tồn tại trong Northflank hay có dữ liệu.

Hiện không có script export/import Supabase→PostgreSQL, object storage transfer, mapping Auth UID/account state, deterministic reconciliation report hoặc rehearsal. Không có row counts, checksums, source snapshot ID hay backup/restore evidence. Vì vậy target database chưa thể nhận traffic hoặc được xem là bản sao authoritative.
