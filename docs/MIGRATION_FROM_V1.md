# QIZZONE V3 — T00 BASELINE, PARITY MATRIX & INFRASTRUCTURE ADAPTER PLAN

> **Tài liệu:** `docs/MIGRATION_FROM_V1.md` (Deliverable T00)
> **Ngày lập:** 2026-11-21
> **Workspace sạch:** `D:\Qizzone_ANTI`
> **Remote:** `https://github.com/BaoAnh109/Qizzone`
> **Nhánh triển khai:** `fix/devolopV3`

---

## 1. Thông tin Baseline & Khóa Production

### 1.1. Baseline SHA đã xác minh
| Nhánh | SHA Baseline | Vai trò trong Qizzone V3 | Quy tắc áp dụng |
|---|---|---|---|
| `origin/main` (`main`) | `42830769097c85638cc2f2e8413df4e37e215aa4` | **Source of Truth duy nhất** cho toàn bộ UI/UX, Design System, Routes, Role/Auth flows, Quản lý đề, Phòng thi, Luyện tập, Autosave, Chấm điểm, Kết quả, Báo cáo & Admin | Không sửa, không force-push, không merge ngược vào `main`, không deploy từ `main`. |
| `origin/devolop/AIV3` (`devolop/AIV3`) | `3c5199581f72046e2595d865be18cc9567785657` | **Source of Truth chỉ cho module Extraction** (Document IR 2.0, OpenXML AST parser, PDF.js parser/visual media/red-text, OCR browser, Rule extractor, Answer evidence, Grounded structural AI fallback & extraction tests) | **Cấm** merge hoặc cherry-pick nguyên nhánh; chỉ port từng file thuộc phạm vi extraction sang `fix/devolopV3`. |
| `origin/fix/devolopV3` (`fix/devolopV3`) | `42830769097c85638cc2f2e8413df4e37e215aa4` | **Nhánh triển khai V3** (tạo từ `main`) | Mọi mã V3 chỉ phát triển tại đây; **chưa commit/push/merge** khi chưa có phê duyệt của chủ repo sau từng mốc. |

### 1.2. Khóa Production & Bảo mật Secrets
- Tuyệt đối không sử dụng Firebase production project, Supabase production project, hoặc Vercel production domain trong quá trình phát triển và kiểm thử V3.
- Mọi kiểm thử đều thực hiện ở môi trường local hoặc project **staging** tách biệt hoàn toàn.
- Tuyệt đối không đưa secret (`GEMINI_API_KEY`, Cloudflare R2 access/secret keys, Resend API key / SMTP password, `SUPABASE_SERVICE_ROLE_KEY`) vào frontend, log, git bundle, hoặc tài liệu Markdown. Browser chỉ sử dụng `VITE_SUPABASE_URL` và `VITE_SUPABASE_PUBLISHABLE_KEY` (và cấu hình public nếu có).
- Kiến trúc V3 loại bỏ hoàn toàn **Firebase**, **Northflank**, **ASP.NET Core (`backend/`)** và **Python extraction service (`services/extraction/`)**.

---

## 2. Inventory Toàn bộ Màn hình, Hành vi, Backend & Kiểm thử trên `main`

### 2.1. Layouts, Routes & Màn hình (`qizzone/src/`)
- **Layouts (`qizzone/src/layouts/`):** `AuthLayout.tsx`, `DashboardLayout.tsx`, `ExamLayout.tsx` (hỗ trợ `mode="practice"`).
- **Route Guards & Navigation (`qizzone/src/routes/`):** `AppRoutes.tsx`, `GuestRoute.tsx`, `ProtectedRoute.tsx`, `navigation.ts` (`getRoleHomeRoute`, `getPostLoginRedirect`, `preloadDashboardForRole`).
- **Màn hình Public / Auth (`qizzone/src/pages/auth/`):**
  - `/login` → `Login.tsx` (Email/Password, Google Sign-In, Quên mật khẩu, toggle hiện/ẩn mật khẩu, pre-warm dashboard chunks)
  - `/register` → `Register.tsx` (Đăng ký mới mặc định bắt đầu ở vai trò `student`, thanh đo độ mạnh mật khẩu)
  - `/unauthorized` → `Unauthorized.tsx`
  - `*` → `NotFound.tsx`
- **Màn hình Teacher (`qizzone/src/pages/teacher/` — `ProtectedRoute allowedRoles={["teacher", "admin"]}`):**
  - `/teacher` → `TeacherDashboard.tsx`
  - `/teacher/create-quiz` & `/teacher/edit-quiz/:quizId` → `CreateQuiz.tsx` (Wizard 3 bước + `QuizCreationEntry.tsx`)
  - `/teacher/quizzes` → `QuizList.tsx`
  - `/teacher/quiz/:quizId/review` → `QuestionReview.tsx`
  - `/teacher/quiz/:quizId/results` → `QuizResultsView.tsx`
  - `/teacher/extract-quiz` → `SplitExamEditor.tsx` (dùng `FileDropzone.tsx`, `DocumentViewer.tsx`, `ResizableSplitter.tsx`, `BatchActionBar.tsx`, `ExtractedQuestionCard.tsx`, `QuickAnswerKeyModal.tsx`)
