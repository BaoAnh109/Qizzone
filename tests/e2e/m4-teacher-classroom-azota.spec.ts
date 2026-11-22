import { test, expect } from '@playwright/test';
import {
  addClassroomMembers,
  callEdge,
  callRpc,
  cleanupE2eRun,
  createAdminClient,
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
import {
  buildEmptyXlsxInputFile,
  buildLegacyXlsInputFile,
  buildMalformedXlsxInputFile,
  buildRosterCsvInputFile,
  buildRosterXlsxInputFile,
} from './helpers/xlsxFixture';

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test.describe('M4 R3: Teacher Classrooms & Roster Management (F6 & F7 — Tier 1 & Tier 2)', () => {
  let run: E2eRunManifest;

  test.beforeAll(async () => {
    await sweepStaleE2eAccounts(24).catch(() => undefined);
    run = await provisionE2eRun('m4_cls');
  });

  test.afterAll(async () => {
    await cleanupE2eRun(run);
  });

  test('F6 Tier 1 & Tier 2: Classroom CRUD, validation (blank & >120), invite code/link rotation, toggle inviteEnabled, archive & cross-teacher isolation', async ({
    page,
  }) => {
    const className = `[E2E] Lớp 12A1 ${run.runId.slice(-4)}`;
    const editedName = `[E2E] Lớp 12A1 Cập nhật ${run.runId.slice(-4)}`;

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');

    await page.getByRole('link', { name: 'Lớp học' }).click();
    await expect(page).toHaveURL(/\/teacher\/classes$/);
    await expect(page.getByRole('heading', { name: /Lớp học|Quản lý lớp học/i })).toBeVisible();

    // Tier 2: Blank and >120-char classroom name validation
    await page.getByRole('button', { name: /Tạo lớp/i }).first().click();
    const createModal = page.getByRole('dialog');
    await expect(createModal).toBeVisible();

    await createModal.getByLabel(/Tên lớp/i).fill('   ');
    await createModal.getByRole('button', { name: /Tạo lớp|Lưu/i }).click();
    await expect(createModal).toBeVisible();

    await createModal.getByLabel(/Tên lớp/i).fill('A'.repeat(121));
    await createModal.getByRole('button', { name: /Tạo lớp|Lưu/i }).click();
    await expect(createModal).toBeVisible();

    // Tier 1: Valid create classroom
    await createModal.getByLabel(/Tên lớp/i).fill(className);
    const subjectInput = createModal.getByLabel(/Môn học/i);
    if (await subjectInput.isVisible().catch(() => false)) {
      await subjectInput.fill('Toán');
    }
    const gradeInput = createModal.getByLabel(/Khối/i);
    if (await gradeInput.isVisible().catch(() => false)) {
      await gradeInput.fill('12');
    }
    await createModal.getByRole('button', { name: /Tạo lớp|Lưu/i }).click();
    await expectToast(page, /Tạo lớp|thành công/i);
    await expect(page.getByText(className)).toBeVisible();

    // Open ClassDetail
    await page.getByText(className).first().click();
    await expect(page).toHaveURL(/\/teacher\/classes\/[0-9a-f-]+/i);

    // Fetch created class ID & inviteCode via Supabase admin for deterministic checks
    const admin = createAdminClient();
    const { data: clsRow } = await admin
      .from('classrooms')
      .select('id, invite_code')
      .eq('teacher_uid', run.accounts.teacher1.uid)
      .eq('name', className)
      .single();
    expect(clsRow).toBeTruthy();
    run.classroomIds.push(clsRow!.id);
    const oldCode = clsRow!.invite_code;
    await expect(page.getByText(oldCode)).toBeVisible();

    // Edit classroom name
    await page.getByRole('button', { name: /Chỉnh sửa|Sửa lớp/i }).click();
    const editModal = page.getByRole('dialog');
    await editModal.getByLabel(/Tên lớp/i).fill(editedName);
    await editModal.getByRole('button', { name: /Lưu|Cập nhật/i }).click();
    await expect(page.getByRole('heading', { name: editedName })).toBeVisible();

    // Regenerate invite code -> old code becomes invalid for student1
    await page.getByRole('button', { name: /Đổi mã|Tạo mã mới/i }).click();
    await confirmActionDialog(page, 'confirm', /Xác nhận|Đổi mã|Tạo mã mới/i);
    await expectToast(page, /mã mời|mã lớp/i);

    const { data: rotatedRow } = await admin
      .from('classrooms')
      .select('invite_code')
      .eq('id', clsRow!.id)
      .single();
    expect(rotatedRow!.invite_code).not.toBe(oldCode);
    await expect(page.getByText(rotatedRow!.invite_code)).toBeVisible();

    const s1Token = (await signInAndGetToken(run.accounts.student1.email, run.password)).accessToken;
    const oldCodeRes = await callRpc(
      'join_classroom_by_code',
      { p_code: oldCode, p_via: 'code' },
      s1Token
    );
    expect(oldCodeRes.status).toBe(400);

    // Toggle inviteEnabled OFF -> student join rejected; toggle ON -> student joins
    const inviteSwitch = page
      .getByRole('switch', { name: /mời|tham gia/i })
      .or(page.getByLabel(/Cho phép.*tham gia|Bật mã mời/i))
      .first();
    await inviteSwitch.click();
    await expect(inviteSwitch).toHaveAttribute('aria-checked', 'false').catch(async () => {
      // Handle checkbox fallback if implemented as checkbox
      await expect(inviteSwitch).not.toBeChecked();
    });

    const disabledJoin = await callRpc(
      'join_classroom_by_code',
      { p_code: rotatedRow!.invite_code, p_via: 'code' },
      s1Token
    );
    expect(disabledJoin.status).toBe(400);

    await inviteSwitch.click();
    const enabledJoin = await callRpc(
      'join_classroom_by_code',
      { p_code: rotatedRow!.invite_code, p_via: 'code' },
      s1Token
    );
    expect(enabledJoin.status).toBe(200);

    // Archive classroom -> archived state visible & blocks new joins
    await page.getByRole('button', { name: /Lưu trữ lớp|Lưu trữ/i }).click();
    await confirmActionDialog(page, 'confirm', /Lưu trữ|Xác nhận/i);
    await expect(page.getByText(/Đã lưu trữ/i).first()).toBeVisible();

    const s2Token = (await signInAndGetToken(run.accounts.student2.email, run.password)).accessToken;
    const archivedJoin = await callRpc(
      'join_classroom_by_code',
      { p_code: rotatedRow!.invite_code, p_via: 'code' },
      s2Token
    );
    expect(archivedJoin.status).toBe(400);

    await logoutViaUi(page);

    // Tier 2: Cross-teacher & student access isolation
    const t2Token = (await signInAndGetToken(run.accounts.teacher2.email, run.password)).accessToken;
    const crossUpdate = await callRpc(
      'update_classroom',
      { p_id: clsRow!.id, p_name: 'Hacked Class' },
      t2Token
    );
    expect(crossUpdate.status).toBe(400);

    await loginViaUi(page, run.accounts.teacher2.email, run.password, '/teacher');
    await page.goto(`/teacher/classes/${clsRow!.id}`);
    await expect(page.getByText(/Không có quyền|Không tìm thấy/i).first()).toBeVisible();
    await logoutViaUi(page);

    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');
    await page.goto('/teacher/classes');
    await expect(page).toHaveURL(/\/student/);
    await logoutViaUi(page);
  });

  test('F7 Tier 1 & Tier 2: Add student by email (active + pending_invite), valid .xlsx & .csv import preview/confirm, remove member, and invalid file rejections', async ({
    page,
  }) => {
    const classroom = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Lớp Roster ${run.runId.slice(-4)}`,
    });
    const pendingEmail1 = `${run.runId}_invite_email@e2e.qizzone.test`;
    const pendingEmail2 = `${run.runId}_xlsx_pending@e2e.qizzone.test`;
    const csvPendingEmail = `${run.runId}_csv_pending@e2e.qizzone.test`;

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');
    await page.goto(`/teacher/classes/${classroom.id}`);
    await expect(page.getByRole('heading', { name: classroom.name })).toBeVisible();

    // 1. Add student by email: active (student1) + unknown email (pending_invite)
    await page.getByRole('button', { name: /Thêm học sinh/i }).first().click();
    const addDialog = page.getByRole('dialog');
    await expect(addDialog).toBeVisible();
    await addDialog
      .getByLabel(/Email/i)
      .fill(`${run.accounts.student1.email}\n${pendingEmail1}`);
    await addDialog.getByRole('button', { name: /Thêm|Xác nhận|Lưu/i }).click();
    await expectToast(page, /thành công|Đã thêm/i);

    await expect(page.getByText(run.accounts.student1.email)).toBeVisible();
    await expect(page.getByText(pendingEmail1)).toBeVisible();

    // 2. Boundary file rejections in Excel/CSV import: .xls, malformed .xlsx, 0-byte empty file
    const importBtn = page.getByRole('button', { name: /Nhập.*Excel|Import Excel|Nhập danh sách/i });
    if (await importBtn.isVisible().catch(() => false)) {
      await importBtn.click();
    }
    const fileInput = page.locator('input[type="file"]').first();

    // 2a. Legacy .xls rejected
    await fileInput.setInputFiles(buildLegacyXlsInputFile());
    await expect(page.getByText(/\.xls.*chưa được hỗ trợ|không hỗ trợ/i).first()).toBeVisible();

    // 2b. Malformed .xlsx rejected
    await fileInput.setInputFiles(buildMalformedXlsxInputFile());
    await expect(page.getByText(/không hợp lệ|bị hỏng/i).first()).toBeVisible();

    // 2c. Empty 0-byte .xlsx rejected
    await fileInput.setInputFiles(buildEmptyXlsxInputFile());
    await expect(page.getByText(/đang trống|không có dữ liệu/i).first()).toBeVisible();

    // 3. Valid .xlsx with header detection, multi-email cell, duplicate & invalid entry
    const xlsxFile = await buildRosterXlsxInputFile([
      ['STT', 'Họ và tên', 'Địa chỉ Email'],
      ['1', 'Student Two', `${run.accounts.student2.email}, ${pendingEmail2}`],
      ['2', 'Duplicate S2', run.accounts.student2.email.toUpperCase()],
      ['3', 'Invalid Entry', 'not-a-valid-email'],
    ]);
    await fileInput.setInputFiles(xlsxFile);
    await expect(page.getByText(run.accounts.student2.email)).toBeVisible();
    await expect(page.getByText(pendingEmail2)).toBeVisible();
    await page.getByRole('button', { name: /Xác nhận nhập|Nhập \d+ email|Thêm vào lớp/i }).click();
    await expectToast(page, /thành công|Đã thêm|Đã nhập/i);

    await expect(page.getByText(run.accounts.student2.email)).toBeVisible();
    await expect(page.getByText(pendingEmail2)).toBeVisible();

    // 4. Valid .csv with UTF-8 BOM & semicolon delimiter
    if (await importBtn.isVisible().catch(() => false)) {
      await importBtn.click();
    }
    const csvFile = buildRosterCsvInputFile(
      `\uFEFFSTT;Họ tên;Email\n1;Student Three;${run.accounts.student3.email}\n2;CSV Pending;${csvPendingEmail}\n`
    );
    await page.locator('input[type="file"]').first().setInputFiles(csvFile);
    await expect(page.getByText(run.accounts.student3.email)).toBeVisible();
    await expect(page.getByText(csvPendingEmail)).toBeVisible();
    await page.getByRole('button', { name: /Xác nhận nhập|Nhập \d+ email|Thêm vào lớp/i }).click();
    await expectToast(page, /thành công|Đã thêm|Đã nhập/i);

    // 5. Remove active student1 -> removed from roster and student1 loses get_classroom_detail access
    const s1Row = page
      .locator('tr, li, div')
      .filter({ hasText: run.accounts.student1.email })
      .filter({ has: page.getByRole('button', { name: /Xóa/i }) })
      .first();
    await s1Row.getByRole('button', { name: /Xóa/i }).click();
    await confirmActionDialog(page, 'confirm', /Xóa|Xác nhận/i);
    await expect(page.getByText(run.accounts.student1.email)).toHaveCount(0);

    const s1Token = (await signInAndGetToken(run.accounts.student1.email, run.password)).accessToken;
    const removedDetail = await callRpc('get_classroom_detail', { p_classroom_id: classroom.id }, s1Token);
    expect(removedDetail.status).toBe(400);

    // 6. Tier 2 >500 email cap guard via RPC
    const t1Token = (await signInAndGetToken(run.accounts.teacher1.email, run.password)).accessToken;
    const over500 = Array.from({ length: 501 }, (_, i) => `cap_${i}@e2e.qizzone.test`);
    const capRes = await callRpc(
      'add_classroom_members_bulk',
      { p_classroom_id: classroom.id, p_emails: over500, p_joined_via: 'excel_import' },
      t1Token
    );
    expect(capRes.status).toBe(400);

    await logoutViaUi(page);
  });
});

test.describe('M4 R3: Azota Publish Settings, Assign-to-Classroom & Tracking Matrix (F8 & F9 — Tier 1 & Tier 2)', () => {
  let run: E2eRunManifest;

  test.beforeAll(async () => {
    await sweepStaleE2eAccounts(24).catch(() => undefined);
    run = await provisionE2eRun('m4_azota');
  });

  test.afterAll(async () => {
    await cleanupE2eRun(run);
  });

  test('F8 Tier 1 & Tier 2: CreateQuiz 3-step + Azota publish settings, inverted window rejection & post-attempt updatePublishSettings', async ({
    page,
  }) => {
    const azotaTitle = `[E2E] Azota Quiz ${run.runId.slice(-4)}`;
    const now = new Date();
    const opens = new Date(now.getTime() - 10 * 60 * 1000);
    const closes = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const invertedClose = new Date(now.getTime() - 60 * 60 * 1000);

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');

    // 1. CreateQuiz Step 1 -> Step 2 -> Step 3 with Azota publish controls
    await page.goto('/teacher/create-quiz');
    await page.getByRole('button', { name: 'Bắt đầu soạn đề thủ công' }).click();
    await page.getByPlaceholder(/Kiểm tra 1 tiết/).fill(azotaTitle);

    await page.getByRole('button', { name: /2\. Xem trước đề thi/ }).click();
    await page.getByRole('button', { name: /3\. Cấu hình phòng thi/ }).click();

    // Configure Azota settings: class_only, opensAt, closesAt, maxAttempts=2, shuffle, after_close visibility
    const scopeSelect = page.getByLabel(/Phạm vi phát hành/i);
    if (await scopeSelect.isVisible().catch(() => false)) {
      await scopeSelect.selectOption('class_only');
    } else {
      await page.getByRole('radio', { name: /Chỉ lớp được giao/i }).check();
    }

    await page.getByLabel(/Thời gian mở đề/i).fill(toDatetimeLocalValue(opens));
    // Tier 2: Inverted closesAt <= opensAt rejected before publish
    await page.getByLabel(/Thời gian đóng đề/i).fill(toDatetimeLocalValue(invertedClose));
    await page.getByRole('button', { name: 'Xuất bản bài thi ngay' }).click();
    await expect(page.getByText(/phải sau thời gian mở đề/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/teacher\/create-quiz/);

    // Fix closesAt and set visibility policies
    await page.getByLabel(/Thời gian đóng đề/i).fill(toDatetimeLocalValue(closes));
    await page.getByLabel(/Số lần làm/i).fill('2');
    await page.getByLabel(/Hiển thị điểm/i).selectOption('after_close');
    await page.getByLabel(/Hiển thị đáp án/i).selectOption('never');

    await page.getByRole('button', { name: 'Xuất bản bài thi ngay' }).click();
    await expect(page).toHaveURL(/\/teacher\/quizzes/, { timeout: 20_000 });
    await expect(page.getByText(azotaTitle)).toBeVisible();

    const admin = createAdminClient();
    const { data: createdQuiz } = await admin
      .from('quizzes')
      .select('id, settings')
      .eq('teacher_uid', run.accounts.teacher1.uid)
      .eq('title', azotaTitle)
      .single();
    expect(createdQuiz).toBeTruthy();
    run.quizIds.push(createdQuiz!.id);

    // 2. Create an attempt on a seeded quiz, then verify updatePublishSettings works in QuizList even after attempts exist
    const attemptedQuiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] PostAttempt Settings ${run.runId.slice(-4)}`,
      settings: { publishScope: 'public', scoreVisibility: 'immediate', answerVisibility: 'immediate' },
    });
    const stuToken = (await signInAndGetToken(run.accounts.student1.email, run.password)).accessToken;
    const attStart = await callRpc('start_attempt', { p_quiz_id: attemptedQuiz.id, p_class: '12A1' }, stuToken);
    expect(attStart.status).toBe(200);
    const attId = (attStart.json as { id: string }).id;
    await callEdge('finalize-exam', {
      token: stuToken,
      body: { attemptId: attId, idempotencyKey: `m4_post_att_${attId}` },
    });

    await page.reload();
    const quizCard = page
      .locator('section, article, div')
      .filter({ hasText: attemptedQuiz.title })
      .filter({ has: page.getByRole('button', { name: /Cấu hình phát hành|Cài đặt Azota/i }) })
      .first();
    await quizCard.getByRole('button', { name: /Cấu hình phát hành|Cài đặt Azota/i }).click();

    const pubModal = page.getByRole('dialog');
    await expect(pubModal).toBeVisible();
    await pubModal.getByLabel(/Hiển thị điểm/i).selectOption('after_close');
    await pubModal.getByRole('button', { name: /Lưu|Cập nhật/i }).click();
    await expectToast(page, /Cập nhật.*thành công|Đã lưu/i);

    const { data: updatedQuiz } = await admin
      .from('quizzes')
      .select('settings')
      .eq('id', attemptedQuiz.id)
      .single();
    expect((updatedQuiz!.settings as Record<string, unknown>).scoreVisibility).toBe('after_close');

    // Tier 2: Cross-teacher cannot update publish settings
    const t2Token = (await signInAndGetToken(run.accounts.teacher2.email, run.password)).accessToken;
    const crossPub = await callRpc(
      'update_quiz_publish_settings',
      { p_quiz_id: attemptedQuiz.id, p_settings: { scoreVisibility: 'never' } },
      t2Token
    );
    expect(crossPub.status).toBe(400);

    await logoutViaUi(page);
  });

  test('F9 Tier 1 & Tier 2: Assign-to-Classroom modal (dueAt, latePolicy, hardCloseAt, date guard) & QuizResultsView tracking matrix + real per-question points', async ({
    page,
  }) => {
    const classroom = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] Lớp Giao Bài ${run.runId.slice(-4)}`,
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
      {
        email: run.accounts.student3.email,
        studentUid: run.accounts.student3.uid,
        memberName: run.accounts.student3.fullName,
        status: 'active',
        joinedVia: 'teacher_email',
      },
    ]);

    // Seed quiz with non-2.5 points (2đ and 3đ) to verify QuizResultsView has NO +2.5đ hardcode
    const quizForUiAssign = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Đề Giao UI ${run.runId.slice(-4)}`,
      questions: [
        {
          content: '[E2E] Câu A 2 điểm',
          options: [
            { id: 'A', content: 'Đúng' },
            { id: 'B', content: 'Sai' },
          ],
          correctAnswers: ['A'],
          points: 2,
        },
        {
          content: '[E2E] Câu B 3 điểm',
          options: [
            { id: 'A', content: 'Sai' },
            { id: 'B', content: 'Đúng' },
          ],
          correctAnswers: ['B'],
          points: 3,
        },
      ],
    });

    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');
    await page.goto('/teacher/quizzes');

    const assignCard = page
      .locator('section, article, div')
      .filter({ hasText: quizForUiAssign.title })
      .filter({ has: page.getByRole('button', { name: /Giao.*Lớp|Giao bài/i }) })
      .first();
    await assignCard.getByRole('button', { name: /Giao.*Lớp|Giao bài/i }).click();

    const assignModal = page.getByRole('dialog');
    await expect(assignModal).toBeVisible();

    // Tier 2: Submitting without selecting a classroom rejected
    await assignModal.getByRole('button', { name: /Giao bài|Xác nhận|Lưu/i }).click();
    await expect(assignModal).toBeVisible();

    // Select classroom
    await assignModal.getByLabel(new RegExp(classroom.name)).check();

    const now = new Date();
    const dueFuture = new Date(now.getTime() + 60 * 60 * 1000);
    const hardBeforeDue = new Date(now.getTime() + 30 * 60 * 1000);
    const hardAfterDue = new Date(now.getTime() + 4 * 60 * 60 * 1000);

    await assignModal.getByLabel(/Hạn nộp/i).fill(toDatetimeLocalValue(dueFuture));
    await assignModal.getByLabel(/Đóng hẳn|Hạn cuối/i).fill(toDatetimeLocalValue(hardBeforeDue));
    await assignModal.getByRole('button', { name: /Giao bài|Xác nhận|Lưu/i }).click();
    // Inverted hardCloseAt < dueAt rejected
    await expect(assignModal).toBeVisible();

    await assignModal.getByLabel(/Đóng hẳn|Hạn cuối/i).fill(toDatetimeLocalValue(hardAfterDue));
    await assignModal.getByLabel(/Chính sách nộp muộn/i).selectOption('block_after_due');
    await assignModal.getByRole('button', { name: /Giao bài|Xác nhận|Lưu/i }).click();
    await expectToast(page, /Đã giao|thành công/i);

    // Seed another quiz with past dueAt + allow_late to verify tracking matrix across all 4 states:
    // student1 = submitted_on_time (or late), student2 = in_progress, student3 = not_submitted
    const trackQuiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] Đề Tracking ${run.runId.slice(-4)}`,
      questions: [
        {
          content: '[E2E] Câu Track 3đ',
          options: [
            { id: 'A', content: 'Đúng' },
            { id: 'B', content: 'Sai' },
          ],
          correctAnswers: ['A'],
          points: 3,
        },
      ],
    });
    const pastDue = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const lateAssign = await seedAssignment(classroom.id, trackQuiz.id, {
      assignedBy: run.accounts.teacher1.uid,
      dueAt: pastDue,
      latePolicy: 'allow_late',
    });

    // student1 submits late with answer A (correct -> +3đ)
    const s1Token = (await signInAndGetToken(run.accounts.student1.email, run.password)).accessToken;
    const s1Start = await callRpc(
      'start_attempt',
      { p_quiz_id: trackQuiz.id, p_class: '12A1', p_assignment_id: lateAssign.id },
      s1Token
    );
    const s1Att = s1Start.json as { id: string };
    await callRpc(
      'save_attempt',
      {
        p_attempt_id: s1Att.id,
        p_answers: { [trackQuiz.questionIds[0]]: ['A'] },
        p_flagged: [],
        p_current_index: 0,
        p_revision: 0,
      },
      s1Token
    );
    await callEdge('finalize-exam', {
      token: s1Token,
      body: { attemptId: s1Att.id, idempotencyKey: `m4_track_s1_${s1Att.id}` },
    });

    // student2 starts attempt -> stays in_progress
    const s2Token = (await signInAndGetToken(run.accounts.student2.email, run.password)).accessToken;
    const s2Start = await callRpc(
      'start_attempt',
      { p_quiz_id: trackQuiz.id, p_class: '12A1', p_assignment_id: lateAssign.id },
      s2Token
    );
    expect(s2Start.status).toBe(200);

    // Open QuizResultsView for trackQuiz
    await page.goto(`/teacher/quiz/${trackQuiz.id}/results`);
    await expect(page.getByRole('heading', { name: new RegExp(trackQuiz.title) })).toBeVisible();

    // Tracking matrix shows student1 (Nộp muộn), student2 (Đang làm), student3 (Chưa nộp)
    await expect(page.getByText(run.accounts.student1.fullName).first()).toBeVisible();
    await expect(page.getByText('Nộp muộn').first()).toBeVisible();
    await expect(page.getByText(run.accounts.student2.fullName).first()).toBeVisible();
    await expect(page.getByText('Đang làm').first()).toBeVisible();
    await expect(page.getByText(run.accounts.student3.fullName).first()).toBeVisible();
    await expect(page.getByText('Chưa nộp').first()).toBeVisible();

    // Open student1 attempt detail -> must show real points (+3đ), NEVER hardcoded +2.5đ
    await page.getByRole('button', { name: /Xem bài/i }).first().click();
    const detailDialog = page.getByRole('dialog');
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog.getByText(/\+3(\.0+)?đ/)).toBeVisible();
    await expect(detailDialog.getByText('+2.5đ')).toHaveCount(0);

    // Tier 2: Student cannot call list_teacher_quiz_tracking
    const s1Track = await callRpc(
      'list_teacher_quiz_tracking',
      { p_quiz_id: trackQuiz.id, p_classroom_id: classroom.id },
      s1Token
    );
    expect(s1Track.status).toBe(400);

    await logoutViaUi(page);
  });
});
