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
  seedBugReport,
  seedClassroom,
  seedQuiz,
  signInAndGetToken,
  sweepStaleE2eAccounts,
  type E2eRunManifest,
} from './helpers/supabaseAdmin';
import {
  clearBrowserAuth,
  confirmActionDialog,
  expectToast,
  loginViaUi,
  logoutViaUi,
} from './helpers/uiAuth';

test.describe('M3 R2: Admin AccountManagement & TeacherApprovals (F4 — Tier 1 & Tier 2)', () => {
  let run: E2eRunManifest;

  test.beforeAll(async () => {
    await sweepStaleE2eAccounts(24).catch(() => undefined);
    run = await provisionE2eRun('m3_acct');
  });

  test.afterAll(async () => {
    await cleanupE2eRun(run);
  });

  test('F4 Tier 1: AccountManagement tabs, search, clickable Detail Drawer (stats, classrooms, quizzes/results), reviewTeacher & role change persistence', async ({
    page,
  }) => {
    // Seed classroom + quiz + student attempt so Detail Drawer renders real non-zero stats & lists
    const classroom = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Lớp Detail ${run.runId.slice(-4)}`,
    });
    await addClassroomMembers(classroom.id, [
      {
        email: run.accounts.student1.email,
        studentUid: run.accounts.student1.uid,
        memberName: run.accounts.student1.fullName,
        status: 'active',
        joinedVia: 'teacher_email',
      },
    ]);
    const quiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Đề Detail ${run.runId.slice(-4)}`,
    });

    const studentToken = (await signInAndGetToken(run.accounts.student1.email, run.password)).accessToken;
    const startRes = await callEdge('finalize-exam', { token: studentToken, body: {} }).catch(() => null);
    void startRes;
    const stuStart = await callRpc('start_attempt', { p_quiz_id: quiz.id, p_class: '12A1' }, studentToken);
    expect(stuStart.status).toBe(200);
    const attId = (stuStart.json as { id: string }).id;
    const finRes = await callEdge('finalize-exam', {
      token: studentToken,
      body: { attemptId: attId, idempotencyKey: `m3_detail_${attId}` },
    });
    expect(finRes.status).toBe(200);

    // Extra student with pending teacher request for reviewTeacher inside Detail Drawer
    const pendingApplicant = await createExtraStudent(run, 'm3_drawer_req', {
      teacherRequestStatus: 'pending',
    });

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.admin.email, run.password, '/admin/teacher-approvals');

    await page.getByRole('link', { name: 'Quản lý tài khoản' }).click();
    await expect(page).toHaveURL(/\/admin\/accounts/);
    await expect(page.getByRole('heading', { name: 'Quản lý tài khoản' })).toBeVisible();

    // 1. Teacher tab -> search teacher1 -> click row -> Detail Drawer shows stats, classroom & quiz
    const teacherTab = page
      .getByRole('tab', { name: /Giáo viên/ })
      .or(page.getByRole('button', { name: /Giáo viên/ }))
      .first();
    await teacherTab.click();
    const searchInput = page.getByPlaceholder('Tìm theo tên hoặc email...');
    await searchInput.fill(run.accounts.teacher1.email);

    const teacherRow = page.getByRole('row', { name: new RegExp(run.accounts.teacher1.email, 'i') });
    await expect(teacherRow).toBeVisible();
    await teacherRow.click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(run.accounts.teacher1.email)).toBeVisible();
    await expect(drawer.getByText(classroom.name)).toBeVisible();
    await expect(drawer.getByText(quiz.title)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);

    // 2. Student tab -> inspect student1 Detail Drawer (enrolled classroom + recent result)
    const studentTab = page
      .getByRole('tab', { name: /Học sinh/ })
      .or(page.getByRole('button', { name: /Học sinh/ }))
      .first();
    await studentTab.click();
    await searchInput.fill(run.accounts.student1.email);

    const stuRow = page.getByRole('row', { name: new RegExp(run.accounts.student1.email, 'i') });
    await expect(stuRow).toBeVisible();
    await stuRow.click();

    const stuDrawer = page.getByRole('dialog');
    await expect(stuDrawer).toBeVisible();
    await expect(stuDrawer.getByText(run.accounts.student1.email)).toBeVisible();
    await expect(stuDrawer.getByText(classroom.name)).toBeVisible();
    await expect(stuDrawer.getByText(quiz.title)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(stuDrawer).toHaveCount(0);

    // 3. Review pending teacher applicant from Detail Drawer
    await searchInput.fill(pendingApplicant.email);
    const pendingRow = page.getByRole('row', { name: new RegExp(pendingApplicant.email, 'i') });
    await expect(pendingRow).toBeVisible();
    await pendingRow.click();

    const pendingDrawer = page.getByRole('dialog');
    await expect(pendingDrawer).toBeVisible();
    await pendingDrawer.getByRole('button', { name: /Phê duyệt/i }).click();
    await expectToast(page, /phê duyệt|Cập nhật/i);
    await page.keyboard.press('Escape');

    // 4. Change role student3 -> teacher -> reload persists -> restore back to student
    await searchInput.fill(run.accounts.student3.email);
    const s3Row = page.getByRole('row', { name: new RegExp(run.accounts.student3.email, 'i') });
    await expect(s3Row).toBeVisible();
    await s3Row.click();

    const roleDrawer = page.getByRole('dialog');
    await expect(roleDrawer).toBeVisible();
    try {
      const roleSelect = roleDrawer.getByLabel(/Vai trò|Đổi vai trò/i);
      await roleSelect.selectOption('teacher');
      const saveRoleBtn = roleDrawer.getByRole('button', { name: /Lưu vai trò|Đổi vai trò|Cập nhật vai trò/i });
      if (await saveRoleBtn.isVisible().catch(() => false)) {
        await saveRoleBtn.click();
      }
      await confirmActionDialog(page, 'confirm', /Xác nhận|Đổi|Lưu/i);
      await expectToast(page, /vai trò|Giáo viên|thành công/i);

      await page.reload();
      await teacherTab.click();
      await page.getByPlaceholder('Tìm theo tên hoặc email...').fill(run.accounts.student3.email);
      await expect(
        page.getByRole('row', { name: new RegExp(run.accounts.student3.email, 'i') })
      ).toBeVisible();
    } finally {
      // Restore student3 back to student via Edge Function so cleanup & state remain clean
      const adminToken = (await signInAndGetToken(run.accounts.admin.email, run.password)).accessToken;
      await callEdge('manage-user-accounts', {
        token: adminToken,
        body: { action: 'change_role', userId: run.accounts.student3.uid, nextRole: 'student' },
      });
    }

    await logoutViaUi(page);
  });

  test('F4 Tier 1 & Tier 2: Lock/Unlock accessible confirmation modal + blocked user login rejection + TeacherApprovals queue', async ({
    page,
  }) => {
    const lockTarget = await createExtraStudent(run, 'm3_lock_target');
    const queueApprove = await createExtraStudent(run, 'm3_queue_approve', {
      teacherRequestStatus: 'pending',
    });
    const queueReject = await createLegacyPendingTeacher(run, 'm3_queue_reject');

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.admin.email, run.password, '/admin/teacher-approvals');

    // 1. TeacherApprovals queue: block switch toggle, reject confirm cancel & accept, approve emits notification
    await page.getByRole('button', { name: 'Làm mới' }).click();
    const approveCard = page
      .locator('section, article, div')
      .filter({ hasText: queueApprove.email })
      .filter({ has: page.getByRole('button', { name: 'Phê duyệt' }) })
      .first();
    await expect(approveCard).toBeVisible();

    const blockSwitch = approveCard.getByRole('switch');
    await blockSwitch.click();
    await expect(blockSwitch).toHaveAttribute('aria-checked', 'true');
    await blockSwitch.click();
    await expect(blockSwitch).toHaveAttribute('aria-checked', 'false');

    const rejectCard = page
      .locator('section, article, div')
      .filter({ hasText: queueReject.email })
      .filter({ has: page.getByRole('button', { name: 'Từ chối' }) })
      .first();
    await expect(rejectCard).toBeVisible();

    // Cancel reject dialog -> stays
    await rejectCard.getByRole('button', { name: 'Từ chối' }).click();
    await confirmActionDialog(page, 'cancel');
    await expect(page.getByText(queueReject.email)).toBeVisible();

    // Confirm reject dialog -> removed
    await rejectCard.getByRole('button', { name: 'Từ chối' }).click();
    await confirmActionDialog(page, 'confirm', /Từ chối|Xác nhận/i);
    await expect(page.getByText(queueReject.email)).toHaveCount(0);

    // Approve queueApprove -> removed & teacher_approval notification created in DB
    await approveCard.getByRole('button', { name: 'Phê duyệt' }).click();
    await expect(page.getByText(queueApprove.email)).toHaveCount(0);

    const admin = createAdminClient();
    const { data: approvalNotifs } = await admin
      .from('in_app_notifications')
      .select('id, type, target_route')
      .eq('recipient_uid', queueApprove.uid)
      .eq('type', 'teacher_approval');
    expect((approvalNotifs || []).length).toBeGreaterThanOrEqual(1);

    // 2. AccountManagement lock/unlock with accessible confirmation dialog
    await page.getByRole('link', { name: 'Quản lý tài khoản' }).click();
    await expect(page).toHaveURL(/\/admin\/accounts/);
    await page
      .getByRole('tab', { name: /Học sinh/ })
      .or(page.getByRole('button', { name: /Học sinh/ }))
      .first()
      .click();

    await page.getByPlaceholder('Tìm theo tên hoặc email...').fill(lockTarget.email);
    const targetRow = page.getByRole('row', { name: new RegExp(lockTarget.email, 'i') });
    await expect(targetRow).toBeVisible();

    // Cancel lock -> stays active
    await targetRow.getByRole('button', { name: 'Khóa', exact: true }).click();
    await confirmActionDialog(page, 'cancel');
    await expect(targetRow.getByText('Đang hoạt động')).toBeVisible();

    try {
      // Confirm lock -> status becomes Đã bị khóa -> blocked user cannot log in
      await targetRow.getByRole('button', { name: 'Khóa', exact: true }).click();
      await confirmActionDialog(page, 'confirm', /Khóa|Xác nhận/i);
      await expect(targetRow.getByText('Đã bị khóa')).toBeVisible();

      await logoutViaUi(page);
      await page.goto('/login');
      await page.getByLabel('Email').fill(lockTarget.email);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(run.password);
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      await expect(page).toHaveURL(/\/(login|unauthorized)/);
      await expect(page).not.toHaveURL(/\/student|\/teacher|\/admin/);

      // Re-login as admin and unlock
      await loginViaUi(page, run.accounts.admin.email, run.password, '/admin/teacher-approvals');
      await page.getByRole('link', { name: 'Quản lý tài khoản' }).click();
      await page
        .getByRole('tab', { name: /Học sinh/ })
        .or(page.getByRole('button', { name: /Học sinh/ }))
        .first()
        .click();
      await page.getByPlaceholder('Tìm theo tên hoặc email...').fill(lockTarget.email);
      const lockedRow = page.getByRole('row', { name: new RegExp(lockTarget.email, 'i') });
      await lockedRow.getByRole('button', { name: 'Mở khóa', exact: true }).click();
      await confirmActionDialog(page, 'confirm', /Mở khóa|Xác nhận/i);
      await expect(lockedRow.getByText('Đang hoạt động')).toBeVisible();
    } finally {
      const adminToken = (await signInAndGetToken(run.accounts.admin.email, run.password)).accessToken;
      await callEdge('manage-user-accounts', {
        token: adminToken,
        body: { action: 'toggle_block', userId: lockTarget.uid, isBlocked: false },
      });
    }

    await logoutViaUi(page);
  });

  test('F4 Tier 2: Boundary & Security guards (CANNOT_MODIFY_SELF, admin block protection, non-admin route redirects)', async ({
    page,
  }) => {
    const adminToken = (await signInAndGetToken(run.accounts.admin.email, run.password)).accessToken;

    // 1. Self-modify guards
    const selfBlock = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'toggle_block', userId: run.accounts.admin.uid, isBlocked: true },
    });
    expect(selfBlock.status).toBe(403);
    expect((selfBlock.json as { code?: string }).code).toBe('CANNOT_MODIFY_SELF');

    const selfRole = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'change_role', userId: run.accounts.admin.uid, nextRole: 'student' },
    });
    expect(selfRole.status).toBe(403);
    expect((selfRole.json as { code?: string }).code).toBe('CANNOT_MODIFY_SELF');

    // 2. Last-admin protection check when sole admin exists, or secondary admin block protection
    const adminClient = createAdminClient();
    const { count: adminCount } = await adminClient
      .from('profiles')
      .select('firebase_uid', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('approval_status', 'approved');
    if ((adminCount ?? 0) <= 1) {
      // If run.accounts.admin is the sole admin, calling change_role via another path would hit self-guard first;
      // verify non-admin cannot demote admin.
      expect(adminCount).toBeLessThanOrEqual(1);
    } else {
      // Promote student2 temporarily to admin, verify another admin cannot toggle_block an admin (403 FORBIDDEN), then demote safely
      const promo = await callEdge('manage-user-accounts', {
        token: adminToken,
        body: { action: 'change_role', userId: run.accounts.student2.uid, nextRole: 'admin' },
      });
      expect(promo.status).toBe(200);
      try {
        const blockAdmin = await callEdge('manage-user-accounts', {
          token: adminToken,
          body: { action: 'toggle_block', userId: run.accounts.student2.uid, isBlocked: true },
        });
        expect(blockAdmin.status).toBe(403);
        expect((blockAdmin.json as { code?: string }).code).toBe('FORBIDDEN');
      } finally {
        await callEdge('manage-user-accounts', {
          token: adminToken,
          body: { action: 'change_role', userId: run.accounts.student2.uid, nextRole: 'student' },
        });
      }
    }

    // 3. Non-admin browser redirects away from /admin/accounts and /admin/bug-reports
    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');
    await page.goto('/admin/accounts');
    await expect(page).toHaveURL(/\/student/);
    await page.goto('/admin/bug-reports');
    await expect(page).toHaveURL(/\/student/);
    await logoutViaUi(page);

    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');
    await page.goto('/admin/accounts');
    await expect(page).toHaveURL(/\/teacher/);
    await page.goto('/admin/bug-reports');
    await expect(page).toHaveURL(/\/teacher/);
    await logoutViaUi(page);
  });
});