- **Màn hình Admin (`qizzone/src/pages/admin/` — `ProtectedRoute allowedRole="admin"`):**
  - `/admin/teacher-approvals` → `TeacherApprovals.tsx` (duyệt/từ chối/khóa yêu cầu nâng cấp giáo viên)
  - `/admin/accounts` → `AccountManagement.tsx` (quản lý tài khoản teacher/student, khóa/mở khóa)
- **Màn hình Student & Phòng thi (`qizzone/src/pages/student/`):**
  - Public/Alias join: `/join`, `/join/:code` → `JoinByLink.tsx`; `/quiz/:quizId`, `/exam/:quizId` → `QuizRedirect` (chuyển tới `/student/quiz/:quizId/lobby`)
  - Student only (`allowedRole="student"`):
    - `/student` → `StudentDashboard.tsx`
    - `/student/practice` → `PracticeHistory.tsx`
    - `/student/practice/:quizId` → `PracticeSetup.tsx`
    - `/student/practice/:sessionId/room` → `PracticeRoom.tsx` (`ExamLayout mode="practice"`)
    - `/student/practice/:sessionId/result` → `PracticeResult.tsx`
  - Exam Lobby & Room (`allowedRoles={["student", "teacher", "admin"]}`):
    - `/student/quiz/:quizId/lobby` → `ExamEntry.tsx`
    - `/student/quiz/:quizId` → `QuizRoom.tsx` (`ExamLayout`)
    - `/student/result/:resultId` → `Result.tsx`
- **Common Components (`qizzone/src/components/common/` & `student/` & `ui/`):**
  - `AccountSettingsModal.tsx` (cập nhật tên, upload avatar ≤ 2 MB, gửi email đặt lại mật khẩu)
  - `LegacyMigrationAssistant.tsx` (chỉ migrate dữ liệu `localStorage` cũ sang DB theo tài khoản khớp email)
  - `MathRenderer.tsx`, `MathEditorPreview.tsx`, `Navbar.tsx`, `Sidebar.tsx`, `ThemeToggle.tsx`, `RouteLoadingFallback.tsx`
  - Student: `QuestionFrame.tsx`, `SubmitConfirmModal.tsx`
  - UI Design System (`design-system/` + `qizzone/src/components/ui/`): `Badge`, `Button`, `Card`, `Input`, `Modal`, `Textarea`, `Toast`

### 2.2. Stores, Services, Hooks & Utils (`main`)
- **Stores (`qizzone/src/store/`):** `authStore.ts`, `quizStore.ts`, `examSessionStore.ts`, `extractionStore.ts`, `practiceStore.ts`, `themeStore.ts`
- **Services (`qizzone/src/services/`):** `firebaseAuthService.ts`, `accountSettingsService.ts`, `adminService.ts`, `aiExtractionService.ts`, `examSessionService.ts`, `legacyMigrationService.ts`, `practiceService.ts`, `quizService.ts`
- **Client Config & Validations:** `lib/cloud.ts`, `lib/utils.ts`, `lib/validations/auth.ts`, `lib/validations/quiz.ts`, `config/aiConfig.ts`
- **Hooks:** `useExamTimer.ts`, `useQuestionKeyboardShortcuts.ts`, `useToast.ts`
- **Utils:** `exportHelper.ts`, `extractedQuestionMapper.ts`, `fileImportValidation.ts`, `gradingEngine.ts`, `practice.ts`, `questionAnalytics.ts`, `parsers/{docxAstParser,docxParser,pdfCleaner,pdfParser,ruleExtractor}.ts`

### 2.3. Database RPCs, Migrations & Edge Functions hiện có trên `main`
- **Migrations (`supabase/migrations/`):**
  1. `202609050001_cloud.sql` — Schema cốt lõi (`profiles`, `quizzes`, `questions`, `question_answer_keys`, `exam_attempts`, `exam_answers`, `exam_results`, `data_migrations`, `private.ai_limits`), RLS, RPCs
  2. `202609090001_teacher_approval.sql` — `approval_status`, `has_role()`
  3. `202609160001_student_teacher_switch.sql` — `teacher_request_status`, `teacher_request_blocked`, chuyển vai trò `student` ↔ `teacher`
  4. `202609250001_quiz_assignments.sql` — `set_quiz_assignments`
  5. `202610260000_redact_assigned_emails.sql` — Ẩn email học sinh khác trong `list_quizzes()`
  6. `202610260001_practice.sql` — `practice_sessions`, `practice_answers`, `start_practice`, `get_practice_session`, `check_practice_answer`, `finish_practice`, `list_practice_history`
  7. `202610260002_practice_retry.sql` & `20261026164438_practice_retry_checked_only.sql` — `start_practice_retry` (chỉ luyện lại câu sai đã kiểm tra)
  8. `20261029130000_account_avatar_storage.sql` — bucket `account-avatars`
