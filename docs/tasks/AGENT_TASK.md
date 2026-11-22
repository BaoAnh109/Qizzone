# Qizzone V3 — Agent Implementation Task

## Context
- **Repo:** `d:\Qizzone_ANTI`
- **Branch:** `feat/v3-role-workflows-classroom-azota` (HEAD `19e4659`)
- **Node PATH:** `E:\Programs\Microsoft Visual Studio\Community\MSBuild\Microsoft\VisualStudio\NodeJs`
- **Supabase project:** `iqojrgrljrttqjbhcogr`
- **Stack:** React 19 + Vite + TypeScript + Supabase + Zustand + TailwindCSS
- **UI primitives:** `@/components/ui` → `Button`, `Input`, `Textarea`, `Card/CardContent`, `Badge`, `Modal`
- **CSS tokens:** `theme-surface`, `theme-border`, `theme-text-primary`, `theme-text-secondary`, `theme-text-muted`, `theme-nav-active`, `theme-status-success`, `theme-status-info`, `theme-hover-surface`, `page-heading`, `page-description`, `theme-target-highlight`
- **Icons:** `lucide-react`
- **Auth:** `useAuthStore()` from `@/store/authStore`
- **Toast:** `useToast()` from `@/hooks/useToast`
- **Cloud:** `import { rpc, edge } from '@/lib/cloud'`
- **Domain types:** all from `@qizzone/domain`

## Rules
- NEVER push to `main`
- NEVER use `codex/...` branch names
- NO commit without passing typecheck + tests
- Scan staged diff for secrets before each commit
- Baseline: **205 tests passing** — must not regress
- Apply `ui-ux-pro-max` principles (min 44×44px touch targets, contrast-safe, responsive)

## PowerShell commands
```powershell
$env:PATH = "E:\Programs\Microsoft Visual Studio\Community\MSBuild\Microsoft\VisualStudio\NodeJs;$env:PATH"
Set-Location d:\Qizzone_ANTI
```

---

## TASK LIST

### TASK 1: Commit BugReportsAdmin.tsx (M3-A)
`BugReportsAdmin.tsx` is already written (387 lines, uncommitted).
1. Run typecheck: `npm run typecheck`
2. If pass, commit:
```powershell
git add apps/web/src/pages/admin/BugReportsAdmin.tsx
git diff --cached | Select-String -Pattern "^\+.*(xkeysib-|AIza|sbp_|sb_secret_|eyJhbGciOi)"
git -c user.name="BaoAnh109" -c user.email="anh011009@gmail.com" commit -m "feat(m3-a): admin bug reports triage page with filter/search/inline update"
```

---

### TASK 2: Refactor AccountManagement.tsx (M3-B)
File: `apps/web/src/pages/admin/AccountManagement.tsx` (currently 18619 bytes)

Replace/refactor with full implementation:
- **Teacher/Student tabs** → `getByRole('tab', {name:/Giáo viên/})` and `getByRole('tab', {name:/Học sinh/})`
- **Search input**: `placeholder="Tìm theo tên hoặc email..."`
- **Table**: `<table role="table">` with clickable rows
- **On row click**: open `<Modal>` (use existing Modal primitive: `isOpen`, `onClose`, `title`, `children`, `footer`, `size`)
  - Shows: email, role, createdAt, isBlocked status badge, approval status
  - Stats: classroomCount, quizCount, submissionCount (call `adminService.getAccountDetail(uid)`)
  - Lists: related classrooms, quizzes (from detail response)
  - Action buttons:
    - If teacher with pending request: `"Phê duyệt"` / `"Từ chối"` → `adminService.reviewTeacherAccount(uid, 'approve'/'reject')`
    - Lock/Unlock: `"Khóa"` / `"Mở khóa"` toggle → `adminService.toggleBlockUser(uid, bool)`
    - Status badge: `"Đang hoạt động"` / `"Đã bị khóa"`
    - Role change: `<select aria-label="Vai trò">` + save button `"Lưu vai trò"` → `adminService.changeUserRole(uid, role)`
- Load data: `adminService.listAccountSummaries()` split by role

After implementation:
1. Typecheck
2. If pass, commit M3-B with M3-A in one commit if not already committed separately

---

### TASK 3: Teacher Classes Page (M4-A)
File: `apps/web/src/pages/teacher/Classes.tsx` (currently 16 lines stub)

