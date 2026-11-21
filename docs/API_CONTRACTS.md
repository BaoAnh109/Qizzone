# QIZZONE V3 — API & RPC CONTRACTS (`API_CONTRACTS`)

> **Schema chuẩn hóa:** [`packages/domain/src/apiContracts.ts`](file:///d:/Qizzone_ANTI/packages/domain/src/apiContracts.ts)
> **Edge Functions:** [`supabase/functions/`](file:///d:/Qizzone_ANTI/supabase/functions)

---

## 1. Quy chuẩn Chung cho Edge Functions

- **Authentication:** Header `Authorization: Bearer <supabase_access_token>` (ngoại trừ `dispatch-email` cho phép `x-cron-secret` nội bộ).
- **Correlation ID & Logging:** Hỗ trợ header `x-correlation-id`; trả về `X-Correlation-Id` ở response; log cấu trúc JSON đã che email (`ab***@domain`), tuyệt đối không log JWT, secret key, signed URL hay nội dung đề.
- **HTTP Status & Error Format:**
  - `200 OK`: Thành công
  - `400 Bad Request` (`INVALID_INPUT`, `R2_SIZE_MISMATCH`)
  - `401 Unauthorized` (`UNAUTHORIZED`)
  - `403 Forbidden` (`FORBIDDEN`, `TEACHER_REQUEST_BLOCKED`, `TEACHER_ACCESS_NOT_APPROVED`)
  - `404 Not Found` (`NOT_FOUND`, `R2_UPLOAD_NOT_FOUND`)
  - `409 Conflict` (`TEACHER_REQUEST_PENDING`)
  - `413 Payload Too Large` (`TOO_LARGE`, `AVATAR_TOO_LARGE`)
  - `429 Too Many Requests` (`RATE_LIMIT`)
  - `502 / 503 / 504`: `UPSTREAM_ERROR`, `NOT_CONFIGURED`, `GEMINI_TIMEOUT`, `GEMINI_UNAVAILABLE`

---

## 2. Hợp đồng Endpoints V3 (§6)

### 2.1. `POST /functions/v1/create-upload-url`
- **Quyền:** `teacher`, `admin`
- **Request:**
  ```json
  {
    "fileName": "de-thi-toan.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 12582912,
    "sha256": "<optional 64-hex>"
  }
  ```
- **Giới hạn:** `sizeBytes <= 52,428,800` (50 MiB). Chỉ nhận PDF, DOCX, PNG, JPEG, WebP, TXT.
- **Response (200):**
  ```json
  {
    "materialId": "uuid",
    "objectKey": "materials/<uid>/<uuid>-de-thi-toan.pdf",
    "putUrl": "https://<account>.r2.cloudflarestorage.com/...",
    "expiresAt": "2026-11-21T10:05:00.000Z"
  }
  ```

### 2.2. `POST /functions/v1/confirm-upload`
- **Quyền:** `teacher`, `admin` (kiểm tra `owner_uid = auth.uid()`)
- **Request:** `{ "materialId": "uuid" }`
- **Hành vi:** Gọi `HEAD` lên private Cloudflare R2 xác minh tệp tồn tại và kích thước hợp lệ, cập nhật `materials.status = 'ready'`.
- **Response (200):** `{ "status": "ready", "sizeBytes": 12582912, "mimeType": "application/pdf" }`

### 2.3. `POST /functions/v1/extract-quiz` (và alias `extract-quiz-with-gemini`)
- **Quyền:** `teacher`, `admin` + kiểm tra quota `consume_ai_quota_v3` (phút + ngày)
- **Request:**
  ```json
  {
    "materialId": "uuid (optional)",
    "extractedText": "string (optional, <= 150000 chars)",
    "selectedPages": [1, 2, 3],
    "extractionMode": "structural_fallback | scan_ocr_vlm | solve_missing_answers",
    "prompt": "string (optional)",
    "imageBase64": "data:image/... (optional)"
  }
  ```
- **Hành vi:** Tạo dòng `ai_extraction_jobs`. Nếu có `materialId`, đọc stream từ R2 và upload sang Gemini Files API (sau khi chạy xong sẽ xóa file tạm trên Gemini). Chặn mọi `body.apiKey` từ client.
- **Response (200):** `{ "jobId": "uuid", "status": "completed", "result": { ... } }`

### 2.4. `GET /functions/v1/ai-job-status?id=<uuid>` (hoặc `POST { id }`)
- **Quyền:** Chủ sở hữu job hoặc `admin` (chống IDOR)
- **Response (200):**
  ```json
  {
    "id": "uuid",
    "status": "queued | processing | completed | failed",
    "progress": 100,
    "warnings": [],
    "resultDraftId": null,
    "resultDraft": { ... },
    "errorCode": null
  }
  ```

### 2.5. `POST /functions/v1/finalize-exam`
- **Quyền:** `student` sở hữu `attemptId`
- **Request:** `{ "attemptId": "uuid", "idempotencyKey": "string (>=8 chars)" }`
- **Hành vi:** Ủy quyền cho RPC `finalize_exam_attempt(p_attempt_id, p_idempotency_key)` trong PostgreSQL, kiểm tra deadline, khóa atomic và chống nộp trùng.
- **Response (200):** `{ "score": 8.5, "status": "submitted | already_submitted", "result": { ... } }`

### 2.6. `POST /functions/v1/dispatch-email` *(Internal / Admin / Cron Only)*
- **Quyền:** Yêu cầu header `x-cron-secret` khớp `CRON_SECRET` hoặc token của `admin`. Mọi user thường đều nhận `403 FORBIDDEN`.
- **Request:** `{ "limit": 20, "dryRun": false }`
- **Hành vi:** Quét `notification_outbox` đến hạn, claim atomic sang `processing`, kiểm tra hạn mức gửi ngày theo múi giờ `Asia/Ho_Chi_Minh` (`BREVO_DAILY_LIMIT = 300`), gửi qua Brevo Transactional Email API v3 (`POST https://api.brevo.com/v3/smtp/email`), cập nhật `provider_message_id`, exponential retry (tối đa 5 lần) hoặc `dead_letter`.
- **Response (200):** `{ "processed": 5, "sent": 5, "retried": 0, "deadLettered": 0, "dryRun": false }`

---

## 3. Endpoints Tài khoản & Quản trị (Port từ `main`)

- `POST /functions/v1/bootstrap-profile`: Tạo/đồng bộ `profiles`, `user_roles`, cấp `app_metadata.app_role = 'student'` mặc định.
- `POST /functions/v1/request-teacher-role`: Học sinh gửi yêu cầu nâng cấp giáo viên.
- `POST /functions/v1/manage-teacher-approvals`: Admin liệt kê, phê duyệt, từ chối, khóa/mở khóa yêu cầu; đẩy email thông báo vào `notification_outbox` và ghi `role_audit_logs`.
- `POST /functions/v1/switch-account-role`: Chuyển `student` ↔ `teacher` nếu yêu cầu giáo viên đã được duyệt.
- `POST /functions/v1/manage-user-accounts`: Admin liệt kê tài khoản và khóa/mở khóa (`approval_status` + `app_metadata`).
- `POST /functions/v1/upload-account-avatar`: Xác thực magic byte JPG/PNG/WebP (≤ 2 MB) và lưu vào bucket `account-avatars`.