- **PostgreSQL RPCs trên `main`:**
  - `update_my_profile`, `list_quizzes`, `save_quiz`, `set_quiz_assignments`, `set_quiz_status`, `delete_quiz`, `import_legacy_attempt`, `mark_data_migration`, `list_sessions`, `list_results`, `start_attempt`, `save_attempt`, `submit_attempt`, `finalize_expired`, `start_practice`, `start_practice_retry`, `get_practice_session`, `check_practice_answer`, `finish_practice`, `list_practice_history`, `consume_ai_quota`
- **Edge Functions (`supabase/functions/`):**
  - `_shared/server.ts`, `bootstrap-profile`, `extract-quiz-with-gemini`, `manage-teacher-approvals`, `request-teacher-role`, `switch-account-role`, `upload-account-avatar`

### 2.4. Inventory Kiểm thử hiện có
- **Trên `main` (26 file test Vitest):**
  - Routes: `routingAndJoinRoom.test.ts`
  - Services: `adminService.test.ts`, `examSessionService.test.ts`, `firebaseAuthService.test.ts`, `legacyMigrationService.test.ts`, `practiceService.test.ts`
  - Stores: `authStore.test.ts`, `examSessionStore.test.ts`, `practiceStore.test.ts`, `quizStore.test.ts`
  - Utils & Integration Security (PGlite): `aiExtractionService.test.ts`, `databaseSecurity.integration.test.ts`, `docxAstParser.test.ts`, `examSession.test.ts`, `exportHelper.test.ts`, `extractedQuestionMapper.test.ts`, `extractionStore.test.ts`, `fileImportValidation.test.ts`, `gradingEngine.test.ts`, `pdfParser.test.ts`, `practice.test.ts`, `practiceSecurity.integration.test.ts`, `questionAnalytics.test.ts`, `quizValidation.test.ts`, `ruleExtractor.test.ts`, `securityArtifacts.test.ts`
- **Bổ sung trên `devolop/AIV3` thuộc phạm vi Extraction (9 file test mới + cập nhật):**
  - Mới: `aiv3ExtractionSafety.test.ts`, `aiExtractionGrounding.test.ts`, `parserFirstAnswerKey.test.ts`, `pdfRedTextAnswer.test.ts`, `pdfVisualMedia.test.ts`, `sourceReference.test.ts`, `realDocumentBenchmark.test.ts`, `questionMedia.test.ts` (và `examAutosavePersistence.test.ts` — **lưu ý:** `examAutosavePersistence` thuộc mảng thi/autosave nên đối chiếu theo chuẩn `main`, không tự ý lấy từ AIV3 nếu làm đổi nghiệp vụ `main`).
  - Cập nhật trong phạm vi extraction: `aiExtractionService.test.ts`, `docxAstParser.test.ts`, `extractedQuestionMapper.test.ts`, `extractionStore.test.ts`, `fileImportValidation.test.ts`, `ruleExtractor.test.ts`.

---

## 3. Bảng 1 — Source-of-Truth & Parity Matrix cho UI và Nghiệp vụ (`main`)

