import { test, expect } from '@playwright/test';
import {
  addClassroomMembers,
  callEdge,
  callRestTable,
  callRpc,
  cleanupE2eRun,
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
  expectToast,
  loginViaUi,
  logoutViaUi,
} from './helpers/uiAuth';

test.describe('M5 R4: Student Home, Classrooms, Join Links & Roster Privacy (F10 — Tier 1 & Tier 2)', () => {
  let run: E2eRunManifest;

  test.beforeAll(async () => {
    await sweepStaleE2eAccounts(24).catch(() => undefined);
    run = await provisionE2eRun('m5_cls');
  });

  test.afterAll(async () => {
    await cleanupE2eRun(run);
  });

  test('F10 Tier 1: Join class by code & /class/join/:code link, StudentDashboard quick-join & assignments hub, ClassDetail privacy & /join/:code quiz link', async ({
    page,
  }) => {
    const classCodeJoin = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Lớp Mã ${run.runId.slice(-4)}`,
    });
    const classLinkJoin = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Lớp Link ${run.runId.slice(-4)}`,
    });
    // Add student2 to classCodeJoin BEFORE student1 joins -> verify student1 NEVER sees student2's email
    await addClassroomMembers(classCodeJoin.id, [
      {
        email: run.accounts.student2.email,
        studentUid: run.accounts.student2.uid,
        memberName: run.accounts.student2.fullName,
        status: 'active',
        joinedVia: 'teacher_email',
      },
    ]);

    const todoQuiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Bài Cần Làm ${run.runId.slice(-4)}`,
      settings: { publishScope: 'public' },
    });
    const overdueQuiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Bài Quá Hạn ${run.runId.slice(-4)}`,
    });
    const completedQuiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Bài Đã Xong ${run.runId.slice(-4)}`,
    });

    const futureDue = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    const pastDue = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    await seedAssignment(classCodeJoin.id, todoQuiz.id, {
      assignedBy: run.accounts.teacher1.uid,
      dueAt: futureDue,
      latePolicy: 'allow_late',
    });
    await seedAssignment(classCodeJoin.id, overdueQuiz.id, {
      assignedBy: run.accounts.teacher1.uid,
      dueAt: pastDue,
      latePolicy: 'allow_late',
    });
    const doneAssign = await seedAssignment(classCodeJoin.id, completedQuiz.id, {
      assignedBy: run.accounts.teacher1.uid,
      dueAt: futureDue,
      latePolicy: 'allow_late',
    });

    // 1. Unauthenticated /class/join/:code redirects to /login?redirect=... then returns to link confirmation page
    await clearBrowserAuth(page);
    await page.goto(`/class/join/${classLinkJoin.inviteCode}`);
    await expect(page.getByText(classLinkJoin.inviteCode).or(page.getByRole('button', { name: /Đăng nhập/i }))).toBeVisible();
    const loginLinkOrBtn = page.getByRole('link', { name: /Đăng nhập/i }).or(
      page.getByRole('button', { name: /Đăng nhập/i })
    );
    if (await loginLinkOrBtn.isVisible().catch(() => false)) {
      await loginLinkOrBtn.first().click();
    }
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('Email').fill(run.accounts.student1.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(run.password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/student/classes/${classLinkJoin.id}|/class/join/${classLinkJoin.inviteCode}`), {
      timeout: 20_000,
    });
    if (page.url().includes('/class/join/')) {
      const joinByLinkButton = page.getByRole('button', { name: 'Tham gia lớp' });
      if (await joinByLinkButton.isVisible().catch(() => false)) {
        await joinByLinkButton.click();
      }
      const continueToClassButton = page.getByRole('button', { name: 'Đi đến lớp học - Tham gia lớp' });
      await expect(continueToClassButton).toBeVisible({ timeout: 15_000 });
      await continueToClassButton.click();
      await expect(page).toHaveURL(new RegExp(`/student/classes/${classLinkJoin.id}`), { timeout: 20_000 });
    }

    // 2. Join second classroom via code modal on /student/classes
    await page.getByRole('link', { name: 'Lớp học của tôi' }).click();
    await expect(page).toHaveURL(/\/student\/classes$/);
    await expect(page.getByText(classLinkJoin.name)).toBeVisible();

    await page.getByRole('button', { name: 'Tham gia lớp' }).first().click();
    const joinModal = page.getByRole('dialog');
    await joinModal.getByPlaceholder(/Nhập mã lớp|VD:/i).or(joinModal.getByLabel(/Mã lớp/i)).first().fill(classCodeJoin.inviteCode);
    await joinModal.getByRole('button', { name: /Tham gia lớp/i }).click();
    await expectToast(page, /thành công|Đã tham gia/i);
    await expect(page.getByText(classCodeJoin.name)).toBeVisible();

    // Complete doneAssign via API so all 3 badges (Cần làm / Đã hoàn thành / Quá hạn) render
    const s1Token = (await signInAndGetToken(run.accounts.student1.email, run.password)).accessToken;
    const attStart = await callRpc(
      'start_attempt',
      { p_quiz_id: completedQuiz.id, p_class: '12A1', p_assignment_id: doneAssign.id },
      s1Token
    );
    const attId = (attStart.json as { id: string }).id;
    await callEdge('finalize-exam', {
      token: s1Token,
      body: { attemptId: attId, idempotencyKey: `m5_done_${attId}` },
    });

    // 3. View /student/classes/:classId -> check assignment statuses & strict peer privacy
    await page.getByText(classCodeJoin.name).first().click();
    await expect(page).toHaveURL(new RegExp(`/student/classes/${classCodeJoin.id}$`));
    await expect(page.getByText(todoQuiz.title)).toBeVisible();
    await expect(page.getByText(overdueQuiz.title)).toBeVisible();
    await expect(page.getByText(completedQuiz.title)).toBeVisible();
    await expect(page.getByText('Cần làm').first()).toBeVisible();
    await expect(page.getByText('Quá hạn').first()).toBeVisible();
    await expect(page.getByText('Đã hoàn thành').first()).toBeVisible();

    // Privacy invariant: peer email MUST NOT be visible in DOM
    await expect(page.getByText(run.accounts.student2.email)).toHaveCount(0);

    // 4. StudentDashboard preserves quick room-code join + shows assignments hub + /student/practice
    await page.goto('/student');
    await expect(page.getByText(todoQuiz.title).first()).toBeVisible();
    await page.locator('#room-code').fill(todoQuiz.code);
    await page.getByRole('button', { name: 'Vào phòng thi' }).click();
    await expect(page).toHaveURL(new RegExp(`/student/quiz/${todoQuiz.id}/lobby`));

    // 5. Public quiz join link /join/:code
    await page.goto(`/join/${todoQuiz.code}`);
    await expect(page).toHaveURL(new RegExp(`/student/quiz/${todoQuiz.id}/lobby`), { timeout: 20_000 });

    // Practice history preserved
    await page.goto('/student/practice');
    await expect(page.getByRole('heading', { name: /Lịch sử luyện tập/i, level: 1 })).toBeVisible();

    await logoutViaUi(page);
  });

  test('F10 Tier 2: Invalid/disabled/archived class code errors, outsider ClassDetail block & teacher join rejection', async ({
    page,
  }) => {
    const disabledClass = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Lớp Tắt Mời ${run.runId.slice(-4)}`,
      inviteEnabled: false,
    });
    const archivedClass = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Lớp Lưu Trữ ${run.runId.slice(-4)}`,
      isArchived: true,
    });

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.student3.email, run.password, '/student');
    await page.goto('/student/classes');

    const codeInput = page.getByPlaceholder(/Nhập mã lớp|VD:/i).or(page.getByLabel(/Mã lớp/i)).first();
    const joinBtn = page.getByRole('button', { name: /Tham gia/i }).first();

    // 1. Invalid code
    await codeInput.fill('ZZZZ99');
    await joinBtn.click();
    await expect(page.getByText(/Không tìm thấy lớp học/i).first()).toBeVisible();

    // 2. Invite disabled
    await codeInput.fill(disabledClass.inviteCode);
    await joinBtn.click();
    await expect(page.getByText(/tạm tắt lời mời/i).first()).toBeVisible();

    // 3. Archived class
    await codeInput.fill(archivedClass.inviteCode);
    await joinBtn.click();
    await expect(page.getByText(/đã được lưu trữ/i).first()).toBeVisible();

    // 4. Outsider visiting /student/classes/:id rejected
    await page.goto(`/student/classes/${disabledClass.id}`);
    await expect(page.getByText(/Không có quyền|Không tìm thấy/i).first()).toBeVisible();
    await logoutViaUi(page);

    // 5. Teacher cannot join classroom via /class/join/:code
    const activeClass = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Lớp Active ${run.runId.slice(-4)}`,
    });
    await loginViaUi(page, run.accounts.teacher2.email, run.password, '/teacher');
    await page.goto(`/class/join/${activeClass.inviteCode}`);
    await expect(page.getByText(/Chỉ tài khoản ở chế độ học sinh/i).first()).toBeVisible();
    await page.goto('/teacher');
    await logoutViaUi(page);
  });
});

test.describe('M5 R4: Exam Deadlines, Late Policies, Redaction & RLS Isolation (F11 & F12 — Tier 1 & Tier 2)', () => {
  let run: E2eRunManifest;

  test.beforeAll(async () => {
    await sweepStaleE2eAccounts(24).catch(() => undefined);
    run = await provisionE2eRun('m5_exam');
  });

  test.afterAll(async () => {
    await cleanupE2eRun(run);
  });

  test('F11 Tier 1 & Tier 2: allow_late banner & Nộp muộn badge, block_after_due rejection, future opensAt & past closesAt guards', async ({
    page,
  }) => {
    const classroom = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Lớp ExamPolicy ${run.runId.slice(-4)}`,
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

    const pastDue = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const futureOpen = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const pastClose = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const allowLateQuiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Allow Late ${run.runId.slice(-4)}`,
    });
    const allowLateAssign = await seedAssignment(classroom.id, allowLateQuiz.id, {
      assignedBy: run.accounts.teacher1.uid,
      dueAt: pastDue,
      latePolicy: 'allow_late',
    });

    const blockLateQuiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Block Late ${run.runId.slice(-4)}`,
    });
    const blockLateAssign = await seedAssignment(classroom.id, blockLateQuiz.id, {
      assignedBy: run.accounts.teacher1.uid,
      dueAt: pastDue,
      latePolicy: 'block_after_due',
    });

    const futureQuiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Future OpensAt ${run.runId.slice(-4)}`,
      settings: { publishScope: 'public', opensAt: futureOpen },
    });

    const closedWindowQuiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Past ClosesAt ${run.runId.slice(-4)}`,
      settings: { publishScope: 'public', closesAt: pastClose },
    });

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');

    // 1. Future opensAt blocked in lobby
    await page.goto(`/student/quiz/${futureQuiz.id}/lobby`);
    await expect(page.getByText(/chưa đến thời gian mở/i).first()).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(`/student/quiz/${futureQuiz.id}$`));

    // 2. Past closesAt blocked in lobby
    await page.goto(`/student/quiz/${closedWindowQuiz.id}/lobby`);
    await expect(page.getByText(/đã hết thời gian mở|đã đóng/i).first()).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(`/student/quiz/${closedWindowQuiz.id}$`));

    // 3. block_after_due past dueAt rejected cleanly (no QuizRoom entry)
    await page.goto(`/student/quiz/${blockLateQuiz.id}/lobby?assignmentId=${blockLateAssign.id}`);
    const startBlockBtn = page.getByRole('button', { name: /Bắt đầu làm bài/i });
    if (await startBlockBtn.isVisible().catch(() => false)) {
      await startBlockBtn.click();
    }
    await expect(page.getByText(/quá hạn|khóa nộp muộn/i).first()).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(`/student/quiz/${blockLateQuiz.id}$`));

    // 4. allow_late past dueAt shows late banner, enters QuizRoom, submits with "Nộp muộn" badge on Result
    await page.goto(`/student/quiz/${allowLateQuiz.id}/lobby?assignmentId=${allowLateAssign.id}`);
    await expect(page.getByText(/nộp muộn|Quá hạn/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Bắt đầu làm bài thi ngay' }).click();
    await expect(page).toHaveURL(new RegExp(`/student/quiz/${allowLateQuiz.id}\\?assignmentId=${allowLateAssign.id}$`), { timeout: 20_000 });
    await expect(page.getByText(/nộp muộn|Quá hạn/i).first()).toBeVisible();

    await page.getByRole('button', { name: /10/ }).first().click();
    await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
    await page.getByRole('button', { name: 'Nộp bài ngay' }).click();
    await page.getByRole('button', { name: /Vẫn muốn nộp bài/ }).click();
    await expect(page).toHaveURL(/\/student\/result\//, { timeout: 20_000 });
    await expect(page.getByText('Nộp muộn').first()).toBeVisible();

    await logoutViaUi(page);
  });

  test('F11 Tier 1 & Tier 2: scoreVisibility/answerVisibility (never & after_close), maxAttempts limit & class_only + RLS cross-role isolation', async ({
    page,
  }) => {
    const classroom = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Lớp Redact ${run.runId.slice(-4)}`,
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

    // 1. scoreVisibility='never' + answerVisibility='never' + maxAttempts=1 + class_only
    const neverQuiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Never Redact ${run.runId.slice(-4)}`,
      settings: {
        publishScope: 'class_only',
        scoreVisibility: 'never',
        answerVisibility: 'never',
        allowReview: false,
        maxAttempts: 1,
      },
    });
    const neverAssign = await seedAssignment(classroom.id, neverQuiz.id, {
      assignedBy: run.accounts.teacher1.uid,
    });

    // 2. after_close quiz
    const afterCloseQuiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] AfterClose UI ${run.runId.slice(-4)}`,
      settings: {
        publishScope: 'class_only',
        scoreVisibility: 'after_close',
        answerVisibility: 'after_close',
      },
    });
    const afterAssign = await seedAssignment(classroom.id, afterCloseQuiz.id, {
      assignedBy: run.accounts.teacher1.uid,
    });

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');

    // Take neverQuiz -> Result hides score & answers
    await page.goto(`/student/quiz/${neverQuiz.id}/lobby?assignmentId=${neverAssign.id}`);
    await page.getByRole('button', { name: 'Bắt đầu làm bài thi ngay' }).click();
    await expect(page).toHaveURL(new RegExp(`/student/quiz/${neverQuiz.id}`), { timeout: 20_000 });
    await page.getByRole('button', { name: /10/ }).first().click();
    await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
    await page.getByRole('button', { name: 'Nộp bài ngay' }).click();
    await page.getByRole('button', { name: /Vẫn muốn nộp bài/ }).click();
    await expect(page).toHaveURL(/\/student\/result\//, { timeout: 20_000 });

    const s1ResultUrl = page.url();
    await expect(page.getByText('Đã nộp bài (Điểm đang được ẩn)')).toBeVisible();
    await expect(page.getByText('Không hiển thị xem lại bài làm')).toBeVisible();

    // maxAttempts=1 enforced in lobby
    await page.goto(`/student/quiz/${neverQuiz.id}/lobby?assignmentId=${neverAssign.id}`);
    await expect(page.getByText(/hết lượt làm bài/i).first()).toBeVisible();

    // after_close: hidden while published, then revealed after teacher closes quiz
    const s1Token = (await signInAndGetToken(run.accounts.student1.email, run.password)).accessToken;
    const t1Token = (await signInAndGetToken(run.accounts.teacher1.email, run.password)).accessToken;
    const acStart = await callRpc(
      'start_attempt',
      { p_quiz_id: afterCloseQuiz.id, p_class: '12A1', p_assignment_id: afterAssign.id },
      s1Token
    );
    const acAttId = (acStart.json as { id: string }).id;
    const acFin = await callEdge('finalize-exam', {
      token: s1Token,
      body: { attemptId: acAttId, idempotencyKey: `m5_ac_${acAttId}` },
    });
    const acResId = (acFin.json as { id: string }).id;

    await page.goto(`/student/result/${acResId}`);
    await expect(page.getByText('Đã nộp bài (Điểm đang được ẩn)')).toBeVisible();

    await callRpc('set_quiz_status', { p_id: afterCloseQuiz.id, p_status: 'closed' }, t1Token);
    await page.reload();
    await expect(page.getByText('Đã nộp bài (Điểm đang được ẩn)')).toHaveCount(0);
    await expect(page.getByText('Chi tiết câu hỏi và đáp án')).toBeVisible();

    // Cross-role RLS isolation for student1: cannot open /teacher/classes or /admin/bug-reports
    await page.goto('/teacher/classes');
    await expect(page).toHaveURL(/\/student/);
    await page.goto('/admin/bug-reports');
    await expect(page).toHaveURL(/\/student/);
    await logoutViaUi(page);

    // Non-member student2: rejected from class_only quiz & cannot view student1's Result or REST tables
    await loginViaUi(page, run.accounts.student2.email, run.password, '/student');
    await page.goto(`/student/quiz/${neverQuiz.id}/lobby`);
    await expect(page.getByText(/chỉ dành cho lớp học|Không tìm thấy/i).first()).toBeVisible();

    await page.goto(s1ResultUrl);
    await expect(page.getByText(/Chưa tìm thấy kết quả bài thi|Không có quyền/i).first()).toBeVisible();

    const s2Token = (await signInAndGetToken(run.accounts.student2.email, run.password)).accessToken;
    const directKeys = await callRestTable('question_answer_keys?select=*', { token: s2Token });
    expect(directKeys.status).toBe(200);
    expect(directKeys.json).toEqual([]);

    const directQuizzes = await callRestTable('quizzes?select=id', { token: s2Token });
    expect([401, 403]).toContain(directQuizzes.status);

    await logoutViaUi(page);
  });
});
