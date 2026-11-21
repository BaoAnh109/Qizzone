import {
  bodyJson,
  cors,
  databaseAdmin,
  failure,
  identity,
  requireProfileAndRole,
  respond,
  structuredLog,
} from '../_shared/server.ts';

const REQUEST_COLUMNS =
  'id,firebase_uid,email,full_name,role,approval_status,approval_requested_at,teacher_request_status,teacher_request_blocked,teacher_requested_at,created_at';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);
  const requestId = req.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    const auth = await identity(req);
    const db = databaseAdmin();
    await requireProfileAndRole(db, auth, ['admin']);

    const body = (await bodyJson(req, 4096)) as {
      action?: unknown;
      firebaseUid?: unknown;
      targetUid?: unknown;
      blocked?: unknown;
    };

    if (body.action === 'list') {
      const { data: matchedRows, error: listError } = await db
        .from('profiles')
        .select(REQUEST_COLUMNS)
        .or(
          'and(role.eq.student,teacher_request_status.eq.pending),and(role.eq.student,teacher_request_blocked.eq.true),and(role.eq.teacher,approval_status.eq.pending)',
        );
      if (listError) throw listError;

      type RequestRow = {
        firebase_uid: string;
        teacher_requested_at: string | null;
        approval_requested_at: string | null;
        created_at: string;
        [key: string]: unknown;
      };
      const rows = new Map<string, RequestRow>();
      for (const row of matchedRows || []) {
        rows.set(row.firebase_uid, row);
      }
      const requests = [...rows.values()].sort((left, right) => {
        const leftDate = left.teacher_requested_at || left.approval_requested_at || left.created_at;
        const rightDate = right.teacher_requested_at || right.approval_requested_at || right.created_at;
        return new Date(leftDate).getTime() - new Date(rightDate).getTime();
      });
      return respond(req, { requests }, 200, requestId);
    }

    const targetUid =
      typeof body.targetUid === 'string' && body.targetUid
        ? body.targetUid
        : typeof body.firebaseUid === 'string' && body.firebaseUid
          ? body.firebaseUid
          : '';
    if (!targetUid) throw new Error('INVALID_INPUT');

    if (body.action === 'set_blocked') {
      if (typeof body.blocked !== 'boolean') throw new Error('INVALID_INPUT');
      const { data: target, error: targetError } = await db
        .from('profiles')
        .select('firebase_uid,role')
        .eq('firebase_uid', targetUid)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target || target.role !== 'student') throw new Error('INVALID_INPUT');

      const now = new Date().toISOString();
      const { data, error } = await db
        .from('profiles')
        .update({ teacher_request_blocked: body.blocked, updated_at: now })
        .eq('firebase_uid', target.firebase_uid)
        .select()
        .single();
      if (error) throw error;

      await Promise.all([
        db.from('teacher_requests').upsert(
          { user_uid: target.firebase_uid, blocked: body.blocked, updated_at: now },
          { onConflict: 'user_uid' },
        ),
        db.from('role_audit_logs').insert({
          actor_uid: auth.uid,
          target_uid: target.firebase_uid,
          action: body.blocked ? 'block_teacher_request' : 'unblock_teacher_request',
        }),
      ]);

      structuredLog('info', {
        requestId,
        action: 'set_teacher_request_blocked',
        adminUid: auth.uid,
        targetUid: target.firebase_uid,
        blocked: body.blocked,
      });
      return respond(req, { profile: data }, 200, requestId);
    }

    if (body.action !== 'approve' && body.action !== 'reject') throw new Error('INVALID_INPUT');

    const { data: target, error: targetError } = await db
      .from('profiles')
      .select('*')
      .eq('firebase_uid', targetUid)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) throw new Error('INVALID_INPUT');

    const isStudentRequest = target.role === 'student' && target.teacher_request_status === 'pending';
    const isLegacyTeacherRequest = target.role === 'teacher' && target.approval_status === 'pending';
    if (!isStudentRequest && !isLegacyTeacherRequest) throw new Error('INVALID_INPUT');

    const { data: targetAuthUser } = await db.auth.admin.getUserById(target.firebase_uid);
    const nextAppMeta = { ...((targetAuthUser?.user?.app_metadata || {}) as Record<string, unknown>) };
    const now = new Date().toISOString();

    if (isStudentRequest) {
      const nextStatus = body.action === 'approve' ? 'approved' : 'rejected';
      const { data, error } = await db
        .from('profiles')
        .update({
          teacher_request_status: nextStatus,
          teacher_reviewed_at: now,
          teacher_reviewed_by: auth.uid,
          updated_at: now,
        })
        .eq('firebase_uid', target.firebase_uid)
        .select()
        .single();
      if (error) throw error;

      nextAppMeta.role = 'authenticated';
      nextAppMeta.app_role = 'student';
      nextAppMeta.account_status = 'approved';
      delete nextAppMeta.requested_role;

      await Promise.all([
        db.auth.admin.updateUserById(target.firebase_uid, { app_metadata: nextAppMeta }),
        db.from('teacher_requests').upsert(
          {
            user_uid: target.firebase_uid,
            status: nextStatus,
            reviewed_at: now,
            reviewed_by: auth.uid,
            updated_at: now,
          },
          { onConflict: 'user_uid' },
        ),
        db.from('role_audit_logs').insert({
          actor_uid: auth.uid,
          target_uid: target.firebase_uid,
          action: `${body.action}_teacher_access`,
          previous_role: 'student',
          new_role: 'student',
        }),
        db.rpc('enqueue_notification', {
          p_recipient_uid: target.firebase_uid,
          p_event_type: 'teacher_approval',
          p_template_code: 'teacher_approval',
          p_payload: {
            fullName: target.full_name,
            decision: body.action === 'approve' ? 'Đã phê duyệt quyền giáo viên' : 'Đã bị từ chối',
          },
          p_idempotency_key: `teacher-approval-${target.firebase_uid}-${now.slice(0, 16)}`,
        }),
      ]);

      return respond(req, { profile: data }, 200, requestId);
    }

    if (body.action === 'approve') {
      const { data, error } = await db
        .from('profiles')
        .update({
          approval_status: 'approved',
          teacher_request_status: 'approved',
          reviewed_at: now,
          reviewed_by: auth.uid,
          teacher_reviewed_at: now,
          teacher_reviewed_by: auth.uid,
          updated_at: now,
        })
        .eq('firebase_uid', target.firebase_uid)
        .select()
        .single();
      if (error) throw error;

      nextAppMeta.role = 'authenticated';
      nextAppMeta.app_role = 'teacher';
      nextAppMeta.account_status = 'approved';
      delete nextAppMeta.requested_role;
      await Promise.all([
        db.auth.admin.updateUserById(target.firebase_uid, { app_metadata: nextAppMeta }),
        db.from('role_audit_logs').insert({
          actor_uid: auth.uid,
          target_uid: target.firebase_uid,
          action: 'approve_teacher',
          previous_role: 'teacher',
          new_role: 'teacher',
        }),
      ]);
      return respond(req, { profile: data }, 200, requestId);
    }

    delete nextAppMeta.role;
    delete nextAppMeta.app_role;
    nextAppMeta.account_status = 'rejected';
    nextAppMeta.requested_role = 'teacher';
    const { data, error } = await db
      .from('profiles')
      .update({
        approval_status: 'rejected',
        teacher_request_status: 'rejected',
        reviewed_at: now,
        reviewed_by: auth.uid,
        teacher_reviewed_at: now,
        teacher_reviewed_by: auth.uid,
        updated_at: now,
      })
      .eq('firebase_uid', target.firebase_uid)
      .select()
      .single();
    if (error) throw error;

    await Promise.all([
      db.auth.admin.updateUserById(target.firebase_uid, { app_metadata: nextAppMeta }),
      db.from('role_audit_logs').insert({
        actor_uid: auth.uid,
        target_uid: target.firebase_uid,
        action: 'reject_teacher',
        previous_role: 'teacher',
        new_role: 'rejected',
      }),
    ]);

    return respond(req, { profile: data }, 200, requestId);
  } catch (error) {
    return failure(req, error, requestId);
  }
});