| Mảng tính năng | Source of Truth | Trạng thái trên `main` | Hướng triển khai V3 trên `fix/devolopV3` | Trạng thái T00 |
|---|---|---|---|---|
| **UI & Design System toàn hệ thống** | `main` (`design-system/`, `index.css`, `components/ui/`, `layouts/`, `pages/`) | React 19 + TS + Vite 8 + Tailwind v4; đầy đủ giao diện Auth, Student, Teacher, Admin | **Giữ nguyên 100%** component, bố cục, màu sắc, điều hướng, responsive và trạng thái UI. Không dùng bất kỳ chỉnh sửa UI thuần túy nào từ `devolop/AIV3`. Chụp baseline snapshot trước khi đổi adapter. | READY (T01) |
| **Auth, OTP, Google & Phân quyền** | `main` (`authStore`, `firebaseAuthService`, `AccountSettingsModal`, `ProtectedRoute`, `GuestRoute`) | Đang dùng Firebase Auth + custom claims + Edge Functions verify Firebase ID token | Thay Firebase Auth bằng **Supabase Auth** (Email/Password, Email OTP qua Resend SMTP, Google OAuth, Reset Password). Giữ nguyên quy trình tài khoản mới bắt đầu từ `student` → gửi yêu cầu nâng cấp giáo viên → admin duyệt/từ chối/khóa → switch role `student` ↔ `teacher`. Phân quyền dựa trên bảng `profiles`/`user_roles` & `app_metadata` + RLS, ghi `role_audit_logs`. | READY (T01–T03) |
| **Tạo đề thủ công & Quản lý đề** | `main` (`CreateQuiz`, `QuizCreationEntry`, `QuizList`, `QuestionReview`, `quizStore`, `quizService`) | Wizard 3 bước, lưu draft/published/closed, giao đề theo lớp/email (`set_quiz_assignments`), ẩn email học sinh khác | Giữ toàn bộ validation, trạng thái và luồng màn hình `main`. Mở rộng nhẹ adapter dữ liệu để hỗ trợ câu 2–5 phương án (A–E), ảnh đính kèm câu hỏi/đáp án từ extraction, và cờ bắt buộc giáo viên tích xác nhận đối chiếu nguồn (`requiresSourceReview`) trước khi xuất bản đề trích xuất (theo T05.7). | READY (T05–T06) |
| **Phòng thi, Autosave & Chấm điểm** | `main` (`ExamEntry`, `JoinByLink`, `QuizRoom`, `SubmitConfirmModal`, `examSessionStore`, `examSessionService`) | `start_attempt`, `save_attempt` (optimistic locking `revision`), `submit_attempt` (idempotent), `finalize_expired`, server-side grading | Giữ nguyên hành vi, giao diện, phím tắt (`useQuestionKeyboardShortcuts`), đồng hồ (`useExamTimer`) và cơ chế chống lộ `question_answer_keys`. Port toàn bộ RPC sang schema V3 dùng `auth.uid()` UUID. | READY (T02, T06) |
| **Luyện tập độc lập** | `main` (`PracticeSetup`, `PracticeRoom`, `PracticeResult`, `PracticeHistory`, `practiceStore`, `practiceService`) | Tách biệt điểm thi; kiểm tra từng câu (`check_practice_answer`), xem giải thích theo cấu hình, `start_practice_retry` (`wrong` \| `all`) | Giữ nguyên 100% logic & UI `main`; port RPC và RLS sang schema V3 dùng `auth.uid()`. | READY (T02, T06) |
| **Kết quả, Thống kê & Xuất CSV** | `main` (`Result`, `QuizResultsView`, `exportHelper`, `questionAnalytics`) | Xem chi tiết khi `allow_review` hoặc là giáo viên sở hữu đề; phân tích câu hỏi; xuất CSV | Giữ nguyên format và UI `main`; bổ sung hình ảnh câu hỏi nếu có trong kết quả mà không phá bố cục. | READY (T06) |
| **Admin duyệt GV & Quản lý tài khoản** | `main` (`TeacherApprovals`, `AccountManagement`, `adminService`) | Duyệt/từ chối/chặn yêu cầu giáo viên; khóa/mở tài khoản | Giữ UI `main`; bỏ hoàn toàn nhánh fallback gọi thẳng update `profiles` thiếu an toàn nếu có và chuẩn hóa qua Edge Function/RPC có kiểm tra quyền `admin` server-side + ghi `role_audit_logs`. | READY (T03, T06) |
| **Email & Notification Outbox** | Kiến trúc V3 (§3.4, T07) | `main` dùng email mặc định của Firebase Auth, chưa có transactional notification | Thêm **Resend SMTP** cho Supabase Auth OTP/reset/confirmation; thêm `notification_preferences`, `notification_outbox`, `notification_delivery_logs`, Edge `dispatch-email` + Supabase Cron (múi giờ `Asia/Ho_Chi_Minh`) chạy ngầm không phá UI hiện có. | READY (T07) |
| **Legacy LocalStorage Migration** | `main` (`LegacyMigrationAssistant`, `legacyMigrationService`) | Cho phép user tự chuyển dữ liệu localStorage v1 lên Supabase theo khớp email | Giữ adapter migration hoặc đánh dấu hoàn tất tương thích với UUID `auth.uid()` nếu còn người dùng cũ. | READY (T06) |

---

## 4. Bảng 2 — Source-of-Truth & Parity Matrix cho Module Extraction (`devolop/AIV3`)

