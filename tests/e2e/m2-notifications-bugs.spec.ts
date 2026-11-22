import { test, expect } from '@playwright/test';
import {
  addClassroomMembers,
  callEdge,
  callRpc,
  cleanupE2eRun,
  createAdminClient,
  createExtraStudent,
  createLegacyPendingTeacher,
  provisionE2eRun,
  seedAssignment,
  seedBugReport,
  seedClassroom,
  seedNotification,
  seedQuiz,
  signInAndGetToken,
  sweepStaleE2eAccounts,
  type E2eRunManifest,
} from './helpers/supabaseAdmin';
import { clearBrowserAuth, expectToast, loginViaUi, logoutViaUi } from './helpers/uiAuth';

test.describe('M2 R1: NotificationBell UI & Dual-Role Deep-Link Routing (F2)', () => {
  let run: E2eRunManifest;

  test.beforeAll(async () => {
    await sweepStaleE2eAccounts(24).catch(() => undefined);
    run = await provisionE2eRun('m2_notif');
  });

  test.afterAll(async () => {
    await cleanupE2eRun(run);
  });

  test('F2 Tier 1: Unread badge, popover Escape + focus restore, mark single read & mark all read persist across reload', async ({
    page,
  }) => {
    const n1 = await seedNotification(run, run.accounts.student1.uid, {
      type: 'system_notice',
      title: `[E2E] TB Đơn 1 ${run.runId.slice(-4)}`,
      body: 'Thông báo đọc đơn lẻ',
      targetRoute: '/student/classes',
    });
    const n2 = await seedNotification(run, run.accounts.student1.uid, {
      type: 'system_notice',
      title: `[E2E] TB Tất cả 2 ${run.runId.slice(-4)}`,
      body: 'Thông báo đọc tất cả',
      targetRoute: '/student/practice',
    });

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');

    const bellTrigger = page.getByRole('button', { name: /Thông báo \(2 chưa đọc\)/ });
    await expect(bellTrigger).toBeVisible();

    // Open popover -> Escape closes & restores focus to bell trigger
    await bellTrigger.click();
    const popover = page.getByRole('dialog', { name: 'Danh sách thông báo' });
    await expect(popover).toBeVisible();
    await expect(popover.getByText('2 mới')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(bellTrigger).toBeFocused();

    // Re-open, mark n1 single read -> count drops to 1
    await bellTrigger.click();
    await expect(popover).toBeVisible();
    await popover.getByRole('button', { name: `Đánh dấu đã đọc: ${n1.title}` }).click();
    await expect(page.getByRole('button', { name: /Thông báo \(1 chưa đọc\)/ })).toBeVisible();
    await expect(popover.getByText('1 mới')).toBeVisible();

    // Reload -> single-read state persisted (still 1 unread, n2 unread)
    await page.reload();
    await expect(page.getByRole('button', { name: /Thông báo \(1 chưa đọc\)/ })).toBeVisible();

    // Mark all read -> badge disappears & persists after reload
    await page.getByRole('button', { name: /Thông báo \(1 chưa đọc\)/ }).click();
    const popoverAfter = page.getByRole('dialog', { name: 'Danh sách thông báo' });
    await expect(popoverAfter.getByText(n2.title)).toBeVisible();
    await popoverAfter.getByRole('button', { name: 'Đọc tất cả' }).click();
    await expect(page.getByRole('button', { name: 'Thông báo', exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Thông báo', exact: true })).toBeVisible();
    await logoutViaUi(page);
  });

  test('F2 Tier 1: Click classroom_joined & quiz_assigned notifications navigate directly to targetRoute', async ({
    page,
  }) => {
    const classroom = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Lớp Notif ${run.runId.slice(-4)}`,
    });
    await addClassroomMembers(classroom.id, [
      {
        email: run.accounts.student2.email,
        studentUid: run.accounts.student2.uid,
        memberName: run.accounts.student2.fullName,
        status: 'active',
        joinedVia: 'teacher_email',
      },
    ]);
    const quiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Đề Notif ${run.runId.slice(-4)}`,
    });
    await seedAssignment(classroom.id, quiz.id, { assignedBy: run.accounts.teacher1.uid });

    const joinedNotif = await seedNotification(run, run.accounts.student2.uid, {
      type: 'classroom_joined',
      title: `[E2E] Đã vào lớp ${classroom.name}`,
      body: 'Bạn vừa được thêm vào lớp học.',
      targetRoute: `/student/classes/${classroom.id}`,
    });
    const assignedNotif = await seedNotification(run, run.accounts.student2.uid, {
      type: 'quiz_assigned',
      title: `[E2E] Bài tập mới ${quiz.title}`,
      body: 'Giáo viên vừa giao bài tập mới.',
      targetRoute: `/student/classes/${classroom.id}`,
    });

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.student2.email, run.password, '/student');

    await page.getByRole('button', { name: /Thông báo/ }).click();
    const popover = page.getByRole('dialog', { name: 'Danh sách thông báo' });
    await popover.getByRole('button', { name: new RegExp(joinedNotif.title) }).click();
    await expect(page).toHaveURL(new RegExp(`/student/classes/${classroom.id}$`), { timeout: 15_000 });

    // Navigate back to home, click quiz_assigned notification
    await page.goto('/student');
    await page.getByRole('button', { name: /Thông báo/ }).click();
    await page
      .getByRole('dialog', { name: 'Danh sách thông báo' })
      .getByRole('button', { name: new RegExp(assignedNotif.title) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/student/classes/${classroom.id}$`), { timeout: 15_000 });
    await logoutViaUi(page);
  });

  test('F2 Tier 1: Dual-role teacher_approval, role_changed & cross-role bug_report_updated deep-link auto-switching', async ({
    page,
  }) => {
    const dualUser = await createExtraStudent(run, 'm2_dual_notif', {
      teacherRequestStatus: 'approved',
    });
    const stuReport = await seedBugReport(run, dualUser.uid, {
      reporterRole: 'student',
      title: `[E2E] Dual Student Bug ${run.runId.slice(-4)}`,
      status: 'resolved',
      adminResponse: 'Đã xử lý xong lỗi ở chế độ học sinh.',
    });
    const teaReport = await seedBugReport(run, dualUser.uid, {
      reporterRole: 'teacher',
      title: `[E2E] Dual Teacher Bug ${run.runId.slice(-4)}`,
      status: 'in_progress',
      adminResponse: 'Đang kiểm tra ở chế độ giáo viên.',
    });

    await seedNotification(run, dualUser.uid, {
      type: 'teacher_approval',
      title: `[E2E] Duyệt GV ${run.runId.slice(-4)}`,
      body: 'Yêu cầu giáo viên của bạn đã được phê duyệt.',
      targetRoute: '/teacher',
    });
    await seedNotification(run, dualUser.uid, {
      type: 'bug_report_updated',
      title: `[E2E] Cập nhật lỗi GV ${run.runId.slice(-4)}`,
      body: 'Admin cập nhật lỗi giáo viên.',
      targetRoute: `/teacher/bug-reports?reportId=${teaReport.id}`,
    });
    await seedNotification(run, dualUser.uid, {
      type: 'bug_report_updated',
      title: `[E2E] Cập nhật lỗi HS ${run.runId.slice(-4)}`,
      body: 'Admin cập nhật lỗi học sinh.',
      targetRoute: `/student/bug-reports?reportId=${stuReport.id}`,
    });

    await clearBrowserAuth(page);
    await loginViaUi(page, dualUser.email, run.password, '/student');

    // 1. In student mode, click teacher_approval -> auto-switches to teacher & lands on /teacher
    await page.getByRole('button', { name: /Thông báo/ }).click();
    await page
      .getByRole('dialog', { name: 'Danh sách thông báo' })
      .getByRole('button', { name: new RegExp(`Duyệt GV ${run.runId.slice(-4)}`) })
      .click();
    await expect(page).toHaveURL(/\/teacher$/, { timeout: 20_000 });

    // 2. While in teacher mode, click student bug_report_updated -> must switch to student & land on /student/bug-reports?reportId=...
    await page.getByRole('button', { name: /Thông báo/ }).click();
    await page
      .getByRole('dialog', { name: 'Danh sách thông báo' })
      .getByRole('button', { name: new RegExp(`Cập nhật lỗi HS ${run.runId.slice(-4)}`) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/student/bug-reports\\?reportId=${stuReport.id}`), {
      timeout: 20_000,
    });
    await expect(page.getByText('Được mở từ thông báo')).toBeVisible();
    await expect(page.getByText(stuReport.title)).toBeVisible();

    // 3. While in student mode, click teacher bug_report_updated -> switches to teacher & lands on /teacher/bug-reports?reportId=...
    await page.getByRole('button', { name: /Thông báo/ }).click();
    await page
      .getByRole('dialog', { name: 'Danh sách thông báo' })
      .getByRole('button', { name: new RegExp(`Cập nhật lỗi GV ${run.runId.slice(-4)}`) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/teacher/bug-reports\\?reportId=${teaReport.id}`), {
      timeout: 20_000,
    });
    await expect(page.getByText('Được mở từ thông báo')).toBeVisible();
    await expect(page.getByText(teaReport.title)).toBeVisible();

    await logoutViaUi(page);
  });

  test('F2 Tier 2: Empty state, outside click close, 99+ cap, invalid targetRoute fallback & cross-user RPC isolation', async ({
    page,
  }) => {
    const cleanStu = await createExtraStudent(run, 'm2_empty_notif');

    // Seed an unsafe/external-style targetRoute notification and verify fallback to /student
    await seedNotification(run, cleanStu.uid, {
      type: 'system_notice',
      title: `[E2E] Unsafe Route ${run.runId.slice(-4)}`,
      body: 'Kiểm tra fallback an toàn.',
      targetRoute: '//evil.example.com/phish',
    });

    await clearBrowserAuth(page);
    await loginViaUi(page, cleanStu.email, run.password, '/student');

    // Click unsafe route notification -> falls back to role home (/student) and never leaves origin
    await page.getByRole('button', { name: /Thông báo/ }).click();
    const pop1 = page.getByRole('dialog', { name: 'Danh sách thông báo' });
    await expect(pop1).toBeVisible();
    await pop1.getByRole('button', { name: new RegExp(`Unsafe Route ${run.runId.slice(-4)}`) }).click();
    await expect(page).toHaveURL(/^https?:\/\/localhost:5173\/student/);

    // Now unread=0 -> open popover shows empty/read state; click outside closes popover
    await page.getByRole('button', { name: 'Thông báo', exact: true }).click();
    const pop2 = page.getByRole('dialog', { name: 'Danh sách thông báo' });
    await expect(pop2).toBeVisible();
    // Click outside on main heading
    await page.locator('h1').first().click({ force: true });
    await expect(pop2).toHaveCount(0);

    // Cross-user mark_notifications_read returns 0
    const s3Notif = await seedNotification(run, run.accounts.student3.uid, {
      title: `[E2E] S3 Private ${run.runId.slice(-4)}`,
    });
    const cleanStuToken = (await signInAndGetToken(cleanStu.email, run.password)).accessToken;
    const crossMarkRes = await callRpc(
      'mark_notifications_read',
      { p_ids: [s3Notif.id] },
      cleanStuToken
    );
    expect(crossMarkRes.status).toBe(200);
    expect(crossMarkRes.json).toBe(0);

    // Verify 99+ badge cap when unreadCount > 99 using a fresh student
    const floodStu = await createExtraStudent(run, 'm2_flood_notif');
    const admin = createAdminClient();
    const bulkRows = Array.from({ length: 101 }, (_, idx) => ({
      recipient_uid: floodStu.uid,
      type: 'system_notice',
      title: `[E2E] Flood #${idx + 1}`,
      body: 'Kiểm tra giới hạn hiển thị 99+.',
      target_route: '/student',
      metadata: {},
      is_read: false,
    }));
    const { error: floodErr } = await admin.from('in_app_notifications').insert(bulkRows);
    expect(floodErr).toBeNull();

    await logoutViaUi(page);
    await loginViaUi(page, floodStu.email, run.password, '/student');
    const floodBell = page.getByRole('button', { name: /Thông báo \(101 chưa đọc\)/ });
    await expect(floodBell).toBeVisible();
    await expect(floodBell.getByText('99+')).toBeVisible();
    await floodBell.click();
    await expect(page.getByText('Chưa có thông báo nào')).toHaveCount(0);
    await logoutViaUi(page);
  });
});