Replace stub with full implementation:
- Load `classroomService.listMyClassrooms()` on mount via `useEffect`
- Display as **grid of cards** (2 cols on tablet, 3 on desktop)
- Each card shows:
  - Classroom name (bold), subject badge, gradeLevel chip
  - memberCount + assignmentCount stat chips
  - inviteCode (small monospace with copy button)
  - "Vào lớp" button → navigate to `/teacher/classes/:classId`
  - "Lưu trữ" button → `classroomService.updateClassroom(id, {isArchived: true})` (confirm dialog)
- FAB or header button: `"Tạo lớp học"` → Modal with form:
  - `name` (required), `subject` (required), `gradeLevel` (optional), `description` (optional textarea)
  - Submit → `classroomService.createClassroom(data)` → show success toast → reload list
- Filter: toggle to show/hide archived classrooms
- Loading skeleton while fetching
- Empty state illustration when no classrooms

---

### TASK 4: Teacher ClassDetail Page (M4-B)
File: `apps/web/src/pages/teacher/ClassDetail.tsx` (currently 16 lines stub)

Replace stub with full implementation:
- Fetch `classroomService.getClassroomDetail(classId)` on mount
- **3 Tabs**: "Học sinh" | "Bài tập" | "Cài đặt"

**Học sinh tab (roster):**
- Table of members: avatar/initials, email, displayName, status badge, joinedVia, joinedAt
- "Thêm học sinh" button:
  - Input: email text field → `classroomService.addMembersBulk([{email}])`
  - Or: Excel upload button → `excelRosterImport` util from `@/utils/excelRosterImport` → `classroomService.addMembersBulk(emails)`
- Per row: "Xóa" icon button → `classroomService.removeMember(classroomId, memberId)` with confirm

**Bài tập tab (assignments):**
- List `ClassroomAssignment[]` with: quizTitle, assignedAt, dueAt, latePolicy badge, status chip
- Status: Đang mở / Đã đóng / Sắp diễn ra
- "Xem kết quả" link → `/teacher/quiz-results/:quizId?classId=...`

**Cài đặt tab:**
- Edit form: name, subject, gradeLevel, description → `classroomService.updateClassroom`
- Invite code display (monospace) + "Tạo mã mới" button → `classroomService.regenerateInviteCode(classroomId)`
- Archive / Restore toggle

E2E selectors to match (`m4-teacher-classroom-azota.spec.ts`): use `role`, `label`, `placeholder` attributes

---

### TASK 5: Student Classes Page (M5-B)
File: `apps/web/src/pages/student/Classes.tsx` (currently 16 lines stub)

Replace stub with full implementation:
- Load `classroomService.listMyClassrooms()` on mount
- Grid of joined classroom cards showing: name, subject, teacher name, memberCount, assignmentCount
- Status badge per classroom: has pending assignments / all done
- "Vào lớp" button → `/student/classes/:classId`
- **Join modal**: `"Tham gia lớp"` button → Modal with:
  - Text input for class code (placeholder `"Nhập mã lớp..."`)
  - Submit → `classroomService.joinByCode(code)` → success toast → reload
- Empty state when no classrooms

---

### TASK 6: Student ClassDetail Page (M5-C)
File: `apps/web/src/pages/student/ClassDetail.tsx` (currently 16 lines stub)

Replace stub with full implementation:
- Fetch `classroomService.getClassroomDetail(classId)` + `classroomService.listStudentAssignments(classroomId)`
- **Header**: classroom name, subject, teacher name, memberCount
- **Assignment list** with status badges:
  - `Cần làm` (green) → show "Làm bài" button → `/student/exam/:quizId` or `/student/quiz/:quizId/lobby`
  - `Đã hoàn thành` (blue) → show "Xem kết quả" button → `/student/result/:resultId`
  - `Quá hạn` (red) → show expired message
  - `Nộp muộn` (orange) → show "Xem kết quả" button
  - Due date countdown for active assignments
- Empty state when no assignments

---

### TASK 7: Student JoinClassByLink Page (M5-D)
File: `apps/web/src/pages/student/JoinClassByLink.tsx` (currently 543 bytes, partial)

Read the existing content first, then enhance if needed:
- Parse `:code` from URL params (or query param `?code=`)
- Auto-call `classroomService.joinByCode(code, 'link')` on mount (once)
- Loading spinner while joining
- Success state: show classroom name + "Đi đến lớp học" button → `/student/classes/:classId`
- Error state: show error message + "Quay lại" button → `/student/classes`
- Already joined: handle gracefully (re-route to class)

---

### TASK 8: Extend QuizList with Assign-to-Class (M4-C)
File: `apps/web/src/pages/teacher/QuizList.tsx` (27516 bytes)

