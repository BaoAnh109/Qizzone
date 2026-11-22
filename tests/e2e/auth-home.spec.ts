import { test, expect, type Page } from '@playwright/test';
import {
  cleanupE2eRun,
  createAdminClient,
  createExtraStudent,
  createLegacyPendingTeacher,
  provisionE2eRun,
  sweepStaleE2eAccounts,
  type E2eRunManifest,
} from './helpers/supabaseAdmin';
import {
  assertNoHorizontalOverflow,
  loginViaUi,
  logoutViaUi,
  toggleDarkMode,
} from './helpers/uiAuth';

async function clearBrowserAuth(page: Page): Promise<void> {
  await page.goto('/login');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

test.describe.serial('Baseline M1 Browser E2E Suite (Auth, Admin, Teacher Quiz, Student Exam/Practice, Responsive)', () => {
  let run: E2eRunManifest;

  test.beforeAll(async () => {
    await sweepStaleE2eAccounts(24).catch(() => undefined);
    run = await provisionE2eRun('ui');
  });

  test.afterAll(async () => {
    await cleanupE2eRun(run);
  });

  test('Auth: role login redirects, invalid login, register Zod validation, blocked user, ProtectedRoute, dual-role switch, AccountSettingsModal, logout', async ({
    page,
  }) => {
    // 1. Invalid login & malformed email
    await clearBrowserAuth(page);
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('123456');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel('Email').fill(run.accounts.student1.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('WrongPass!999');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/Email hoặc mật khẩu không đúng|Sai|không đúng/i).first()).toBeVisible();

    // 2. Register Zod validation (weak password & mismatched confirmPassword)
    await page.goto('/register');
    await page.getByLabel('Họ và tên').fill('Nguyễn E2E Test');
    await page.getByLabel('Email').fill('zod_check@e2e.qizzone.test');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('weak');
    await page.getByLabel('Xác nhận mật khẩu').fill('mismatch');
    await page.getByRole('button', { name: 'Hoàn tất đăng ký' }).click();
    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByText(/8 ký tự|Mật khẩu/).first()).toBeVisible();

    // 3. Unauthenticated ProtectedRoute redirect
    await page.goto('/teacher/quizzes');
    await expect(page).toHaveURL(/\/login\?redirect=/);

    // 4. Blocked user login rejection
    const blockedStu = await createExtraStudent(run, 'ui_blocked', { approvalStatus: 'rejected' });
    await page.goto('/login');
    await page.getByLabel('Email').fill(blockedStu.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(run.password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(/\/(login|unauthorized)/);
    await expect(page).not.toHaveURL(/\/student|\/teacher|\/admin/);

    // 5. Student login redirect + cross-role ProtectedRoute redirect + AccountSettingsModal name update + reload persistence
    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');
    await expect(page.getByRole('heading', { name: /Xin chào,/ })).toBeVisible();

    await page.goto('/teacher');
    await expect(page).toHaveURL(/\/student/);
    await page.goto('/admin/accounts');
    await expect(page).toHaveURL(/\/student/);

    // Update name via AccountSettingsModal & verify reload persistence
    const updatedName = `E2E Updated ${run.runId.slice(-4)}`;
    await page.getByRole('button', { name: 'Mở tài khoản' }).click();
    await page.getByRole('button', { name: 'Cài đặt tài khoản' }).click();
    await page.locator('#account-full-name').fill(updatedName);
    await page.getByRole('button', { name: 'Lưu thông tin' }).click();
    await expect(page.getByText('Thông tin tài khoản đã được cập nhật.').first()).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: new RegExp(`Xin chào,\\s*${updatedName}`) })).toBeVisible();
    await logoutViaUi(page);

    // 6. Teacher login redirect
    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');
    await expect(page.getByText('Bảng điều khiển').first()).toBeVisible();
    await logoutViaUi(page);

    // 7. Admin login redirect
    await loginViaUi(page, run.accounts.admin.email, run.password, '/admin/teacher-approvals');
    await expect(page.getByRole('link', { name: 'Quản lý tài khoản' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Duyệt giáo viên' })).toBeVisible();
    await logoutViaUi(page);

    // 8. Dual-role approved user switch (Chuyển sang tài khoản giáo viên <-> Chuyển sang tài khoản học sinh)
    const dualUser = await createExtraStudent(run, 'ui_dual', { teacherRequestStatus: 'approved' });
    await loginViaUi(page, dualUser.email, run.password, '/student');

    await page.getByRole('button', { name: 'Mở tài khoản' }).click();
    await page.getByRole('button', { name: 'Chuyển sang tài khoản giáo viên' }).click();
    await expect(page).toHaveURL(/\/teacher/, { timeout: 20_000 });

    await page.getByRole('button', { name: 'Mở tài khoản' }).click();
    await page.getByRole('button', { name: 'Chuyển sang tài khoản học sinh' }).click();
    await expect(page).toHaveURL(/\/student/, { timeout: 20_000 });
    await logoutViaUi(page);
  });

  test('Admin Approvals & Accounts baseline: list/refresh/block-toggle/reject/approve & lock/unlock', async ({
    page,
  }) => {
    const rejectCandidate = await createLegacyPendingTeacher(run, 'ui_reject');

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.admin.email, run.password, '/admin/teacher-approvals');

    // Refresh button works
    await page.getByRole('button', { name: 'Làm mới' }).click();
    await expect(page.getByText(run.accounts.pendingTeacher.email)).toBeVisible();
    await expect(page.getByText(rejectCandidate.email)).toBeVisible();

    // Locate pendingTeacher card & toggle block switch on/off
    const ptCard = page.locator('div.rounded-xl, [class*="card"]').filter({
      hasText: run.accounts.pendingTeacher.email,
    }).first();
    const blockSwitch = ptCard.getByRole('switch');
    await blockSwitch.click();
    await expect(blockSwitch).toHaveAttribute('aria-checked', 'true');
    await blockSwitch.click();
    await expect(blockSwitch).toHaveAttribute('aria-checked', 'false');

    // Cancel reject confirm dialog -> row stays; then accept reject on rejectCandidate -> row leaves
    const rejCard = page.locator('div.rounded-xl, [class*="card"]').filter({
      hasText: rejectCandidate.email,
    }).first();

    page.once('dialog', (dialog) => dialog.dismiss());
    await rejCard.getByRole('button', { name: 'Từ chối' }).click();
    await expect(page.getByText(rejectCandidate.email)).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await rejCard.getByRole('button', { name: 'Từ chối' }).click();
    await expect(page.getByText(rejectCandidate.email)).toHaveCount(0);

    // Approve pendingTeacher -> leaves queue
    await ptCard.getByRole('button', { name: 'Phê duyệt' }).click();
    await expect(page.getByText(run.accounts.pendingTeacher.email)).toHaveCount(0);

    // Verify empty-state text exists when queue is empty (only if no other requests exist in live DB)
    const remainingCards = await page.getByText('Chờ xét duyệt').count();
    if (remainingCards === 0) {
      await expect(page.getByText('Không có yêu cầu đang chờ')).toBeVisible();
    }

    // Account Management (/admin/accounts)
    await page.getByRole('link', { name: 'Quản lý tài khoản' }).click();
    await expect(page).toHaveURL(/\/admin\/accounts/);

    // Switch tabs Teacher <-> Student & search
    await page.getByRole('button', { name: /Học sinh/ }).click();
    const searchInput = page.getByPlaceholder('Tìm theo tên hoặc email...');
    await searchInput.fill('__no_such_e2e_user_xyz__');
    await expect(page.getByText('Không có tài khoản nào phù hợp với tìm kiếm.')).toBeVisible();

    await searchInput.fill(run.accounts.student2.email);
    const stuRow = page.locator('tr', { hasText: run.accounts.student2.email });
    await expect(stuRow).toBeVisible();

    // Cancel lock confirmation -> status stays Đang hoạt động
    page.once('dialog', (dialog) => dialog.dismiss());
    await stuRow.getByRole('button', { name: 'Khóa', exact: true }).click();
    await expect(stuRow.getByText('Đang hoạt động')).toBeVisible();

    // Accept lock -> Đã bị khóa -> then unlock -> Đang hoạt động
    try {
      page.once('dialog', (dialog) => dialog.accept());
      await stuRow.getByRole('button', { name: 'Khóa', exact: true }).click();
      await expect(stuRow.getByText('Đã bị khóa')).toBeVisible();
    } finally {
      if (await stuRow.getByRole('button', { name: 'Mở khóa', exact: true }).isVisible().catch(() => false)) {
        page.once('dialog', (dialog) => dialog.accept());
        await stuRow.getByRole('button', { name: 'Mở khóa', exact: true }).click();
        await expect(stuRow.getByText('Đang hoạt động')).toBeVisible();
      }
    }

    await logoutViaUi(page);
  });

  test('Teacher 3-step CreateQuiz, SplitExamEditor 5-option (A-E) quiz publish, Student Quick-Join Exam, Practice & Retry', async ({
    page,
  }) => {
    const manualTitle = `[E2E] Manual Quiz ${run.runId}`;
    const fiveOptTitle = `[E2E] 5-Option Quiz ${run.runId}`;

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');

    // 1. Teacher 3-step manual CreateQuiz (/teacher/create-quiz)
    await page.goto('/teacher/create-quiz');
    await page.getByRole('button', { name: 'Bắt đầu soạn đề thủ công' }).click();

    await page.getByPlaceholder(/Kiểm tra 1 tiết/).fill(manualTitle);
    // Step 2 preview
    await page.getByRole('button', { name: /2\. Xem trước đề thi/ }).click();
    await expect(page.getByText(manualTitle)).toBeVisible();
    // Step 3 settings & publish
    await page.getByRole('button', { name: /3\. Cấu hình phòng thi/ }).click();
    await page.getByRole('button', { name: 'Xuất bản bài thi ngay' }).click();
    await expect(page).toHaveURL(/\/teacher\/quizzes/, { timeout: 20_000 });
    await expect(page.getByText(manualTitle)).toBeVisible();

    // 2. Teacher SplitExamEditor (/teacher/extract-quiz) with 5-option (A-E) structured TXT -> review -> publish
    await page.goto('/teacher/extract-quiz');
    const examText = [
      'Câu 1: Giá trị của 10 + 5 là bao nhiêu?',
      'A. 12',
      'B. 13',
      'C. 14',
      'D. 15',
      'E. 16',
      'Đáp án: D',
      'Lời giải: 10 + 5 = 15.',
      '',
      'Câu 2: Phương án E là đáp án đúng trong câu hỏi 5 lựa chọn?',
      'A. Lựa chọn A',
      'B. Lựa chọn B',
      'C. Lựa chọn C',
      'D. Lựa chọn D',
      'E. Lựa chọn E chính xác',
      'Đáp án: E',
      'Lời giải: Chọn phương án E.',
    ].join('\n');

    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-5opt.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(examText, 'utf8'),
    });

    await expect(page.getByRole('button', { name: /Chuyển sang cấu hình đề \(2 câu\)/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Lựa chọn E chính xác').first()).toBeVisible();
    await page.getByRole('button', { name: /Chuyển sang cấu hình đề \(2 câu\)/ }).click();

    await expect(page).toHaveURL(/\/teacher\/create-quiz/);
    await page.getByLabel(/Tôi đã đối chiếu toàn bộ câu hỏi/).check();
    await page.getByRole('button', { name: 'Chuyển sang Cấu hình phòng thi' }).click();
    await page.getByPlaceholder(/Kiểm tra Giải tích 12/).fill(fiveOptTitle);
    await page.getByRole('button', { name: 'Xuất bản bài thi ngay' }).click();
    await expect(page).toHaveURL(/\/teacher\/quizzes/, { timeout: 20_000 });
    await expect(page.getByText(fiveOptTitle)).toBeVisible();

    // Fetch exact quiz codes & ids via Supabase admin for deterministic verification
    const adminClient = createAdminClient();
    const { data: createdQuizzes } = await adminClient
      .from('quizzes')
      .select('id, code, title')
      .eq('teacher_uid', run.accounts.teacher1.uid);

    const fiveOptQuiz = createdQuizzes?.find((q) => q.title === fiveOptTitle);
    const manualQuiz = createdQuizzes?.find((q) => q.title === manualTitle);
    expect(fiveOptQuiz).toBeDefined();
    expect(manualQuiz).toBeDefined();
    if (fiveOptQuiz) run.quizIds.push(fiveOptQuiz.id);
    if (manualQuiz) run.quizIds.push(manualQuiz.id);

    // Also create a practiceDisabled quiz to verify practiceEnabled=false guard
    const { data: noPracticeQuizId } = await adminClient
      .from('quizzes')
      .insert({
        teacher_uid: run.accounts.teacher1.uid,
        title: `[E2E] No Practice ${run.runId}`,
        subject: 'Toán',
        description: '',
        status: 'published',
        settings: {
          durationMinutes: 15,
          shuffleQuestions: false,
          shuffleOptions: false,
          allowReview: true,
          maxAttempts: 0,
          passPercentage: 50,
          practiceEnabled: false,
        },
      })
      .select('id')
      .single();
    if (noPracticeQuizId) run.quizIds.push(noPracticeQuizId.id);

    await logoutViaUi(page);

    // 3. Student quick room-code join, invalid room code, QuizRoom save indicator + flag + submit -> Result breakdown filters
    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');

    // Invalid room code rejection
    await page.locator('#room-code').fill('NOPE99');
    await page.getByRole('button', { name: 'Vào phòng thi' }).click();
    await expect(page.getByText(/Không tìm thấy phòng thi có mã "NOPE99"/).first()).toBeVisible();

    // Valid room code join -> lobby -> QuizRoom
    await page.locator('#room-code').fill(fiveOptQuiz!.code);
    await page.getByRole('button', { name: 'Vào phòng thi' }).click();
    await expect(page).toHaveURL(new RegExp(`/student/quiz/${fiveOptQuiz!.id}/lobby`));
    await page.getByRole('button', { name: 'Bắt đầu làm bài thi ngay' }).click();
    await expect(page).toHaveURL(new RegExp(`/student/quiz/${fiveOptQuiz!.id}$`));

    // Answer Q1 wrong (A), flag Q1, move to Q2, answer Q2 right (E), verify Đã lưu, submit
    await page.getByRole('button', { name: /12/ }).first().click();
    await page.getByRole('button', { name: 'Gắn cờ' }).click();
    await expect(page.getByRole('button', { name: 'Đã gắn cờ' })).toBeVisible();
    await page.getByRole('button', { name: 'Câu tiếp theo' }).click();
    await page.getByRole('button', { name: /Lựa chọn E chính xác/ }).click();
    await expect(page.getByText('Đã lưu').first()).toBeVisible();

    await page.getByRole('button', { name: 'Hoàn tất & Nộp bài' }).click();
    await page.getByRole('button', { name: 'Nộp bài ngay' }).click();
    await expect(page).toHaveURL(/\/student\/result\//, { timeout: 20_000 });

    // Result breakdown filters
    await expect(page.getByText('Chi tiết câu hỏi và đáp án')).toBeVisible();
    await page.getByRole('button', { name: /Đúng \(1\)/ }).click();
    await expect(page.getByText('Lựa chọn E chính xác')).toBeVisible();
    await page.getByRole('button', { name: /Sai \(1\)/ }).click();
    await expect(page.getByText('Giá trị của 10 + 5 là bao nhiêu?')).toBeVisible();
    await page.getByRole('button', { name: /Có cờ \(1\)/ }).click();
    await expect(page.getByText('Giá trị của 10 + 5 là bao nhiêu?')).toBeVisible();

    // 4. Student Practice (A-E check + finish + history + wrong-answer retry + practiceEnabled=false guard)
    if (noPracticeQuizId) {
      await page.goto(`/student/practice/${noPracticeQuizId.id}`);
      await expect(page.getByText('Giáo viên đã tắt chức năng luyện tập cho đề này.')).toBeVisible();
    }

    await page.goto(`/student/practice/${fiveOptQuiz!.id}`);
    await page.getByRole('button', { name: 'Bắt đầu luyện tập' }).click();
    await expect(page).toHaveURL(/\/student\/practice\/.*\/room/, { timeout: 20_000 });

    // Q1 wrong (A) -> check -> next -> Q2 right (E) -> check -> finish
    await page.getByRole('button', { name: /12/ }).first().click();
    await page.getByRole('button', { name: 'Kiểm tra câu này' }).click();
    await expect(page.getByText('Chưa chính xác')).toBeVisible();
    await page.getByRole('button', { name: 'Câu tiếp theo' }).click();

    await page.getByRole('button', { name: /Lựa chọn E chính xác/ }).click();
    await page.getByRole('button', { name: 'Kiểm tra câu này' }).click();
    await expect(page.getByText('Chính xác', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Xem kết quả' }).click();
    await expect(page).toHaveURL(/\/student\/practice\/.*\/result/, { timeout: 20_000 });

    // Wrong-answer retry creates a 1-question session
    await page.getByRole('button', { name: 'Luyện lại câu sai' }).click();
    await expect(page).toHaveURL(/\/student\/practice\/.*\/room/, { timeout: 20_000 });
    await expect(page.getByText(/Đã kiểm tra 0\/1 câu/)).toBeVisible();

    // Practice history renders
    await page.goto('/student/practice');
    await expect(page.getByText(fiveOptTitle).first()).toBeVisible();

    await logoutViaUi(page);
  });

  test('Responsive baseline: Desktop (1280x800) & Mobile (390x844) overflow, mobile drawer & dark mode', async ({
    page,
  }) => {
    // 1. /login on Desktop & Mobile + dark mode toggle
    await clearBrowserAuth(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/login');
    await assertNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    const themeAfter = await toggleDarkMode(page);
    expect(['dark', 'light']).toContain(themeAfter);
    await assertNoHorizontalOverflow(page);

    // 2. /student on Desktop & Mobile + mobile menu drawer
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');
    await assertNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Mở menu' }).click();
    await expect(page.getByRole('link', { name: 'Lịch sử luyện tập' })).toBeVisible();
    await page.getByRole('button', { name: 'Đóng menu' }).click();
    await logoutViaUi(page);

    // 3. /teacher on Desktop & Mobile
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');
    await assertNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Mở menu' }).click();
    await expect(page.getByRole('link', { name: 'Danh sách đề thi' })).toBeVisible();
    await page.getByRole('button', { name: 'Đóng menu' }).click();
    await logoutViaUi(page);

    // 4. /admin/teacher-approvals on Desktop & Mobile
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginViaUi(page, run.accounts.admin.email, run.password, '/admin/teacher-approvals');
    await assertNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Mở menu' }).click();
    await expect(page.getByRole('link', { name: 'Quản lý tài khoản' })).toBeVisible();
    await page.getByRole('button', { name: 'Đóng menu' }).click();
    await logoutViaUi(page);
  });
});