test.describe('M2 R1: BugReportModal & BugReportsPage (F3 — Tier 1 & Tier 2)', () => {
  let run: E2eRunManifest;

  test.beforeAll(async () => {
    await sweepStaleE2eAccounts(24).catch(() => undefined);
    run = await provisionE2eRun('m2_bugs');
  });

  test.afterAll(async () => {
    await cleanupE2eRun(run);
  });

  test('F3 Tier 1: Student & Teacher submit bug reports from Navbar, verify pre-filled role/route, status pills & search', async ({
    page,
  }) => {
    const stuBugTitle = `[E2E] Lỗi HS ${run.runId.slice(-4)}`;
    const teaBugTitle = `[E2E] Lỗi GV ${run.runId.slice(-4)}`;

    // 1. Student opens BugReportModal on /student/classes
    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');
    await page.goto('/student/classes');
    await page.getByRole('button', { name: 'Báo lỗi hệ thống' }).click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('Học sinh')).toBeVisible();
    await expect(modal.locator('code', { hasText: '/student/classes' })).toBeVisible();

    await modal.getByLabel(/Tiêu đề lỗi/).fill(stuBugTitle);
    await modal.getByLabel('Phân loại').selectOption('classroom');
    await modal.getByLabel('Mức độ nghiêm trọng').selectOption('high');
    await modal
      .getByLabel(/Mô tả chi tiết/)
      .fill('Khi mở trang lớp học trên trình duyệt, dữ liệu không hiển thị đầy đủ.');
    await modal.getByRole('button', { name: 'Gửi báo lỗi' }).click();
    await expectToast(page, /Đã gửi phiếu báo lỗi tới quản trị viên/);

    // Navigate to /student/bug-reports and check list + status pills + search
    await page.getByRole('link', { name: 'Báo lỗi' }).click();
    await expect(page).toHaveURL(/\/student\/bug-reports/);
    await expect(page.getByRole('heading', { name: 'Báo lỗi & Hỗ trợ' })).toBeVisible();
    await expect(page.getByText(stuBugTitle)).toBeVisible();

    // Seed in_progress and resolved reports for filter pill verification
    const inProg = await seedBugReport(run, run.accounts.student1.uid, {
      reporterRole: 'student',
      title: `[E2E] Đang xử lý ${run.runId.slice(-4)}`,
      status: 'in_progress',
      adminResponse: 'Đội kỹ thuật đang tái hiện lỗi.',
    });
    const resolved = await seedBugReport(run, run.accounts.student1.uid, {
      reporterRole: 'student',
      title: `[E2E] Đã xong ${run.runId.slice(-4)}`,
      status: 'resolved',
      adminResponse: 'Đã vá lỗi ở bản cập nhật mới nhất.',
    });

    await page.getByRole('button', { name: 'Làm mới' }).click();
    await expect(page.getByText(inProg.title)).toBeVisible();
    await expect(page.getByText(resolved.title)).toBeVisible();

    const filterGroup = page.getByRole('group', { name: 'Lọc theo trạng thái' });
    await filterGroup.getByRole('button', { name: /^Đang xử lý/ }).click();
    await expect(page.getByText(inProg.title)).toBeVisible();
    await expect(page.getByText(resolved.title)).toHaveCount(0);

    await filterGroup.getByRole('button', { name: /^Đã giải quyết/ }).click();
    await expect(page.getByText(resolved.title)).toBeVisible();
    await expect(page.getByText('Đã vá lỗi ở bản cập nhật mới nhất.')).toBeVisible();

    await filterGroup.getByRole('button', { name: /^Tất cả/ }).click();
    await page.getByPlaceholder('Tìm tiêu đề, mô tả, phản hồi...').fill('Đội kỹ thuật đang tái hiện');
    await expect(page.getByText(inProg.title)).toBeVisible();
    await expect(page.getByText(stuBugTitle)).toHaveCount(0);
    await logoutViaUi(page);

    // 2. Teacher submits BugReportModal from /teacher/quizzes -> sees it in /teacher/bug-reports
    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');
    await page.goto('/teacher/quizzes');
    await page.getByRole('button', { name: 'Báo lỗi hệ thống' }).click();
    const teaModal = page.getByRole('dialog');
    await expect(teaModal.getByText('Giáo viên')).toBeVisible();
    await expect(teaModal.locator('code', { hasText: '/teacher/quizzes' })).toBeVisible();

    await teaModal.getByLabel(/Tiêu đề lỗi/).fill(teaBugTitle);
    await teaModal.getByLabel('Phân loại').selectOption('exam');
    await teaModal
      .getByLabel(/Mô tả chi tiết/)
      .fill('Không lưu được cấu hình đóng đề sau khi chỉnh sửa trên danh sách đề thi.');
    await teaModal.getByRole('button', { name: 'Gửi báo lỗi' }).click();
    await expectToast(page, /Đã gửi phiếu báo lỗi/);

    await page.getByRole('link', { name: 'Báo lỗi' }).click();
    await expect(page).toHaveURL(/\/teacher\/bug-reports/);
    await expect(page.getByText(teaBugTitle)).toBeVisible();
    await logoutViaUi(page);
  });

  test('F3 Tier 1 & Tier 2: BugReportPage ?reportId= deep-link highlight, modal Zod boundaries & cross-user privacy isolation', async ({
    page,
  }) => {
    const s2Private = await seedBugReport(run, run.accounts.student2.uid, {
      reporterRole: 'student',
      title: `[E2E] Private S2 Bug ${run.runId.slice(-4)}`,
      status: 'new',
    });
    const s1Target = await seedBugReport(run, run.accounts.student1.uid, {
      reporterRole: 'student',
      title: `[E2E] Highlight S1 Bug ${run.runId.slice(-4)}`,
      status: 'resolved',
      adminResponse: 'Admin đã kiểm tra và xác nhận.',
    });

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');
    await page.goto(`/student/bug-reports?reportId=${s1Target.id}`);

    // Highlight badge & admin response visible, S2's private bug report NEVER visible
    await expect(page.getByText('Được mở từ thông báo')).toBeVisible();
    await expect(page.getByText(s1Target.title)).toBeVisible();
    await expect(page.getByText('Admin đã kiểm tra và xác nhận.')).toBeVisible();
    await expect(page.getByText(s2Private.title)).toHaveCount(0);

    // Open BugReportModal from page button and test Zod validation boundaries
    await page.getByRole('button', { name: 'Gửi báo lỗi mới' }).first().click();
    const modal = page.getByRole('dialog');

    // Too short: title = 2 chars (<3), description = 9 chars (<10)
    await modal.getByLabel(/Tiêu đề lỗi/).fill('AB');
    await modal.getByLabel(/Mô tả chi tiết/).fill('123456789');
    await modal.getByRole('button', { name: 'Gửi báo lỗi' }).click();
    await expect(modal).toBeVisible();
    await expect(modal.getByText(/3 ký tự|ít nhất 3/i)).toBeVisible();
    await expect(modal.getByText(/10 ký tự|ít nhất 10/i)).toBeVisible();

    // Whitespace-only input also rejected
    await modal.getByLabel(/Tiêu đề lỗi/).fill('   ');
    await modal.getByLabel(/Mô tả chi tiết/).fill('          ');
    await modal.getByRole('button', { name: 'Gửi báo lỗi' }).click();
    await expect(modal).toBeVisible();

    // Exact minimum valid boundary: 3-char title + 10-char description succeeds
    const minTitle = 'Loi';
    await modal.getByLabel(/Tiêu đề lỗi/).fill(minTitle);
    await modal.getByLabel(/Mô tả chi tiết/).fill('1234567890');
    await modal.getByRole('button', { name: 'Gửi báo lỗi' }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByText(minTitle, { exact: true }).first()).toBeVisible();

    // Non-admin RPC call to update_bug_report_status must fail
    const s1Token = (await signInAndGetToken(run.accounts.student1.email, run.password)).accessToken;
    const forbiddenUpdate = await callRpc(
      'update_bug_report_status',
      {
        p_report_id: s1Target.id,
        p_status: 'new',
        p_admin_response: 'Student tamper attempt',
      },
      s1Token
    );
    expect(forbiddenUpdate.status).toBe(400);
    expect(forbiddenUpdate.text).toContain('Chỉ quản trị viên');

    await logoutViaUi(page);
  });
});

