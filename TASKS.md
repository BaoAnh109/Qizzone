# DANH SÁCH TASK VÀ PHÂN CHIA BRANCH TRIỂN KHAI

Tài liệu này hệ thống toàn bộ 14 yêu cầu theo **6 luồng logic độc lập**, quy định nhánh Git tương ứng và chi tiết kỹ thuật từng task.

---

## Bảng Tổng hợp Luồng và Branch Git

| Luồng | Branch đề xuất | Các yêu cầu tương ứng | Mức độ |
|---|---|---|---|
| **Luồng 1** | `feat/exam-room-ux-and-layout` | **Yêu cầu 1**: Tràn viền màn hình 100% không chừa 2 bên<br>**Yêu cầu 3**: Fix nhãn A B C D cố định khi đảo câu<br>**Yêu cầu 6 (lưu cờ)**: Lưu cờ khi làm bài xong<br>**Yêu cầu 7 (phòng thi)**: Cuộn ma trận 40 câu + cắt nửa câu 41 | Lớn |
| **Luồng 2** | `feat/quiz-result-review-enhancements` | **Yêu cầu 2**: Tìm kiếm câu ở trang kết quả<br>**Yêu cầu 4**: Lọc câu đúng/sai/bỏ qua/có cờ<br>**Yêu cầu 5**: Làm lại toàn bộ hoặc chỉ làm lại câu sai<br>**Yêu cầu 6 (hiển thị cờ)**: Đánh cờ hiển thị ở trang kết quả<br>**Yêu cầu 7 (kết quả)**: Ma trận câu hỏi cuộn 40 câu ở trang kết quả<br>**Yêu cầu 8**: Tính điểm thang 10đ, làm tròn 2 chữ số thập phân | Lớn |
| **Luồng 3** | `feat/unified-quiz-creation-flow` | **Yêu cầu 9**: Màn hình tạo đề chia đôi 50/50 (Drop file & Các chức năng khác)<br>**Yêu cầu 10**: Sửa luồng up file (Xem đề -> Cấu hình -> Xuất bản / Lưu nháp) | Lớn |
| **Luồng 4** | `fix/teacher-quiz-authorization` | **Yêu cầu 11**: Phân quyền giáo viên chỉ xem và chỉnh sửa đề của chính mình | Trung bình |
| **Luồng 5** | `feat/student-direct-code-and-link-access` | **Yêu cầu 12**: Ẩn danh mục đề công khai của HS, chỉ thấy khi nhập mã<br>**Yêu cầu 13**: Tạo link làm bài trực tiếp không cần gõ mã | Lớn |
| **Luồng 6** | `feat/admin-account-management` | **Yêu cầu 14**: Admin quản lý tài khoản HS & GV, tìm kiếm, khóa/mở khóa, xem & sửa đề của GV | Lớn |

---

## Chi tiết Triển khai Từng Luồng

### Luồng 1: Giao diện phòng thi & Trải nghiệm làm bài
> **Branch**: `feat/exam-room-ux-and-layout`

- [x] **Task 1.1 (Yêu cầu 1)**: Màn hình 100% trên desktop, bỏ giới hạn `max-w-[1440px]` và `max-w-5xl`.
  - File: `src/layouts/DashboardLayout.tsx`, `src/layouts/ExamLayout.tsx`, `src/pages/student/QuizRoom.tsx`.
  - Chi tiết: Loại bỏ `max-w-* mx-auto`, để `w-full` tràn viền với padding `px-4 sm:px-6 lg:px-8`.
- [x] **Task 1.2 (Yêu cầu 3)**: Đảm bảo nhãn phương án luôn hiển thị A, B, C, D theo thứ tự.
  - File: `src/pages/student/QuizRoom.tsx`.
  - Chi tiết: Hiển thị badge phương án bằng `String.fromCharCode(65 + index)` thay cho `{opt.id}`, giữ nguyên `opt.id` gốc cho lưu đáp án.
- [x] **Task 1.3 (Yêu cầu 7 - Phòng thi)**: Ma trận câu hỏi cuộn tối đa 40 câu, hàng 9 cắt nửa (câu 41).
  - File: `src/pages/student/QuizRoom.tsx`.
  - Chi tiết: Bọc lưới câu hỏi trong container `max-h-[404px] overflow-y-auto pr-1` (tương ứng 8 hàng + 50% hàng 9).
- [x] **Task 1.4 (Yêu cầu 6 - Lưu cờ)**: Lưu danh sách cờ vào kết quả bài thi khi nộp.
  - File: `src/types/exam.ts`, `src/store/examSessionStore.ts`.
  - Chi tiết: Thêm `flaggedQuestionIds?: string[]` vào `ExamResult` và hợp nhất từ session khi `submitExam`.

---

### Luồng 2: Trang kết quả & Xem lại đáp án
> **Branch**: `feat/quiz-result-review-enhancements`

- [x] **Task 2.1 (Yêu cầu 2)**: Chức năng tìm kiếm câu hỏi ở trang kết quả.
  - File: `src/pages/student/Result.tsx`.
  - Chi tiết: Thêm ô tìm kiếm lọc nhanh theo nội dung câu, số câu hoặc lời giải.
- [x] **Task 2.2 (Yêu cầu 4)**: Bộ lọc câu đúng / câu sai / bỏ qua / đã cắm cờ.
  - File: `src/pages/student/Result.tsx`.
  - Chi tiết: Thêm tabs: `Tất cả`, `Đúng (x)`, `Sai (y)`, `Chưa làm (z)`, `Có cờ (k)`.
