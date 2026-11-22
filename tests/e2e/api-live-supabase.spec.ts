import { test, expect } from '@playwright/test';
import { loadE2eEnv } from './helpers/env';
import {
  cleanupE2eRun,
  createAdminClient,
  createExtraStudent,
  provisionE2eRun,
  signInAndGetToken,
  sweepStaleE2eAccounts,
  type E2eRunManifest,
} from './helpers/supabaseAdmin';

const ORIGIN = 'http://localhost:5173';

interface HttpResponse {
  status: number;
  ok: boolean;
  text: string;
  json: unknown;
}

async function callEdge(
  fnName: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    rawBody?: string;
    origin?: string;
  } = {}
): Promise<HttpResponse> {
  const env = loadE2eEnv();
  const headers: Record<string, string> = {
    apikey: env.publishableKey,
    Origin: options.origin ?? ORIGIN,
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const method = options.method ?? 'POST';
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    body = options.rawBody !== undefined ? options.rawBody : JSON.stringify(options.body ?? {});
  }

  const res = await fetch(`${env.supabaseUrl}/functions/v1/${fnName}`, {
    method,
    headers,
    body,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, text, json };
}

async function callRpc(
  rpcName: string,
  params: Record<string, unknown>,
  token?: string
): Promise<HttpResponse> {
  const env = loadE2eEnv();
  const headers: Record<string, string> = {
    apikey: env.publishableKey,
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, text, json };
}

async function callRestTable(
  tablePath: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {}
): Promise<HttpResponse> {
  const env = loadE2eEnv();
  const headers: Record<string, string> = {
    apikey: env.publishableKey,
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const method = options.method ?? 'GET';
  const res = await fetch(`${env.supabaseUrl}/rest/v1/${tablePath}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, text, json };
}

function buildSampleQuestions() {
  return [
    {
      content: '[E2E] Câu 1: $2 + 3 = ?$',
      type: 'single_choice',
      options: [
        { id: 'A', content: '4' },
        { id: 'B', content: '5' },
        { id: 'C', content: '6' },
        { id: 'D', content: '7' },
        { id: 'E', content: '8' },
      ],
      correctAnswers: ['B'],
      explanation: '2 + 3 = 5',
      points: 1,
    },
    {
      content: '[E2E] Câu 2: Đáp án E đúng',
      type: 'single_choice',
      options: [
        { id: 'A', content: 'Sai A' },
        { id: 'B', content: 'Sai B' },
        { id: 'C', content: 'Sai C' },
        { id: 'D', content: 'Sai D' },
        { id: 'E', content: 'Đúng E' },
      ],
      correctAnswers: ['E'],
      explanation: 'Chọn E',
      points: 1,
    },
  ];
}

test.describe.serial('Live Supabase Edge Functions, PostgREST RPCs & RLS Contracts', () => {
  let run: E2eRunManifest;
  let adminToken = '';
  let teacher1Token = '';
  let teacher2Token = '';
  let pendingTeacherToken = '';
  let student1Token = '';
  let student2Token = '';
  let student3Token = '';

  test.beforeAll(async () => {
    await sweepStaleE2eAccounts(24).catch(() => undefined);
    run = await provisionE2eRun('api');
    [
      adminToken,
      teacher1Token,
      teacher2Token,
      pendingTeacherToken,
      student1Token,
      student2Token,
      student3Token,
    ] = await Promise.all([
      signInAndGetToken(run.accounts.admin.email, run.password).then((s) => s.accessToken),
      signInAndGetToken(run.accounts.teacher1.email, run.password).then((s) => s.accessToken),
      signInAndGetToken(run.accounts.teacher2.email, run.password).then((s) => s.accessToken),
      signInAndGetToken(run.accounts.pendingTeacher.email, run.password).then((s) => s.accessToken),
      signInAndGetToken(run.accounts.student1.email, run.password).then((s) => s.accessToken),
      signInAndGetToken(run.accounts.student2.email, run.password).then((s) => s.accessToken),
      signInAndGetToken(run.accounts.student3.email, run.password).then((s) => s.accessToken),
    ]);
  });

  test.afterAll(async () => {
    await cleanupE2eRun(run);
  });

  test('A.1 bootstrap-profile Edge Function contracts & pending_invite auto-activation', async () => {
    // 200 OK for valid student
    const okRes = await callEdge('bootstrap-profile', {
      token: student1Token,
      body: { fullName: run.accounts.student1.fullName, overwriteName: false },
    });
    expect(okRes.status).toBe(200);
    const okData = okRes.json as Record<string, unknown>;
    expect(okData.firebase_uid).toBe(run.accounts.student1.uid);
    expect(okData.active_role).toBe('student');

    // 401 UNAUTHORIZED (no auth & invalid bearer)
    const noAuth = await callEdge('bootstrap-profile', { body: {} });
    expect(noAuth.status).toBe(401);
    expect((noAuth.json as Record<string, unknown>)?.code).toBe('UNAUTHORIZED');

    const badAuth = await callEdge('bootstrap-profile', { token: 'invalid-jwt', body: {} });
    expect(badAuth.status).toBe(401);

    // 405 Method not allowed
    const getRes = await callEdge('bootstrap-profile', { method: 'GET', token: student1Token });
    expect(getRes.status).toBe(405);
    expect((getRes.json as Record<string, unknown>)?.error).toBe('Method not allowed');

    // 400 INVALID_INPUT (non-JSON body)
    const badJson = await callEdge('bootstrap-profile', {
      token: student1Token,
      rawBody: '{not-json',
    });
    expect(badJson.status).toBe(400);
    expect((badJson.json as Record<string, unknown>)?.code).toBe('INVALID_INPUT');

    // 413 TOO_LARGE (> 4096 bytes)
    const largeRes = await callEdge('bootstrap-profile', {
      token: student1Token,
      body: { fullName: 'A'.repeat(4200) },
    });
    expect(largeRes.status).toBe(413);
    expect((largeRes.json as Record<string, unknown>)?.code).toBe('TOO_LARGE');

    // Blocked user returns 200 with active_role: null and does NOT self-unblock
    const blockedStudent = await createExtraStudent(run, 'blocked_boot', {
      approvalStatus: 'rejected',
    });
    const blockedTok = (await signInAndGetToken(blockedStudent.email, run.password)).accessToken;
    const blockedBoot = await callEdge('bootstrap-profile', { token: blockedTok, body: {} });
    expect(blockedBoot.status).toBe(200);
    expect((blockedBoot.json as Record<string, unknown>)?.active_role).toBeNull();
    expect((blockedBoot.json as Record<string, unknown>)?.approval_status).toBe('rejected');

    // Auto-activates pending_invite classroom row & emits classroom_joined notification
    const invitedStudent = await createExtraStudent(run, 'invited_boot');
    const invitedTok = (await signInAndGetToken(invitedStudent.email, run.password)).accessToken;

    const clsRes = await callRpc(
      'create_classroom',
      { p_name: `[E2E] Invite Boot ${run.runId}`, p_subject: 'Toán', p_grade_level: '12', p_description: '' },
      teacher1Token
    );
    expect(clsRes.status).toBe(200);
    const classroom = clsRes.json as { id: string };
    run.classroomIds.push(classroom.id);

    // Seed pending_invite directly as admin (simulating invite created before user existed or pending_invite row)
    const adminClient = createAdminClient();
    await adminClient.from('classroom_members').insert({
      classroom_id: classroom.id,
      student_uid: null,
      invited_email: invitedStudent.email.toLowerCase(),
      member_name: invitedStudent.email.split('@')[0],
      status: 'pending_invite',
      joined_via: 'excel_import',
    });

    const activateBoot = await callEdge('bootstrap-profile', {
      token: invitedTok,
      body: { fullName: invitedStudent.fullName, overwriteName: false },
    });
    expect(activateBoot.status).toBe(200);

    const notifsRes = await callRpc(
      'list_my_notifications',
      { p_limit: 20, p_unread_only: false },
      invitedTok
    );
    expect(notifsRes.status).toBe(200);
    const notifs = (notifsRes.json as { items: Array<{ type: string; targetRoute: string }> }).items;
    expect(notifs.some((n) => n.type === 'classroom_joined' && n.targetRoute === `/student/classes/${classroom.id}`)).toBe(true);
  });

  test('A.1 manage-user-accounts Edge Function contracts & RBAC', async () => {
    const targetStudent = await createExtraStudent(run, 'acct_target');

    // RBAC: student/teacher -> 403 FORBIDDEN; unauth -> 401 UNAUTHORIZED
    const unauth = await callEdge('manage-user-accounts', { body: { action: 'list' } });
    expect(unauth.status).toBe(401);
    const studentForbidden = await callEdge('manage-user-accounts', {
      token: student1Token,
      body: { action: 'list' },
    });
    expect(studentForbidden.status).toBe(403);
    expect((studentForbidden.json as Record<string, unknown>)?.code).toBe('FORBIDDEN');

    const teacherForbidden = await callEdge('manage-user-accounts', {
      token: teacher1Token,
      body: { action: 'list' },
    });
    expect(teacherForbidden.status).toBe(403);

    // Invalid action -> 400
    const badAction = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'unknown_action' },
    });
    expect(badAction.status).toBe(400);
    expect((badAction.json as Record<string, unknown>)?.code).toBe('INVALID_INPUT');

    // list
    const listRes = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'list', role: 'all', includeAdmins: true },
    });
    expect(listRes.status).toBe(200);
    const accounts = (listRes.json as { accounts: Array<Record<string, unknown>> }).accounts;
    const foundTarget = accounts.find((a) => a.firebase_uid === targetStudent.uid);
    expect(foundTarget).toBeDefined();
    expect(foundTarget).toHaveProperty('is_blocked', false);
    expect(foundTarget).toHaveProperty('quiz_count');
    expect(foundTarget).toHaveProperty('submission_count');
    expect(foundTarget).toHaveProperty('classroom_count');
    expect(foundTarget).toHaveProperty('owned_classroom_count');
    expect(foundTarget).toHaveProperty('enrolled_classroom_count');
    expect(foundTarget).toHaveProperty('base_role', 'student');
    expect(foundTarget).toHaveProperty('active_role', 'student');

    // detail
    const detailMissing = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'detail', userId: '' },
    });
    expect(detailMissing.status).toBe(400);

    const detail404 = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'detail', userId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(detail404.status).toBe(404);
    expect((detail404.json as Record<string, unknown>)?.code).toBe('PROFILE_NOT_FOUND');

    const detailRes = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'detail', userId: targetStudent.uid },
    });
    expect(detailRes.status).toBe(200);
    const detail = detailRes.json as Record<string, unknown>;
    expect(detail).toHaveProperty('profile');
    expect(detail).toHaveProperty('stats');
    expect(detail).toHaveProperty('classrooms');
    expect(detail).toHaveProperty('quizzes');
    expect(detail).toHaveProperty('recentResults');

    // toggle_block guards & roundtrip
    const selfBlock = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'toggle_block', userId: run.accounts.admin.uid, isBlocked: true },
    });
    expect(selfBlock.status).toBe(403);
    expect((selfBlock.json as Record<string, unknown>)?.code).toBe('CANNOT_MODIFY_SELF');

    const badBlockInput = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'toggle_block', userId: targetStudent.uid, isBlocked: 'yes' },
    });
    expect(badBlockInput.status).toBe(400);

    try {
      const blockRes = await callEdge('manage-user-accounts', {
        token: adminToken,
        body: { action: 'toggle_block', userId: targetStudent.uid, isBlocked: true },
      });
      expect(blockRes.status).toBe(200);
      expect(((blockRes.json as { profile: Record<string, unknown> }).profile).approval_status).toBe('rejected');
    } finally {
      const unblockRes = await callEdge('manage-user-accounts', {
        token: adminToken,
        body: { action: 'toggle_block', userId: targetStudent.uid, isBlocked: false },
      });
      expect(unblockRes.status).toBe(200);
      expect(((unblockRes.json as { profile: Record<string, unknown> }).profile).approval_status).toBe('approved');
    }

    // change_role guards & roundtrip
    const selfRole = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'change_role', userId: run.accounts.admin.uid, nextRole: 'student' },
    });
    expect(selfRole.status).toBe(403);
    expect((selfRole.json as Record<string, unknown>)?.code).toBe('CANNOT_MODIFY_SELF');

    const badRole = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'change_role', userId: targetStudent.uid, nextRole: 'superadmin' },
    });
    expect(badRole.status).toBe(400);

    try {
      const toTeacher = await callEdge('manage-user-accounts', {
        token: adminToken,
        body: { action: 'change_role', userId: targetStudent.uid, nextRole: 'teacher' },
      });
      expect(toTeacher.status).toBe(200);
      expect((toTeacher.json as { active_role: string }).active_role).toBe('teacher');
    } finally {
      const backStudent = await callEdge('manage-user-accounts', {
        token: adminToken,
        body: { action: 'change_role', userId: targetStudent.uid, nextRole: 'student' },
      });
      expect(backStudent.status).toBe(200);
      expect((backStudent.json as { active_role: string }).active_role).toBe('student');
    }

    // review_teacher guards & action
    const selfReview = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'review_teacher', userId: run.accounts.admin.uid, decision: 'approve' },
    });
    expect(selfReview.status).toBe(403);
    expect((selfReview.json as Record<string, unknown>)?.code).toBe('CANNOT_MODIFY_SELF');

    const badDecision = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'review_teacher', userId: targetStudent.uid, decision: 'maybe' },
    });
    expect(badDecision.status).toBe(400);

    const reviewReject = await callEdge('manage-user-accounts', {
      token: adminToken,
      body: { action: 'review_teacher', userId: targetStudent.uid, decision: 'reject' },
    });
    expect(reviewReject.status).toBe(200);
    expect(((reviewReject.json as { profile: Record<string, unknown> }).profile).teacher_request_status).toBe('rejected');
  });

  test('A.1 manage-teacher-approvals, request-teacher-role & switch-account-role', async () => {
    const rejectCandidate = await createExtraStudent(run, 'reject_req', {
      teacherRequestStatus: 'pending',
    });

    // Non-admin rejected on manage-teacher-approvals
    const nonAdmin = await callEdge('manage-teacher-approvals', {
      token: student1Token,
      body: { action: 'list' },
    });
    expect(nonAdmin.status).toBe(403);
    expect((nonAdmin.json as Record<string, unknown>)?.code).toBe('FORBIDDEN');

    // List contains pendingTeacher and rejectCandidate
    const listRes = await callEdge('manage-teacher-approvals', {
      token: adminToken,
      body: { action: 'list' },
    });
    expect(listRes.status).toBe(200);
    const reqs = (listRes.json as { requests: Array<{ firebase_uid: string }> }).requests;
    expect(reqs.some((r) => r.firebase_uid === run.accounts.pendingTeacher.uid)).toBe(true);
    expect(reqs.some((r) => r.firebase_uid === rejectCandidate.uid)).toBe(true);

    // Reject candidate
    const rejRes = await callEdge('manage-teacher-approvals', {
      token: adminToken,
      body: { action: 'reject', firebaseUid: rejectCandidate.uid },
    });
    expect(rejRes.status).toBe(200);

    // Re-rejecting non-pending fails with 400 INVALID_INPUT
    const rejAgain = await callEdge('manage-teacher-approvals', {
      token: adminToken,
      body: { action: 'reject', firebaseUid: rejectCandidate.uid },
    });
    expect(rejAgain.status).toBe(400);
    expect((rejAgain.json as Record<string, unknown>)?.code).toBe('INVALID_INPUT');

    // set_blocked on student3 (and restore), and reject on non-student teacher1
    const blockNonStudent = await callEdge('manage-teacher-approvals', {
      token: adminToken,
      body: { action: 'set_blocked', firebaseUid: run.accounts.teacher1.uid, blocked: true },
    });
    expect(blockNonStudent.status).toBe(400);

    try {
      const setBlk = await callEdge('manage-teacher-approvals', {
        token: adminToken,
        body: { action: 'set_blocked', firebaseUid: run.accounts.student3.uid, blocked: true },
      });
      expect(setBlk.status).toBe(200);
      const blockedReq = await callEdge('request-teacher-role', {
        token: student3Token,
        body: {},
      });
      expect(blockedReq.status).toBe(403);
      expect((blockedReq.json as Record<string, unknown>)?.code).toBe('TEACHER_REQUEST_BLOCKED');
    } finally {
      await callEdge('manage-teacher-approvals', {
        token: adminToken,
        body: { action: 'set_blocked', firebaseUid: run.accounts.student3.uid, blocked: false },
      });
    }

    // student3 unapproved switch-account-role -> 403 TEACHER_ACCESS_NOT_APPROVED
    const unapprovedSwitch = await callEdge('switch-account-role', {
      token: student3Token,
      body: { role: 'teacher' },
    });
    expect(unapprovedSwitch.status).toBe(403);
    expect((unapprovedSwitch.json as Record<string, unknown>)?.code).toBe('TEACHER_ACCESS_NOT_APPROVED');

    // student2 requests teacher role -> 200 pending, then 409 TEACHER_REQUEST_PENDING
    const reqRoleRes = await callEdge('request-teacher-role', {
      token: student2Token,
      body: {},
    });
    expect(reqRoleRes.status).toBe(200);
    expect((reqRoleRes.json as Record<string, unknown>)?.teacher_request_status).toBe('pending');

    const reqAgain = await callEdge('request-teacher-role', {
      token: student2Token,
      body: {},
    });
    expect(reqAgain.status).toBe(409);
    expect((reqAgain.json as Record<string, unknown>)?.code).toBe('TEACHER_REQUEST_PENDING');

    // Admin cannot call switch-account-role -> 403 FORBIDDEN
    const adminSwitch = await callEdge('switch-account-role', {
      token: adminToken,
      body: { role: 'teacher' },
    });
    expect(adminSwitch.status).toBe(403);
    expect((adminSwitch.json as Record<string, unknown>)?.code).toBe('FORBIDDEN');

    // Approve pendingTeacher -> emits teacher_approval notif -> switch teacher <-> student
    const approveRes = await callEdge('manage-teacher-approvals', {
      token: adminToken,
      body: { action: 'approve', firebaseUid: run.accounts.pendingTeacher.uid },
    });
    expect(approveRes.status).toBe(200);

    const ptNotifs = await callRpc('list_my_notifications', { p_limit: 20, p_unread_only: false }, pendingTeacherToken);
    expect(ptNotifs.status).toBe(200);
    expect((ptNotifs.json as { items: Array<{ type: string }> }).items.some((n) => n.type === 'teacher_approval')).toBe(true);

    const switchTeacher = await callEdge('switch-account-role', {
      token: pendingTeacherToken,
      body: { role: 'teacher' },
    });
    expect(switchTeacher.status).toBe(200);
    expect((switchTeacher.json as Record<string, unknown>)?.active_role).toBe('teacher');

    const switchStudent = await callEdge('switch-account-role', {
      token: pendingTeacherToken,
      body: { role: 'student' },
    });
    expect(switchStudent.status).toBe(200);
    expect((switchStudent.json as Record<string, unknown>)?.active_role).toBe('student');

    const badSwitch = await callEdge('switch-account-role', {
      token: pendingTeacherToken,
      body: { role: 'admin' },
    });
    expect(badSwitch.status).toBe(400);
    expect((badSwitch.json as Record<string, unknown>)?.code).toBe('ROLE_SWITCH_INVALID');
  });

  test('A.2 Classrooms RPCs: CRUD, code rotation, bulk import, member privacy & removal', async () => {
    // Student cannot create classroom
    const stuCreate = await callRpc(
      'create_classroom',
      { p_name: 'Bad', p_subject: 'Toán', p_grade_level: '12', p_description: '' },
      student1Token
    );
    expect(stuCreate.status).toBe(400);
    expect(stuCreate.text).toContain('Chỉ giáo viên hoặc quản trị viên được tạo lớp học');

    // Blank name rejected
    const blankCreate = await callRpc(
      'create_classroom',
      { p_name: '   ', p_subject: 'Toán', p_grade_level: '12', p_description: '' },
      teacher1Token
    );
    expect(blankCreate.status).toBe(400);
    expect(blankCreate.text).toContain('Tên lớp học phải từ 1 đến 120 ký tự');

    // Teacher1 creates classroom
    const clsRes = await callRpc(
      'create_classroom',
      { p_name: `[E2E] Lớp 12A ${run.runId}`, p_subject: 'Toán', p_grade_level: '12', p_description: 'Mô tả E2E' },
      teacher1Token
    );
    expect(clsRes.status).toBe(200);
    const cls = clsRes.json as {
      id: string;
      inviteCode: string;
      inviteEnabled: boolean;
      isArchived: boolean;
    };
    run.classroomIds.push(cls.id);
    expect(cls.inviteCode).toHaveLength(6);
    expect(cls.inviteEnabled).toBe(true);
    expect(cls.isArchived).toBe(false);
    const oldCode = cls.inviteCode;

    // Teacher2 cannot update Teacher1's classroom
    const t2Update = await callRpc(
      'update_classroom',
      { p_id: cls.id, p_name: 'Hack', p_invite_enabled: true, p_is_archived: false },
      teacher2Token
    );
    expect(t2Update.status).toBe(400);
    expect(t2Update.text).toContain('Không có quyền chỉnh sửa lớp học này');

    // Regenerate code -> old code rejected
    const regenRes = await callRpc('regenerate_classroom_code', { p_id: cls.id }, teacher1Token);
    expect(regenRes.status).toBe(200);
    const newCode = regenRes.json as string;
    expect(newCode).toHaveLength(6);

    const joinOld = await callRpc(
      'join_classroom_by_code',
      { p_code: oldCode, p_via: 'code' },
      student1Token
    );
    if (newCode !== oldCode) {
      expect(joinOld.status).toBe(400);
      expect(joinOld.text).toContain('Không tìm thấy lớp học với mã mời này');
    }

    // Teacher cannot join classroom as student
    const teacherJoin = await callRpc(
      'join_classroom_by_code',
      { p_code: newCode, p_via: 'code' },
      teacher1Token
    );
    expect(teacherJoin.status).toBe(400);
    expect(teacherJoin.text).toContain('Chỉ tài khoản ở chế độ học sinh mới có thể tham gia lớp học');

    // Student1 joins with new code
    const joinOk = await callRpc(
      'join_classroom_by_code',
      { p_code: newCode, p_via: 'link' },
      student1Token
    );
    expect(joinOk.status).toBe(200);

    // Disable invites & archive checks
    await callRpc(
      'update_classroom',
      { p_id: cls.id, p_invite_enabled: false, p_is_archived: false },
      teacher1Token
    );
    const joinDisabled = await callRpc(
      'join_classroom_by_code',
      { p_code: newCode, p_via: 'code' },
      student2Token
    );
    expect(joinDisabled.status).toBe(400);
    expect(joinDisabled.text).toContain('Giáo viên đã tạm tắt lời mời');

    await callRpc(
      'update_classroom',
      { p_id: cls.id, p_invite_enabled: true, p_is_archived: true },
      teacher1Token
    );
    const joinArchived = await callRpc(
      'join_classroom_by_code',
      { p_code: newCode, p_via: 'code' },
      student2Token
    );
    expect(joinArchived.status).toBe(400);
    expect(joinArchived.text).toContain('Lớp học này đã được lưu trữ');

    // Unarchive
    await callRpc(
      'update_classroom',
      { p_id: cls.id, p_invite_enabled: true, p_is_archived: false },
      teacher1Token
    );

    // Bulk add members: active student2 + unregistered pending email + invalid email
    const bulkBadVia = await callRpc(
      'add_classroom_members_bulk',
      { p_classroom_id: cls.id, p_emails: [run.accounts.student2.email], p_joined_via: 'code' },
      teacher1Token
    );
    expect(bulkBadVia.status).toBe(400);

    const tooManyEmails = Array.from({ length: 501 }, (_, idx) => `u${idx}@e2e.qizzone.test`);
    const bulkTooMany = await callRpc(
      'add_classroom_members_bulk',
      { p_classroom_id: cls.id, p_emails: tooManyEmails, p_joined_via: 'excel_import' },
      teacher1Token
    );
    expect(bulkTooMany.status).toBe(400);
    expect(bulkTooMany.text).toContain('Tối đa 500 email mỗi lần thêm');

    const bulkRes = await callRpc(
      'add_classroom_members_bulk',
      {
        p_classroom_id: cls.id,
        p_emails: [
          run.accounts.student1.email, // already active -> skippedExisting
          run.accounts.student2.email, // existing user -> addedActive
          `${run.runId}_unreg@e2e.qizzone.test`, // pending_invite -> addedPending
          'not-an-email',
        ],
        p_joined_via: 'excel_import',
      },
      teacher1Token
    );
    expect(bulkRes.status).toBe(200);
    const bulkJson = bulkRes.json as {
      addedActive: number;
      addedPending: number;
      skippedExisting: number;
      invalidEmails: string[];
    };
    expect(bulkJson.addedActive).toBe(1);
    expect(bulkJson.addedPending).toBe(1);
    expect(bulkJson.skippedExisting).toBe(1);
    expect(bulkJson.invalidEmails).toEqual(['not-an-email']);

    // Student2 received classroom_joined notification
    const s2Notifs = await callRpc('list_my_notifications', { p_limit: 20, p_unread_only: false }, student2Token);
    expect(
      (s2Notifs.json as { items: Array<{ type: string }> }).items.some((n) => n.type === 'classroom_joined')
    ).toBe(true);

    // Privacy check: Student1 sees ONLY own member row (length 1); Teacher sees all 3; Student3 (outsider) rejected
    const stu1Detail = await callRpc('get_classroom_detail', { p_classroom_id: cls.id }, student1Token);
    expect(stu1Detail.status).toBe(200);
    const stu1Members = (stu1Detail.json as { members: Array<{ studentUid: string }> }).members;
    expect(stu1Members).toHaveLength(1);
    expect(stu1Members[0].studentUid).toBe(run.accounts.student1.uid);

    const stu3Detail = await callRpc('get_classroom_detail', { p_classroom_id: cls.id }, student3Token);
    expect(stu3Detail.status).toBe(400);
    expect(stu3Detail.text).toContain('Bạn không có quyền xem thông tin lớp học này');

    const teacherDetail = await callRpc('get_classroom_detail', { p_classroom_id: cls.id }, teacher1Token);
    expect(teacherDetail.status).toBe(200);
    const allMembers = (teacherDetail.json as { members: Array<{ id: string; studentUid: string | null }> }).members;
    expect(allMembers.length).toBe(3);

    // Remove student2
    const stu2MemberRow = allMembers.find((m) => m.studentUid === run.accounts.student2.uid)!;
    const removeOk = await callRpc(
      'remove_classroom_member',
      { p_classroom_id: cls.id, p_member_id: stu2MemberRow.id },
      teacher1Token
    );
    expect(removeOk.ok).toBe(true);

    const stu2AfterRemove = await callRpc('get_classroom_detail', { p_classroom_id: cls.id }, student2Token);
    expect(stu2AfterRemove.status).toBe(400);

    // list_my_classrooms
    const listStu1 = await callRpc('list_my_classrooms', {}, student1Token);
    expect(listStu1.status).toBe(200);
    expect((listStu1.json as Array<{ id: string }>).some((c) => c.id === cls.id)).toBe(true);
  });

  test('A.1 & A.2 Azota Quizzes, Assignments, Exam Lifecycle, finalize-exam & Redaction', async () => {
    // Create classroom for class_only quiz & add student1
    const clsRes = await callRpc(
      'create_classroom',
      { p_name: `[E2E] Azota Class ${run.runId}`, p_subject: 'Lý', p_grade_level: '12', p_description: '' },
      teacher1Token
    );
    const cls = clsRes.json as { id: string; inviteCode: string };
    run.classroomIds.push(cls.id);
    await callRpc('join_classroom_by_code', { p_code: cls.inviteCode, p_via: 'code' }, student1Token);

    const nowMs = Date.now();
    const pastIso = new Date(nowMs - 3600_000).toISOString();
    const futureCloseIso = new Date(nowMs + 3600_000).toISOString();

    // Student cannot save_quiz; closesAt <= opensAt rejected
    const stuSave = await callRpc(
      'save_quiz',
      {
        p_data: {
          title: 'Hack',
          subject: 'Toán',
          status: 'published',
          settings: {
            durationMinutes: 15,
            shuffleQuestions: false,
            shuffleOptions: false,
            allowReview: true,
            maxAttempts: 2,
            passPercentage: 50,
            publishScope: 'public',
            scoreVisibility: 'immediate',
            answerVisibility: 'immediate',
          },
          questions: buildSampleQuestions(),
        },
        p_id: null,
        p_legacy_id: null,
      },
      student1Token
    );
    expect(stuSave.status).toBe(400);

    const invertedWindowSave = await callRpc(
      'save_quiz',
      {
        p_data: {
          title: '[E2E] Bad Window',
          subject: 'Toán',
          status: 'published',
          settings: {
            durationMinutes: 15,
            shuffleQuestions: false,
            shuffleOptions: false,
            allowReview: true,
            maxAttempts: 2,
            passPercentage: 50,
            publishScope: 'public',
            opensAt: futureCloseIso,
            closesAt: pastIso,
            scoreVisibility: 'immediate',
            answerVisibility: 'immediate',
          },
          questions: buildSampleQuestions(),
        },
        p_id: null,
        p_legacy_id: null,
      },
      teacher1Token
    );
    expect(invertedWindowSave.status).toBe(400);
    expect(invertedWindowSave.text).toContain('Thời gian đóng đề phải sau thời gian mở đề');

    // Create an unattempted quiz & delete it cleanly
    const tempSave = await callRpc(
      'save_quiz',
      {
        p_data: {
          title: `[E2E] Temp Delete ${run.runId}`,
          subject: 'Toán',
          status: 'draft',
          settings: {
            durationMinutes: 15,
            shuffleQuestions: false,
            shuffleOptions: false,
            allowReview: true,
            maxAttempts: 0,
            passPercentage: 50,
          },
          questions: buildSampleQuestions(),
        },
        p_id: null,
        p_legacy_id: null,
      },
      teacher1Token
    );
    expect(tempSave.status).toBe(200);
    const tempQuizId = tempSave.json as string;
    const delUnattempted = await callRpc('delete_quiz', { p_id: tempQuizId }, teacher1Token);
    expect(delUnattempted.ok).toBe(true);

    // Create main class_only quiz with scoreVisibility='never' (tests redaction) -> later update_quiz_publish_settings
    const quizSave = await callRpc(
      'save_quiz',
      {
        p_data: {
          title: `[E2E] Azota Class Quiz ${run.runId}`,
          subject: 'Toán',
          description: 'Mô tả Azota',
          status: 'published',
          settings: {
            durationMinutes: 30,
            shuffleQuestions: false,
            shuffleOptions: false,
            allowReview: true,
            maxAttempts: 2,
            passPercentage: 50,
            practiceEnabled: true,
            publishScope: 'class_only',
            opensAt: pastIso,
            closesAt: futureCloseIso,
            scoreVisibility: 'never',
            answerVisibility: 'never',
          },
          questions: buildSampleQuestions(),
        },
        p_id: null,
        p_legacy_id: null,
      },
      teacher1Token
    );
    expect(quizSave.status).toBe(200);
    const quizId = quizSave.json as string;
    run.quizIds.push(quizId);

    // Read quiz via teacher list_quizzes to get code & question IDs
    const tQuizzes = await callRpc('list_quizzes', {}, teacher1Token);
    const quizObj = (tQuizzes.json as Array<{ id: string; code: string; questions: Array<{ id: string }> }>).find(
      (q) => q.id === quizId
    )!;
    expect(quizObj).toBeDefined();

    // Assign validation checks
    const badAssignEmpty = await callRpc(
      'assign_quiz_to_classrooms',
      { p_quiz_id: quizId, p_assignments: [] },
      teacher1Token
    );
    expect(badAssignEmpty.status).toBe(400);

    const badAssignDates = await callRpc(
      'assign_quiz_to_classrooms',
      {
        p_quiz_id: quizId,
        p_assignments: [
          {
            classroomId: cls.id,
            availableFrom: futureCloseIso,
            dueAt: pastIso,
            latePolicy: 'allow_late',
          },
        ],
      },
      teacher1Token
    );
    expect(badAssignDates.status).toBe(400);

    // Assign with allow_late & dueAt in past (so submission is marked isLate=true)
    const pastDueIso = new Date(Date.now() - 120_000).toISOString();
    const assignOk = await callRpc(
      'assign_quiz_to_classrooms',
      {
        p_quiz_id: quizId,
        p_assignments: [
          {
            classroomId: cls.id,
            title: 'Bài tập Azota E2E',
            availableFrom: pastIso,
            dueAt: pastDueIso,
            latePolicy: 'allow_late',
            hardCloseAt: futureCloseIso,
          },
        ],
      },
      teacher1Token
    );
    expect(assignOk.status).toBe(200);
    const assignment = (assignOk.json as Array<{ id: string }>)[0];

    // Student1 got quiz_assigned notification
    const s1Notifs = await callRpc('list_my_notifications', { p_limit: 20, p_unread_only: false }, student1Token);
    expect(
      (s1Notifs.json as { items: Array<{ type: string }> }).items.some((n) => n.type === 'quiz_assigned')
    ).toBe(true);

    // Student1 list_student_assignments shows overdue (past dueAt, allow_late, not yet submitted)
    const s1Assigns = await callRpc('list_student_assignments', { p_classroom_id: cls.id }, student1Token);
    expect(s1Assigns.status).toBe(200);
    const s1Item = (s1Assigns.json as Array<{ assignmentId: string; status: string }>).find(
      (a) => a.assignmentId === assignment.id
    );
    expect(s1Item?.status).toBe('overdue');

    // Outsider Student3 cannot join class_only quiz by code
    const s3Join = await callRpc('join_quiz_by_code', { p_code: quizObj.code }, student3Token);
    expect(s3Join.status).toBe(400);
    expect(s3Join.text).toContain('Đề thi này chỉ dành cho lớp học hoặc học sinh được giao');

    // Member Student1 joins by code (answers redacted)
    const s1Join = await callRpc('join_quiz_by_code', { p_code: quizObj.code }, student1Token);
    expect(s1Join.status).toBe(200);
    const joinedQuiz = s1Join.json as { questions: Array<{ correctAnswers: unknown[]; explanation: unknown }> };
    expect(joinedQuiz.questions[0].correctAnswers).toEqual([]);
    expect(joinedQuiz.questions[0].explanation).toBeNull();

    // Start attempt with assignmentId
    const startRes = await callRpc(
      'start_attempt',
      { p_quiz_id: quizId, p_class: '12A1', p_assignment_id: assignment.id },
      student1Token
    );
    expect(startRes.status).toBe(200);
    const attempt = startRes.json as { id: string; revision: number; assignmentId: string };
    expect(attempt.assignmentId).toBe(assignment.id);

    // save_attempt increments revision & rejects stale revision + invalid option 'Z'
    const saveOk = await callRpc(
      'save_attempt',
      {
        p_id: attempt.id,
        p_revision: attempt.revision,
        p_answers: { [quizObj.questions[0].id]: ['B'], [quizObj.questions[1].id]: ['E'] },
        p_flags: [],
        p_index: 1,
      },
      student1Token
    );
    expect(saveOk.status).toBe(200);
    expect((saveOk.json as { revision: number }).revision).toBe(attempt.revision + 1);

    const staleSave = await callRpc(
      'save_attempt',
      {
        p_id: attempt.id,
        p_revision: attempt.revision,
        p_answers: {},
        p_flags: [],
        p_index: 0,
      },
      student1Token
    );
    expect(staleSave.status).toBe(400);
    expect(staleSave.text).toContain('CONFLICT');

    const badOptionSave = await callRpc(
      'save_attempt',
      {
        p_id: attempt.id,
        p_revision: attempt.revision + 1,
        p_answers: { [quizObj.questions[0].id]: ['Z'] },
        p_flags: [],
        p_index: 0,
      },
      student1Token
    );
    expect(badOptionSave.status).toBe(400);
    expect(badOptionSave.text).toContain('Phương án không hợp lệ');

    // finalize-exam Edge Function checks (bad input, no auth, wrong user, idempotency)
    const finBadInput = await callEdge('finalize-exam', {
      token: student1Token,
      body: { attemptId: 'not-uuid', idempotencyKey: 'short' },
    });
    expect(finBadInput.status).toBe(400);
    expect((finBadInput.json as Record<string, unknown>)?.code).toBe('INVALID_INPUT');

    const finNoAuth = await callEdge('finalize-exam', {
      body: { attemptId: attempt.id, idempotencyKey: `e2e-idem-${run.runId}` },
    });
    expect(finNoAuth.status).toBe(401);

    const finWrongStudent = await callEdge('finalize-exam', {
      token: student3Token,
      body: { attemptId: attempt.id, idempotencyKey: `e2e-idem-${run.runId}` },
    });
    expect(finWrongStudent.status).toBe(403);
    expect((finWrongStudent.json as Record<string, unknown>)?.code).toBe('FORBIDDEN');

    const idemKey1 = `e2e-idem-1-${run.runId}`;
    const fin1 = await callEdge('finalize-exam', {
      token: student1Token,
      body: { attemptId: attempt.id, idempotencyKey: idemKey1 },
    });
    expect(fin1.status).toBe(200);
    const fin1Json = fin1.json as {
      status: string;
      score: number | null;
      result: { score: number | null; scoreHidden: boolean; answersHidden: boolean; isLate: boolean; lateSeconds: number };
    };
    expect(fin1Json.status).toBe('submitted');
    expect(fin1Json.score).toBeNull();
    expect(fin1Json.result.score).toBeNull();
    expect(fin1Json.result.scoreHidden).toBe(true);
    expect(fin1Json.result.answersHidden).toBe(true);
    expect(fin1Json.result.isLate).toBe(true);
    expect(fin1Json.result.lateSeconds).toBeGreaterThan(0);

    // Same idempotencyKey -> identical payload
    const finSame = await callEdge('finalize-exam', {
      token: student1Token,
      body: { attemptId: attempt.id, idempotencyKey: idemKey1 },
    });
    expect(finSame.status).toBe(200);
    expect(finSame.json).toEqual(fin1.json);

    // New idempotencyKey -> already_submitted
    const finNewKey = await callEdge('finalize-exam', {
      token: student1Token,
      body: { attemptId: attempt.id, idempotencyKey: `e2e-idem-2-${run.runId}` },
    });
    expect(finNewKey.status).toBe(200);
    expect((finNewKey.json as { status: string }).status).toBe('already_submitted');

    // list_results: student gets redacted score=null; teacher gets unredacted score=10
    const s1Results = await callRpc('list_results', {}, student1Token);
    expect((s1Results.json as Array<{ quizId: string; score: number | null }>).find((r) => r.quizId === quizId)?.score).toBeNull();

    const t1Results = await callRpc('list_results', {}, teacher1Token);
    expect((t1Results.json as Array<{ quizId: string; score: number | null }>).find((r) => r.quizId === quizId)?.score).toBe(10);

    // list_teacher_quiz_tracking
    const tracking = await callRpc(
      'list_teacher_quiz_tracking',
      { p_quiz_id: quizId, p_classroom_id: cls.id },
      teacher1Token
    );
    expect(tracking.status).toBe(200);
    expect((tracking.json as { summary: { submittedLate: number } }).summary.submittedLate).toBe(1);

    const trackingStuForbidden = await callRpc(
      'list_teacher_quiz_tracking',
      { p_quiz_id: quizId, p_classroom_id: cls.id },
      student1Token
    );
    expect(trackingStuForbidden.status).toBe(400);

    // save_quiz & delete_quiz rejected when attempts exist, whereas update_quiz_publish_settings SUCCEEDS!
    const editAttempted = await callRpc(
      'save_quiz',
      {
        p_data: {
          title: 'Edit Fail',
          subject: 'Toán',
          status: 'published',
          settings: { durationMinutes: 30, maxAttempts: 2, passPercentage: 50 },
          questions: buildSampleQuestions(),
        },
        p_id: quizId,
        p_legacy_id: null,
      },
      teacher1Token
    );
    expect(editAttempted.status).toBe(400);
    expect(editAttempted.text).toContain('Đề đã có lượt làm');

    const delAttempted = await callRpc('delete_quiz', { p_id: quizId }, teacher1Token);
    expect(delAttempted.status).toBe(400);

    const updateSettingsOk = await callRpc(
      'update_quiz_publish_settings',
      {
        p_quiz_id: quizId,
        p_settings: {
          publishScope: 'class_only',
          scoreVisibility: 'immediate',
          answerVisibility: 'immediate',
          maxAttempts: 2,
        },
        p_status: 'published',
      },
      teacher1Token
    );
    expect(updateSettingsOk.status).toBe(200);

    // Block after due test + finalize-exam cutoff (502 INTERNAL_ERROR)
    const pastHardCloseIso = new Date(Date.now() - 120_000).toISOString();
    const blockQuizSave = await callRpc(
      'save_quiz',
      {
        p_data: {
          title: `[E2E] Block Cutoff ${run.runId}`,
          subject: 'Toán',
          status: 'published',
          settings: {
            durationMinutes: 10,
            shuffleQuestions: false,
            shuffleOptions: false,
            allowReview: true,
            maxAttempts: 1,
            passPercentage: 50,
            publishScope: 'public',
            scoreVisibility: 'immediate',
            answerVisibility: 'immediate',
          },
          questions: buildSampleQuestions(),
        },
        p_id: null,
        p_legacy_id: null,
      },
      teacher1Token
    );
    const blockQuizId = blockQuizSave.json as string;
    run.quizIds.push(blockQuizId);

    const blockStart = await callRpc(
      'start_attempt',
      { p_quiz_id: blockQuizId, p_class: '', p_assignment_id: null },
      student1Token
    );
    expect(blockStart.status).toBe(200);
    const blockAttemptId = (blockStart.json as { id: string }).id;

    // Close the quiz past closesAt + 60s via update_quiz_publish_settings
    await callRpc(
      'update_quiz_publish_settings',
      {
        p_quiz_id: blockQuizId,
        p_settings: {
          opensAt: new Date(Date.now() - 3600_000).toISOString(),
          closesAt: pastHardCloseIso,
        },
        p_status: 'published',
      },
      teacher1Token
    );

    const cutoffSubmitRpc = await callRpc('submit_attempt', { p_id: blockAttemptId }, student1Token);
    expect(cutoffSubmitRpc.status).toBe(400);
    expect(cutoffSubmitRpc.text).toContain('Đề thi đã hết thời gian mở');

    const cutoffEdge = await callEdge('finalize-exam', {
      token: student1Token,
      body: { attemptId: blockAttemptId, idempotencyKey: `e2e-cutoff-${run.runId}` },
    });
    expect(cutoffEdge.status).toBe(502);
    expect((cutoffEdge.json as Record<string, unknown>)?.code).toBe('INTERNAL_ERROR');
  });

  test('A.2 Practice RPCs (incl. 5-option E & Azota visibility gating)', async () => {
    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    const pastIso = new Date(Date.now() - 3600_000).toISOString();

    const pQuizRes = await callRpc(
      'save_quiz',
      {
        p_data: {
          title: `[E2E] Practice Quiz ${run.runId}`,
          subject: 'Toán',
          status: 'published',
          settings: {
            durationMinutes: 15,
            shuffleQuestions: false,
            shuffleOptions: false,
            allowReview: true,
            maxAttempts: 0,
            passPercentage: 50,
            practiceEnabled: true,
            publishScope: 'public',
            opensAt: pastIso,
            closesAt: futureIso,
            scoreVisibility: 'immediate',
            answerVisibility: 'after_close',
          },
          questions: buildSampleQuestions(),
        },
        p_id: null,
        p_legacy_id: null,
      },
      teacher1Token
    );
    const pQuizId = pQuizRes.json as string;
    run.quizIds.push(pQuizId);

    // after_close before close -> rejected
    const beforeClose = await callRpc(
      'start_practice',
      { p_quiz_id: pQuizId, p_question_count: 2, p_show_explanation: true },
      student1Token
    );
    expect(beforeClose.status).toBe(400);
    expect(beforeClose.text).toContain('sau khi đóng đề');

    // Update to answerVisibility='never' -> rejected
    await callRpc(
      'update_quiz_publish_settings',
      { p_quiz_id: pQuizId, p_settings: { answerVisibility: 'never' }, p_status: 'published' },
      teacher1Token
    );
    const neverPractice = await callRpc(
      'start_practice',
      { p_quiz_id: pQuizId, p_question_count: 2, p_show_explanation: true },
      student1Token
    );
    expect(neverPractice.status).toBe(400);

    // Update to immediate -> succeeds and checks 5-option E!
    await callRpc(
      'update_quiz_publish_settings',
      { p_quiz_id: pQuizId, p_settings: { answerVisibility: 'immediate' }, p_status: 'published' },
      teacher1Token
    );
    const startPr = await callRpc(
      'start_practice',
      { p_quiz_id: pQuizId, p_question_count: 2, p_show_explanation: true },
      student1Token
    );
    expect(startPr.status).toBe(200);
    const prSession = startPr.json as { id: string; questionOrder: string[] };

    // Answer Q1 wrong (A), Q2 right with 5-option E!
    const chk1 = await callRpc(
      'check_practice_answer',
      { p_session_id: prSession.id, p_question_id: prSession.questionOrder[0], p_selected_answers: ['A'] },
      student1Token
    );
    expect(chk1.status).toBe(200);
    expect((chk1.json as { isCorrect: boolean }).isCorrect).toBe(false);

    const chk2 = await callRpc(
      'check_practice_answer',
      { p_session_id: prSession.id, p_question_id: prSession.questionOrder[1], p_selected_answers: ['E'] },
      student1Token
    );
    expect(chk2.status).toBe(200);
    expect((chk2.json as { isCorrect: boolean }).isCorrect).toBe(true);

    const finPr = await callRpc('finish_practice', { p_session_id: prSession.id }, student1Token);
    expect(finPr.status).toBe(200);
    expect((finPr.json as { correctCount: number; incorrectCount: number }).correctCount).toBe(1);
    expect((finPr.json as { correctCount: number; incorrectCount: number }).incorrectCount).toBe(1);

    const histPr = await callRpc('list_practice_history', {}, student1Token);
    expect(histPr.status).toBe(200);
    expect((histPr.json as Array<{ id: string }>).some((h) => h.id === prSession.id)).toBe(true);

    const retryPr = await callRpc(
      'start_practice_retry',
      { p_source_session_id: prSession.id, p_mode: 'wrong' },
      student1Token
    );
    expect(retryPr.status).toBe(200);
    expect((retryPr.json as { questionOrder: string[] }).questionOrder).toHaveLength(1);
  });

  test('A.2 & A.3 Notifications, Bug Reports & Direct PostgREST RLS Lockdown', async () => {
    // Student1 creates a bug report -> Admin notified & lists all -> Admin updates status -> Student1 notified
    const badBug = await callRpc(
      'create_bug_report',
      {
        p_title: 'ab',
        p_description: '1234567890',
        p_category: 'ui',
        p_severity: 'medium',
        p_page_route: '/student',
        p_context_metadata: {},
      },
      student1Token
    );
    expect(badBug.status).toBe(400);

    const createBug = await callRpc(
      'create_bug_report',
      {
        p_title: `[E2E] Lỗi UI ${run.runId}`,
        p_description: 'Mô tả chi tiết lỗi E2E đủ dài trên 10 ký tự',
        p_category: 'ui',
        p_severity: 'high',
        p_page_route: '/student/classes',
        p_context_metadata: { source: 'e2e' },
      },
      student1Token
    );
    expect(createBug.status).toBe(200);
    const bug = createBug.json as { id: string; status: string; reporterRole: string };
    expect(bug.status).toBe('new');
    expect(bug.reporterRole).toBe('student');

    // Student2 cannot see Student1's bug report via RPC or REST
    const s2BugsRpc = await callRpc('list_bug_reports', { p_status: null, p_role: null }, student2Token);
    expect(s2BugsRpc.status).toBe(200);
    expect((s2BugsRpc.json as Array<{ id: string }>).some((b) => b.id === bug.id)).toBe(false);

    // Non-admin cannot update bug report status
    const s2UpdateBug = await callRpc(
      'update_bug_report_status',
      { p_report_id: bug.id, p_status: 'resolved', p_admin_response: 'Hack' },
      student2Token
    );
    expect(s2UpdateBug.status).toBe(400);
    expect(s2UpdateBug.text).toContain('Chỉ quản trị viên');

    // Admin updates bug report to resolved
    const adminResolve = await callRpc(
      'update_bug_report_status',
      { p_report_id: bug.id, p_status: 'resolved', p_admin_response: 'Đã xử lý xong' },
      adminToken
    );
    expect(adminResolve.status).toBe(200);
    expect((adminResolve.json as { status: string; resolvedAt: string | null }).status).toBe('resolved');
    expect((adminResolve.json as { resolvedAt: string | null }).resolvedAt).not.toBeNull();

    // Student1 checks notifications & marks read; Student2 cannot mark Student1's notification (returns 0)
    const s1NotifRes = await callRpc('list_my_notifications', { p_limit: 20, p_unread_only: true }, student1Token);
    const s1Notifs = (s1NotifRes.json as { items: Array<{ id: string; type: string }> }).items;
    const bugNotif = s1Notifs.find((n) => n.type === 'bug_report_updated');
    expect(bugNotif).toBeDefined();

    const crossMark = await callRpc('mark_notifications_read', { p_ids: [bugNotif!.id] }, student2Token);
    expect(crossMark.status).toBe(200);
    expect(crossMark.json).toBe(0);

    const ownMark = await callRpc('mark_notifications_read', { p_ids: [bugNotif!.id] }, student1Token);
    expect(ownMark.status).toBe(200);
    expect(ownMark.json).toBe(1);

    // A.3 Direct PostgREST RLS Lockdown checks
    const restQuizzes = await callRestTable('quizzes?select=*', { token: student1Token });
    expect([401, 403]).toContain(restQuizzes.status);

    const restQuestions = await callRestTable('questions?select=*', { token: student1Token });
    expect([401, 403]).toContain(restQuestions.status);

    const restKeys = await callRestTable('question_answer_keys?select=*', { token: student1Token });
    expect(restKeys.status).toBe(200);
    expect(restKeys.json).toEqual([]);

    const restMembersStu3 = await callRestTable('classroom_members?select=*', { token: student3Token });
    expect(restMembersStu3.status).toBe(200);
    expect(restMembersStu3.json).toEqual([]);

    const restNotifPost = await callRestTable('in_app_notifications', {
      method: 'POST',
      token: student1Token,
      body: { recipient_uid: run.accounts.student2.uid, type: 'hack', title: 'x', body: 'y', target_route: '/' },
    });
    expect([401, 403]).toContain(restNotifPost.status);

    const restBugStu2 = await callRestTable(`bug_reports?id=eq.${bug.id}&select=*`, { token: student2Token });
    expect(restBugStu2.status).toBe(200);
    expect(restBugStu2.json).toEqual([]);

    const restBugPatch = await callRestTable(`bug_reports?id=eq.${bug.id}`, {
      method: 'PATCH',
      token: student1Token,
      body: { status: 'resolved' },
    });
    expect([401, 403]).toContain(restBugPatch.status);

    const restClassPost = await callRestTable('classrooms', {
      method: 'POST',
      token: teacher1Token,
      body: { name: 'Bypass' },
    });
    expect([401, 403]).toContain(restClassPost.status);
  });
});