| Thành phần Extraction | Source of Truth | Mô tả kỹ thuật cần bảo toàn từ `devolop/AIV3` | Điều chỉnh / Adapter bắt buộc cho V3 | Trạng thái T00 |
|---|---|---|---|---|
| **Document IR 2.0 & Provenance** | `devolop/AIV3` (`documentIR.ts`, `extractor.ts`) | `schemaVersion: "2.0"`, `sourceHash`, `parserVersion`, `readingOrder`, `sourceRef`, `bbox` (PDF/ảnh), `flowBlocks` (DOCX chưa có tọa độ trang), `answerStatus` (`unknown\|evidence_supported\|ambiguous\|manually_confirmed`), `answerEvidence`, `reviewStatus` (`pending\|approved\|rejected`), `coverage`, `qualityFlags` | Port nguyên vẹn kiểu dữ liệu & hợp đồng IR; ánh xạ sạch vào `packages/document-parser` / `packages/domain` (hoặc tương đương) và schema DB V3. | READY (T05.1) |
| **DOCX OpenXML AST Parser** | `devolop/AIV3` (`docxAstParser.ts`, `docxParser.ts`) | Validate ZIP/archive chống zip-bomb & path traversal (`validateDocxArchive`), đọc trực tiếp OpenXML giữ thứ tự paragraph/table/list, chuyển đổi công thức OMML sang LaTeX (`convertOmmlToLatex`), giữ style bold/underline/highlight/màu, tách ảnh nhúng | Port nguyên logic parse client-side; giữ DOMPurify khi hiển thị `rawHtml`. | READY (T05.2) |
| **PDF.js Native Parser & Visual Media** | `devolop/AIV3` (`pdfParser.ts`, `pdfCleaner.ts`) | Trích xuất text theo tọa độ trang, nhận diện highlight annotation, vector highlight marks (`getPdfPagePaintMarks`), chữ tô màu đỏ, crop ảnh/đồ thị theo câu hỏi (`attachPdfVisualMediaToQuestions`), giữ `bbox` | Port nguyên logic client-side; tránh đưa CPU-heavy PDF rasterize vào Supabase Edge Functions. | READY (T05.2) |
| **Browser OCR (`vie+eng`)** | `devolop/AIV3` (`ocrService.ts`) | Dùng `tesseract.js` (`vie+eng`), giới hạn `MAX_OCR_PAGES_PER_IMPORT = 10` trang/lượt, cảnh báo confidence thấp (`ocr_low_confidence`), đánh dấu trang vượt giới hạn chưa OCR | Port nguyên baseline 10 trang/lượt; bổ sung cơ chế offload sang **Cloudflare R2 + Gemini Files API** cho tệp scan dài thông qua `ai_extraction_jobs` khi giáo viên chọn xử lý server. | READY (T05.3) |
| **Deterministic Rule Extractor & Evidence** | `devolop/AIV3` (`ruleExtractor.ts`, `extractionLimits.ts`, `sourceReference.ts`) | Hỗ trợ 2–5 lựa chọn (A–E), `①–④`, cặp Đúng/Sai; trích xuất đáp án từ ký hiệu, bold, underline, highlight, chữ đỏ, đáp án cuối câu, bảng đáp án cuối file; xung đột → `ambiguous`; thiếu chứng cứ → `correctAnswers=[]`; giới hạn `MAX_EXTRACTED_QUESTIONS = 1000` | Port nguyên thuật toán và các invariants: **cấm mặc định đáp án A**, **cấm tự sinh option/đáp án**. | READY (T05.2, T05.4) |
| **Grounded Structural AI Fallback** | `devolop/AIV3` (`aiExtractionService.ts`, `aiConfig.ts`) | Điều kiện kích hoạt `shouldUseAIExtractionFallback`; validator `isGroundedText` / `isGroundedOption` kiểm chứng nguyên văn nguồn; `mergeExtractionResults` giữ chứng cứ từ parser và luôn đặt `reviewStatus: "pending"`, `correctAnswers` không lấy từ AI; tách riêng `solveMissingAnswersWithAI` thành luồng gợi ý độc lập | **Thay đổi adapter hạ tầng:** bỏ tham chiếu `qizzoneApi` (.NET) và Firebase token; chuyển sang gọi Supabase Edge `extract-quiz` / `ai-job-status` với Supabase Auth JWT, dùng **R2 presigned PUT + Gemini Files API** cho file lớn (không gửi Base64 > 8 MiB qua Edge body). | READY (T05.5, T05.6) |
| **Media Persistence (`questionMedia.ts`)** | `devolop/AIV3` (`utils/parsers/questionMedia.ts`, `lib/questionMedia.ts`, `ImageAttachments.tsx`, `QuestionContent.tsx`) | Crop hình OCR/PDF/DOCX, nén JPEG ≤ 900 KB/ảnh, tối đa 80 ảnh & 15 MB/đề | Thay đổi bucket/adapter upload sang V3 storage adapter (R2 private bucket hoặc bucket có kiểm soát quyền đọc/signed URL ngắn hạn) thay vì gọi trực tiếp cấu trúc cũ; đảm bảo không rò rỉ file đề thi công khai vô thời hạn. | READY (T04, T05.6) |
| **Màn hình Review Kết quả Extraction** | **UI gốc từ `main`** (`SplitExamEditor`, `FileDropzone`, `DocumentViewer`, `ExtractedQuestionCard`, `BatchActionBar`, `QuickAnswerKeyModal`, `CreateQuiz`) | `devolop/AIV3` đã sửa nhiều chi tiết UI/UX trong các component này | **Không sao chép UI từ AIV3 thay thế UI `main`.** Chỉ giữ bố cục/component của `main` và đưa dữ liệu/cảnh báo/chứng cứ bắt buộc (`answerStatus`, `answerEvidence`, lọc `unanswered`, không mặc định `A`, checkbox xác nhận rà nguồn trước xuất bản, hiển thị `ImageAttachments`/`QuestionContent`) thông qua adapter tối thiểu. | READY (T05.7) |
| **Bộ Test Extraction & Benchmark** | `devolop/AIV3` (`qizzone/src/utils/__tests__/`) | 139 unit tests trên AIV3 + `realDocumentBenchmark.test.ts` (opt-in ngoài repo) | Port toàn bộ test extraction sang V3 và chạy lại đối chiếu parity thực tế trên cùng tập test/fixtures (không tự suy diễn pass từ báo cáo 17/11/2026 của AIV3). | READY (T05.8, T05.9) |

### 4.1. Phân loại toàn bộ file trong `git diff main..devolop/AIV3`

