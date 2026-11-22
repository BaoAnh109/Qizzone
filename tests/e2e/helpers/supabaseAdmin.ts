import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadE2eEnv } from './env';

export const E2E_EMAIL_DOMAIN = '@e2e.qizzone.test';

export type E2eAccountRoleKey =
  | 'admin'
  | 'teacher1'
  | 'teacher2'
  | 'pendingTeacher'
  | 'student1'
  | 'student2'
  | 'student3';

export interface ProvisionedUser {
  uid: string;
  email: string;
  password: string;
  fullName: string;
  role: 'admin' | 'teacher' | 'student';
}

export interface E2eRunManifest {
  runId: string;
  password: string;
  accounts: Record<E2eAccountRoleKey, ProvisionedUser>;
  extraUids: string[];
  quizIds: string[];
  classroomIds: string[];
  bugReportIds: string[];
  notificationIds: string[];
}

export function createAdminClient(): SupabaseClient {
  const env = loadE2eEnv();
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createAnonClient(): SupabaseClient {
  const env = loadE2eEnv();
  return createClient(env.supabaseUrl, env.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

interface ProvisionUserOptions {
  email: string;
  password: string;
  fullName: string;
  role: 'admin' | 'teacher' | 'student';
  appRole: 'admin' | 'teacher' | 'student';
  approvalStatus: 'approved' | 'pending' | 'rejected';
  teacherRequestStatus: 'none' | 'pending' | 'approved' | 'rejected';
  teacherRequestBlocked?: boolean;
  createTeacherRequestRow?: boolean;
}

async function provisionSingleUser(
  admin: SupabaseClient,
  opts: ProvisionUserOptions
): Promise<ProvisionedUser> {
  const now = new Date().toISOString();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: opts.email,
    password: opts.password,
    email_confirm: true,
    user_metadata: {
      full_name: opts.fullName,
    },
    app_metadata: {
      provider: 'email',
      providers: ['email'],
      role: 'authenticated',
      app_role: opts.appRole,
      account_status: opts.approvalStatus,
    },
  });

  if (createErr || !created?.user) {
    throw new Error(
      `Failed to provision auth user (${opts.email}): ${createErr?.message || 'Unknown error'}`
    );
  }

  const uid = created.user.id;

  const { error: profileErr } = await admin.from('profiles').upsert(
    {
      firebase_uid: uid,
      id: uid,
      email: opts.email,
      full_name: opts.fullName,
      role: opts.role,
      approval_status: opts.approvalStatus,
      teacher_request_status: opts.teacherRequestStatus,
      teacher_request_blocked: opts.teacherRequestBlocked ?? false,
      teacher_requested_at: opts.teacherRequestStatus === 'pending' ? now : null,
      updated_at: now,
    },
    { onConflict: 'firebase_uid' }
  );

  if (profileErr) {
    await admin.auth.admin.deleteUser(uid).catch(() => undefined);
    throw new Error(`Failed to upsert profile (${opts.email}): ${profileErr.message}`);
  }

  const { error: roleErr } = await admin.from('user_roles').upsert(
    {
      user_uid: uid,
      base_role: opts.role,
      active_role: opts.appRole,
      updated_at: now,
    },
    { onConflict: 'user_uid' }
  );

  if (roleErr) {
    await admin.from('profiles').delete().eq('firebase_uid', uid);
    await admin.auth.admin.deleteUser(uid).catch(() => undefined);
    throw new Error(`Failed to upsert user_roles (${opts.email}): ${roleErr.message}`);
  }

  if (opts.createTeacherRequestRow) {
    const { error: reqErr } = await admin.from('teacher_requests').upsert(
      {
        user_uid: uid,
        status: opts.teacherRequestStatus,
        blocked: opts.teacherRequestBlocked ?? false,
        requested_at: now,
        updated_at: now,
      },
      { onConflict: 'user_uid' }
    );
    if (reqErr) {
      await admin.from('user_roles').delete().eq('user_uid', uid);
      await admin.from('profiles').delete().eq('firebase_uid', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => undefined);
      throw new Error(`Failed to upsert teacher_requests (${opts.email}): ${reqErr.message}`);
    }
  }

  return {
    uid,
    email: opts.email,
    password: opts.password,
    fullName: opts.fullName,
    role: opts.role,
  };
}

function sanitizeRunSegment(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

export async function provisionE2eRun(runPrefix = 'run'): Promise<E2eRunManifest> {
  const admin = createAdminClient();
  const prefix = sanitizeRunSegment(runPrefix) || 'run';
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const runId = `e2e_${prefix}_${suffix}`;
  const password = `QzE2e!${suffix}A9#`;

  const createdUids: string[] = [];
  const makeEmail = (label: string) => `${runId}_${label}${E2E_EMAIL_DOMAIN}`;

  try {
    const adminUser = await provisionSingleUser(admin, {
      email: makeEmail('admin'),
      password,
      fullName: `E2E Admin ${suffix}`,
      role: 'admin',
      appRole: 'admin',
      approvalStatus: 'approved',
      teacherRequestStatus: 'none',
    });
    createdUids.push(adminUser.uid);

    const teacher1 = await provisionSingleUser(admin, {
      email: makeEmail('teacher1'),
      password,
      fullName: `E2E Teacher 1 ${suffix}`,
      role: 'teacher',
      appRole: 'teacher',
      approvalStatus: 'approved',
      teacherRequestStatus: 'approved',
    });
    createdUids.push(teacher1.uid);

    const teacher2 = await provisionSingleUser(admin, {
      email: makeEmail('teacher2'),
      password,
      fullName: `E2E Teacher 2 ${suffix}`,
      role: 'teacher',
      appRole: 'teacher',
      approvalStatus: 'approved',
      teacherRequestStatus: 'approved',
    });
    createdUids.push(teacher2.uid);

    const pendingTeacher = await provisionSingleUser(admin, {
      email: makeEmail('pending_teacher'),
      password,
      fullName: `E2E Pending Teacher ${suffix}`,
      role: 'student',
      appRole: 'student',
      approvalStatus: 'approved',
      teacherRequestStatus: 'pending',
      createTeacherRequestRow: true,
    });
    createdUids.push(pendingTeacher.uid);

    const student1 = await provisionSingleUser(admin, {
      email: makeEmail('student1'),
      password,
      fullName: `E2E Student 1 ${suffix}`,
      role: 'student',
      appRole: 'student',
      approvalStatus: 'approved',
      teacherRequestStatus: 'none',
    });
    createdUids.push(student1.uid);

    const student2 = await provisionSingleUser(admin, {
      email: makeEmail('student2'),
      password,
      fullName: `E2E Student 2 ${suffix}`,
      role: 'student',
      appRole: 'student',
      approvalStatus: 'approved',
      teacherRequestStatus: 'none',
    });
    createdUids.push(student2.uid);

    const student3 = await provisionSingleUser(admin, {
      email: makeEmail('student3'),
      password,
      fullName: `E2E Student 3 ${suffix}`,
      role: 'student',
      appRole: 'student',
      approvalStatus: 'approved',
      teacherRequestStatus: 'none',
    });
    createdUids.push(student3.uid);

    return {
      runId,
      password,
      accounts: {
        admin: adminUser,
        teacher1,
        teacher2,
        pendingTeacher,
        student1,
        student2,
        student3,
      },
      extraUids: [],
      quizIds: [],
      classroomIds: [],
      bugReportIds: [],
      notificationIds: [],
    };
  } catch (err) {
    await cleanupUids(createdUids).catch(() => undefined);
    throw err;
  }
}

export async function createExtraStudent(
  run: E2eRunManifest,
  label: string,
  overrides?: {
    email?: string;
    fullName?: string;
    approvalStatus?: 'approved' | 'pending' | 'rejected';
    teacherRequestStatus?: 'none' | 'pending' | 'approved' | 'rejected';
    teacherRequestBlocked?: boolean;
  }
): Promise<ProvisionedUser> {
  const admin = createAdminClient();
  const safeLabel = sanitizeRunSegment(label) || 'extra';
  const unique = Math.random().toString(36).slice(2, 6);
  const email = overrides?.email || `${run.runId}_${safeLabel}_${unique}${E2E_EMAIL_DOMAIN}`;
  const user = await provisionSingleUser(admin, {
    email,
    password: run.password,
    fullName: overrides?.fullName || `E2E Extra ${safeLabel}`,
    role: 'student',
    appRole: 'student',
    approvalStatus: overrides?.approvalStatus ?? 'approved',
    teacherRequestStatus: overrides?.teacherRequestStatus ?? 'none',
    teacherRequestBlocked: overrides?.teacherRequestBlocked ?? false,
    createTeacherRequestRow: overrides?.teacherRequestStatus === 'pending',
  });
  run.extraUids.push(user.uid);
  return user;
}

export async function createLegacyPendingTeacher(
  run: E2eRunManifest,
  label = 'legacy_pending'
): Promise<ProvisionedUser> {
  const admin = createAdminClient();
  const safeLabel = sanitizeRunSegment(label) || 'legacy_pending';
  const unique = Math.random().toString(36).slice(2, 6);
  const user = await provisionSingleUser(admin, {
    email: `${run.runId}_${safeLabel}_${unique}${E2E_EMAIL_DOMAIN}`,
    password: run.password,
    fullName: `E2E Legacy Pending Teacher`,
    role: 'teacher',
    appRole: 'teacher',
    approvalStatus: 'pending',
    teacherRequestStatus: 'pending',
    createTeacherRequestRow: true,
  });
  run.extraUids.push(user.uid);
  return user;
}

export async function signInAndGetToken(
  email: string,
  password: string
): Promise<{ accessToken: string; userId: string }> {
  const anon = createAnonClient();
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    throw new Error(`signInAndGetToken failed for ${email}: ${error?.message || 'no session'}`);
  }
  return {
    accessToken: data.session.access_token,
    userId: data.user.id,
  };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0)));
}

