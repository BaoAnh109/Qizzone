import { test, expect } from '@playwright/test';
import {
  addClassroomMembers,
  callEdge,
  callRpc,
  cleanupE2eRun,
  createAdminClient,
  createExtraStudent,
  provisionE2eRun,
  seedAssignment,
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
import { buildRosterXlsxInputFile } from './helpers/xlsxFixture';

test.describe('Tier 3: Cross-Feature Pairwise Workflows (>= 12 interactions)', () => {
  let run: E2eRunManifest;

  test.beforeAll(async () => {
    await sweepStaleE2eAccounts(24).catch(() => undefined);
    run = await provisionE2eRun('tier3_pw');
  });

  test.afterAll(async () => {
    await cleanupE2eRun(run);
  });

  test('Pairwise A (F7+F1+F2+F10): Excel .xlsx pending_invite -> new student signup/bootstrap auto-activates -> classroom_joined notification -> lands on /student/classes/:classId', async ({
    page,
  }) => {
    const classroom = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Pairwise A Lớp ${run.runId.slice(-4)}`,
    });
    const invitedEmail = `${run.runId}_pw_a_stu@e2e.qizzone.test`;

    // Teacher imports .xlsx containing invitedEmail (not yet registered -> pending_invite)
    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');
    await page.goto(`/teacher/classes/${classroom.id}`);

    const importBtn = page.getByRole('button', { name: /Nhập.*Excel|Import Excel|Nhập danh sách/i });
    if (await importBtn.isVisible().catch(() => false)) {
      await importBtn.click();
    }
    const xlsx = await buildRosterXlsxInputFile([
      ['STT', 'Email'],
      ['1', invitedEmail],
    ]);
    await page.locator('input[type="file"]').first().setInputFiles(xlsx);
    await expect(page.getByText(invitedEmail)).toBeVisible();
    await page.getByRole('button', { name: /Xác nhận nhập|Nhập \d+ email|Thêm vào lớp/i }).click();
    await expectToast(page, /thành công|Đã thêm|Đã nhập/i);
    await logoutViaUi(page);

    // Simulate confirmed new student signup + bootstrap-profile
    const admin = createAdminClient();
    const { data: createdAuth, error: createAuthErr } = await admin.auth.admin.createUser({
      email: invitedEmail,
      password: run.password,
      email_confirm: true,
      user_metadata: { full_name: 'Học Sinh Mới Pairwise A' },
    });
    expect(createAuthErr).toBeNull();
    run.extraUids.push(createdAuth!.user!.id);

    const newStuToken = (await signInAndGetToken(invitedEmail, run.password)).accessToken;
    const bootRes = await callEdge('bootstrap-profile', {
      token: newStuToken,
      body: { fullName: 'Học Sinh Mới Pairwise A', overwriteName: true },
    });
    expect(bootRes.status).toBe(200);

    // Student logs in -> sees classroom_joined notification -> clicks -> lands on /student/classes/:classId
    await loginViaUi(page, invitedEmail, run.password, '/student');
    await page.getByRole('button', { name: /Thông báo \(1 chưa đọc\)|Thông báo/ }).click();
    const popover = page.getByRole('dialog', { name: 'Danh sách thông báo' });
    await expect(popover.getByText(new RegExp(classroom.name))).toBeVisible();
    await popover.getByRole('button', { name: new RegExp(classroom.name) }).click();
    await expect(page).toHaveURL(new RegExp(`/student/classes/${classroom.id}$`), { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: classroom.name })).toBeVisible();
    await logoutViaUi(page);
  });

  test('Pairwise B (F8+F9+F2+F11): class_only + after_close + allow_late -> quiz_assigned notif -> late exam -> Result redacted -> Teacher closes quiz -> revealed & tracked Nộp muộn', async ({
    page,
  }) => {
    const classroom = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Pairwise B Lớp ${run.runId.slice(-4)}`,
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
      title: `[E2E] Pairwise B Đề ${run.runId.slice(-4)}`,
      settings: {
        publishScope: 'class_only',
        scoreVisibility: 'after_close',
        answerVisibility: 'after_close',
      },
    });

    // Teacher assigns via RPC (triggers quiz_assigned notification) with past dueAt & allow_late
    const t1Token = (await signInAndGetToken(run.accounts.teacher1.email, run.password)).accessToken;
    const pastDue = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const assignRes = await callRpc(
      'assign_quiz_to_classrooms',
      {
        p_quiz_id: quiz.id,
        p_assignments: [
          {
            classroomId: classroom.id,
            dueAt: pastDue,
            latePolicy: 'allow_late',
          },
        ],
      },
      t1Token
    );
    expect(assignRes.status).toBe(200);
    const assignmentId = (assignRes.json as Array<{ id: string }>)[0].id;

    // Student1 clicks quiz_assigned notification -> navigates to /student/classes/:classId -> starts late exam
    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');
    await page.getByRole('button', { name: /Thông báo/ }).click();
    await page
      .getByRole('dialog', { name: 'Danh sách thông báo' })
      .getByRole('button', { name: new RegExp(quiz.title) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/student/classes/${classroom.id}$`), { timeout: 15_000 });

    await page.goto(`/student/quiz/${quiz.id}/lobby?assignmentId=${assignmentId}`);
    await expect(page.getByText(/nộp muộn|Quá hạn/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Bắt đầu làm bài thi ngay' }).click();
    await expect(page).toHaveURL(new RegExp(`/student/quiz/${quiz.id}$`), { timeout: 20_000 });
    await page.getByRole('button', { name: /10/ }).first().click();
    await page.getByRole('button', { name: 'Hoàn tất & Nộp bài' }).click();
    await page.getByRole('button', { name: 'Nộp bài ngay' }).click();
    await expect(page).toHaveURL(/\/student\/result\//, { timeout: 20_000 });

    await expect(page.getByText('Nộp muộn').first()).toBeVisible();
    await expect(page.getByText('Đã nộp bài (Điểm đang được ẩn)')).toBeVisible();
    await expect(page.getByText('Không hiển thị xem lại bài làm')).toBeVisible();

    // Teacher closes quiz -> student refreshes Result -> revealed!
    await callRpc('set_quiz_status', { p_id: quiz.id, p_status: 'closed' }, t1Token);
    await page.reload();
    await expect(page.getByText('Đã nộp bài (Điểm đang được ẩn)')).toHaveCount(0);
    await expect(page.getByText('Chi tiết câu hỏi và đáp án')).toBeVisible();
    await logoutViaUi(page);

    // Teacher tracking matrix shows Nộp muộn for student1
    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');
    await page.goto(`/teacher/quiz/${quiz.id}/results`);
    await expect(page.getByText(run.accounts.student1.fullName).first()).toBeVisible();
    await expect(page.getByText('Nộp muộn').first()).toBeVisible();
    await logoutViaUi(page);
  });

  test('Pairwise C (F3+F2+F5): Student bug report -> Admin notification deep-link -> in_progress -> resolved + response -> Student notification deep-link', async ({
    page,
  }) => {
    const bugTitle = `[E2E] Pairwise C Bug ${run.runId.slice(-4)}`;
    const adminReply = `Đã xử lý triệt để (${run.runId.slice(-4)}).`;

    // 1. Student submits bug report from /student/classes
    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.student2.email, run.password, '/student');
    await page.goto('/student/classes');
    await page.getByRole('button', { name: 'Báo lỗi hệ thống' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel(/Tiêu đề lỗi/).fill(bugTitle);
    await modal.getByLabel(/Mô tả chi tiết/).fill('Mô tả lỗi pairwise C để kiểm thử thông báo hai chiều.');
    await modal.getByRole('button', { name: 'Gửi báo lỗi' }).click();
    await expectToast(page, /Đã gửi phiếu báo lỗi/);
    await logoutViaUi(page);

    // 2. Admin receives bug_report_created notification -> clicks -> lands on /admin/bug-reports?reportId=...
    await loginViaUi(page, run.accounts.admin.email, run.password, '/admin/teacher-approvals');
    await page.getByRole('button', { name: /Thông báo/ }).click();
    await page
      .getByRole('dialog', { name: 'Danh sách thông báo' })
      .getByRole('button', { name: new RegExp(bugTitle) })
      .click();
    await expect(page).toHaveURL(/\/admin\/bug-reports\?reportId=/, { timeout: 15_000 });
    await expect(page.getByText('Được mở từ thông báo')).toBeVisible();

    const card = page
      .locator('section, article, div')
      .filter({ hasText: bugTitle })
      .filter({ has: page.getByRole('button', { name: /Lưu|Cập nhật/i }) })
      .first();
    await card.getByLabel(/Trạng thái/i).selectOption('in_progress');
    await card.getByRole('button', { name: /Lưu|Cập nhật/i }).click();
    await expectToast(page, /Đã cập nhật|thành công/i);

    await card.getByLabel(/Trạng thái/i).selectOption('resolved');
    await card.getByLabel(/Phản hồi/i).fill(adminReply);
    await card.getByRole('button', { name: /Lưu|Cập nhật/i }).click();
    await expectToast(page, /Đã cập nhật|thành công/i);
    await logoutViaUi(page);

    // 3. Student receives bug_report_updated notification -> clicks -> lands on /student/bug-reports?reportId=...
    await loginViaUi(page, run.accounts.student2.email, run.password, '/student');
    await page.getByRole('button', { name: /Thông báo/ }).click();
    await page
      .getByRole('dialog', { name: 'Danh sách thông báo' })
      .getByRole('button', { name: new RegExp(bugTitle) })
      .click();
    await expect(page).toHaveURL(/\/student\/bug-reports\?reportId=/, { timeout: 15_000 });
    await expect(page.getByText('Được mở từ thông báo')).toBeVisible();
    await expect(page.getByText('Đã giải quyết').first()).toBeVisible();
    await expect(page.getByText(adminReply)).toBeVisible();
    await logoutViaUi(page);
  });

  test('Pairwise D (F4+F2+F1+F6+F8): Admin approves pending teacher -> user clicks teacher_approval notif in student mode -> auto-switches to teacher -> creates classroom & quiz', async ({
    page,
  }) => {
    const applicant = await createExtraStudent(run, 'pw_d_applicant', {
      teacherRequestStatus: 'pending',
    });

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.admin.email, run.password, '/admin/teacher-approvals');
    const appCard = page
      .locator('section, article, div')
      .filter({ hasText: applicant.email })
      .filter({ has: page.getByRole('button', { name: 'Phê duyệt' }) })
      .first();
    await appCard.getByRole('button', { name: 'Phê duyệt' }).click();
    await expect(page.getByText(applicant.email)).toHaveCount(0);
    await logoutViaUi(page);

    // Applicant logs in as student, clicks teacher_approval notification -> auto-switches to /teacher -> creates classroom
    await loginViaUi(page, applicant.email, run.password, '/student');
    await page.getByRole('button', { name: /Thông báo/ }).click();
    await page
      .getByRole('dialog', { name: 'Danh sách thông báo' })
      .getByRole('button', { name: /giáo viên|phê duyệt/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/teacher$/, { timeout: 20_000 });

    const newClassName = `[E2E] Dual Teacher Class ${run.runId.slice(-4)}`;
    await page.getByRole('link', { name: 'Lớp học' }).click();
    await page.getByRole('button', { name: /Tạo lớp/i }).first().click();
    const clsModal = page.getByRole('dialog');
    await clsModal.getByLabel(/Tên lớp/i).fill(newClassName);
    await clsModal.getByRole('button', { name: /Tạo lớp|Lưu/i }).click();
    await expect(page.getByText(newClassName)).toBeVisible();

    const newQuizTitle = `[E2E] Dual Teacher Quiz ${run.runId.slice(-4)}`;
    await page.goto('/teacher/create-quiz');
    await page.getByRole('button', { name: 'Bắt đầu soạn đề thủ công' }).click();
    await page.getByPlaceholder(/Kiểm tra 1 tiết/).fill(newQuizTitle);
    await page.getByRole('button', { name: /3\. Cấu hình phòng thi/ }).click();
    await page.getByRole('button', { name: 'Xuất bản bài thi ngay' }).click();
    await expect(page).toHaveURL(/\/teacher\/quizzes/, { timeout: 20_000 });
    await expect(page.getByText(newQuizTitle)).toBeVisible();

    await logoutViaUi(page);
  });

  test('Pairwise E (F6+F10+F12): Rotate invite code & remove student -> old code & class_only access blocked -> re-join with new code restores access', async ({
    page,
  }) => {
    const classroom = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Pairwise E Lớp ${run.runId.slice(-4)}`,
    });
    const oldCode = classroom.inviteCode;
    await addClassroomMembers(classroom.id, [
      {
        email: run.accounts.student3.email,
        studentUid: run.accounts.student3.uid,
        memberName: run.accounts.student3.fullName,
        status: 'active',
        joinedVia: 'code',
      },
    ]);
    const classQuiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Pairwise E Đề ${run.runId.slice(-4)}`,
      settings: { publishScope: 'class_only' },
    });
    await seedAssignment(classroom.id, classQuiz.id, { assignedBy: run.accounts.teacher1.uid });

    // Teacher rotates code & removes student3
    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');
    await page.goto(`/teacher/classes/${classroom.id}`);

    await page.getByRole('button', { name: /Đổi mã|Tạo mã mới/i }).click();
    await confirmActionDialog(page, 'confirm', /Xác nhận|Đổi mã|Tạo mã mới/i);
    await expectToast(page, /mã mời|mã lớp/i);

    const s3Row = page
      .locator('tr, li, div')
      .filter({ hasText: run.accounts.student3.email })
      .filter({ has: page.getByRole('button', { name: /Xóa/i }) })
      .first();
    await s3Row.getByRole('button', { name: /Xóa/i }).click();
    await confirmActionDialog(page, 'confirm', /Xóa|Xác nhận/i);
    await expect(page.getByText(run.accounts.student3.email)).toHaveCount(0);
    await logoutViaUi(page);

    const admin = createAdminClient();
    const { data: updatedCls } = await admin
      .from('classrooms')
      .select('invite_code')
      .eq('id', classroom.id)
      .single();
    const newCode = updatedCls!.invite_code;
    expect(newCode).not.toBe(oldCode);

    // Student3: blocked from class_only quiz & class detail, old code fails, new code restores access
    await loginViaUi(page, run.accounts.student3.email, run.password, '/student');
    await page.goto(`/student/quiz/${classQuiz.id}/lobby`);
    await expect(page.getByText(/chỉ dành cho lớp học|Không tìm thấy/i).first()).toBeVisible();

    await page.goto('/student/classes');
    const codeInput = page.getByPlaceholder(/Nhập mã lớp|VD:/i).or(page.getByLabel(/Mã lớp/i)).first();
    const joinBtn = page.getByRole('button', { name: /Tham gia/i }).first();

    await codeInput.fill(oldCode);
    await joinBtn.click();
    await expect(page.getByText(/Không tìm thấy lớp học/i).first()).toBeVisible();

    await codeInput.fill(newCode);
    await joinBtn.click();
    await expectToast(page, /thành công|Đã tham gia/i);
    await expect(page.getByText(classroom.name)).toBeVisible();

    await page.goto(`/student/quiz/${classQuiz.id}/lobby`);
    await expect(page.getByRole('button', { name: 'Bắt đầu làm bài thi ngay' })).toBeVisible();
    await logoutViaUi(page);
  });
});

test.describe('Tier 4: Real-World Multi-Role End-to-End Application Journeys', () => {
  let run: E2eRunManifest;

  test.beforeAll(async () => {
    await sweepStaleE2eAccounts(24).catch(() => undefined);
    run = await provisionE2eRun('tier4_e2e');
  });

  test.afterAll(async () => {
    await cleanupE2eRun(run);
  });

  test('Journey 1 (Full 10-step): Excel import pending_invite -> student signup auto-activation -> assignment notif -> deep-link -> late exam -> teacher tracking -> student bug -> admin resolves -> student deep-link', async ({
    page,
  }) => {
    const t1Token = (await signInAndGetToken(run.accounts.teacher1.email, run.password)).accessToken;
    const classroom = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Journey1 Lớp ${run.runId.slice(-4)}`,
    });
    const invitedEmail = `${run.runId}_j1_student@e2e.qizzone.test`;

    // Step 1: Teacher imports Excel with pending_invite
    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');
    await page.goto(`/teacher/classes/${classroom.id}`);
    const importBtn = page.getByRole('button', { name: /Nhập.*Excel|Import Excel|Nhập danh sách/i });
    if (await importBtn.isVisible().catch(() => false)) {
      await importBtn.click();
    }
    const xlsx = await buildRosterXlsxInputFile([['Email'], [invitedEmail]]);
    await page.locator('input[type="file"]').first().setInputFiles(xlsx);
    await page.getByRole('button', { name: /Xác nhận nhập|Nhập \d+ email|Thêm vào lớp/i }).click();
    await expectToast(page, /thành công|Đã thêm|Đã nhập/i);
    await logoutViaUi(page);

    // Step 2: New student registers/bootstraps -> auto-activated in classroom
    const admin = createAdminClient();
    const { data: stuAuth } = await admin.auth.admin.createUser({
      email: invitedEmail,
      password: run.password,
      email_confirm: true,
      user_metadata: { full_name: 'Học Sinh Journey 1' },
    });
    run.extraUids.push(stuAuth!.user!.id);
    const stuToken = (await signInAndGetToken(invitedEmail, run.password)).accessToken;
    await callEdge('bootstrap-profile', {
      token: stuToken,
      body: { fullName: 'Học Sinh Journey 1', overwriteName: true },
    });

    // Step 3: Teacher creates & assigns quiz past dueAt (allow_late) -> emits quiz_assigned notification
    const quiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Journey1 Đề ${run.runId.slice(-4)}`,
      settings: { publishScope: 'class_only', scoreVisibility: 'immediate', answerVisibility: 'immediate' },
    });
    const pastDue = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const assignRes = await callRpc(
      'assign_quiz_to_classrooms',
      {
        p_quiz_id: quiz.id,
        p_assignments: [{ classroomId: classroom.id, dueAt: pastDue, latePolicy: 'allow_late' }],
      },
      t1Token
    );
    const assignmentId = (assignRes.json as Array<{ id: string }>)[0].id;

    // Step 4 & 5: Student logs in, clicks notification deep-link -> enters QuizRoom -> submits late
    await loginViaUi(page, invitedEmail, run.password, '/student');
    await page.getByRole('button', { name: /Thông báo/ }).click();
    await page
      .getByRole('dialog', { name: 'Danh sách thông báo' })
      .getByRole('button', { name: new RegExp(quiz.title) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/student/classes/${classroom.id}$`), { timeout: 15_000 });

    await page.goto(`/student/quiz/${quiz.id}/lobby?assignmentId=${assignmentId}`);
    await page.getByRole('button', { name: 'Bắt đầu làm bài thi ngay' }).click();
    await expect(page).toHaveURL(new RegExp(`/student/quiz/${quiz.id}$`), { timeout: 20_000 });
    await page.getByRole('button', { name: /10/ }).first().click();
    await page.getByRole('button', { name: 'Hoàn tất & Nộp bài' }).click();
    await page.getByRole('button', { name: 'Nộp bài ngay' }).click();
    await expect(page).toHaveURL(/\/student\/result\//, { timeout: 20_000 });
    await expect(page.getByText('Nộp muộn').first()).toBeVisible();

    // Step 6 & 7: Student reports a bug on Result page
    const j1BugTitle = `[E2E] Journey1 Bug ${run.runId.slice(-4)}`;
    await page.getByRole('button', { name: 'Báo lỗi hệ thống' }).click();
    const bugModal = page.getByRole('dialog');
    await bugModal.getByLabel(/Tiêu đề lỗi/).fill(j1BugTitle);
    await bugModal.getByLabel(/Mô tả chi tiết/).fill('Mô tả sự cố hiển thị chi tiết câu hỏi sau khi nộp muộn.');
    await bugModal.getByRole('button', { name: 'Gửi báo lỗi' }).click();
    await expectToast(page, /Đã gửi phiếu báo lỗi/);
    await logoutViaUi(page);

    // Step 8: Teacher verifies student in QuizResultsView tracking matrix as Nộp muộn
    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');
    await page.goto(`/teacher/quiz/${quiz.id}/results`);
    await expect(page.getByText('Học Sinh Journey 1').first()).toBeVisible();
    await expect(page.getByText('Nộp muộn').first()).toBeVisible();
    await logoutViaUi(page);

    // Step 9: Admin resolves the bug report with response
    await loginViaUi(page, run.accounts.admin.email, run.password, '/admin/teacher-approvals');
    await page.getByRole('button', { name: /Thông báo/ }).click();
    await page
      .getByRole('dialog', { name: 'Danh sách thông báo' })
      .getByRole('button', { name: new RegExp(j1BugTitle) })
      .click();
    await expect(page).toHaveURL(/\/admin\/bug-reports\?reportId=/, { timeout: 15_000 });

    const adminReply = `Đã kiểm tra và xử lý xong cho Journey 1 (${run.runId.slice(-4)}).`;
    const bugCard = page
      .locator('section, article, div')
      .filter({ hasText: j1BugTitle })
      .filter({ has: page.getByRole('button', { name: /Lưu|Cập nhật/i }) })
      .first();
    await bugCard.getByLabel(/Trạng thái/i).selectOption('resolved');
    await bugCard.getByLabel(/Phản hồi/i).fill(adminReply);
    await bugCard.getByRole('button', { name: /Lưu|Cập nhật/i }).click();
    await expectToast(page, /Đã cập nhật|thành công/i);
    await logoutViaUi(page);

    // Step 10: Student receives bug_report_updated notification -> clicks deep-link -> sees resolved response
    await loginViaUi(page, invitedEmail, run.password, '/student');
    await page.getByRole('button', { name: /Thông báo/ }).click();
    await page
      .getByRole('dialog', { name: 'Danh sách thông báo' })
      .getByRole('button', { name: new RegExp(j1BugTitle) })
      .click();
    await expect(page).toHaveURL(/\/student\/bug-reports\?reportId=/, { timeout: 15_000 });
    await expect(page.getByText('Được mở từ thông báo')).toBeVisible();
    await expect(page.getByText('Đã giải quyết').first()).toBeVisible();
    await expect(page.getByText(adminReply)).toBeVisible();
    await logoutViaUi(page);
  });

  test('Journey 2: Admin audits Teacher Detail Drawer (stats/classes/quizzes) -> blocks compromised account -> verifies login rejection -> unblocks', async ({
    page,
  }) => {
    const suspectTeacher = await createExtraStudent(run, 'j2_suspect', {
      teacherRequestStatus: 'approved',
    });
    const adminToken = (await signInAndGetToken(run.accounts.admin.email, run.password)).accessToken;
    await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'change_role', userId: suspectTeacher.uid, nextRole: 'teacher' },
    });

    const suspectClass = await seedClassroom(run, suspectTeacher.uid, {
      name: `[E2E] Audit Lớp ${run.runId.slice(-4)}`,
    });
    const suspectQuiz = await seedQuiz(run, suspectTeacher.uid, {
      title: `[E2E] Audit Đề ${run.runId.slice(-4)}`,
    });

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.admin.email, run.password, '/admin/teacher-approvals');
    await page.getByRole('link', { name: 'Quản lý tài khoản' }).click();

    await page
      .getByRole('tab', { name: /Giáo viên/ })
      .or(page.getByRole('button', { name: /Giáo viên/ }))
      .first()
      .click();
    await page.getByPlaceholder('Tìm theo tên hoặc email...').fill(suspectTeacher.email);
    await page.getByRole('row', { name: new RegExp(suspectTeacher.email, 'i') }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(suspectClass.name)).toBeVisible();
    await expect(drawer.getByText(suspectQuiz.title)).toBeVisible();

    try {
      await drawer.getByRole('button', { name: /Khóa tài khoản|Khóa/i }).click();
      await confirmActionDialog(page, 'confirm', /Khóa|Xác nhận/i);
      await expectToast(page, /khóa|Cập nhật/i);
      await page.keyboard.press('Escape').catch(() => undefined);
      await logoutViaUi(page);

      // Compromised teacher cannot log in
      await page.goto('/login');
      await page.getByLabel('Email').fill(suspectTeacher.email);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(run.password);
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      await expect(page).toHaveURL(/\/(login|unauthorized)/);
      await expect(page).not.toHaveURL(/\/teacher|\/student/);

      // Admin unlocks -> teacher login succeeds again
      await loginViaUi(page, run.accounts.admin.email, run.password, '/admin/teacher-approvals');
      await page.getByRole('link', { name: 'Quản lý tài khoản' }).click();
      await page
        .getByRole('tab', { name: /Giáo viên/ })
        .or(page.getByRole('button', { name: /Giáo viên/ }))
        .first()
        .click();
      await page.getByPlaceholder('Tìm theo tên hoặc email...').fill(suspectTeacher.email);
      const row = page.getByRole('row', { name: new RegExp(suspectTeacher.email, 'i') });
      await row.getByRole('button', { name: 'Mở khóa', exact: true }).click();
      await confirmActionDialog(page, 'confirm', /Mở khóa|Xác nhận/i);
      await expect(row.getByText('Đang hoạt động')).toBeVisible();
      await logoutViaUi(page);

      await loginViaUi(page, suspectTeacher.email, run.password, '/teacher');
      await expect(page.getByText('Bảng điều khiển').first()).toBeVisible();
      await logoutViaUi(page);
    } finally {
      await callEdge('manage-user-accounts', {
        token: adminToken,
        body: { action: 'toggle_block', userId: suspectTeacher.uid, isBlocked: false },
      });
    }
  });

  test('Journey 3: class_only block_after_due + after_close release -> student1 submits on time (hidden) -> student2 blocked past due -> teacher closes quiz -> student1 sees revealed score & answers', async ({
    page,
  }) => {
    const classroom = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Journey3 Lớp ${run.runId.slice(-4)}`,
    });
    await addClassroomMembers(classroom.id, [
      {
        email: run.accounts.student1.email,
        studentUid: run.accounts.student1.uid,
        memberName: run.accounts.student1.fullName,
        status: 'active',
        joinedVia: 'teacher_email',
      },
      {
        email: run.accounts.student2.email,
        studentUid: run.accounts.student2.uid,
        memberName: run.accounts.student2.fullName,
        status: 'active',
        joinedVia: 'teacher_email',
      },
    ]);

    const quiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Journey3 Đề ${run.runId.slice(-4)}`,
      settings: {
        publishScope: 'class_only',
        scoreVisibility: 'after_close',
        answerVisibility: 'after_close',
      },
    });
    const futureDue = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const assignment = await seedAssignment(classroom.id, quiz.id, {
      assignedBy: run.accounts.teacher1.uid,
      dueAt: futureDue,
      latePolicy: 'block_after_due',
    });

    // Student1 submits on time -> score & answers hidden
    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');
    await page.goto(`/student/quiz/${quiz.id}/lobby?assignmentId=${assignment.id}`);
    await page.getByRole('button', { name: 'Bắt đầu làm bài thi ngay' }).click();
    await expect(page).toHaveURL(new RegExp(`/student/quiz/${quiz.id}$`), { timeout: 20_000 });
    await page.getByRole('button', { name: /10/ }).first().click();
    await page.getByRole('button', { name: 'Hoàn tất & Nộp bài' }).click();
    await page.getByRole('button', { name: 'Nộp bài ngay' }).click();
    await expect(page).toHaveURL(/\/student\/result\//, { timeout: 20_000 });
    const s1ResultUrl = page.url();
    await expect(page.getByText('Đã nộp bài (Điểm đang được ẩn)')).toBeVisible();
    await logoutViaUi(page);

    // Move dueAt into the past -> student2 blocked by block_after_due
    const admin = createAdminClient();
    await admin
      .from('quiz_assignments')
      .update({ due_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
      .eq('id', assignment.id);

    await loginViaUi(page, run.accounts.student2.email, run.password, '/student');
    await page.goto(`/student/quiz/${quiz.id}/lobby?assignmentId=${assignment.id}`);
    const startBtn = page.getByRole('button', { name: /Bắt đầu làm bài/i });
    if (await startBtn.isVisible().catch(() => false)) {
      await startBtn.click();
    }
    await expect(page.getByText(/quá hạn|khóa nộp muộn/i).first()).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(`/student/quiz/${quiz.id}$`));
    await logoutViaUi(page);

    // Teacher closes quiz -> student1 revisits Result and sees revealed score & answers
    const t1Token = (await signInAndGetToken(run.accounts.teacher1.email, run.password)).accessToken;
    await callRpc('set_quiz_status', { p_id: quiz.id, p_status: 'closed' }, t1Token);

    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');
    await page.goto(s1ResultUrl);
    await expect(page.getByText('Đã nộp bài (Điểm đang được ẩn)')).toHaveCount(0);
    await expect(page.getByText('Chi tiết câu hỏi và đáp án')).toBeVisible();
    await logoutViaUi(page);
  });
});