1. **Nhóm A — Port nguyên bản thuật toán/kiểu dữ liệu/test Extraction (từ `devolop/AIV3`):**
   - `qizzone/src/types/documentIR.ts`, `qizzone/src/types/extractor.ts`
   - `qizzone/src/config/extractionLimits.ts`, `qizzone/src/config/aiConfig.ts`
   - `qizzone/src/types/quiz.ts` (chỉ phần mở rộng `OPTION_IDS = ["A","B","C","D","E"]` và `images?: string[]`), `qizzone/src/lib/validations/quiz.ts` (max 5 options)
   - `qizzone/src/utils/fileImportValidation.ts` (`validateImportFileSignature`), `qizzone/src/utils/extractedQuestionMapper.ts` (bỏ fallback mặc định `["A"]`, giữ `correctAnswers: q.correctAnswers || []` và `images`)
   - `qizzone/src/utils/parsers/{docxAstParser,docxParser,pdfParser,pdfCleaner,ruleExtractor,ocrService,sourceReference,questionMedia}.ts` (bóc tách phần storage upload trong `questionMedia.ts` ra adapter)
   - `qizzone/src/lib/questionMedia.ts`, `qizzone/src/components/common/{ImageAttachments,QuestionContent}.tsx`
   - `qizzone/src/services/aiExtractionService.ts` (lấy toàn bộ grounding validator, merge logic, prompt; bỏ `qizzoneApi`, nối Edge V3)
   - Tests extraction: `aiv3ExtractionSafety.test.ts`, `aiExtractionGrounding.test.ts`, `parserFirstAnswerKey.test.ts`, `pdfRedTextAnswer.test.ts`, `pdfVisualMedia.test.ts`, `sourceReference.test.ts`, `realDocumentBenchmark.test.ts`, `questionMedia.test.ts`, `docxAstParser.test.ts`, `ruleExtractor.test.ts`, `extractedQuestionMapper.test.ts`, `extractionStore.test.ts`, `fileImportValidation.test.ts`, `aiExtractionService.test.ts`

2. **Nhóm B — Giữ UI `main`, chỉ bổ sung Adapter dữ liệu/cảnh báo từ `devolop/AIV3`:**
   - `qizzone/src/store/extractionStore.ts` (`answerStatus`, `answerEvidence`, `reviewStatus`, `A-E`, không mặc định `"A"`)
   - `qizzone/src/components/teacher/extraction/{FileDropzone,BatchActionBar,ExtractedQuestionCard,DocumentViewer,QuickAnswerKeyModal}.tsx`
   - `qizzone/src/pages/teacher/{SplitExamEditor,CreateQuiz,QuestionReview}.tsx` (giữ giao diện `main`, chỉ nối pipeline parse/review/ảnh & checkbox xác nhận rà nguồn trước xuất bản)
   - `qizzone/package.json` (thêm `tesseract.js` cho OCR browser và `fake-indexeddb` nếu cần test)

3. **Nhóm C — TUYỆT ĐỐI KHÔNG PORT (Loại bỏ khỏi phạm vi V3):**
   - Toàn bộ `backend/` (`.NET` / `ASP.NET Core` API, `Qizzone.Worker`, `Qizzone.MigrationTool`, `Dockerfile`, EF Core migrations)
   - Toàn bộ `services/extraction/` (`app.py` Python service)
   - Toàn bộ `docs/DEPLOY_NORTHFLANK_SANDBOX.md`, `docs/audit/*` (tài liệu audit của nhánh .NET/Northflank)
   - Các sửa đổi nghiệp vụ/UI ngoài extraction trên `devolop/AIV3`: `adminService.ts`, `examSessionService.ts`, `practiceService.ts`, `quizService.ts`, `firebaseAuthService.ts`, `legacyMigrationService.ts`, `authStore.ts`, `examSessionStore.ts`, `examAutosavePersistence.ts`, `practiceStore.ts`, `AccountSettingsModal.tsx`, `Register.tsx`, `QuizRoom.tsx`, `Result.tsx`, `PracticeRoom.tsx`, `PracticeResult.tsx`, `QuizResultsView.tsx`, `supabase/functions/extract-quiz-with-gemini/index.ts` (bản gắn Firebase Admin).

---

## 5. Thiết kế Lớp Adapter Hạ tầng V3 & Tổ chức Thư mục Sạch (`fix/devolopV3`)