async function deleteAuthUserWithRetry(
  admin: ReturnType<typeof createAdminClient>,
  uid: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (!error || /not found/i.test(error.message)) return;
      lastError = error;
    } catch (error) {
      lastError = error;
    }

    const message = lastError instanceof Error
      ? lastError.message
      : String(lastError ?? 'Unknown error');
    if (!/fetch failed|network|timeout|ECONNRESET|socket|\b50[234]\b/i.test(message)) break;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'Unknown error');
  throw new Error(`cleanupUids failed deleting auth user ${uid}: ${message}`);
}

export async function cleanupUids(
  uids: string[],
  extraQuizIds: string[] = [],
  extraClassroomIds: string[] = [],
  extraBugReportIds: string[] = [],
  extraNotificationIds: string[] = []
): Promise<void> {
  const targetUids = uniqueStrings(uids);
  const targetExtraQuizIds = uniqueStrings(extraQuizIds);
  const targetExtraClassroomIds = uniqueStrings(extraClassroomIds);
  const targetExtraBugReportIds = uniqueStrings(extraBugReportIds);
  const targetExtraNotificationIds = uniqueStrings(extraNotificationIds);

  if (
    targetUids.length === 0 &&
    targetExtraQuizIds.length === 0 &&
    targetExtraClassroomIds.length === 0 &&
    targetExtraBugReportIds.length === 0 &&
    targetExtraNotificationIds.length === 0
  ) {
    return;
  }

  const admin = createAdminClient();

  if (targetUids.length > 0) {
    // 1. Clear reviewer self-references on profiles and teacher_requests
    await admin.from('profiles').update({ reviewed_by: null }).in('reviewed_by', targetUids);
    await admin.from('profiles').update({ teacher_reviewed_by: null }).in('teacher_reviewed_by', targetUids);
    await admin.from('teacher_requests').update({ reviewed_by: null }).in('reviewed_by', targetUids);
  }

  // Collect all quizzes owned by targetUids + explicitly passed quizIds
  let ownedQuizIds: string[] = [...targetExtraQuizIds];
  if (targetUids.length > 0) {
    const { data: qRows } = await admin.from('quizzes').select('id').in('teacher_uid', targetUids);
    if (qRows) {
      ownedQuizIds = uniqueStrings([...ownedQuizIds, ...qRows.map((r: { id: string }) => r.id)]);
    }
  }

  // Collect all attemptIds by student_uid or ownedQuizIds
  let attemptIds: string[] = [];
  if (targetUids.length > 0) {
    const { data: aByStudent } = await admin.from('exam_attempts').select('id').in('student_uid', targetUids);
    if (aByStudent) attemptIds.push(...aByStudent.map((r: { id: string }) => r.id));
  }
  if (ownedQuizIds.length > 0) {
    const { data: aByQuiz } = await admin.from('exam_attempts').select('id').in('quiz_id', ownedQuizIds);
    if (aByQuiz) attemptIds.push(...aByQuiz.map((r: { id: string }) => r.id));
  }
  attemptIds = uniqueStrings(attemptIds);

  // Collect questionIds for owned quizzes
  let questionIds: string[] = [];
  if (ownedQuizIds.length > 0) {
    const { data: qnRows } = await admin.from('questions').select('id').in('quiz_id', ownedQuizIds);
    if (qnRows) questionIds = uniqueStrings(qnRows.map((r: { id: string }) => r.id));
  }

  // 2. Delete exam_results
  if (attemptIds.length > 0) {
    await admin.from('exam_results').delete().in('attempt_id', attemptIds);
  }

  // 3. Delete exam_answers
  if (attemptIds.length > 0) {
    await admin.from('exam_answers').delete().in('attempt_id', attemptIds);
  }
  if (questionIds.length > 0) {
    await admin.from('exam_answers').delete().in('question_id', questionIds);
  }

  // 4. Delete exam_attempts
  if (attemptIds.length > 0) {
    await admin.from('exam_attempts').delete().in('id', attemptIds);
  }

  // 5. Delete practice_sessions
  if (targetUids.length > 0) {
    await admin.from('practice_sessions').delete().in('student_uid', targetUids);
  }
  if (ownedQuizIds.length > 0) {
    await admin.from('practice_sessions').delete().in('quiz_id', ownedQuizIds);
  }

  // 6. Delete quizzes (cascades questions, question_answer_keys, quiz_assignments, quiz_versions, exam_rooms)
  if (ownedQuizIds.length > 0) {
    await admin.from('quizzes').delete().in('id', ownedQuizIds);
  }

  // 7. Delete classrooms (cascades classroom_members, quiz_assignments)
  if (targetUids.length > 0) {
    await admin.from('classrooms').delete().in('teacher_uid', targetUids);
  }
  if (targetExtraClassroomIds.length > 0) {
    await admin.from('classrooms').delete().in('id', targetExtraClassroomIds);
  }

  // 8. Delete audit, idempotency, migrations, bug reports, notifications, requests, roles
  if (targetExtraBugReportIds.length > 0) {
    await admin.from('bug_reports').delete().in('id', targetExtraBugReportIds);
  }
  if (targetExtraNotificationIds.length > 0) {
    await admin.from('in_app_notifications').delete().in('id', targetExtraNotificationIds);
  }
  if (targetUids.length > 0) {
    await admin.from('role_audit_logs').delete().in('actor_uid', targetUids);
    await admin.from('role_audit_logs').delete().in('target_uid', targetUids);
    await admin.from('audit_logs').delete().in('actor_uid', targetUids);
    await admin.from('audit_logs').delete().in('resource_id', targetUids);
    await admin.from('idempotency_keys').delete().in('actor_uid', targetUids);
    await admin.from('data_migrations').delete().in('firebase_uid', targetUids);
    await admin.from('bug_reports').delete().in('reporter_uid', targetUids);
    await admin.from('bug_reports').update({ handled_by: null }).in('handled_by', targetUids);
    await admin.from('in_app_notifications').delete().in('recipient_uid', targetUids);
    await admin.from('in_app_notifications').delete().in('actor_uid', targetUids);
    await admin.from('teacher_requests').delete().in('user_uid', targetUids);
    await admin.from('user_roles').delete().in('user_uid', targetUids);

    // 9. Delete profiles
    const { error: delProfileErr } = await admin
      .from('profiles')
      .delete()
      .in('firebase_uid', targetUids);
    if (delProfileErr) {
      throw new Error(`cleanupUids failed deleting profiles: ${delProfileErr.message}`);
    }

    // 10. Delete Supabase Auth users
    for (const uid of targetUids) {
      await deleteAuthUserWithRetry(admin, uid);
    }
  }
}