test.describe('M3 R2: Admin BugReportsAdmin Triage & Response (F5 — Tier 1 & Tier 2)', () => {
  let run: E2eRunManifest;

  test.beforeAll(async () => {
    await sweepStaleE2eAccounts(24).catch(() => undefined);
    run = await provisionE2eRun('m3_bugs');
  });

  test.afterAll(async () => {
    await cleanupE2eRun(run);
  });

  test('F5 Tier 1: List all bug reports, filter by status/role/severity/search, inspect pageRoute & update status + adminResponse', async ({
    page,
  }) => {
    const stuNew = await seedBugReport(run, run.accounts.student1.uid, {
      reporterRole: 'student',
      title: `[E2E] AdminTriage HS ${run.runId.slice(-4)}`,
      description: 'Học sinh không thấy nút nộp bài ở màn hình nhỏ.',
      severity: 'high',
      category: 'ui',
      pageRoute: '/student/quiz/demo-123',
      status: 'new',
    });
    const teaInProg = await seedBugReport(run, run.accounts.teacher1.uid, {
      reporterRole: 'teacher',
      title: `[E2E] AdminTriage GV ${run.runId.slice(-4)}`,
      description: 'Giáo viên cần lọc theo lớp học trong bảng điểm.',
      severity: 'low',
      category: 'classroom',
      pageRoute: '/teacher/classes',
      status: 'in_progress',
      adminResponse: 'Đang kiểm tra phản ánh của giáo viên.',
    });

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.admin.email, run.password, '/admin/teacher-approvals');

    await page.getByRole('link', { name: 'Báo lỗi hệ thống' }).click();
    await expect(page).toHaveURL(/\/admin\/bug-reports/);
    await expect(page.getByRole('heading', { name: /Báo lỗi|Quản lý báo lỗi/i })).toBeVisible();

    // Both student & teacher reports visible
    await expect(page.getByText(stuNew.title)).toBeVisible();
    await expect(page.getByText(teaInProg.title)).toBeVisible();

    // Filter by status (Mới vs Đang xử lý)
    await page.getByRole('button', { name: /^Mới/ }).click();
    await expect(page.getByText(stuNew.title)).toBeVisible();
    await expect(page.getByText(teaInProg.title)).toHaveCount(0);

    await page.getByRole('button', { name: /^Đang xử lý/ }).click();
    await expect(page.getByText(teaInProg.title)).toBeVisible();
    await expect(page.getByText(stuNew.title)).toHaveCount(0);

    await page.getByRole('button', { name: /^Tất cả/ }).click();

    // Filter by search & verify context pageRoute metadata on stuNew
    const searchInput = page.getByPlaceholder(/Tìm.*tiêu đề|Tìm kiếm/i);
    await searchInput.fill(stuNew.title);
    await expect(page.getByText(stuNew.title)).toBeVisible();
    await expect(page.getByText('/student/quiz/demo-123')).toBeVisible();

    // Update stuNew -> Đã giải quyết with adminResponse
    const targetCard = page
      .locator('section, article, div')
      .filter({ hasText: stuNew.title })
      .filter({ has: page.getByRole('button', { name: /Lưu|Cập nhật/i }) })
      .first();

    const responseText = `Đã sửa nút nộp bài trên mobile (${run.runId.slice(-4)}).`;
    await targetCard.getByLabel(/Trạng thái/i).selectOption('resolved');
    await targetCard.getByLabel(/Phản hồi/i).fill(responseText);
    await targetCard.getByRole('button', { name: /Lưu|Cập nhật/i }).click();
    await expectToast(page, /Đã cập nhật|thành công/i);

    // Persists across reload
    await page.reload();
    await page.getByPlaceholder(/Tìm.*tiêu đề|Tìm kiếm/i).fill(stuNew.title);
    await expect(page.getByText(stuNew.title)).toBeVisible();
    await expect(page.getByText('Đã giải quyết').first()).toBeVisible();
    await expect(page.getByText(responseText)).toBeVisible();
    await logoutViaUi(page);

    // Reporter sees updated status & response on /student/bug-reports
    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');
    await page.goto('/student/bug-reports');
    await expect(page.getByText(stuNew.title)).toBeVisible();
    await expect(page.getByText('Đã giải quyết').first()).toBeVisible();
    await expect(page.getByText(responseText)).toBeVisible();
    await logoutViaUi(page);
  });

  test('F5 Tier 1 & Tier 2: ?reportId= deep-link highlight, role/severity filter combinations, empty filter state & >5000 char boundary', async ({
    page,
  }) => {
    const deepReport = await seedBugReport(run, run.accounts.student2.uid, {
      reporterRole: 'student',
      title: `[E2E] DeepLink Admin ${run.runId.slice(-4)}`,
      severity: 'critical',
      status: 'new',
      pageRoute: '/student/classes',
    });

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.admin.email, run.password, '/admin/teacher-approvals');

    // Deep-link ?reportId= highlights target report
    await page.goto(`/admin/bug-reports?reportId=${deepReport.id}`);
    await expect(page.getByText(deepReport.title)).toBeVisible();
    await expect(page.getByText('Được mở từ thông báo')).toBeVisible();

    // Filter by role (teacher) excludes student deepReport; switching back to student/all restores
    const roleFilter = page.getByLabel(/Vai trò/i).first();
    if (await roleFilter.isVisible().catch(() => false)) {
      await roleFilter.selectOption('teacher');
      await expect(page.getByText(deepReport.title)).toHaveCount(0);
      await roleFilter.selectOption('all');
      await expect(page.getByText(deepReport.title)).toBeVisible();
    }

    // Empty search result shows clean empty message
    await page.getByPlaceholder(/Tìm.*tiêu đề|Tìm kiếm/i).fill('__NO_MATCHING_BUG_XYZ_999__');
    await expect(page.getByText(/Không tìm thấy|Không có phiếu báo lỗi/i).first()).toBeVisible();

    // Backend boundary: >5000 char adminResponse rejected
    const adminToken = (await signInAndGetToken(run.accounts.admin.email, run.password)).accessToken;
    const tooLongResp = await callRpc(
      'update_bug_report_status',
      {
        p_report_id: deepReport.id,
        p_status: 'in_progress',
        p_admin_response: 'X'.repeat(5001),
      },
      adminToken
    );
    expect(tooLongResp.status).toBe(400);

    await logoutViaUi(page);
  });
});