- [x] **Task 2.3 (Yêu cầu 5)**: Tùy chọn làm lại toàn bộ hoặc chỉ làm lại các câu sai.
  - File: `src/pages/student/Result.tsx`, `src/pages/student/ExamEntry.tsx`, `src/pages/student/QuizRoom.tsx`.
  - Chi tiết: Nút "Làm lại toàn bộ" và nút "Làm lại các câu sai" (lọc danh sách câu sai/bỏ qua từ kết quả cũ).
- [x] **Task 2.4 (Yêu cầu 6 - Hiển thị cờ)**: Hiển thị biểu tượng cờ trên câu hỏi và trên thanh điều hướng kết quả.
  - File: `src/pages/student/Result.tsx`.
- [x] **Task 2.5 (Yêu cầu 7 - Kết quả)**: Bổ sung thanh ma trận câu hỏi cuộn 40 câu bên cạnh danh sách đáp án.
  - File: `src/pages/student/Result.tsx`.
  - Chi tiết: Thiết kế bố cục 2 cột (Cột câu hỏi + Cột ma trận điều hướng), cuộn đến câu tương ứng khi click.
- [x] **Task 2.6 (Yêu cầu 8)**: Chuẩn hóa tính điểm thang 10đ, làm tròn 2 chữ số thập phân (`.toFixed(2)`).
  - File: `src/pages/student/Result.tsx`, `src/pages/student/ExamEntry.tsx`, `src/pages/teacher/QuizResultsView.tsx`.

---

### Luồng 3: Luồng tạo đề thi & Nhập file
> **Branch**: `feat/unified-quiz-creation-flow`

- [x] **Task 3.1 (Yêu cầu 9)**: Màn hình tạo đề chia đôi 50/50 trên màn hình lớn.
  - File: `src/components/teacher/QuizCreationEntry.tsx`, `src/pages/teacher/CreateQuiz.tsx`, `src/components/teacher/extraction/FileDropzone.tsx`.
  - Chi tiết: Nửa trái (50%) là Dropzone tải file (Word/PDF/Ảnh). Nửa phải (50%) gồm: Tạo thủ công và Dán TXT.
- [x] **Task 3.2 (Yêu cầu 10)**: Chuẩn hóa luồng: Tải file -> Xem đề -> Cấu hình -> Xuất bản / Lưu nháp.
  - File: `src/components/teacher/extraction/BatchActionBar.tsx`, `src/pages/teacher/CreateQuiz.tsx`, `src/utils/extractedQuestionMapper.ts`.
  - Chi tiết: Nút chuyển tiếp là "Cấu hình đề thi" đưa vào Bước 3. Thêm nút "Lưu bản nháp" (`status: draft`) bên cạnh "Xuất bản đề thi" (`status: published`).

---

### Luồng 4: Phân quyền Giáo viên
> **Branch**: `fix/teacher-quiz-authorization`

- [x] **Task 4.1 (Yêu cầu 11)**: Giáo viên chỉ xem được danh sách đề của chính mình.
  - File: `src/pages/teacher/QuizList.tsx`.
  - Chi tiết: Lọc `quizzes.filter(q => q.teacherId === user.id)` nếu `user.role === 'teacher'`.
- [x] **Task 4.2 (Yêu cầu 11)**: Chặn giáo viên truy cập chỉnh sửa đề của giáo viên khác.
  - File: `src/pages/teacher/CreateQuiz.tsx`, `src/store/quizStore.ts`.
  - Chi tiết: Kiểm tra `existingQuiz.teacherId === user.id || user.role === 'admin'`. Nếu không khớp, từ chối truy cập và chuyển hướng.

---

### Luồng 5: Cổng Học sinh & Truy cập bằng Mã/Link
> **Branch**: `feat/student-direct-code-and-link-access`

- [x] **Task 5.1 (Yêu cầu 12)**: Ẩn danh mục đề công khai trên Dashboard của học sinh.
  - File: `src/pages/student/StudentDashboard.tsx`.
  - Chi tiết: Gỡ bỏ danh sách tất cả đề published. Đưa ô nhập mã phòng làm trọng tâm. Chỉ hiển thị các đề học sinh đã tham gia / có lịch sử làm bài.
- [x] **Task 5.2 (Yêu cầu 13)**: Tạo link trực tiếp cho bài thi và hỗ trợ học sinh mở link làm bài ngay.
  - File: `src/pages/teacher/QuizList.tsx`, `src/routes/AppRoutes.tsx`, `src/pages/student/JoinByLink.tsx`, `src/services/quizService.ts`.
  - Chi tiết: Nút "Sao chép link làm bài" (`/join/:code`). Route `/join/:code` tự động tra mã và vào thẳng phòng thi/lobby.

---

### Luồng 6: Quản trị viên - Quản lý tài khoản
> **Branch**: `feat/admin-account-management`

- [x] **Task 6.1 (Yêu cầu 14)**: Xây dựng trang Quản lý tài khoản Admin.
  - File: `src/pages/admin/AccountManagement.tsx`, `src/components/common/Sidebar.tsx`, `src/routes/AppRoutes.tsx`.
  - Chi tiết: Tab "Quản lý Giáo viên" và Tab "Quản lý Học sinh", thanh tìm kiếm theo tên/email.
- [x] **Task 6.2 (Yêu cầu 14)**: Nút Khóa / Mở khóa tài khoản người dùng.
  - File: `src/pages/admin/AccountManagement.tsx`, `src/services/adminService.ts`.
- [x] **Task 6.3 (Yêu cầu 14)**: Xem danh sách đề thi của từng giáo viên và cho phép Admin chỉnh sửa đề.
  - File: `src/pages/admin/AccountManagement.tsx`.
  - Chi tiết: Mở modal/danh sách đề của GV được chọn, Admin có nút "Chỉnh sửa đề" (truy cập `/teacher/edit-quiz/:quizId` với toàn quyền).