export async function cleanupE2eRun(run: E2eRunManifest | null | undefined): Promise<void> {
  if (!run) return;
  const allUids = [
    ...Object.values(run.accounts).map((u) => u.uid),
    ...run.extraUids,
  ];
  await cleanupUids(
    allUids,
    run.quizIds,
    run.classroomIds,
    run.bugReportIds,
    run.notificationIds
  );
}

export async function sweepStaleE2eAccounts(maxAgeHours = 24): Promise<number> {
  const admin = createAdminClient();
  const cutoffIso = new Date(Date.now() - Math.max(0, maxAgeHours) * 3600 * 1000).toISOString();

  const { data: staleProfiles } = await admin
    .from('profiles')
    .select('firebase_uid, email, created_at')
    .ilike('email', `%${E2E_EMAIL_DOMAIN}`)
    .lt('created_at', cutoffIso);

  const staleUids = new Set<string>();
  for (const row of staleProfiles || []) {
    if (typeof row.email === 'string' && row.email.toLowerCase().endsWith(E2E_EMAIL_DOMAIN)) {
      staleUids.add(row.firebase_uid);
    }
  }

  // Also check Auth users without profile rows (orphaned auth users)
  let page = 1;
  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      const email = (u.email || '').toLowerCase();
      if (email.endsWith(E2E_EMAIL_DOMAIN) && u.created_at < cutoffIso) {
        staleUids.add(u.id);
      }
    }
    if (data.users.length < 200) break;
    page += 1;
  }

  const list = Array.from(staleUids);
  if (list.length > 0) {
    await cleanupUids(list);
  }
  return list.length;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  text: string;
  json: unknown;
}

