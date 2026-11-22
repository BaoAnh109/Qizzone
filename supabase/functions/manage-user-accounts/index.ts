import {
  bodyJson,
  cors,
  databaseAdmin,
  failure,
  identity,
  requireProfileAndRole,
  respond,
  structuredLog,
  type ProfileDbRow,
} from '../_shared/server.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DbClient = ReturnType<typeof databaseAdmin>;

async function resolveTargetProfile(db: DbClient, userId: string): Promise<ProfileDbRow> {
  const normalized = userId.trim();
  const { data: byUid, error: uidErr } = await db
    .from('profiles')
    .select('*')
    .eq('firebase_uid', normalized)
    .maybeSingle<ProfileDbRow>();
  if (uidErr) throw uidErr;
  if (byUid) return byUid;

  if (UUID_REGEX.test(normalized)) {
    const { data: byId, error: idErr } = await db
      .from('profiles')
      .select('*')
      .eq('id', normalized)
      .maybeSingle<ProfileDbRow>();
    if (idErr) throw idErr;
    if (byId) return byId;
  }

  throw new Error('PROFILE_NOT_FOUND');
}

async function syncTargetAuthMetadata(
  db: DbClient,
  uid: string,
  buildNextMeta: (existing: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  if (!UUID_REGEX.test(uid)) return;
  const { data: authUserRes, error } = await db.auth.admin.getUserById(uid);
  if (error || !authUserRes?.user) return;
  const current = (authUserRes.user.app_metadata || {}) as Record<string, unknown>;
  const nextAppMeta = buildNextMeta({ ...current });
  const { error: updateAuthErr } = await db.auth.admin.updateUserById(uid, {
    app_metadata: nextAppMeta,
  });
  if (updateAuthErr) throw updateAuthErr;
}

function resolveEffectiveActiveRole(
  row: Pick<ProfileDbRow, 'role' | 'teacher_request_status'>,
  userRoleActive?: string | null,
): 'student' | 'teacher' | 'admin' {
  if (userRoleActive === 'admin' || userRoleActive === 'teacher' || userRoleActive === 'student') {
    if (row.role === 'admin') return 'admin';
    if (row.role === 'teacher') return 'teacher';
    if (userRoleActive === 'teacher' && row.teacher_request_status === 'approved') return 'teacher';
    return 'student';
  }
  if (row.role === 'admin') return 'admin';
  if (row.role === 'teacher') return 'teacher';
  if (row.teacher_request_status === 'approved') return 'teacher';
  return 'student';
}

async function runSideEffect(
  requestId: string,
  label: string,
  op: PromiseLike<{ error?: unknown } | void>,
): Promise<void> {
  try {
    const res = await op;
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      structuredLog('warn', { requestId, sideEffect: label, error: res.error });
    }
  } catch (err) {
    structuredLog('warn', { requestId, sideEffect: label, error: String(err) });
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);
  const requestId = req.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    const auth = await identity(req);
    const db = databaseAdmin();
    await requireProfileAndRole(db, auth, ['admin']);

    const body = (await bodyJson(req, 8192)) as {
      action?: unknown;
      role?: unknown;
      includeAdmins?: unknown;
      userId?: unknown;
      isBlocked?: unknown;
      nextRole?: unknown;
      decision?: unknown;
    };

    if (body.action === 'list') {
      let query = db
        .from('profiles')
        .select(
          'id, firebase_uid, email, full_name, role, approval_status, teacher_request_status, teacher_request_blocked, avatar_url, created_at',
        )
        .order('created_at', { ascending: false });

      if (body.role === 'teacher') {
        query = query.or('role.eq.teacher,and(role.eq.student,teacher_request_status.eq.approved)');
      } else if (body.role === 'student') {
        query = query.eq('role', 'student');
      } else if (body.role === 'admin') {
        query = query.eq('role', 'admin');
      } else if (body.role === 'all' || body.includeAdmins === true) {
        query = query.in('role', ['admin', 'teacher', 'student']);
      } else {
        query = query.in('role', ['teacher', 'student']);
      }

      const [accountsRes, quizzesRes, classroomsRes, membersRes, attemptsRes, userRolesRes] =
        await Promise.all([
          query,
          db.from('quizzes').select('teacher_uid'),
          db.from('classrooms').select('teacher_uid'),
          db
            .from('classroom_members')
            .select('student_uid')
            .eq('status', 'active')
            .not('student_uid', 'is', null),
          db
            .from('exam_attempts')
            .select('student_uid')
            .not('submitted_at', 'is', null),
          db.from('user_roles').select('user_uid, active_role'),
        ]);

      if (accountsRes.error) throw accountsRes.error;
      if (quizzesRes.error) throw quizzesRes.error;
      if (classroomsRes.error) throw classroomsRes.error;
      if (membersRes.error) throw membersRes.error;
      if (attemptsRes.error) throw attemptsRes.error;
      if (userRolesRes.error) throw userRolesRes.error;

      const quizCounts = new Map<string, number>();
      for (const q of quizzesRes.data || []) {
        quizCounts.set(q.teacher_uid, (quizCounts.get(q.teacher_uid) || 0) + 1);
      }

      const ownedClassroomCounts = new Map<string, number>();
      for (const c of classroomsRes.data || []) {
        ownedClassroomCounts.set(c.teacher_uid, (ownedClassroomCounts.get(c.teacher_uid) || 0) + 1);
      }

      const enrolledClassroomCounts = new Map<string, number>();
      for (const m of membersRes.data || []) {
        if (m.student_uid) {
          enrolledClassroomCounts.set(m.student_uid, (enrolledClassroomCounts.get(m.student_uid) || 0) + 1);
        }
      }

      const submissionCounts = new Map<string, number>();
      for (const a of attemptsRes.data || []) {
        submissionCounts.set(a.student_uid, (submissionCounts.get(a.student_uid) || 0) + 1);
      }

      const activeRoleMap = new Map<string, string>();
      for (const ur of userRolesRes.data || []) {
        activeRoleMap.set(ur.user_uid, ur.active_role);
      }

      const enriched = (accountsRes.data || []).map(row => {
        const uid = row.firebase_uid;
        const ownedCount = ownedClassroomCounts.get(uid) || 0;
        const enrolledCount = enrolledClassroomCounts.get(uid) || 0;
        const classroomCount =
          row.role === 'teacher'
            ? ownedCount
            : row.teacher_request_status === 'approved'
              ? ownedCount + enrolledCount
              : enrolledCount;
        const activeRole = resolveEffectiveActiveRole(
          row as ProfileDbRow,
          activeRoleMap.get(uid) || null,
        );

        return {
          ...row,
          is_blocked: row.approval_status === 'rejected',
          quiz_count: quizCounts.get(uid) || 0,
          submission_count: submissionCounts.get(uid) || 0,
          base_role: row.role,
          active_role: activeRole,
          classroom_count: classroomCount,
          owned_classroom_count: ownedCount,
          enrolled_classroom_count: enrolledCount,
        };
      });

      return respond(req, { accounts: enriched }, 200, requestId);
    }

    if (body.action === 'detail') {
      if (typeof body.userId !== 'string' || !body.userId.trim()) {
        throw new Error('INVALID_INPUT');
      }
      const target = await resolveTargetProfile(db, body.userId);
      const uid = target.firebase_uid;

      const [
        userRoleRes,
        ownedClassroomsRes,
        enrolledMembersRes,
        quizzesRes,
        attemptsRes,
        resultsRes,
      ] = await Promise.all([
        db.from('user_roles').select('active_role').eq('user_uid', uid).maybeSingle(),
        db
          .from('classrooms')
          .select('id, name, subject, grade_level, invite_code, is_archived, created_at')
          .eq('teacher_uid', uid)
          .order('created_at', { ascending: false }),
        db
          .from('classroom_members')
          .select('classroom_id, classrooms!inner(id, name, subject, grade_level, invite_code, is_archived, created_at)')
          .eq('student_uid', uid)
          .eq('status', 'active'),
        db
          .from('quizzes')
          .select('id, title, subject, code, status, created_at, updated_at')
          .eq('teacher_uid', uid)
          .order('created_at', { ascending: false }),
        db
          .from('exam_attempts')
          .select('id, submitted_at')
          .eq('student_uid', uid),
        db
          .from('exam_results')
          .select('id, payload, created_at, exam_attempts!inner(student_uid, is_late, submitted_at)')
          .eq('exam_attempts.student_uid', uid)
          .order('created_at', { ascending: false }),
      ]);

      if (userRoleRes.error) throw userRoleRes.error;
      if (ownedClassroomsRes.error) throw ownedClassroomsRes.error;
      if (enrolledMembersRes.error) throw enrolledMembersRes.error;
      if (quizzesRes.error) throw quizzesRes.error;
      if (attemptsRes.error) throw attemptsRes.error;
      if (resultsRes.error) throw resultsRes.error;

      type ClassroomRow = {
        id: string;
        name: string;
        subject: string;
        grade_level: string;
        invite_code: string;
        is_archived: boolean;
        created_at: string;
      };

      const ownedList = (ownedClassroomsRes.data || []) as ClassroomRow[];
      const enrolledList = (enrolledMembersRes.data || [])
        .map(item => (item as { classrooms: ClassroomRow | ClassroomRow[] | null }).classrooms)
        .flatMap(cls => (cls ? (Array.isArray(cls) ? cls : [cls]) : []));

      const allClassroomIds = Array.from(
        new Set([...ownedList.map(c => c.id), ...enrolledList.map(c => c.id)]),
      );
      const quizIds = (quizzesRes.data || []).map(q => q.id);

      const [classMemberCountsRes, classAssignCountsRes, questionCountsRes] = await Promise.all([
        allClassroomIds.length > 0
          ? db
              .from('classroom_members')
              .select('classroom_id')
              .in('classroom_id', allClassroomIds)
              .eq('status', 'active')
          : Promise.resolve({ data: [], error: null }),
        allClassroomIds.length > 0
          ? db
              .from('quiz_assignments')
              .select('classroom_id')
              .in('classroom_id', allClassroomIds)
          : Promise.resolve({ data: [], error: null }),
        quizIds.length > 0
          ? db.from('questions').select('quiz_id').in('quiz_id', quizIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (classMemberCountsRes.error) throw classMemberCountsRes.error;
      if (classAssignCountsRes.error) throw classAssignCountsRes.error;
      if (questionCountsRes.error) throw questionCountsRes.error;

      const memberCountByClass = new Map<string, number>();
      for (const m of classMemberCountsRes.data || []) {
        memberCountByClass.set(m.classroom_id, (memberCountByClass.get(m.classroom_id) || 0) + 1);
      }

      const assignCountByClass = new Map<string, number>();
      for (const a of classAssignCountsRes.data || []) {
        if (a.classroom_id) {
          assignCountByClass.set(a.classroom_id, (assignCountByClass.get(a.classroom_id) || 0) + 1);
        }
      }

      const questionCountByQuiz = new Map<string, number>();
      for (const qn of questionCountsRes.data || []) {
        questionCountByQuiz.set(qn.quiz_id, (questionCountByQuiz.get(qn.quiz_id) || 0) + 1);
      }

      const classrooms = [
        ...ownedList.map(c => ({
          id: c.id,
          name: c.name,
          subject: c.subject,
          gradeLevel: c.grade_level,
          inviteCode: c.invite_code,
          isArchived: c.is_archived,
          relationship: 'owner' as const,
          memberCount: memberCountByClass.get(c.id) || 0,
          assignmentCount: assignCountByClass.get(c.id) || 0,
          createdAt: c.created_at,
        })),
        ...enrolledList.map(c => ({
          id: c.id,
          name: c.name,
          subject: c.subject,
          gradeLevel: c.grade_level,
          inviteCode: c.invite_code,
          isArchived: c.is_archived,
          relationship: 'member' as const,
          memberCount: memberCountByClass.get(c.id) || 0,
          assignmentCount: assignCountByClass.get(c.id) || 0,
          createdAt: c.created_at,
        })),
      ];

      const quizzes = (quizzesRes.data || []).map(q => ({
        id: q.id,
        title: q.title,
        subject: q.subject,
        code: q.code,
        status: q.status,
        totalQuestions: questionCountByQuiz.get(q.id) || 0,
        createdAt: q.created_at,
        updatedAt: q.updated_at,
      }));

      const allAttempts = attemptsRes.data || [];
      const submittedCount = allAttempts.filter(a => Boolean(a.submitted_at)).length;
      const allResults = resultsRes.data || [];

      let scoreSum = 0;
      let scoreCount = 0;
      const recentResults = allResults.slice(0, 20).map(r => {
        const payload = (r.payload || {}) as Record<string, unknown>;
        const attemptMeta = r.exam_attempts as { is_late?: boolean; submitted_at?: string } | null;
        const numericScore = typeof payload.score === 'number' ? payload.score : null;
        return {
          id: r.id,
          quizId: typeof payload.quizId === 'string' ? payload.quizId : '',
          quizTitle: typeof payload.quizTitle === 'string' ? payload.quizTitle : 'Đề thi',
          subject: typeof payload.subject === 'string' ? payload.subject : '',
          score: numericScore,
          percentage: typeof payload.percentage === 'number' ? payload.percentage : null,
          isPassed: payload.isPassed === true,
          isLate: Boolean(attemptMeta?.is_late ?? payload.isLate),
          submittedAt:
            typeof payload.submittedAt === 'string'
              ? payload.submittedAt
              : attemptMeta?.submitted_at || r.created_at,
        };
      });

      for (const r of allResults) {
        const payload = (r.payload || {}) as Record<string, unknown>;
        if (typeof payload.score === 'number' && Number.isFinite(payload.score)) {
          scoreSum += payload.score;
          scoreCount += 1;
        }
      }

      const activeRole = resolveEffectiveActiveRole(
        target,
        userRoleRes.data?.active_role || null,
      );
      const ownedCount = ownedList.length;
      const enrolledCount = enrolledList.length;
      const classroomCount =
        target.role === 'teacher'
          ? ownedCount
          : target.teacher_request_status === 'approved'
            ? ownedCount + enrolledCount
            : enrolledCount;

      return respond(
        req,
        {
          profile: {
            id: target.id || target.firebase_uid,
            firebaseUid: target.firebase_uid,
            email: target.email,
            fullName: target.full_name,
            role: target.role,
            baseRole: target.role,
            activeRole,
            approvalStatus: target.approval_status,
            teacherRequestStatus: target.teacher_request_status || 'none',
            teacherRequestBlocked: Boolean(target.teacher_request_blocked),
            isBlocked: target.approval_status === 'rejected',
            avatarUrl: target.avatar_url || null,
            quizCount: quizzes.length,
            classroomCount,
            ownedClassroomCount: ownedCount,
            enrolledClassroomCount: enrolledCount,
            submissionCount: submittedCount,
            createdAt: target.created_at,
          },
          stats: {
            classroomCount,
            ownedClassroomCount: ownedCount,
            enrolledClassroomCount: enrolledCount,
            quizCount: quizzes.length,
            attemptCount: allAttempts.length,
            resultCount: allResults.length,
            avgScore: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 100) / 100 : null,
          },
          classrooms,
          quizzes,
          recentResults,
        },
        200,
        requestId,
      );
    }

    if (body.action === 'toggle_block') {
      if (typeof body.userId !== 'string' || !body.userId.trim() || typeof body.isBlocked !== 'boolean') {
        throw new Error('INVALID_INPUT');
      }

      const target = await resolveTargetProfile(db, body.userId);
      if (target.firebase_uid === auth.uid) throw new Error('CANNOT_MODIFY_SELF');
      if (target.role === 'admin') throw new Error('FORBIDDEN');

      const now = new Date().toISOString();
      const nextStatus = body.isBlocked ? 'rejected' : 'approved';
      const { data: userRoleRow, error: userRoleErr } = await db
        .from('user_roles')
        .select('active_role')
        .eq('user_uid', target.firebase_uid)
        .maybeSingle<{ active_role: string }>();
      if (userRoleErr) throw userRoleErr;
      const activeRole = resolveEffectiveActiveRole(target, userRoleRow?.active_role ?? null);

      const { data: updated, error: updateError } = await db
        .from('profiles')
        .update({
          approval_status: nextStatus,
          reviewed_at: now,
          reviewed_by: auth.uid,
          updated_at: now,
        })
        .eq('firebase_uid', target.firebase_uid)
        .select()
        .single();
      if (updateError) throw updateError;

      await Promise.all([
        runSideEffect(
          requestId,
          'toggle_block.syncTargetAuthMetadata',
          syncTargetAuthMetadata(db, target.firebase_uid, nextAppMeta => {
            if (body.isBlocked) {
              delete nextAppMeta.role;
              delete nextAppMeta.app_role;
              nextAppMeta.account_status = 'rejected';
            } else {
              nextAppMeta.role = 'authenticated';
              nextAppMeta.app_role = activeRole;
              nextAppMeta.account_status = 'approved';
            }
            return nextAppMeta;
          }),
        ),
        runSideEffect(
          requestId,
          'toggle_block.role_audit_logs',
          db.from('role_audit_logs').insert({
            actor_uid: auth.uid,
            target_uid: target.firebase_uid,
            action: body.isBlocked ? 'block_account' : 'unblock_account',
          }),
        ),
        runSideEffect(
          requestId,
          'toggle_block.in_app_notifications',
          db.from('in_app_notifications').insert({
            recipient_uid: target.firebase_uid,
            actor_uid: auth.uid,
            type: 'account_status',
            title: body.isBlocked ? 'Tài khoản đã bị khóa' : 'Tài khoản đã được mở khóa',
            body: body.isBlocked
              ? 'Quản trị viên đã tạm khóa quyền truy cập tài khoản của bạn.'
              : 'Quản trị viên đã mở khóa lại tài khoản của bạn.',
            target_route: `/${activeRole}`,
            metadata: { isBlocked: body.isBlocked },
          }),
        ),
      ]);

      structuredLog('info', {
        requestId,
        action: 'toggle_block',
        adminUid: auth.uid,
        targetUid: target.firebase_uid,
        isBlocked: body.isBlocked,
      });
      return respond(req, { profile: updated }, 200, requestId);
    }

    if (body.action === 'change_role') {
      if (
        typeof body.userId !== 'string' ||
        !body.userId.trim() ||
        (body.nextRole !== 'student' && body.nextRole !== 'teacher' && body.nextRole !== 'admin')
      ) {
        throw new Error('INVALID_INPUT');
      }

      const nextRole = body.nextRole;
      const target = await resolveTargetProfile(db, body.userId);
      if (target.firebase_uid === auth.uid) throw new Error('CANNOT_MODIFY_SELF');

      if (target.role === 'admin' && nextRole !== 'admin') {
        const { count, error: adminCountErr } = await db
          .from('profiles')
          .select('firebase_uid', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('approval_status', 'approved');
        if (adminCountErr) throw adminCountErr;
        if ((count || 0) <= 1) {
          throw new Error('LAST_ADMIN_PROTECTED');
        }
      }

      const now = new Date().toISOString();
      const nextTeacherReqStatus =
        nextRole === 'teacher' ? 'approved' : nextRole === 'admin' ? 'none' : 'none';
      const profileUpdate: Record<string, unknown> = {
        role: nextRole,
        teacher_request_status: nextTeacherReqStatus,
        reviewed_at: now,
        reviewed_by: auth.uid,
        updated_at: now,
      };
      if (nextRole === 'teacher' || nextRole === 'admin') {
        profileUpdate.teacher_request_blocked = false;
      }
      if (nextRole === 'teacher') {
        profileUpdate.teacher_reviewed_at = now;
        profileUpdate.teacher_reviewed_by = auth.uid;
      }

      const { data: updated, error: updateErr } = await db
        .from('profiles')
        .update(profileUpdate)
        .eq('firebase_uid', target.firebase_uid)
        .select()
        .single();
      if (updateErr) throw updateErr;

      const targetRoute =
        nextRole === 'admin' ? '/admin/accounts' : nextRole === 'teacher' ? '/teacher' : '/student';
      const roleLabel =
        nextRole === 'admin' ? 'Quản trị viên' : nextRole === 'teacher' ? 'Giáo viên' : 'Học sinh';

      const ops: Promise<void>[] = [
        runSideEffect(
          requestId,
          'change_role.user_roles',
          db.from('user_roles').upsert(
            {
              user_uid: target.firebase_uid,
              base_role: nextRole,
              active_role: nextRole,
              updated_at: now,
            },
            { onConflict: 'user_uid' },
          ),
        ),
        runSideEffect(
          requestId,
          'change_role.role_audit_logs',
          db.from('role_audit_logs').insert({
            actor_uid: auth.uid,
            target_uid: target.firebase_uid,
            action: 'admin_change_role',
            previous_role: target.role,
            new_role: nextRole,
          }),
        ),
        runSideEffect(
          requestId,
          'change_role.in_app_notifications',
          db.from('in_app_notifications').insert({
            recipient_uid: target.firebase_uid,
            actor_uid: auth.uid,
            type: 'role_changed',
            title: 'Vai trò tài khoản đã được cập nhật',
            body: `Quản trị viên đã chuyển vai trò tài khoản của bạn sang ${roleLabel}.`,
            target_route: targetRoute,
            metadata: { previousRole: target.role, nextRole },
          }),
        ),
      ];

      if (updated.approval_status === 'approved') {
        ops.push(
          runSideEffect(
            requestId,
            'change_role.syncTargetAuthMetadata',
            syncTargetAuthMetadata(db, target.firebase_uid, nextAppMeta => {
              nextAppMeta.role = 'authenticated';
              nextAppMeta.app_role = nextRole;
              nextAppMeta.account_status = 'approved';
              delete nextAppMeta.requested_role;
              return nextAppMeta;
            }),
          ),
        );
      }

      await Promise.all(ops);

      structuredLog('info', {
        requestId,
        action: 'change_role',
        adminUid: auth.uid,
        targetUid: target.firebase_uid,
        previousRole: target.role,
        nextRole,
      });
      return respond(req, { profile: updated, active_role: nextRole }, 200, requestId);
    }

    if (body.action === 'review_teacher') {
      if (
        typeof body.userId !== 'string' ||
        !body.userId.trim() ||
        (body.decision !== 'approve' && body.decision !== 'reject')
      ) {
        throw new Error('INVALID_INPUT');
      }

      const decision = body.decision;
      const target = await resolveTargetProfile(db, body.userId);
      if (target.firebase_uid === auth.uid) throw new Error('CANNOT_MODIFY_SELF');
      if (target.role === 'admin') throw new Error('FORBIDDEN');

      const now = new Date().toISOString();
      const nextStatus = decision === 'approve' ? 'approved' : 'rejected';
      const isLegacyTeacher = target.role === 'teacher';

      const profileUpdate = isLegacyTeacher
        ? {
            approval_status: nextStatus,
            teacher_request_status: nextStatus,
            ...(decision === 'approve' ? { teacher_request_blocked: false } : {}),
            reviewed_at: now,
            reviewed_by: auth.uid,
            teacher_reviewed_at: now,
            teacher_reviewed_by: auth.uid,
            updated_at: now,
          }
        : {
            teacher_request_status: nextStatus,
            ...(decision === 'approve' ? { teacher_request_blocked: false } : {}),
            teacher_reviewed_at: now,
            teacher_reviewed_by: auth.uid,
            updated_at: now,
          };

      const { data: updated, error: updateErr } = await db
        .from('profiles')
        .update(profileUpdate)
        .eq('firebase_uid', target.firebase_uid)
        .select()
        .single();
      if (updateErr) throw updateErr;

      const ops: Promise<void>[] = [
        runSideEffect(
          requestId,
          'review_teacher.syncTargetAuthMetadata',
          syncTargetAuthMetadata(db, target.firebase_uid, nextAppMeta => {
            if (isLegacyTeacher) {
              if (decision === 'approve') {
                nextAppMeta.role = 'authenticated';
                nextAppMeta.app_role = 'teacher';
                nextAppMeta.account_status = 'approved';
                delete nextAppMeta.requested_role;
              } else {
                delete nextAppMeta.role;
                delete nextAppMeta.app_role;
                nextAppMeta.account_status = 'rejected';
                nextAppMeta.requested_role = 'teacher';
              }
            } else {
              nextAppMeta.role = 'authenticated';
              if (decision === 'reject' && nextAppMeta.app_role === 'teacher') {
                nextAppMeta.app_role = 'student';
              } else if (!nextAppMeta.app_role) {
                nextAppMeta.app_role = 'student';
              }
              nextAppMeta.account_status = updated.approval_status;
              delete nextAppMeta.requested_role;
            }
            return nextAppMeta;
          }),
        ),
        runSideEffect(
          requestId,
          'review_teacher.role_audit_logs',
          db.from('role_audit_logs').insert({
            actor_uid: auth.uid,
            target_uid: target.firebase_uid,
            action: isLegacyTeacher
              ? decision === 'approve'
                ? 'approve_teacher'
                : 'reject_teacher'
              : `${decision}_teacher_access`,
            previous_role: target.role,
            new_role: isLegacyTeacher ? (decision === 'approve' ? 'teacher' : 'rejected') : 'student',
          }),
        ),
        runSideEffect(
          requestId,
          'review_teacher.enqueue_notification',
          db.rpc('enqueue_notification', {
            p_recipient_uid: target.firebase_uid,
            p_event_type: 'teacher_approval',
            p_template_code: 'teacher_approval',
            p_payload: {
              fullName: target.full_name,
              decision: decision === 'approve' ? 'Đã phê duyệt quyền giáo viên' : 'Đã bị từ chối',
            },
            p_idempotency_key: `teacher-approval-${target.firebase_uid}-${now.slice(0, 16)}`,
          }),
        ),
        runSideEffect(
          requestId,
          'review_teacher.in_app_notifications',
          db.from('in_app_notifications').insert({
            recipient_uid: target.firebase_uid,
            actor_uid: auth.uid,
            type: 'teacher_approval',
            title:
              decision === 'approve'
                ? 'Quyền giáo viên đã được duyệt'
                : 'Yêu cầu quyền giáo viên bị từ chối',
            body:
              decision === 'approve'
                ? 'Bạn đã được cấp quyền giáo viên. Bạn có thể chuyển sang giao diện Giáo viên để quản lý lớp học và đề thi.'
                : 'Yêu cầu quyền giáo viên của bạn chưa được chấp thuận.',
            target_route: decision === 'approve' ? '/teacher' : '/student',
            metadata: { decision, requestKind: isLegacyTeacher ? 'legacy_teacher' : 'student_switch' },
          }),
        ),
      ];

      if (!isLegacyTeacher) {
        ops.push(
          runSideEffect(
            requestId,
            'review_teacher.teacher_requests',
            db.from('teacher_requests').upsert(
              {
                user_uid: target.firebase_uid,
                status: nextStatus,
                ...(decision === 'approve' ? { blocked: false } : {}),
                reviewed_at: now,
                reviewed_by: auth.uid,
                updated_at: now,
              },
              { onConflict: 'user_uid' },
            ),
          ),
        );
        if (decision === 'reject') {
          ops.push(
            runSideEffect(
              requestId,
              'review_teacher.user_roles',
              db.from('user_roles').upsert(
                {
                  user_uid: target.firebase_uid,
                  base_role: 'student',
                  active_role: 'student',
                  updated_at: now,
                },
                { onConflict: 'user_uid' },
              ),
            ),
          );
        }
      }

      await Promise.all(ops);

      structuredLog('info', {
        requestId,
        action: 'review_teacher',
        adminUid: auth.uid,
        targetUid: target.firebase_uid,
        decision,
      });
      return respond(req, { profile: updated }, 200, requestId);
    }

    throw new Error('INVALID_INPUT');
  } catch (error) {
    return failure(req, error, requestId);
  }
});