Add to each quiz row/card:
- `"Giao cho lớp"` button → Modal with form:
  - Multi-select of teacher's classrooms (load `classroomService.listMyClassrooms()`)
  - `dueAt`: datetime picker (required)
  - `latePolicy`: select → `'no_late'` | `'allow_late'` | `'allow_late_penalty'`
  - `hardCloseAt`: optional datetime picker (shown when latePolicy allows late)
  - Submit → `classroomService.assignQuizToClassrooms({quizId, classroomIds, dueAt, latePolicy, hardCloseAt})`
  - Success: toast + close modal

---

### TASK 9: Add Azota Publish Settings to CreateQuiz Step 3 (M4-D)
File: `apps/web/src/pages/teacher/CreateQuiz.tsx` (56821 bytes)

Find the final step (Step 3 / review / publish step). Add Azota publish settings panel:
- **publishScope**: radio group → `'public'` (Mọi học sinh) | `'class_only'` (Chỉ lớp được giao)
- **opensAt**: datetime picker (nullable, label "Mở bài từ")
- **closesAt**: datetime picker (nullable, label "Đóng bài lúc")
- **maxAttempts**: number input (min 1, default 1, label "Số lần làm tối đa")
- **shuffleQuestions**: checkbox "Xáo trộn câu hỏi"
- **shuffleOptions**: checkbox "Xáo trộn đáp án"
- **scoreVisibility**: select → `'immediate'` | `'after_close'` | `'never'` (label "Hiển thị điểm")
- **answerVisibility**: select → `'immediate'` | `'after_close'` | `'never'` (label "Hiển thị đáp án")

Wire to `quizService.updatePublishSettings(quizId, settings)` on quiz save/publish.

---

### TASK 10: Typecheck + Test + Build (M6)
```powershell
$env:PATH = "E:\Programs\Microsoft Visual Studio\Community\MSBuild\Microsoft\VisualStudio\NodeJs;$env:PATH"
Set-Location d:\Qizzone_ANTI
npm run typecheck
npm --workspace=@qizzone/web run test
npm --workspace=@qizzone/web run build
```
Fix any failures. Baseline: 205 tests passing. Must not regress.

---

### TASK 11: Final Commit (M3-M5)
After all tasks pass:
```powershell
git add -A
git diff --cached | Select-String -Pattern "^\+.*(xkeysib-|AIza|sbp_|sb_secret_|eyJhbGciOi)"
git -c user.name="BaoAnh109" -c user.email="anh011009@gmail.com" commit -m "feat(m3-m5): admin account detail/triage, teacher classrooms/azota, student classrooms/assignments"
```

---

### TASK 12: Push to Feature Branch
```powershell
git push origin feat/v3-role-workflows-classroom-azota
```

---

## Key Service APIs (reference)

### classroomService.ts
```typescript
listMyClassrooms(): Promise<Classroom[]>
getClassroomDetail(classroomId: string): Promise<{classroom, members, assignments}>
createClassroom(data: CreateClassroomInput): Promise<Classroom>
updateClassroom(id: string, data: Partial<UpdateClassroomInput>): Promise<Classroom>
joinByCode(code: string, via?: 'code'|'link'): Promise<{classroom}>
addMembersBulk(classroomId: string, emails: string[]): Promise<{added, failed}>
removeMember(classroomId: string, memberId: string): Promise<void>
regenerateInviteCode(classroomId: string): Promise<{inviteCode}>
assignQuizToClassrooms(data: AssignQuizInput): Promise<void>
listStudentAssignments(classroomId: string): Promise<ClassroomAssignment[]>
listTeacherQuizTracking(quizId: string): Promise<QuizTrackingResult[]>
```

### adminService.ts
```typescript
listAccountSummaries(): Promise<AdminAccountSummary[]>
getAccountDetail(uid: string): Promise<AdminAccountDetail>
toggleBlockUser(uid: string, block: boolean): Promise<void>
changeUserRole(uid: string, role: string): Promise<void>
reviewTeacherAccount(uid: string, action: 'approve'|'reject'): Promise<void>
```

### quizService.ts
```typescript
updatePublishSettings(quizId: string, settings: PublishSettings): Promise<void>
```

## E2E Spec Contracts
- `tests/e2e/m3-admin-workflows.spec.ts` — Admin selectors
- `tests/e2e/m4-teacher-classroom-azota.spec.ts` — Teacher selectors
- `tests/e2e/m5-student-classroom-exam.spec.ts` — Student selectors

Read these files before implementing to match exact aria selectors.