### 5.1. Tổ chức thư mục đề xuất (§2 — Code sạch, rõ ranh giới)
Để tách bạch UI `main`, domain schemas, module extraction port từ `devolop/AIV3`, và backend Supabase/R2/Gemini/Resend trong `fix/devolopV3`:
```text
Qizzone/                         # D:\Qizzone_ANTI (branch fix/devolopV3)
├── apps/
│   └── web/                     # Di chuyển sạch từ qizzone/ (giữ nguyên toàn bộ UI/CSS/routes/pages của main)
│       ├── src/                 # Chứa app/, components/, features|pages/, hooks/, layouts/, lib/, services/, store/, styles/
│       └── e2e/                 # Playwright E2E tests (Desktop + Mobile, 3 roles)
├── packages/
│   ├── domain/                  # Shared TS types & Zod schemas (auth, quiz, exam, practice, notifications, errors)
│   └── document-parser/         # Extraction engine port từ devolop/AIV3 (Document IR 2.0, DOCX/PDF/OCR/Rules/Grounding)
├── supabase/
│   ├── migrations/              # Versioned SQL migrations V3 (auth.uid() UUID, RLS, private schema, outbox, AI jobs)
│   ├── functions/
│   │   ├── _shared/             # Auth JWT verify (Supabase Auth), Zod, CORS, logging che PII, R2 S3 sigv4
│   │   ├── bootstrap-profile/
│   │   ├── request-teacher-role/
│   │   ├── manage-teacher-approvals/
│   │   ├── switch-account-role/
│   │   ├── manage-user-accounts/
│   │   ├── upload-account-avatar/
│   │   ├── create-upload-url/   # Presigned PUT Cloudflare R2
│   │   ├── confirm-upload/      # HEAD R2 + cập nhật materials
│   │   ├── extract-quiz/        # Điều phối AI extraction job + Gemini Files API
│   │   ├── ai-job-status/       # Poll trạng thái job + ownership/RLS check
│   │   ├── finalize-exam/       # Chốt/nộp bài & đồng bộ kiểm tra deadline nếu cần
│   │   └── dispatch-email/      # Internal/Cron-only Resend transactional email worker
│   └── seed.sql                 # Dữ liệu giả lập cho local/staging
├── docs/                        # ARCHITECTURE_V3.md, DB_SCHEMA.md, API_CONTRACTS.md, RUNBOOK.md, MIGRATION_FROM_V1.md, ACCEPTANCE_REPORT.md
├── .github/workflows/           # lint, typecheck, unit/integration tests, build, security checks
├── package.json                 # npm workspaces (apps/web, packages/domain, packages/document-parser)
├── vercel.json                  # buildCommand & outputDirectory trỏ về apps/web/dist
└── README.md
```
> **Lưu ý về move/adapter (§2):** Khi tổ chức sang `apps/web` + `packages/*`, toàn bộ UI components/pages/styles của `main` được giữ nguyên 100% (chỉ move + đổi import path / service adapter), đảm bảo chứng minh được qua `git diff -M` và visual regression screenshot giữa `main` và `fix/devolopV3`.