test.describe('M2 Backend Hardening API/RPC Contracts (after_close, closed assignments, pending change_role)', () => {
  let run: E2eRunManifest;

  test.beforeAll(async () => {
    await sweepStaleE2eAccounts(24).catch(() => undefined);
    run = await provisionE2eRun('m2_api');
  });

  test.afterAll(async () => {
    await cleanupE2eRun(run);
  });

  test('Tier 2 M2 Edge Cases: redact_result_for_caller on status=closed, list_student_assignments scoping & overdue, change_role on pending account', async () => {
    const teacherToken = (await signInAndGetToken(run.accounts.teacher1.email, run.password)).accessToken;
    const studentToken = (await signInAndGetToken(run.accounts.student1.email, run.password)).accessToken;
    const adminToken = (await signInAndGetToken(run.accounts.admin.email, run.password)).accessToken;

    // 1. Seed classroom + student1 + 2 quizzes:
    //    - quizClosedAfter: after_close visibility, closesAt null, initially published
    //    - quizPastClosesAt: closesAt in the past, dueAt null
    const classroom = await seedClassroom(run, run.accounts.teacher1.uid);
    await addClassroomMembers(classroom.id, [
      {
        email: run.accounts.student1.email,
        studentUid: run.accounts.student1.uid,
        memberName: run.accounts.student1.fullName,
        status: 'active',
        joinedVia: 'teacher_email',
      },
    ]);

    const quizClosedAfter = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Closed AfterClose ${run.runId.slice(-4)}`,
      settings: {
        publishScope: 'class_only',
        scoreVisibility: 'after_close',
        answerVisibility: 'after_close',
        closesAt: null,
        maxAttempts: 2,
      },
    });
    const assign1 = await seedAssignment(classroom.id, quizClosedAfter.id, {
      assignedBy: run.accounts.teacher1.uid,
      latePolicy: 'allow_late',
    });

    const pastIso = new Date(Date.now() - 3600 * 1000).toISOString();
    const quizPastClosesAt = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Past ClosesAt ${run.runId.slice(-4)}`,
      settings: {
        publishScope: 'class_only',
        closesAt: pastIso,
      },
    });
    const assign2 = await seedAssignment(classroom.id, quizPastClosesAt.id, {
      assignedBy: run.accounts.teacher1.uid,
      dueAt: null,
      hardCloseAt: null,
    });

    // Student completes an attempt for assign1 while published -> score & answers must be redacted
    const startRes = await callRpc(
      'start_attempt',
      {
        p_quiz_id: quizClosedAfter.id,
        p_class: '12A1',
        p_assignment_id: assign1.id,
      },
      studentToken
    );
    expect(startRes.status).toBe(200);
    const attempt = startRes.json as { id: string };

    const finalizeRes = await callEdge('finalize-exam', {
      token: studentToken,
      body: {
        attemptId: attempt.id,
        idempotencyKey: `m2_after_close_${attempt.id}`,
      },
    });
    expect(finalizeRes.status).toBe(200);
    const redactedResult = finalizeRes.json as {
      id: string;
      score: number | null;
      scoreHidden: boolean;
      answersHidden: boolean;
      details: unknown[];
    };
    expect(redactedResult.scoreHidden).toBe(true);
    expect(redactedResult.answersHidden).toBe(true);
    expect(redactedResult.score).toBeNull();
    expect(redactedResult.details).toEqual([]);

    // Teacher manually closes quiz (status = 'closed') without setting closesAt
    const closeRes = await callRpc(
      'set_quiz_status',
      { p_id: quizClosedAfter.id, p_status: 'closed' },
      teacherToken
    );
    expect(closeRes.status).toBe(200);

    // list_results must now reveal score & answers because quiz.status === 'closed'
    const resultsRes = await callRpc('list_results', { p_quiz_id: quizClosedAfter.id }, studentToken);
    expect(resultsRes.status).toBe(200);
    const results = resultsRes.json as Array<{
      id: string;
      score: number | null;
      scoreHidden: boolean;
      answersHidden: boolean;
      details: unknown[];
    }>;
    const revealed = results.find((r) => r.id === redactedResult.id);
    expect(revealed).toBeDefined();
    expect(revealed!.scoreHidden).toBe(false);
    expect(revealed!.answersHidden).toBe(false);
    expect(typeof revealed!.score).toBe('number');
    expect(revealed!.details.length).toBeGreaterThan(0);

    // list_student_assignments must STILL retain assign1 (quiz closed & completed) AND mark assign2 overdue via closesAt
    const stuAssignRes = await callRpc('list_student_assignments', { p_classroom_id: classroom.id }, studentToken);
    expect(stuAssignRes.status).toBe(200);
    const stuAssigns = stuAssignRes.json as Array<{
      assignmentId: string;
      status: string;
      attemptCount: number;
      scoreHidden: boolean;
      bestScore: number | null;
    }>;
    const item1 = stuAssigns.find((a) => a.assignmentId === assign1.id);
    expect(item1).toBeDefined();
    expect(item1!.status).toBe('completed');
    expect(item1!.attemptCount).toBe(1);
    expect(item1!.scoreHidden).toBe(false);

    const item2 = stuAssigns.find((a) => a.assignmentId === assign2.id);
    expect(item2).toBeDefined();
    expect(item2!.status).toBe('overdue');
    expect(item2!.attemptCount).toBe(0);

    // Verify assignment-scoped attemptCount isolation: public attempt on a multi-class quiz must not inflate another assignment's attemptCount
    const sharedQuiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Scoped Attempt Quiz ${run.runId.slice(-4)}`,
      settings: { publishScope: 'public', maxAttempts: 2 },
    });
    const class2 = await seedClassroom(run, run.accounts.teacher1.uid);
    await addClassroomMembers(class2.id, [
      {
        email: run.accounts.student1.email,
        studentUid: run.accounts.student1.uid,
        memberName: run.accounts.student1.fullName,
        status: 'active',
        joinedVia: 'teacher_email',
      },
    ]);
    const assignScoped = await seedAssignment(class2.id, sharedQuiz.id, {
      assignedBy: run.accounts.teacher1.uid,
    });
    const publicStart = await callRpc(
      'start_attempt',
      { p_quiz_id: sharedQuiz.id, p_class: '12A1' },
      studentToken
    );
    expect(publicStart.status).toBe(200);
    const pubAtt = publicStart.json as { id: string };
    await callEdge('finalize-exam', {
      token: studentToken,
      body: { attemptId: pubAtt.id, idempotencyKey: `m2_pub_${pubAtt.id}` },
    });
    const class2AssignsRes = await callRpc('list_student_assignments', { p_classroom_id: class2.id }, studentToken);
    expect(class2AssignsRes.status).toBe(200);
    const class2Assign = (class2AssignsRes.json as Array<{ assignmentId: string; attemptCount: number; status: string }>).find(
      (a) => a.assignmentId === assignScoped.id
    );
    expect(class2Assign).toBeDefined();
    expect(class2Assign!.attemptCount).toBe(0);
    expect(class2Assign!.status).toBe('todo');

    // 2. manage-user-accounts change_role on pending account must approve & sync JWT metadata
    const pendingUser = await createLegacyPendingTeacher(run, 'm2_pending_promote');
    const promoteRes = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: {
        action: 'change_role',
        userId: pendingUser.uid,
        nextRole: 'teacher',
      },
    });
    expect(promoteRes.status).toBe(200);
    const promotedBody = promoteRes.json as {
      profile: { approval_status: string; role: string };
      active_role: string;
    };
    expect(promotedBody.profile.role).toBe('teacher');
    expect(promotedBody.profile.approval_status).toBe('approved');
    expect(promotedBody.active_role).toBe('teacher');

    // Fresh sign-in must immediately work as teacher (JWT app_role synced)
    const promotedAuth = await signInAndGetToken(pendingUser.email, run.password);
    const bootstrapRes = await callEdge('bootstrap-profile', {
      token: promotedAuth.accessToken,
      body: { fullName: pendingUser.fullName, overwriteName: false },
    });
    expect(bootstrapRes.status).toBe(200);
    const bootstrapJson = bootstrapRes.json as { active_role: string; approval_status: string };
    expect(bootstrapJson.active_role).toBe('teacher');
    expect(bootstrapJson.approval_status).toBe('approved');
  });
});