export async function callEdge(
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
    Origin: options.origin ?? env.baseUrl,
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

export async function callRpc(
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

export async function callRestTable(
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

export interface SeedClassroomOptions {
  name?: string;
  subject?: string;
  gradeLevel?: string;
  description?: string;
  inviteEnabled?: boolean;
  isArchived?: boolean;
}

export interface SeededClassroom {
  id: string;
  teacherUid: string;
  name: string;
  inviteCode: string;
  inviteEnabled: boolean;
  isArchived: boolean;
}

export async function seedClassroom(
  run: E2eRunManifest,
  teacherUid: string,
  opts: SeedClassroomOptions = {}
): Promise<SeededClassroom> {
  const admin = createAdminClient();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const name = opts.name ?? `[E2E] Lớp ${run.runId.slice(-4)}-${suffix}`;
  const { data, error } = await admin
    .from('classrooms')
    .insert({
      teacher_uid: teacherUid,
      name,
      subject: opts.subject ?? 'Toán học',
      grade_level: opts.gradeLevel ?? '12',
      description: opts.description ?? 'Lớp kiểm thử E2E tự động',
      invite_enabled: opts.inviteEnabled ?? true,
      is_archived: opts.isArchived ?? false,
    })
    .select('id, teacher_uid, name, invite_code, invite_enabled, is_archived')
    .single();

  if (error || !data) {
    throw new Error(`seedClassroom failed: ${error?.message || 'Unknown error'}`);
  }
  run.classroomIds.push(data.id);
  return {
    id: data.id,
    teacherUid: data.teacher_uid,
    name: data.name,
    inviteCode: data.invite_code,
    inviteEnabled: data.invite_enabled,
    isArchived: data.is_archived,
  };
}

export interface SeedClassroomMemberEntry {
  email: string;
  studentUid?: string | null;
  memberName?: string;
  status?: 'active' | 'pending_invite' | 'removed';
  joinedVia?: 'code' | 'link' | 'teacher_email' | 'excel_import';
  addedBy?: string | null;
}

export async function addClassroomMembers(
  classroomId: string,
  entries: SeedClassroomMemberEntry[]
): Promise<void> {
  if (entries.length === 0) return;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const rows = entries.map((entry) => {
    const status = entry.status ?? (entry.studentUid ? 'active' : 'pending_invite');
    return {
      classroom_id: classroomId,
      student_uid: entry.studentUid ?? null,
      invited_email: entry.email.trim().toLowerCase(),
      member_name: entry.memberName ?? '',
      status,
      joined_via: entry.joinedVia ?? 'teacher_email',
      added_by: entry.addedBy ?? null,
      joined_at: status === 'active' ? now : null,
      updated_at: now,
    };
  });

  const { error } = await admin.from('classroom_members').upsert(rows, {
    onConflict: 'classroom_id,lower(btrim(invited_email))',
  });

  if (error) {
    // Fallback to plain insert when functional unique index cannot be referenced by PostgREST onConflict
    const { error: insertErr } = await admin.from('classroom_members').insert(rows);
    if (insertErr) {
      throw new Error(`addClassroomMembers failed: ${insertErr.message}`);
    }
  }
}

export interface SeedQuizQuestionInput {
  content: string;
  type?: 'single_choice' | 'multiple_choice' | 'true_false';
  options: Array<{ id: 'A' | 'B' | 'C' | 'D' | 'E'; content: string }>;
  correctAnswers: Array<'A' | 'B' | 'C' | 'D' | 'E'>;
  explanation?: string;
  points?: number;
}

export interface SeedQuizSettingsInput {
  durationMinutes?: number;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  allowReview?: boolean;
  maxAttempts?: number;
  passPercentage?: number;
  practiceEnabled?: boolean;
  publishScope?: 'public' | 'class_only';
  opensAt?: string | null;
  closesAt?: string | null;
  scoreVisibility?: 'immediate' | 'after_close' | 'never';
  answerVisibility?: 'immediate' | 'after_close' | 'never';
}

export interface SeedQuizOptions {
  title?: string;
  subject?: string;
  description?: string;
  status?: 'draft' | 'published' | 'closed';
  settings?: SeedQuizSettingsInput;
  questions?: SeedQuizQuestionInput[];
}

export interface SeededQuiz {
  id: string;
  code: string;
  title: string;
  status: 'draft' | 'published' | 'closed';
  questionIds: string[];
}

export async function seedQuiz(
  run: E2eRunManifest,
  teacherUid: string,
  opts: SeedQuizOptions = {}
): Promise<SeededQuiz> {
  const admin = createAdminClient();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const title = opts.title ?? `[E2E] Đề thi ${run.runId.slice(-4)}-${suffix}`;
  const status = opts.status ?? 'published';
  const answerVisibility =
    opts.settings?.answerVisibility ?? (opts.settings?.allowReview === false ? 'never' : 'immediate');

  const settings = {
    durationMinutes: opts.settings?.durationMinutes ?? 15,
    shuffleQuestions: opts.settings?.shuffleQuestions ?? false,
    shuffleOptions: opts.settings?.shuffleOptions ?? false,
    allowReview: opts.settings?.allowReview ?? answerVisibility !== 'never',
    maxAttempts: opts.settings?.maxAttempts ?? 0,
    passPercentage: opts.settings?.passPercentage ?? 50,
    practiceEnabled: opts.settings?.practiceEnabled ?? true,
    publishScope: opts.settings?.publishScope ?? 'public',
    opensAt: opts.settings?.opensAt ?? null,
    closesAt: opts.settings?.closesAt ?? null,
    scoreVisibility: opts.settings?.scoreVisibility ?? 'immediate',
    answerVisibility,
  };

  const { data: quizRow, error: quizErr } = await admin
    .from('quizzes')
    .insert({
      teacher_uid: teacherUid,
      title,
      subject: opts.subject ?? 'Toán học',
      description: opts.description ?? 'Đề thi kiểm thử E2E',
      status,
      settings,
    })
    .select('id, code, title, status')
    .single();

  if (quizErr || !quizRow) {
    throw new Error(`seedQuiz failed inserting quiz: ${quizErr?.message || 'Unknown error'}`);
  }
  run.quizIds.push(quizRow.id);

  const questions: SeedQuizQuestionInput[] = opts.questions ?? [
    {
      content: '[E2E] Câu 1: Giá trị của 6 + 4 là bao nhiêu?',
      type: 'single_choice',
      options: [
        { id: 'A', content: '9' },
        { id: 'B', content: '10' },
        { id: 'C', content: '11' },
        { id: 'D', content: '12' },
      ],
      correctAnswers: ['B'],
      explanation: '6 + 4 = 10',
      points: 2,
    },
    {
      content: '[E2E] Câu 2: Kết quả của 3 x 5 là bao nhiêu?',
      type: 'single_choice',
      options: [
        { id: 'A', content: '12' },
        { id: 'B', content: '14' },
        { id: 'C', content: '15' },
        { id: 'D', content: '18' },
      ],
      correctAnswers: ['C'],
      explanation: '3 x 5 = 15',
      points: 3,
    },
  ];

  const questionIds: string[] = [];
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    const { data: qRow, error: qErr } = await admin
      .from('questions')
      .insert({
        quiz_id: quizRow.id,
        ordinal: i + 1,
        content: q.content,
        type: q.type ?? 'single_choice',
        options: q.options,
        points: q.points ?? 1,
      })
      .select('id')
      .single();

    if (qErr || !qRow) {
      throw new Error(`seedQuiz failed inserting question ${i + 1}: ${qErr?.message || 'Unknown'}`);
    }
    questionIds.push(qRow.id);

    const { error: keyErr } = await admin.from('question_answer_keys').insert({
      question_id: qRow.id,
      correct_answers: q.correctAnswers,
      explanation: q.explanation ?? '',
    });
    if (keyErr) {
      throw new Error(`seedQuiz failed inserting answer key ${i + 1}: ${keyErr.message}`);
    }
  }

  return {
    id: quizRow.id,
    code: quizRow.code,
    title: quizRow.title,
    status: quizRow.status,
    questionIds,
  };
}

export interface SeedAssignmentOptions {
  assignedBy?: string | null;
  title?: string | null;
  instructions?: string;
  availableFrom?: string | null;
  dueAt?: string | null;
  latePolicy?: 'block_after_due' | 'allow_late';
  hardCloseAt?: string | null;
  maxAttemptsOverride?: number | null;
}

export interface SeededAssignment {
  id: string;
  classroomId: string;
  quizId: string;
  dueAt: string | null;
  latePolicy: 'block_after_due' | 'allow_late';
  hardCloseAt: string | null;
}

export async function seedAssignment(
  classroomId: string,
  quizId: string,
  opts: SeedAssignmentOptions = {}
): Promise<SeededAssignment> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('quiz_assignments')
    .upsert(
      {
        quiz_id: quizId,
        target_type: 'class',
        target_value: classroomId,
        classroom_id: classroomId,
        assigned_by: opts.assignedBy ?? null,
        title: opts.title ?? null,
        instructions: opts.instructions ?? '',
        available_from: opts.availableFrom ?? null,
        due_at: opts.dueAt ?? null,
        late_policy: opts.latePolicy ?? 'allow_late',
        hard_close_at: opts.hardCloseAt ?? null,
        max_attempts_override: opts.maxAttemptsOverride ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'quiz_id,target_type,target_value' }
    )
    .select('id, classroom_id, quiz_id, due_at, late_policy, hard_close_at')
    .single();

  if (error || !data) {
    throw new Error(`seedAssignment failed: ${error?.message || 'Unknown error'}`);
  }
  return {
    id: data.id,
    classroomId: data.classroom_id,
    quizId: data.quiz_id,
    dueAt: data.due_at,
    latePolicy: data.late_policy,
    hardCloseAt: data.hard_close_at,
  };
}

export interface SeedBugReportOptions {
  reporterRole?: 'student' | 'teacher' | 'admin';
  title?: string;
  description?: string;
  category?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  pageRoute?: string | null;
  contextMetadata?: Record<string, unknown>;
  status?: 'new' | 'in_progress' | 'resolved';
  adminResponse?: string | null;
  handledBy?: string | null;
}

export interface SeededBugReport {
  id: string;
  title: string;
  status: 'new' | 'in_progress' | 'resolved';
  reporterUid: string;
  reporterRole: 'student' | 'teacher' | 'admin';
}

export async function seedBugReport(
  run: E2eRunManifest,
  reporterUid: string,
  opts: SeedBugReportOptions = {}
): Promise<SeededBugReport> {
  const admin = createAdminClient();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const status = opts.status ?? 'new';
  const reporterRole = opts.reporterRole ?? 'student';
  const title = opts.title ?? `[E2E] Bug ${run.runId.slice(-4)}-${suffix}`;

  const { data, error } = await admin
    .from('bug_reports')
    .insert({
      reporter_uid: reporterUid,
      reporter_role: reporterRole,
      title,
      description: opts.description ?? 'Mô tả lỗi kiểm thử tự động E2E với đầy đủ thông tin.',
      category: opts.category ?? 'general',
      severity: opts.severity ?? 'medium',
      page_route: opts.pageRoute ?? `/${reporterRole}`,
      context_metadata: opts.contextMetadata ?? { role: reporterRole, source: 'e2e_seed' },
      status,
      admin_response: opts.adminResponse ?? null,
      handled_by: opts.handledBy ?? null,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    })
    .select('id, title, status, reporter_uid, reporter_role')
    .single();

  if (error || !data) {
    throw new Error(`seedBugReport failed: ${error?.message || 'Unknown error'}`);
  }
  run.bugReportIds.push(data.id);
  return {
    id: data.id,
    title: data.title,
    status: data.status,
    reporterUid: data.reporter_uid,
    reporterRole: data.reporter_role,
  };
}

export interface SeedNotificationOptions {
  actorUid?: string | null;
  type?: string;
  title?: string;
  body?: string;
  targetRoute?: string;
  metadata?: Record<string, unknown>;
  isRead?: boolean;
}

export interface SeededNotification {
  id: string;
  recipientUid: string;
  title: string;
  targetRoute: string;
  type: string;
}

export async function seedNotification(
  run: E2eRunManifest,
  recipientUid: string,
  opts: SeedNotificationOptions = {}
): Promise<SeededNotification> {
  const admin = createAdminClient();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const type = opts.type ?? 'system_notice';
  const title = opts.title ?? `[E2E] Thông báo ${suffix}`;
  const targetRoute = opts.targetRoute ?? '/student';
  const isRead = opts.isRead ?? false;

  const { data, error } = await admin
    .from('in_app_notifications')
    .insert({
      recipient_uid: recipientUid,
      actor_uid: opts.actorUid ?? null,
      type,
      title,
      body: opts.body ?? 'Nội dung thông báo kiểm thử E2E.',
      target_route: targetRoute,
      metadata: opts.metadata ?? {},
      is_read: isRead,
      read_at: isRead ? new Date().toISOString() : null,
    })
    .select('id, recipient_uid, title, target_route, type')
    .single();

  if (error || !data) {
    throw new Error(`seedNotification failed: ${error?.message || 'Unknown error'}`);
  }
  run.notificationIds.push(data.id);
  return {
    id: data.id,
    recipientUid: data.recipient_uid,
    title: data.title,
    targetRoute: data.target_route,
    type: data.type,
  };
}