### 5.2. Chi tiết 5 Adapter Hạ tầng cần thay thế trong `fix/devolopV3`
1. **Adapter 1 — Supabase Client & Auth (`apps/web/src/lib/cloud.ts`, `services/authService.ts` + compatibility facade nếu cần cho test/stores):**
   - Gỡ bỏ `firebase` khỏi dependencies; khởi tạo `@supabase/supabase-js` thuần (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
   - Hỗ trợ `signInWithPassword`, `signUp` + Email OTP (`signInWithOtp` / `verifyOtp`), `signInWithOAuth({ provider: 'google' })` + callback route, `resetPasswordForEmail`, `updateUser` (đổi mật khẩu/email), `signOut({ scope: 'global' })`.
   - `authStore` lắng nghe `supabase.auth.onAuthStateChange`; thay thông báo Firebase trong `AccountSettingsModal.tsx` bằng thông báo trung lập cho Supabase/Resend email.
   - Đổi danh nghĩa `edge(name, body)` gửi `Authorization: Bearer <supabase_session.access_token>` (không dùng Firebase ID token).
2. **Adapter 2 — Database Schema, Roles & RPC V3 (`supabase/migrations/`):**
   - Thay `firebase_uid text` thành `id uuid references auth.users(id)` (`auth.uid()`).
   - Bảng phân quyền server-managed (`user_roles` / `profiles` + `app_metadata` + `role_audit_logs`): tuyệt đối không đọc `user_metadata` do client sửa để quyết định quyền.
   - Bảo toàn 100% semantics của toàn bộ RPC `main` (`list_quizzes`, `save_quiz`, `set_quiz_assignments`, `start_attempt`, `save_attempt`, `submit_attempt`, `finalize_expired`, `start_practice`, `check_practice_answer`, `finish_practice`, `start_practice_retry`).
   - Bảng `private.answer_keys` (hoặc `question_answer_keys` thu hồi mọi quyền `SELECT` từ `anon`/`authenticated`) chỉ đọc bên trong `SECURITY DEFINER` RPCs sau khi xác minh quyền sở hữu giáo viên hoặc chấm điểm server-side.
   - Thêm các bảng V3: `materials`, `ai_extraction_jobs`, `ai_usage_daily`, `notification_preferences`, `notification_outbox`, `notification_delivery_logs`, `audit_logs`, `idempotency_keys`.
3. **Adapter 3 — Cloudflare R2 Direct Upload (`create-upload-url`, `confirm-upload`):**
   - Browser gọi `create-upload-url` → Edge kiểm tra JWT, role (`teacher`/`admin`), MIME/size, cấp presigned PUT URL (1–5 phút) với `objectKey` ngẫu nhiên scoped theo `userId`.
   - Browser `PUT` trực tiếp lên R2 private bucket (hỗ trợ progress/cancel/retry, không qua Edge 8 MiB body limit).
   - Browser gọi `confirm-upload` → Edge `HEAD` object xác nhận kích cỡ/MIME/hash thực tế → cập nhật `materials.status = 'ready'`.
   - Ảnh minh họa câu hỏi (`questionMedia`) sau khi trích xuất cũng lưu theo cơ chế kiểm soát truy cập/presigned hoặc path có kiểm duyệt thay vì URL công khai vĩnh viễn cho tài liệu nguồn.
4. **Adapter 4 — AI Extraction & Gemini Files API (`extract-quiz`, `ai-job-status`):**
   - DOCX/PDF có text chạy **parser-first ở browser** (không tốn Edge CPU/Gemini).
   - Với file scan/ảnh/phần parser chưa đạt: tạo `ai_extraction_jobs`, đọc tệp có kiểm soát từ R2 trong Edge hoặc chuyển vào **Gemini Files API** (ưu tiên hàng đầu theo §1 & §9, không nhồi Base64 lớn qua Edge JSON body), retry 429/5xx có backoff, tôn trọng giới hạn Free của Supabase Edge (CPU 2s/request, RAM 256 MB, wall-clock 150s) bằng job async và chunk/batch trang.
   - Kết quả từ Gemini bắt buộc đi qua grounded validator trong `packages/document-parser` trước khi đổ vào màn review `main`.
5. **Adapter 5 — Email & Notification Outbox (`dispatch-email` + Supabase Cron + Resend):**
   - Auth OTP / Confirm / Reset Password dùng **Resend SMTP** cấu hình trên Supabase Auth với domain đã xác minh SPF/DKIM/DMARC (bắt buộc theo chính sách Supabase Free từ 03/06/2026 để tùy chỉnh template OTP Qizzone).
   - Transactional emails (duyệt GV, giao bài, nhắc thi 24h/1h, kết quả) đẩy vào `notification_outbox` kèm `idempotency_key` & múi giờ `Asia/Ho_Chi_Minh`; Edge `dispatch-email` (chỉ nhận internal/cron/admin secret, không public) đọc outbox, kiểm tra `notification_preferences` & rate limit (100 email/ngày Free tier), gọi Resend REST API với exponential backoff.

---

## 6. Báo cáo Rủi ro (Risk Register) & Kế hoạch Rollback

| ID | Rủi ro | Mức độ | Biện pháp giảm thiểu | Kế hoạch Rollback |
|---|---|---|---|---|
| **R1** | Lệch UI/UX hoặc làm đổi nghiệp vụ `main` khi di chuyển sang cấu trúc thư mục mới hoặc khi lọc code từ `devolop/AIV3` | Cao | Chụp ảnh màn hình đối chiếu `main` (desktop/mobile) ở T01; không cherry-pick/merge toàn nhánh `devolop/AIV3`; chỉ port Nhóm A và adapter Nhóm B; duy trì 2 bảng parity độc lập. | Khôi phục từng file page/component nguyên trạng từ SHA `42830769097c85638cc2f2e8413df4e37e215aa4` (`main`). |
| **R2** | Vượt giới hạn Supabase Edge Free Tier (CPU active 2s/req, RAM 256 MB, wall-clock 150s) khi xử lý PDF lớn/AI | Cao | Parse DOCX/PDF/OCR nhẹ tại trình duyệt; file lớn tải thẳng R2 bằng presigned PUT; Edge chỉ làm điều phối nhẹ (`ai_extraction_jobs`), gọi Gemini Files API theo batch nhỏ, trả `jobId` ngay để client poll `ai-job-status`. | Tạm vô hiệu fallback server AI (`ai_extraction_jobs`) và giữ parser-first + browser OCR hoạt động độc lập. |
| **R3** | Hạn mức Free Tier (Gemini API rate limit, Resend 100 email/ngày, Supabase Free email template policy 2026-06-03) | Trung bình | Cấu hình Resend SMTP ngay trên project staging để dùng branded OTP; đặt rate limit theo user + mức trần ngày trong `ai_usage_daily` & `notification_outbox`; không gửi mail hàng loạt không kiểm soát. | Hạ tần suất/ngắt mail marketing/nhắc lịch tùy chọn trong `notification_preferences`, giữ nguyên mail bảo mật/OTP. |
| **R4** | Lộ `question_answer_keys`, IDOR khi đọc `ai_extraction_jobs` hoặc `materials` trên R2 | Cao | Bật RLS mặc định trên mọi bảng public; tách `private.answer_keys`; mọi presigned GET/PUT URL kiểm tra `owner_id` & `auth.uid()`, TTL 1–5 phút; viết automated negative tests với PGlite/staging. | Thu hồi quyền execute RPC/function hoặc rollback migration về phiên bản trước đó. |
| **R5** | Quyền lợi người dùng khi chuyển từ Firebase UID (`text`) sang Supabase UUID (`uuid`) | Trung bình | Triển khai trên Supabase staging sạch; lưu `legacy_firebase_uid` trong bảng ánh xạ riêng nếu sau này chủ repo duyệt chạy migrate dữ liệu thật từ V1. | Không chạm DB production V1; production vẫn hoạt động độc lập trên nhánh `main`. |
| **R6** | Sai khác chất lượng trích xuất giữa `devolop/AIV3` và bản port V3 (đặc biệt scan-only, câu qua trang, đáp án tô đỏ/highlight) | Cao | Port đầy đủ 14 test extraction của AIV3 + thêm fixture scan-only, nhiều cột, câu qua trang, 1.000 câu, file lỗi/prompt injection; chỉ kết luận parity dựa trên log chạy thực tế ở T05.9. | Giữ nguyên logic parser thuần từ `devolop/AIV3` ở commit `3c5199581f72046e2595d865be18cc9567785657` và tinh chỉnh adapter mapping. |
